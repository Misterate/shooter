export interface Axis {
  id: string;
  name: string;
  positive: string;
  negative: string;
  description: string;
  active: number; // 1 = active, 0 = disabled
  sort_order: number;
}

export interface Session {
  id: string;
  created_at: string;
  completed: number; // 0 | 1
}

export interface SessionQuestion {
  id: string;
  session_id: string;
  question_text: string;
  primary_axis_id: string;
  secondary_axes: string; // JSON string: [{axisId, weight}]
  direction: number; // 1 | -1
  answer: "yes" | "somewhat" | "no" | null;
  answered_at: string | null;
}

export interface SecondaryAxis {
  axisId: string;
  weight: number;
}

export interface AxisScore {
  id: string;
  session_id: string;
  axis_id: string;
  score: number; // running average -10 to 10
  raw_contribution: number;
}

// What Claude returns per question (internal)
export interface ClaudeQuestion {
  text: string;
  primaryAxisId: string;
  secondaryAxes: SecondaryAxis[];
  direction: 1 | -1;
}

// What we send to the client (axis metadata stripped)
export interface ClientQuestion {
  id: string;
  text: string;
}

// What the client sends back when answering
export interface AnswerPayload {
  questionId: string;
  answer: "yes" | "somewhat" | "no";
}

// Full session with scores for dashboard
export interface SessionWithScores extends Session {
  scores: AxisScore[];
}

// Radar chart data point
export interface RadarDataPoint {
  axis: string;
  score: number;
  fullMark: number;
}
