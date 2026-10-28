// PATCH /api/tasks/[taskId]
// Body: { status: "NOT_STARTED" | "IN_PROGRESS" | "WAITING" | "COMPLETED", ... }
//
// completedAt is set/cleared here (not left to the client to supply) so it
// always reflects the real moment a task was marked done — this is what
// scheduling.ts reads to give PHASE_COMPLETION-anchored phases (e.g.
// Coordination) an accurate trigger date instead of a guess.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recomputeEventSchedule } from "@/lib/scheduling";

export async function PATCH(req: NextRequest, { params }: { params: { taskId: string } }) {
  const { taskId } = params;
  const body = await req.json();

  const existing = await db.task.findUnique({
    where: { id: taskId },
    include: { planningPhase: true },
  });
  if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const becomingCompleted = body.status === "COMPLETED" && existing.status !== "COMPLETED";
  const leavingCompleted = body.status && body.status !== "COMPLETED" && existing.status === "COMPLETED";

  const updated = await db.task.update({
    where: { id: taskId },
    data: {
      ...(body.status ? { status: body.status } : {}),
      ...(body.priority ? { priority: body.priority } : {}),
      ...(body.dueDate ? { dueDate: new Date(body.dueDate) } : {}),
      ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(becomingCompleted ? { completedAt: new Date() } : {}),
      ...(leavingCompleted ? { completedAt: null } : {}),
    },
  });

  await db.activityLogEntry.create({
    data: {
      eventId: (
        await db.planningPhase.findUniqueOrThrow({ where: { id: existing.planningPhaseId } })
      ).eventId,
      action: becomingCompleted ? "Task completed" : "Task updated",
      metadata: { taskId, label: existing.label },
    },
  });

  // A task flipping to/from COMPLETED can change whether a downstream
  // PHASE_COMPLETION-anchored phase now has a trigger date, so recompute.
  if (becomingCompleted || leavingCompleted) {
    const phase = await db.planningPhase.findUnique({ where: { id: existing.planningPhaseId } });
    if (phase) await recomputeEventSchedule(phase.eventId);
  }

  return NextResponse.json(updated);
}
