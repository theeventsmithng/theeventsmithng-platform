// GET  /api/events — list every event, newest first. Powers the admin
//      dashboard, the Events sidebar screen, and the event picker on the
//      Team & Client Access screen. Requires an admin session (any tier —
//      this is read access, not the super-admin-only team/client gate).
// POST /api/events
// Body: { names, eventTypeId, templateId?, planningStartDate, eventDate,
//         firstComponentName, ...briefFields }
//
// Cloning happens here, once, at creation time — editing the template later
// never retroactively changes events already created from it (Section 3).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const session = await resolveSession(req.cookies.get("tes_session")?.value ?? "");
  if (!session || session.type !== "admin") {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }

  const events = await db.event.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      eventType: true,
      components: { orderBy: { date: "asc" } },
      authorisedEmails: { select: { email: true } },
    },
  });

  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    names,
    eventTypeId,
    templateId,
    planningStartDate,
    eventDate,
    firstComponentName,
    location,
    primaryVenue,
    expectedGuests,
    theme,
    colours,
    hashtag,
  } = body;

  if (!names || !eventTypeId) {
    return NextResponse.json({ error: "names and eventTypeId are required." }, { status: 400 });
  }

  const event = await db.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        names,
        eventTypeId,
        templateId: templateId ?? null,
        planningStartDate: planningStartDate ? new Date(planningStartDate) : null,
        location,
        primaryVenue,
        expectedGuests,
        theme,
        colours,
        hashtag,
      },
    });

    // Always create at least one component so budget/itinerary have
    // somewhere to attach to, even for single-component events.
    const component = await tx.eventComponent.create({
      data: {
        eventId: created.id,
        name: firstComponentName || names,
        date: eventDate ? new Date(eventDate) : null,
        guestCount: expectedGuests ?? null,
      },
    });

    if (templateId) {
      const template = await tx.eventTemplate.findUnique({
        where: { id: templateId },
        include: {
          phases: { include: { tasks: true }, orderBy: { order: "asc" } },
          budgetCategories: { orderBy: { order: "asc" } },
        },
      });

      if (template) {
        // Clone planning phases + tasks. Actual dates get computed by a
        // separate scheduling pass (see src/lib/scheduling.ts) once anchor
        // offsets and the event's planning start/event dates are known —
        // kept out of this endpoint to keep creation fast and dumb.
        for (const phase of template.phases) {
          const clonedPhase = await tx.planningPhase.create({
            data: {
              eventId: created.id,
              order: phase.order,
              name: phase.name,
              focusPoint: phase.focusPoint,
              explanation: phase.explanation,
              anchorType: phase.anchorType,
              anchorOffsetDays: phase.anchorOffsetDays,
              triggerPhaseOrder: phase.triggerPhaseOrder,
              triggerThresholdPct: phase.triggerThresholdPct,
            },
          });

          for (const task of phase.tasks) {
            await tx.task.create({
              data: {
                planningPhaseId: clonedPhase.id,
                label: task.label,
                priority: task.defaultPriority,
                notes: task.notes,
              },
            });
          }
        }

        // Clone budget categories onto the first component. Additional
        // components created later start empty and are built up manually,
        // since category needs genuinely differ by component (per the
        // Wedding-vs-Trad "Engagement Area" example in the blueprint).
        for (const cat of template.budgetCategories) {
          await tx.budgetCategory.create({
            data: {
              eventComponentId: component.id,
              order: cat.order,
              name: cat.name,
            },
          });
        }
      }
    }

    await tx.activityLogEntry.create({
      data: { eventId: created.id, action: "Event created", metadata: { templateId } },
    });

    return created;
  });

  return NextResponse.json(event, { status: 201 });
}
