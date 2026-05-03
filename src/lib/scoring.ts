import type { SessionQuestion, SecondaryAxis, AxisScore } from "@/types";

const ANSWER_VALUES: Record<string, number> = {
  yes: 1,
  somewhat: 0,
  no: -1,
};

interface AxisContribution {
  axisId: string;
  contribution: number; // weighted raw value
  weight: number;
}

/**
 * Computes per-axis raw contributions from a set of answered questions.
 * Each question contributes to its primary axis (weight 1.0) and optionally
 * secondary axes (weight 0.3–0.5 as specified).
 * direction: 1 means yes = positive score, -1 means yes = negative score.
 */
function computeRawContributions(
  questions: SessionQuestion[]
): Map<string, { totalWeightedScore: number; totalWeight: number }> {
  const axisData = new Map<
    string,
    { totalWeightedScore: number; totalWeight: number }
  >();

  for (const q of questions) {
    if (!q.answer) continue;

    const rawValue = ANSWER_VALUES[q.answer] ?? 0;
    const directedValue = rawValue * q.direction;

    // Primary axis (weight 1.0)
    const primary = axisData.get(q.primary_axis_id) ?? {
      totalWeightedScore: 0,
      totalWeight: 0,
    };
    primary.totalWeightedScore += directedValue * 1.0;
    primary.totalWeight += 1.0;
    axisData.set(q.primary_axis_id, primary);

    // Secondary axes
    let secondaryAxes: SecondaryAxis[] = [];
    try {
      secondaryAxes = JSON.parse(q.secondary_axes);
    } catch {
      // ignore parse errors
    }

    for (const sa of secondaryAxes) {
      const w = sa.weight ?? 0.3;
      const secondary = axisData.get(sa.axisId) ?? {
        totalWeightedScore: 0,
        totalWeight: 0,
      };
      secondary.totalWeightedScore += directedValue * w;
      secondary.totalWeight += w;
      axisData.set(sa.axisId, secondary);
    }
  }

  return axisData;
}

/**
 * Converts raw average (typically -1 to 1) to -10..10 scale.
 */
function scaleToRange(value: number): number {
  return Math.max(-10, Math.min(10, value * 10));
}

/**
 * Computes rolling weighted average across all sessions.
 * More recent sessions get slightly higher weight.
 * @param sessionContributions ordered oldest-first list of raw contributions per axis
 * @param currentContribution the new session's contribution
 * @param sessionIndex 0-based index of the current session (used for recency weighting)
 * @param totalSessions total number of sessions including current
 */
function rollingAverage(
  previousScore: number | null,
  previousWeight: number,
  newContribution: number,
  recencyBonus: number = 1.2
): number {
  if (previousScore === null) {
    return newContribution;
  }
  const totalWeight = previousWeight + recencyBonus;
  return (
    (previousScore * previousWeight + newContribution * recencyBonus) /
    totalWeight
  );
}

/**
 * Given the answered questions for a new session and existing axis scores
 * (keyed by axisId -> most recent running score + session count),
 * computes new running axis scores.
 */
export function computeSessionScores(
  sessionId: string,
  questions: SessionQuestion[],
  existingScores: Map<
    string,
    { runningScore: number; sessionCount: number }
  >
): Omit<AxisScore, "id">[] {
  const rawContributions = computeRawContributions(questions);
  const results: Omit<AxisScore, "id">[] = [];

  for (const [axisId, data] of rawContributions.entries()) {
    if (data.totalWeight === 0) continue;

    const rawAvg = data.totalWeightedScore / data.totalWeight;
    const rawContribution = scaleToRange(rawAvg);

    const existing = existingScores.get(axisId);
    let newScore: number;

    if (!existing || existing.sessionCount === 0) {
      newScore = rawContribution;
    } else {
      // Give recent session ~20% more weight
      const recencyBonus = 1.2;
      const totalWeight = existing.sessionCount + recencyBonus;
      newScore =
        (existing.runningScore * existing.sessionCount +
          rawContribution * recencyBonus) /
        totalWeight;
      newScore = Math.max(-10, Math.min(10, newScore));
    }

    results.push({
      session_id: sessionId,
      axis_id: axisId,
      score: Math.round(newScore * 100) / 100,
      raw_contribution: Math.round(rawContribution * 100) / 100,
    });
  }

  return results;
}
