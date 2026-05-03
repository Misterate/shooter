import { NextResponse } from "next/server";
import { getActiveAxes, getRecentAnsweredSessions } from "@/lib/db";
import { generateQuestions } from "@/lib/claude";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const axes = getActiveAxes();
    if (axes.length === 0) {
      return NextResponse.json(
        { error: "No active axes configured" },
        { status: 400 }
      );
    }

    // Load recent answers for context
    const recentSessions = getRecentAnsweredSessions(2);
    const recentAnswers = recentSessions.flatMap(({ questions }) =>
      questions
        .filter((q) => q.answer !== null)
        .map((q) => ({
          question: q.question_text,
          answer: q.answer as string,
        }))
    );

    const claudeQuestions = await generateQuestions(axes, recentAnswers);

    // Strip axis metadata before sending to client — only return id + text
    const clientQuestions = claudeQuestions.map((q, i) => ({
      id: `q_${i}_${Date.now()}`,
      text: q.text,
    }));

    // Store the full metadata in a server-side cache keyed by the temp IDs
    // so we can retrieve it when the session is submitted
    // We return the full questions to be stored during session creation
    return NextResponse.json({
      questions: clientQuestions,
      // Internal metadata returned in the same call so session creation can store it
      _meta: claudeQuestions.map((q, i) => ({
        tempId: `q_${i}_${Date.now()}`,
        primaryAxisId: q.primaryAxisId,
        secondaryAxes: q.secondaryAxes,
        direction: q.direction,
      })),
    });
  } catch (error) {
    console.error("Error generating questions:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to generate questions: ${msg}` },
      { status: 500 }
    );
  }
}
