// POST /api/vendors/[vendorId]/payments
// Body: {
//   amount, paidAt, paymentMethod?, paidBy ("EVENTSMITH_NG" | "CLIENT_DIRECT"),
//   paidByPersonName?, fundAllocationId?, notes?
// }
//
// Updates the vendor's running amountPaid/balance and, when this payment is
// linked to a BudgetLineItem (via the vendor's VendorOption/VendorAllocation
// records), keeps that line item's amountPaid in sync too — so the number
// only ever lives in one place conceptually, even though it's denormalised
// onto both records for fast reads.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: { vendorId: string } }) {
  const { vendorId } = params;
  const body = await req.json();
  const { amount, paidAt, paymentMethod, paidBy, paidByPersonName, fundAllocationId, notes } = body;

  if (!amount || !paidAt) {
    return NextResponse.json({ error: "amount and paidAt are required." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({
      where: { id: vendorId },
      include: {
        vendorOptions: { where: { status: "SELECTED" } },
        vendorAllocations: true,
      },
    });
    if (!vendor) throw new Error("Vendor not found");

    const payment = await tx.vendorPayment.create({
      data: {
        vendorId,
        amount,
        paidAt: new Date(paidAt),
        paymentMethod,
        paidBy: paidBy ?? "EVENTSMITH_NG",
        paidByPersonName,
        fundAllocationId: fundAllocationId ?? null,
        notes,
      },
    });

    // Propagate to whichever BudgetLineItem this vendor is committed on —
    // via a selected competing option or a split-fulfilment allocation.
    const lineItemIds = new Set<string>();
    vendor.vendorOptions.forEach((o) => lineItemIds.add(o.lineItemId));
    vendor.vendorAllocations.forEach((a) => lineItemIds.add(a.lineItemId));

    for (const lineItemId of lineItemIds) {
      await tx.budgetLineItem.update({
        where: { id: lineItemId },
        data: { amountPaid: { increment: amount } },
      });
    }

    await tx.activityLogEntry.create({
      data: {
        eventId: vendor.eventId,
        action: "Vendor payment made",
        metadata: { vendorId, amount, paidBy },
      },
    });

    return payment;
  });

  return NextResponse.json(result, { status: 201 });
}
