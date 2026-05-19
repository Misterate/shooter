"""
SQLite persistence layer.

Tables:
  tracked_markets  – which markets the bot is currently watching
  market_checks    – every probability check (time-series)
  trade_signals    – every generated trade signal and what was done
"""

import logging
import sqlite3
import time
from contextlib import contextmanager
from typing import Optional

logger = logging.getLogger(__name__)

_DDL = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS tracked_markets (
    ticker        TEXT PRIMARY KEY,
    title         TEXT    NOT NULL,
    added_at      REAL    NOT NULL,
    close_time    REAL    NOT NULL,
    initial_price REAL    NOT NULL
);

CREATE TABLE IF NOT EXISTS market_checks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker         TEXT    NOT NULL,
    checked_at     REAL    NOT NULL,
    market_price   REAL    NOT NULL,
    our_prob       REAL    NOT NULL,
    confidence     REAL    NOT NULL,
    edge           REAL    NOT NULL,
    news_velocity  TEXT    NOT NULL,
    reasoning      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_signals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker         TEXT    NOT NULL,
    signaled_at    REAL    NOT NULL,
    signal_type    TEXT    NOT NULL,   -- VALUE | MOMENTUM | BREAKING
    market_price   REAL    NOT NULL,
    our_prob       REAL    NOT NULL,
    edge           REAL    NOT NULL,
    action         TEXT    NOT NULL    -- PAPER_BUY | LIVE_BUY | ALERT_ONLY
);

CREATE INDEX IF NOT EXISTS idx_checks_ticker  ON market_checks  (ticker, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_ticker ON trade_signals  (ticker, signaled_at DESC);
"""


class Database:
    def __init__(self, path: str):
        self._path = path
        self._init()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self._path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init(self):
        with self._conn() as c:
            c.executescript(_DDL)

    # ── writes ────────────────────────────────────────────────────────────────

    def upsert_tracked(self, ticker: str, title: str, close_ts: float, initial_price: float):
        with self._conn() as c:
            c.execute(
                """
                INSERT OR REPLACE INTO tracked_markets (ticker, title, added_at, close_time, initial_price)
                VALUES (?, ?, ?, ?, ?)
                """,
                (ticker, title, time.time(), close_ts, initial_price),
            )

    def remove_tracked(self, ticker: str):
        with self._conn() as c:
            c.execute("DELETE FROM tracked_markets WHERE ticker = ?", (ticker,))

    def log_check(
        self,
        ticker: str,
        market_price: float,
        our_prob: float,
        confidence: float,
        edge: float,
        velocity: str,
        reasoning: str,
    ):
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO market_checks
                  (ticker, checked_at, market_price, our_prob, confidence, edge, news_velocity, reasoning)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (ticker, time.time(), market_price, our_prob, confidence, edge, velocity, reasoning),
            )

    def log_signal(
        self,
        ticker: str,
        signal_type: str,
        market_price: float,
        our_prob: float,
        edge: float,
        action: str,
    ):
        with self._conn() as c:
            c.execute(
                """
                INSERT INTO trade_signals
                  (ticker, signaled_at, signal_type, market_price, our_prob, edge, action)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (ticker, time.time(), signal_type, market_price, our_prob, edge, action),
            )

    # ── reads ─────────────────────────────────────────────────────────────────

    def last_check(self, ticker: str) -> Optional[dict]:
        with self._conn() as c:
            row = c.execute(
                "SELECT * FROM market_checks WHERE ticker = ? ORDER BY checked_at DESC LIMIT 1",
                (ticker,),
            ).fetchone()
            return dict(row) if row else None

    def price_history(self, ticker: str, limit: int = 100) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                """
                SELECT checked_at, market_price, our_prob, edge
                FROM market_checks WHERE ticker = ?
                ORDER BY checked_at DESC LIMIT ?
                """,
                (ticker, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def recent_signals(self, limit: int = 20) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT * FROM trade_signals ORDER BY signaled_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]
