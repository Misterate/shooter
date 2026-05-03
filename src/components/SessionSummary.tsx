"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  sessionId: string;
}

export default function SessionSummary({ sessionId }: Props) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.push("/");
    }, 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center">
      <div className="w-16 h-16 rounded-full bg-indigo-500/20 flex items-center justify-center mb-6">
        <svg
          className="w-8 h-8 text-indigo-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <h2 className="text-2xl font-light text-neutral-100 mb-3">
        Session complete
      </h2>
      <p className="text-neutral-500 text-sm">
        Your scores have been updated. Returning to dashboard&hellip;
      </p>
      <button
        onClick={() => router.push("/")}
        className="mt-8 px-6 py-3 rounded-xl bg-neutral-800 text-neutral-300 text-sm hover:bg-neutral-700 transition-colors"
      >
        Go to Dashboard
      </button>
    </div>
  );
}
