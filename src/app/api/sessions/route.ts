import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createSession,
  getAllSessions,
  getAxisScoresForSession,
  insertSessionQuestions,
} from "@/lib/db";
import type { ClaudeQuestion, SessionWithScores } from "@/types";

export const dynamic = "force-dynamic";

// GET /api/sessions — list all sessions with scores
export async function GET() {
  try {
    const sessions = getAllSessions();
    const result: SessionWithScores[] = sessions.map((s) => ({
      ...s,
      scores: getAxisScoresForSession(s.id),
    }));
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error listing sessions:", error);
    return NextResponse.json(
      { error: "Failed to list sessions" },
      { status: 500 }
    );
  }
}

// POST /api/sessions — create a new session and store questions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // body: { questions: ClaudeQuestion[] }
    const questions: ClaudeQuestion[] = body.questions;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { error: "questions array is required" },
        { status: 400 }
      );
    }

    const session = createSession();

    // Store questions with full metadata
    const sessionQuestions = questions.map((q, i) => ({
      id: uuidv4(),
      session_id: session.id,
      question_text: q.text,
      primary_axis_id: q.primaryAxisId,
      secondary_axes: JSON.stringify(q.secondaryAxes ?? []),
      direction: q.direction,
    }));

    insertSessionQuestions(sessionQuestions);

    return NextResponse.json({
      sessionId: session.id,
      // Return question IDs mapped to display order (no axis metadata)
      questionIds: sessionQuestions.map((q) => ({
        id: q.id,
        text: q.question_text,
      })),
    });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
