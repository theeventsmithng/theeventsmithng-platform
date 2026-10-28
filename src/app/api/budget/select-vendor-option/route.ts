// POST /api/budget/select-vendor-option
// Body: { lineItemId: string, optionId: string }
//
// Marks one VendorOption as SELECTED and every sibling option on the same
// line item as REJECTED (never deleted — history stays queryable). The line
// item's committedAmount is then set to the selected option's quotedAmount,
// which is what every category/subtotal/grand-total calculation reads from.
// If the option isn't yet linked to a real Vendor record, one is created so
// the vendor immediately shows up in the Vendor Directory and Payment
// Tracker without re-typing anything.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { lineItemId, optionId } = await req.json();

  if (!lineItemId || !optionId) {
    return NextResponse.json({ error: "lineItemId and optionId are required." }, { status: 400 });
  }

  const result = await db.$transaction(async (tx) => {
    const lineItem = await tx.budgetLineItem.findUnique({
      where: { id: lineItemId },
      include: { vendorOptions: true, category: { include: { eventComponent: true } } },
    });

    if (!lineItem) throw new Error("Line item not found");
    if (lineItem.fulfilmentMode !== "COMPETING_OPTIONS") {
      throw new Error("This line item is not in competing-options mode.");
    }

    const chosen = lineItem.vendorOptions.find((o) => o.id === optionId);
    if (!chosen) throw new Error("Option not found on this line item");

    // Auto-create or link the real Vendor record if this option hasn't
    // been tied to one yet.
    let vendorId = chosen.vendorId;
    if (!vendorId && chosen.vendorNameFreeText) {
      const eventId = lineItem.category.eventComponent.eventId;
      // Falls back to a generic "Uncategorised" vendor category — the
      // planner can recategorise from the Vendor Directory afterward.
      const fallbackCategory = await tx.vendorCategory.upsert({
        where: { name: "Uncategorised" },
        update: {},
        create: { name: "Uncategorised", isCustom: true },
      });
      const vendor = await tx.vendor.create({
        data: {
          eventId,
          categoryId: fallbackCategory.id,
          businessName: chosen.vendorNameFreeText,
        },
      });
      vendorId = vendor.id;
    }

    await tx.vendorOption.updateMany({
      where: { lineItemId },
      data: { status: "REJECTED" },
    });
    await tx.vendorOption.update({
      where: { id: optionId },
      data: { status: "SELECTED", vendorId },
    });

    const updatedLineItem = await tx.budgetLineItem.update({
      where: { id: lineItemId },
      data: { committedAmount: chosen.quotedAmount },
    });

    await tx.activityLogEntry.create({
      data: {
        eventId: lineItem.category.eventComponent.eventId,
        action: "Vendor selected",
        metadata: { lineItemId, optionId, vendorId },
      },
    });

    return updatedLineItem;
  });

  return NextResponse.json(result);
}
