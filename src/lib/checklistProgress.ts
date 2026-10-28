// src/lib/checklistProgress.ts
//
// Implements the confirmed weighting approach: tasks in earlier planning
// phases count for more toward the overall progress percentage than tasks
// in later phases (reflecting that early decisions — venue, A-Team booking
// — carry more weight than late-stage admin tasks). Explicitly a starting
// point per the conversation — swap the weight curve below if it doesn't
// feel right once the platform is in real use.

import { db } from "./db";

/**
 * Weight curve: phase 1 counts most, decaying by phase order. Simple and
 * legible rather than clever — easy to see why a given event's progress
 * number is what it is, easy to retune later.
 *
 * order 1 -> weight 7, order 2 -> weight 6, ... floor of 1.
 */
function phaseWeight(order: number, totalPhases: number): number {
  return Math.max(totalPhases - order + 1, 1);
}

export async function computeEventProgress(eventId: string): Promise<{
  overallPct: number;
  perPhase: { phaseId: string; name: string; weight: number; pct: number }[];
}> {
  const phases = await db.planningPhase.findMany({
    where: { eventId },
    include: { tasks: true },
    orderBy: { order: "asc" },
  });

  if (phases.length === 0) return { overallPct: 0, perPhase: [] };

  let weightedSum = 0;
  let weightTotal = 0;
  const perPhase = phases.map((phase) => {
    const weight = phaseWeight(phase.order, phases.length);
    const total = phase.tasks.length;
    const done = phase.tasks.filter((t) => t.status === "COMPLETED").length;
    const pct = total > 0 ? (done / total) * 100 : 0;

    weightedSum += pct * weight;
    weightTotal += weight;

    return { phaseId: phase.id, name: phase.name, weight, pct: Math.round(pct) };
  });

  const overallPct = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;

  return { overallPct, perPhase };
}
