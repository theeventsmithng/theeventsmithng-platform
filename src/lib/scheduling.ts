// src/lib/scheduling.ts
//
// Turns a PlanningPhase's anchor (FORWARD_FROM_START / BACKWARD_FROM_EVENT_DATE
// / PHASE_COMPLETION) into a real calendar date for a specific event, using
// that event's own Planning Start Date and Event Date — this is the
// "adjusts based on the actual timeline" logic confirmed in conversation.
//
// Call recomputeEventSchedule(eventId) any time an event's planning start
// date, event date, or a phase's task-completion status changes.

import { db } from "./db";
import { AnchorType } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

interface ComputedDate {
  phaseId: string;
  suggestedStartDate: Date | null;
  suggestedEndDate: Date | null;
}

/**
 * Computes suggestedStartDate/suggestedEndDate for every PlanningPhase on an
 * event, then persists the results. Phases are processed in `order` so that
 * PHASE_COMPLETION anchors can look at the already-computed dates and
 * progress of the phase they depend on.
 */
export async function recomputeEventSchedule(eventId: string): Promise<ComputedDate[]> {
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      planningPhases: {
        include: { tasks: true },
        orderBy: { order: "asc" },
      },
      components: true,
    },
  });

  if (!event) throw new Error("Event not found");
  if (!event.planningStartDate) {
    // Nothing to compute yet — the UI should prompt for a Planning Start
    // Date before showing any dates, rather than guessing one.
    return [];
  }

  // Event Date isn't a field on Event itself (each EventComponent has its
  // own date, per the multi-component model) — for anchor purposes we use
  // the earliest component date, since that's what "the event" means for
  // scheduling purposes even when components span a few days.
  const componentDates = event.components.map((c) => c.date).filter((d): d is Date => !!d);
  const eventDate = componentDates.length > 0 ? new Date(Math.min(...componentDates.map((d) => d.getTime()))) : null;

  const results: ComputedDate[] = [];
  // Track computed date ranges by phase order, so PHASE_COMPLETION anchors
  // can reference "when phase N's tasks hit threshold%".
  const phaseCompletionDate: Record<number, Date> = {};

  for (const phase of event.planningPhases) {
    let suggestedStartDate: Date | null = null;
    let suggestedEndDate: Date | null = null;

    if (phase.anchorType === AnchorType.FORWARD_FROM_START) {
      const offset = phase.anchorOffsetDays ?? 0;
      suggestedStartDate = new Date(event.planningStartDate.getTime() + offset * DAY_MS);
      // End date defaults to the next phase's start, resolved in a second
      // pass below once all forward/backward dates are known.
    } else if (phase.anchorType === AnchorType.BACKWARD_FROM_EVENT_DATE) {
      if (!eventDate) {
        // Can't compute yet — at least one component needs a date set.
        results.push({ phaseId: phase.id, suggestedStartDate: null, suggestedEndDate: null });
        continue;
      }
      const offset = phase.anchorOffsetDays ?? 0;
      suggestedStartDate = new Date(eventDate.getTime() - offset * DAY_MS);
      suggestedEndDate = suggestedStartDate;
    } else if (phase.anchorType === AnchorType.PHASE_COMPLETION) {
      const triggerOrder = phase.triggerPhaseOrder;
      const triggerDate = triggerOrder ? phaseCompletionDate[triggerOrder] : undefined;
      if (triggerDate) {
        suggestedStartDate = triggerDate;
      } else {
        // The referenced phase hasn't been marked complete enough yet — no
        // date to show until it is. The UI should display this phase's
        // anchor as "Starts once [Phase name] is ~X% complete" instead of a
        // date, exactly as the prototype already does.
        results.push({ phaseId: phase.id, suggestedStartDate: null, suggestedEndDate: null });
        continue;
      }
    }

    results.push({ phaseId: phase.id, suggestedStartDate, suggestedEndDate });

    // If this phase is complete enough to satisfy a threshold, record when
    // that happened so a later PHASE_COMPLETION-anchored phase can use it.
    // Uses each task's real completedAt where available (set by the task
    // update endpoint), falling back to "now" only for tasks marked
    // complete before completedAt existed on older records.
    const completedTasks = phase.tasks.filter((t) => t.status === "COMPLETED");
    const pct = phase.tasks.length > 0 ? (completedTasks.length / phase.tasks.length) * 100 : 0;
    const threshold = phase.triggerThresholdPct ?? 90;
    if (pct >= threshold && suggestedStartDate) {
      // The threshold is "crossed" at the moment the task that tipped it
      // over was completed — i.e. the completedAt of the Nth task once
      // sorted, where N is the threshold count. Using the latest
      // completedAt among the required tasks is a reasonable, simple stand-in.
      const requiredCount = Math.ceil((threshold / 100) * phase.tasks.length);
      const sortedCompletions = completedTasks
        .map((t) => t.completedAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => a.getTime() - b.getTime());
      const triggerMoment = sortedCompletions[requiredCount - 1] ?? new Date();
      phaseCompletionDate[phase.order] = triggerMoment;
    }
  }

  // Second pass: give FORWARD_FROM_START phases an end date equal to the
  // next phase's start date, so the UI can show a clean range rather than
  // an open-ended start.
  for (let i = 0; i < results.length; i++) {
    if (results[i].suggestedEndDate === null && results[i].suggestedStartDate) {
      const next = results[i + 1];
      results[i].suggestedEndDate = next?.suggestedStartDate ?? results[i].suggestedStartDate;
    }
  }

  await db.$transaction(
    results.map((r) =>
      db.planningPhase.update({
        where: { id: r.phaseId },
        data: { suggestedStartDate: r.suggestedStartDate, suggestedEndDate: r.suggestedEndDate },
      })
    )
  );

  return results;
}
