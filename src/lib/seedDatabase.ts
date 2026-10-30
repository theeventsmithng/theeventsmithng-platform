// src/lib/seedDatabase.ts
//
// Shared seeding logic — used by both prisma/seed.ts (local `prisma db seed`,
// its own standalone PrismaClient) and the one-time production bootstrap
// route (src/app/api/admin/bootstrap/route.ts, reusing the app's shared `db`
// singleton). Keeping this in one place means the production database ends
// up with exactly the same super-admin + Wedding template content as a
// local seed would produce, run however it's triggered.
//
// Populates the Wedding event type with a real template built from the
// analysis in Section 0/6 of the blueprint — not placeholder data. This is
// deliberately the ONLY event type seeded with full content (per the
// confirmed Phase 1 scope): the template *mechanism* below works for any
// event type, but only Wedding has real content behind it so far.

import type { PrismaClient } from "@prisma/client";

// The one account that always has access. This seed is idempotent (upsert
// on email) and is the only place isProtected is ever set to true — the
// app layer refuses to change that flag or deactivate/delete a protected
// row, so this is the permanent root of the team/client-authorisation
// chain, not just a default that happens to be unset.
const SUPER_ADMIN_EMAIL = "theeventsmithng@gmail.com";

export async function seedDatabase(prisma: PrismaClient) {
  await prisma.adminUser.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: {
      // Re-assert on every seed run, in case something downstream ever
      // tried to change it — this account cannot be downgraded by a seed.
      tier: "SUPER_ADMIN",
      isActive: true,
      isProtected: true,
    },
    create: {
      email: SUPER_ADMIN_EMAIL,
      name: "The EventSmith NG",
      tier: "SUPER_ADMIN",
      isActive: true,
      isProtected: true,
    },
  });
  console.log(`Seeded permanent super admin: ${SUPER_ADMIN_EMAIL}`);

  // ---- Event Types (mechanism supports all of these; only Wedding has a template) ----
  const eventTypeNames = [
    "Wedding",
    "Traditional Wedding",
    "Birthday",
    "Anniversary",
    "Corporate Event",
    "Private Celebration",
    "Dinner",
    "Conference",
    "Product Launch",
    "Custom Event",
  ];

  const eventTypes: Record<string, { id: string }> = {};
  for (const name of eventTypeNames) {
    eventTypes[name] = await prisma.eventType.upsert({
      where: { name },
      update: {},
      create: { name, isCustom: name === "Custom Event" },
    });
  }

  // The rest of this (template, phases, tasks, vendor/budget categories,
  // document folders) is NOT upsert-based in the original design — so guard
  // the whole block on whether the Wedding template already exists, rather
  // than letting a second run (e.g. the bootstrap route hit twice) create
  // duplicate phases/tasks every time.
  const existingTemplate = await prisma.eventTemplate.findFirst({
    where: { eventTypeId: eventTypes["Wedding"].id, name: "Standard Wedding Template v1" },
  });

  if (existingTemplate) {
    console.log("Wedding template already exists — skipping template/phase/task seeding.");
    return;
  }

  const weddingTemplate = await prisma.eventTemplate.create({
    data: {
      eventTypeId: eventTypes["Wedding"].id,
      name: "Standard Wedding Template v1",
    },
  });

  // ---- Vendor categories, tiered by the risk-based priority logic ----
  // Tier 1: book earliest — highest impact-if-wrong + highest scarcity risk.
  // Tier 2: food & drinks — after Tier 1, per the confirmed sequencing.
  // Tier 3: guest management + logistics (logistics folded in, no separate phase).
  const vendorCategoryTiers: Array<[string, number]> = [
    ["Venue", 1],
    ["Decor / Lighting / SFX", 1],
    ["Photography", 1],
    ["Videography", 1],
    ["Content Creation", 1],
    ["Live Band / DJ / MC", 1],
    ["Bridal Styling (Stylist, MUA, Hair)", 1], // Production/Styling folded into Tier 1, per discussion
    ["Cake", 2],
    ["Main Catering", 2],
    ["Drinks Service", 2],
    ["Smallchops / Fingerfoods", 2],
    ["Guest Access / Invitations", 3],
    ["Front of House Staff (Bouncers, Hostesses, LASTMA)", 3],
    ["Accommodation & Logistics", 3], // folded into Guest Management tier, no dedicated phase
    ["Afterparty Vendors", 3],
  ];

  for (const [name, tier] of vendorCategoryTiers) {
    await prisma.templateVendorCategory.create({
      data: { templateId: weddingTemplate.id, name, priorityTier: tier },
    });
  }

  // ---- Budget categories, matching the real workbook's category list ----
  const budgetCategoryNames = [
    "Venue",
    "Decor/Lighting/SFX",
    "Entertainment",
    "Media",
    "Fine Dining",
    "Confectionaries",
    "Drinks",
    "Fingerfoods",
    "Front of House Staff",
    "Stationaries",
    "Accommodation",
    "Logistics",
    "Wardrobe/Styling",
    "Afterparty",
  ];
  for (let i = 0; i < budgetCategoryNames.length; i++) {
    await prisma.templateBudgetCategory.create({
      data: { templateId: weddingTemplate.id, order: i, name: budgetCategoryNames[i] },
    });
  }

  // ---- Document folders ----
  const documentFolders = [
    "Planning Contract & Invoices",
    "Vendor Contracts & Quotes",
    "Moodboard",
    "Floor Plans & Seating",
    "Guest List",
    "Event Flow / Food Flow",
    "Receipts",
  ];
  for (const name of documentFolders) {
    await prisma.templateDocumentFolder.create({ data: { templateId: weddingTemplate.id, name } });
  }

  // ---- Planning phases, anchors, and tasks — straight from the analysed schedule ----
  // Anchor model (confirmed): most phases flex forward from Planning Start;
  // the vendor meeting is pinned backward from the Event Date regardless of
  // total runway; Coordination triggers off Phase 2's completion, not a
  // fixed date.
  const phase1 = await prisma.templatePhase.create({
    data: {
      templateId: weddingTemplate.id,
      order: 1,
      name: "Wedding Framework",
      focusPoint: "The Foundation Phase",
      explanation:
        "Laying the groundwork for the entire planning process — from the wedding logo to venue booking and budget creation.",
      anchorType: "FORWARD_FROM_START",
      anchorOffsetDays: 0,
      priorityRationale: "Venue and framework decisions gate everything downstream; done first by necessity, not risk ranking.",
    },
  });
  for (const [order, label] of Object.entries([
    "Planner's contract & booking deposit",
    "Venue sourcing, review of terms & booking",
    "Logo/hashtag creation",
    "Save the Date creation",
    "Selection of wedding theme & colours",
    "Moodboard creation",
    "Budget creation",
  ])) {
    await prisma.templateTask.create({
      data: { phaseId: phase1.id, order: Number(order), label },
    });
  }

  const phase2 = await prisma.templatePhase.create({
    data: {
      templateId: weddingTemplate.id,
      order: 2,
      name: 'Building the "A" Team',
      focusPoint: "Selection & booking of priority vendors",
      explanation:
        "Book earliest whoever has the highest impact if they get it wrong (large, brief-interpretive deliverables like decor) and the highest scarcity risk (in-demand vendors a competing client could poach). Styling/production sits here too, for the same lead-time reasoning.",
      anchorType: "FORWARD_FROM_START",
      anchorOffsetDays: 60,
      priorityRationale: "Risk-based: impact-if-wrong + scarcity, not a fixed category list (see blueprint Section 6).",
    },
  });
  for (const [order, label] of Object.entries([
    "Aesthetics partners (decorator, lighting/SFX, rentals)",
    "Media team (photographer, videographer, content creator)",
    "Entertainment crew (live band, DJ, alaga, dancers, MC, hypeman)",
    "Bridal/groom styling team (stylist, MUA, hairstylist)",
  ])) {
    await prisma.templateTask.create({ data: { phaseId: phase2.id, order: Number(order), label } });
  }

  const phase3 = await prisma.templatePhase.create({
    data: {
      templateId: weddingTemplate.id,
      order: 3,
      name: "The Banqueting/Confectionery Team",
      focusPoint: "Selection & booking of all food & drinks vendors",
      explanation: "Comes after the A-Team tier, as confirmed — food & drinks are not scarcity-critical in the same way.",
      anchorType: "FORWARD_FROM_START",
      anchorOffsetDays: 120,
    },
  });
  for (const [order, label] of Object.entries([
    "Wedding cake",
    "Main food vendor",
    "Drinks",
    "Smallchops",
    "Fingerfoods/grills",
    "Desserts",
    "Cocktails/mocktails",
  ])) {
    await prisma.templateTask.create({ data: { phaseId: phase3.id, order: Number(order), label } });
  }

  const phase4 = await prisma.templatePhase.create({
    data: {
      templateId: weddingTemplate.id,
      order: 4,
      name: "Guest Management Team",
      focusPoint: "From invitations & access cards to front-of-house staff",
      explanation: "Logistics/accommodation is folded in here rather than getting its own phase, per discussion.",
      anchorType: "FORWARD_FROM_START",
      anchorOffsetDays: 180,
    },
  });
  for (const [order, label] of Object.entries([
    "Invitation/access card design, production & distribution",
    "Guestlist creation (if using digital invites)",
    "Hostesses, bouncers, LASTMA",
    "Accommodation & transport logistics",
  ])) {
    await prisma.templateTask.create({ data: { phaseId: phase4.id, order: Number(order), label } });
  }

  const phase5 = await prisma.templatePhase.create({
    data: {
      templateId: weddingTemplate.id,
      order: 5,
      name: "Afterparty Planning",
      focusPoint: "All things afterparty",
      anchorType: "FORWARD_FROM_START",
      anchorOffsetDays: 180,
    },
  });
  for (const [order, label] of Object.entries([
    "Afterparty props",
    "DJ/hypeman (if different from main event)",
    "Lounge sets/afterparty lighting",
  ])) {
    await prisma.templateTask.create({ data: { phaseId: phase5.id, order: Number(order), label } });
  }

  const phase6 = await prisma.templatePhase.create({
    data: {
      templateId: weddingTemplate.id,
      order: 6,
      name: "The Coordination Phase",
      focusPoint: 'Actual "planning" is done — time to execute',
      explanation: "Triggers once Phase 2 (A-Team) is essentially complete, not on a fixed calendar date.",
      anchorType: "PHASE_COMPLETION",
      triggerPhaseOrder: 2,
      triggerThresholdPct: 90,
    },
  });
  for (const [order, label] of Object.entries([
    "Scheduling pre-wedding shoot",
    "Creation of the coordination checklist",
    "Event flow / food flow",
    "Floorplan",
  ])) {
    await prisma.templateTask.create({ data: { phaseId: phase6.id, order: Number(order), label } });
  }

  const phase7 = await prisma.templatePhase.create({
    data: {
      templateId: weddingTemplate.id,
      order: 7,
      name: "Vendor Meeting",
      focusPoint: "Final vendor walkthrough at the venue",
      explanation: "Stays fixed at ~2-3 weeks before the event regardless of total planning length — confirmed as non-negotiable.",
      anchorType: "BACKWARD_FROM_EVENT_DATE",
      anchorOffsetDays: 18,
    },
  });
  await prisma.templateTask.create({
    data: { phaseId: phase7.id, order: 1, label: "Vendors meeting — 2-3 weeks before the event, at the venue" },
  });

  console.log("Seed complete: Wedding template created with", 7, "phases.");
}
