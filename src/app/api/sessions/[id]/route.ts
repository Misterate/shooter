import { NextRequest, NextResponse } from "next/server";
import {
  getSessionById,
  getSessionQuestions,
  updateQuestionAnswer,
  markSessionComplete,
  upsertAxisScores,
  getAllAxisScores,
  getAxisScoresForSession,
} from "@/lib/db";
import { computeSessionScores } from "@/lib/scoring";
import type { AnswerPayload } from "@/types";

export const dynamic = "force-dynamic";

// PATCH /api/sessions/[id] — save answers and compute scores
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = getSessionById(params.id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const body = await req.json();
    const answers: AnswerPayload[] = body.answers;

    if (!answers || !Array.isArray(answers)) {
      return NextResponse.json(
        { error: "answers array is required" },
        { status: 400 }
      );
    }

    // Save each answer
    for (const { questionId, answer } of answers) {
      updateQuestionAnswer(questionId, answer);
    }

    // If marking complete, compute scores
    if (body.complete === true) {
      const questions = getSessionQuestions(params.id);

      // Build existing scores map from all previous axis_scores
      const allPriorScores = getAllAxisScores();
      // Filter out scores from this session (shouldn't exist yet, but be safe)
      const priorScores = allPriorScores.filter(
        (s) => s.session_id !== params.id
      );

      // Build a map: axisId -> { runningScore (latest), sessionCount }
      const existingScores = new Map<
        string,
        { runningScore: number; sessionCount: number }
      >();

      // Group by axisId, ordered by session date so last one is most recent
      for (const score of priorScores) {
        const existing = existingScores.get(score.axis_id);
        if (!existing) {
          existingScores.set(score.axis_id, {
            runningScore: score.score,
            sessionCount: 1,
          });
        } else {
          existingScores.set(score.axis_id, {
            runningScore: score.score,
            sessionCount: existing.sessionCount + 1,
          });
        }
      }

      const newScores = computeSessionScores(params.id, questions, existingScores);
      upsertAxisScores(newScores);
      markSessionComplete(params.id);

      const savedScores = getAxisScoresForSession(params.id);
      return NextResponse.json({ ok: true, scores: savedScores });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}
