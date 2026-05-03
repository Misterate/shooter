import Database from "better-sqlite3";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { Axis, Session, SessionQuestion, AxisScore } from "@/types";

const DB_PATH = path.join(process.cwd(), "data", "tracker.db");

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure data directory exists
  const fs = require("fs");
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  initSchema(_db);
  seedDefaultAxes(_db);

  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS axes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      positive TEXT NOT NULL,
      negative TEXT NOT NULL,
      description TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      completed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS session_questions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      question_text TEXT NOT NULL,
      primary_axis_id TEXT NOT NULL,
      secondary_axes TEXT NOT NULL,
      direction INTEGER NOT NULL DEFAULT 1,
      answer TEXT,
      answered_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS axis_scores (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      axis_id TEXT NOT NULL,
      score REAL NOT NULL,
      raw_contribution REAL NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
}

const DEFAULT_AXES = [
  {
    id: "integrity",
    name: "Integrity",
    positive: "Honest",
    negative: "Deceptive",
    description:
      "truthfulness in statements, accountability for actions, authenticity in self-presentation, keeping promises",
    sort_order: 0,
  },
  {
    id: "courage",
    name: "Courage",
    positive: "Bold",
    negative: "Avoidant",
    description:
      "acting under pressure or fear, speaking up when it matters, taking calculated risks, facing difficult conversations",
    sort_order: 1,
  },
  {
    id: "compassion",
    name: "Compassion",
    positive: "Generous",
    negative: "Selfish",
    description:
      "caring for others' wellbeing, showing empathy, giving time or resources, putting others' needs first",
    sort_order: 2,
  },
  {
    id: "discipline",
    name: "Discipline",
    positive: "Consistent",
    negative: "Impulsive",
    description:
      "following through on commitments, maintaining healthy habits, self-control, resisting short-term temptations",
    sort_order: 3,
  },
  {
    id: "wisdom",
    name: "Wisdom",
    positive: "Reflective",
    negative: "Reactive",
    description:
      "pausing before acting, learning from mistakes, seeking perspective, not repeating the same errors",
    sort_order: 4,
  },
  {
    id: "justice",
    name: "Justice",
    positive: "Fair",
    negative: "Biased",
    description:
      "treating people equally regardless of status, making fair decisions, acknowledging bias, standing up for fairness",
    sort_order: 5,
  },
  {
    id: "humility",
    name: "Humility",
    positive: "Grounded",
    negative: "Arrogant",
    description:
      "self-awareness about limitations, crediting others' contributions, openness to being wrong, not overestimating oneself",
    sort_order: 6,
  },
];

