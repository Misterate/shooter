"use client";

import { useEffect, useState } from "react";
import QuestionCard from "@/components/QuestionCard";
import SessionSummary from "@/components/SessionSummary";
import type { ClientQuestion, ClaudeQuestion, AnswerPayload } from "@/types";

type Phase = "loading" | "questions" | "submitting" | "done" | "error";

interface StoredQuestion {
  id: string; // DB row id
  text: string;
}

export default function SessionPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [questions, setQuestions] = useState<StoredQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerPayload[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    startSession();
  }, []);

  async function startSession() {
    setPhase("loading");
    try {
      // 1. Generate questions via Claude
      const questionsRes = await fetch("/api/questions");
      if (!questionsRes.ok) {
        const err = await questionsRes.json();
        throw new Error(err.error ?? "Failed to generate questions");
      }
      const questionsData = await questionsRes.json();

      // The API returns client-safe questions + internal _meta
      // We create the session passing the full Claude questions
      // Build full ClaudeQuestion objects by merging text from client questions with _meta
      const clientQs: ClientQuestion[] = questionsData.questions;
      const meta: Array<{
        tempId: string;
        primaryAxisId: string;
        secondaryAxes: { axisId: string; weight: number }[];
        direction: 1 | -1;
      }> = questionsData._meta;

      const fullQuestions: ClaudeQuestion[] = clientQs.map((q, i) => ({
        text: q.text,
        primaryAxisId: meta[i].primaryAxisId,
        secondaryAxes: meta[i].secondaryAxes,
        direction: meta[i].direction,
      }));

      // 2. Create session in DB with full question metadata
      const sessionRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: fullQuestions }),
      });

      if (!sessionRes.ok) {
        const err = await sessionRes.json();
        throw new Error(err.error ?? "Failed to create session");
      }

      const sessionData = await sessionRes.json();
      setSessionId(sessionData.sessionId);
      setQuestions(sessionData.questionIds);
      setPhase("questions");
    } catch (e) {
      console.error("Session start error:", e);
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    }
  }

  async function handleAnswer(answer: "yes" | "somewhat" | "no") {
    const question = questions[currentIndex];
    const newAnswers = [...answers, { questionId: question.id, answer }];
    setAnswers(newAnswers);

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      // All answered — submit
      await submitSession(newAnswers);
    }
  }

  async function submitSession(finalAnswers: AnswerPayload[]) {
    if (!sessionId) return;
    setPhase("submitting");
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: finalAnswers, complete: true }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to submit session");
      }

      setPhase("done");
    } catch (e) {
      console.error("Submit error:", e);
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-neutral-500 text-sm">
          Generating your questions&hellip;
        </p>
      </div>
    );
  }

  if (phase === "submitting") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)]">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-neutral-500 text-sm">Saving your session&hellip;</p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center">
        <p className="text-rose-400 mb-2 text-base">Something went wrong</p>
        <p className="text-neutral-500 text-sm mb-6 max-w-sm">{errorMsg}</p>
        <button
          onClick={startSession}
          className="px-6 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm rounded-xl transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === "done" && sessionId) {
    return <SessionSummary sessionId={sessionId} />;
  }

  if (phase === "questions" && questions.length > 0) {
    return (
      <QuestionCard
        question={questions[currentIndex].text}
        questionNumber={currentIndex + 1}
        total={questions.length}
        onAnswer={handleAnswer}
      />
    );
  }

  return null;
}
