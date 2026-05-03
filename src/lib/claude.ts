import Anthropic from "@anthropic-ai/sdk";
import type { Axis, ClaudeQuestion } from "@/types";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface RecentAnswer {
  question: string;
  answer: string;
}

function buildSystemPrompt(axes: Axis[]): string {
  const axisDescriptions = axes
    .map(
      (a, i) =>
        `Axis ${i + 1} [id: "${a.id}"]: ${a.description}`
    )
    .join("\n");

  return `You are a thoughtful journaling assistant. Your job is to generate introspective, reflective questions that help someone examine their day, week, or life patterns.

The questions you generate will be internally mapped to character dimensions for personal tracking. The user should never feel like they're being evaluated or scored — they should feel like they're doing genuine self-reflection.

The character dimensions you must cover are:
${axisDescriptions}

CRITICAL RULES FOR QUESTION WRITING:
1. NEVER mention the axis name or evaluation language ("Were you honest?", "Did you show courage?")
2. Questions must feel like genuine journal prompts a thoughtful friend might ask
3. Vary the time scope: some about today, some about this week, some about recently, some about patterns in general
4. Write in second person ("Did you...", "Was there a moment when...", "Have you noticed...")
5. Questions can be mildly uncomfortable but should never feel accusatory
6. Each question should feel natural and human, not clinical
7. Some questions should be "inverse" — where saying "yes" actually indicates a negative tendency
   (e.g., "Did you find yourself avoiding a conversation you knew you should have?")
8. Vary between past-tense specific events and general pattern questions

EXAMPLES OF GOOD QUESTIONS:
- "Was there a moment today where you held back from saying something important?"
- "Did you find yourself agreeing with someone even though you privately disagreed?"
- "Did you make time today to check in on someone going through a hard time?"
- "Did you start something and not finish it — and tell yourself it was fine?"
- "Was there a decision you made today that you'd feel comfortable explaining to anyone?"

EXAMPLES OF BAD QUESTIONS (never write these):
- "Were you honest today?" (names the axis)
- "Did you show integrity?" (names the axis)
- "How courageous were you?" (names the axis)

Output ONLY valid JSON — an array of exactly 10 question objects. No markdown, no explanation.`;
}

function buildUserPrompt(
  axes: Axis[],
  recentAnswers: RecentAnswer[]
): string {
  const axisIds = axes.map((a) => `"${a.id}"`).join(", ");

  const recentContext =
    recentAnswers.length > 0
      ? `\n\nRecent session context (avoid repeating these exact themes):
${recentAnswers
  .slice(0, 10)
  .map((a) => `- Q: "${a.question}" → A: ${a.answer}`)
  .join("\n")}`
      : "";

  return `Generate exactly 10 reflective journaling questions.

Available axis IDs: [${axisIds}]

Each question object must have exactly these fields:
{
  "text": "the question text",
  "primaryAxisId": "one of the axis IDs above",
  "secondaryAxes": [{"axisId": "...", "weight": 0.3}],  // 0-2 secondary axes, can be empty array
  "direction": 1 or -1  // 1 = yes means positive for that axis, -1 = yes means negative for that axis
}

Ensure good coverage across all axes. Not every axis needs to appear as primary for every question, but all ${axes.length} axes should appear at least once across primary and secondary.${recentContext}

Respond with ONLY the JSON array.`;
}

export async function generateQuestions(
  axes: Axis[],
  recentAnswers: RecentAnswer[] = []
): Promise<ClaudeQuestion[]> {
  const systemPrompt = buildSystemPrompt(axes);
  const userPrompt = buildUserPrompt(axes, recentAnswers);

  const message = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: userPrompt,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }

  // Strip markdown code fences if present
  let jsonText = content.text.trim();
  if (jsonText.startsWith("```")) {
    jsonText = jsonText
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "")
      .trim();
  }

  let questions: ClaudeQuestion[];
  try {
    questions = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Failed to parse Claude response as JSON: ${content.text}`);
  }

  // Validate and sanitize
  const validAxisIds = new Set(axes.map((a) => a.id));
  const sanitized = questions
    .filter(
      (q) =>
        q.text &&
        q.primaryAxisId &&
        validAxisIds.has(q.primaryAxisId) &&
        (q.direction === 1 || q.direction === -1)
    )
    .slice(0, 10);

  if (sanitized.length < 10) {
    throw new Error(
      `Claude returned only ${sanitized.length} valid questions, expected 10`
    );
  }

  return sanitized;
}
