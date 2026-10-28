// POST /api/funds/allocate
// Body: {
//   eventId, amountReceived, receivedAt, payerType, payerNameFreeText, purposeNote,
//   allocations: [{ amount, budgetLineItemId?, vendorId?, notes? }, ...]
// }
//
// Implements the exact pattern from the Payments Breakdown analysis:
// one incoming payment (e.g. ₦1,000,000 from "Peace") can be split across
// several purposes (e.g. ₦450,000 Content Creator + ₦550,000 Cake) in a
// single record, rather than looking like two unrelated payments.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { eventId, amountReceived, receivedAt, payerType, payerNameFreeText, purposeNote, paymentReference, allocations } = body;

  if (!eventId || !amountReceived || !receivedAt || !Array.isArray(allocations) || allocations.length === 0) {
    return NextResponse.json(
      { error: "eventId, amountReceived, receivedAt and at least one allocation are required." },
      { status: 400 }
    );
  }

  const allocationSum = allocations.reduce((s: number, a: { amount: number }) => s + a.amount, 0);
  if (Math.abs(allocationSum - amountReceived) > 0.01) {
    return NextResponse.json(
      { error: `Allocations (${allocationSum}) must sum to the amount received (${amountReceived}).` },
      { status: 400 }
    );
  }

  const fund = await db.$transaction(async (tx) => {
    const createdFund = await tx.incomingClientFund.create({
      data: {
        eventId,
        amountReceived,
        receivedAt: new Date(receivedAt),
        payerType: payerType ?? "CLIENT",
        payerNameFreeText,
        purposeNote,
        paymentReference,
      },
    });

    for (const alloc of allocations) {
      await tx.fundAllocation.create({
        data: {
          fundId: createdFund.id,
          amount: alloc.amount,
          budgetLineItemId: alloc.budgetLineItemId ?? null,
          vendorId: alloc.vendorId ?? null,
          notes: alloc.notes ?? null,
        },
      });
    }

    await tx.activityLogEntry.create({
      data: {
        eventId,
        action: "Funds received from client",
        metadata: { amountReceived, allocationCount: allocations.length },
      },
    });

    return createdFund;
  });

  return NextResponse.json(fund, { status: 201 });
}