function seedDefaultAxes(db: Database.Database): void {
  const count = (
    db.prepare("SELECT COUNT(*) as c FROM axes").get() as { c: number }
  ).c;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO axes (id, name, positive, negative, description, active, sort_order)
    VALUES (@id, @name, @positive, @negative, @description, 1, @sort_order)
  `);

  const insertMany = db.transaction((axes: typeof DEFAULT_AXES) => {
    for (const axis of axes) {
      insert.run(axis);
    }
  });

  insertMany(DEFAULT_AXES);
}

// ---- Axes ----

export function getAllAxes(): Axis[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM axes ORDER BY sort_order ASC, name ASC")
    .all() as Axis[];
}

export function getActiveAxes(): Axis[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM axes WHERE active = 1 ORDER BY sort_order ASC, name ASC"
    )
    .all() as Axis[];
}

export function getAxisById(id: string): Axis | null {
  const db = getDb();
  return (db.prepare("SELECT * FROM axes WHERE id = ?").get(id) as Axis) || null;
}

export function createAxis(
  data: Omit<Axis, "active" | "sort_order">
): Axis {
  const db = getDb();
  const maxOrder = (
    db.prepare("SELECT MAX(sort_order) as m FROM axes").get() as {
      m: number | null;
    }
  ).m;
  const sort_order = (maxOrder ?? -1) + 1;

  db.prepare(
    `INSERT INTO axes (id, name, positive, negative, description, active, sort_order)
     VALUES (@id, @name, @positive, @negative, @description, 1, @sort_order)`
  ).run({ ...data, sort_order });

  return getAxisById(data.id)!;
}

export function updateAxis(
  id: string,
  data: Partial<Omit<Axis, "id">>
): Axis | null {
  const db = getDb();
  const fields = Object.keys(data)
    .map((k) => `${k} = @${k}`)
    .join(", ");
  db.prepare(`UPDATE axes SET ${fields} WHERE id = @id`).run({ ...data, id });
  return getAxisById(id);
}

export function softDeleteAxis(id: string): void {
  const db = getDb();
  db.prepare("UPDATE axes SET active = 0 WHERE id = ?").run(id);
}

// ---- Sessions ----

export function createSession(): Session {
  const db = getDb();
  const id = uuidv4();
  const created_at = new Date().toISOString();
  db.prepare(
    "INSERT INTO sessions (id, created_at, completed) VALUES (?, ?, 0)"
  ).run(id, created_at);
  return { id, created_at, completed: 0 };
}

export function getSessionById(id: string): Session | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session) ||
    null
  );
}

export function getAllSessions(): Session[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM sessions ORDER BY created_at DESC")
    .all() as Session[];
}

export function markSessionComplete(id: string): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET completed = 1 WHERE id = ?").run(id);
}

// ---- Session Questions ----

export function insertSessionQuestions(
  questions: Omit<SessionQuestion, "answer" | "answered_at">[]
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO session_questions
     (id, session_id, question_text, primary_axis_id, secondary_axes, direction)
     VALUES (@id, @session_id, @question_text, @primary_axis_id, @secondary_axes, @direction)`
  );
  const insertMany = db.transaction(
    (qs: Omit<SessionQuestion, "answer" | "answered_at">[]) => {
      for (const q of qs) insert.run(q);
    }
  );
  insertMany(questions);
}

export function getSessionQuestions(sessionId: string): SessionQuestion[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM session_questions WHERE session_id = ?")
    .all(sessionId) as SessionQuestion[];
}

export function updateQuestionAnswer(
  id: string,
  answer: "yes" | "somewhat" | "no"
): void {
  const db = getDb();
  db.prepare(
    "UPDATE session_questions SET answer = ?, answered_at = ? WHERE id = ?"
  ).run(answer, new Date().toISOString(), id);
}

export function getRecentAnsweredSessions(
  limit: number
): Array<{ session: Session; questions: SessionQuestion[] }> {
  const db = getDb();
  const sessions = db
    .prepare(
      "SELECT * FROM sessions WHERE completed = 1 ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit) as Session[];

  return sessions.map((session) => ({
    session,
    questions: getSessionQuestions(session.id),
  }));
}

// ---- Axis Scores ----

export function upsertAxisScores(scores: Omit<AxisScore, "id">[]): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO axis_scores (id, session_id, axis_id, score, raw_contribution)
     VALUES (@id, @session_id, @axis_id, @score, @raw_contribution)`
  );
  const insertMany = db.transaction((ss: Omit<AxisScore, "id">[]) => {
    for (const s of ss) insert.run({ ...s, id: uuidv4() });
  });
  insertMany(scores);
}

export function getAxisScoresForSession(sessionId: string): AxisScore[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM axis_scores WHERE session_id = ?")
    .all(sessionId) as AxisScore[];
}

export function getAllAxisScores(): AxisScore[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM axis_scores ORDER BY (SELECT created_at FROM sessions WHERE id = axis_scores.session_id) ASC"
    )
    .all() as AxisScore[];
}

export function getLatestAxisScores(): Record<string, number> {
  const db = getDb();
  // Get the most recent completed session's scores as the "current" profile
  const latestSession = db
    .prepare(
      "SELECT id FROM sessions WHERE completed = 1 ORDER BY created_at DESC LIMIT 1"
    )
    .get() as { id: string } | undefined;

  if (!latestSession) return {};

  const scores = db
    .prepare("SELECT axis_id, score FROM axis_scores WHERE session_id = ?")
    .all(latestSession.id) as { axis_id: string; score: number }[];

  return Object.fromEntries(scores.map((s) => [s.axis_id, s.score]));
}
