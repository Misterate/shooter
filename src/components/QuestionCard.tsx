"use client";

interface Props {
  question: string;
  questionNumber: number;
  total: number;
  onAnswer: (answer: "yes" | "somewhat" | "no") => void;
  isLoading?: boolean;
}

export default function QuestionCard({
  question,
  questionNumber,
  total,
  onAnswer,
  isLoading = false,
}: Props) {
  const progress = ((questionNumber - 1) / total) * 100;

  const buttons: { label: string; value: "yes" | "somewhat" | "no" }[] = [
    { label: "Yes", value: "yes" },
    { label: "Somewhat", value: "somewhat" },
    { label: "No", value: "no" },
  ];

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)] justify-center">
      {/* Progress */}
      <div className="mb-8">
        <div className="flex justify-between text-xs text-neutral-500 mb-2">
          <span>
            {questionNumber} of {total}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Question */}
      <div className="flex-1 flex items-center">
        <p className="text-xl text-neutral-100 leading-relaxed font-light">
          {question}
        </p>
      </div>

      {/* Answer Buttons */}
      <div className="flex flex-col gap-3 mt-8">
        {buttons.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => onAnswer(value)}
            disabled={isLoading}
            className={`w-full py-4 px-6 rounded-xl text-base font-medium transition-all active:scale-[0.98]
              ${
                value === "yes"
                  ? "bg-neutral-800 hover:bg-indigo-600 text-neutral-100"
                  : value === "somewhat"
                  ? "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                  : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
              }
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
