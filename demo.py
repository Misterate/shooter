#!/usr/bin/env python3
"""
Demo runner: stubs Kalshi + Claude with realistic mock data so you can
see real terminal output without any API credentials.

Run:  python demo.py
"""

import asyncio
import random
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

# ── realistic mock markets ────────────────────────────────────────────────────

def _market(ticker, title, yes_ask_cents, hours_left, volume=2500):
    from kalshi_client import Market
    close = datetime.now(timezone.utc) + timedelta(hours=hours_left)
    c = yes_ask_cents / 100
    return Market(
        ticker=ticker, title=title, subtitle="",
        yes_bid=c - 0.005, yes_ask=c,
        no_bid=1 - c - 0.005, no_ask=1 - c,
        last_price=c, volume=volume, open_interest=volume // 3,
        close_time=close, status="open", category="politics",
        series_ticker=ticker.split("-")[0],
    )


MOCK_MARKETS = [
    _market("PRES-VETO-APR27",   "Will the president veto the budget bill before April 30?",                    3.0,  67),
    _market("SENATE-CONFIRM-MAY", "Will the Senate confirm the AG nominee by May 1?",                           2.5,  90),
    _market("SCOTUS-STAY-APR",   "Will SCOTUS grant an emergency stay of the injunction this week?",            1.5,  48, 1800),
    _market("GOV-SHUTDOWN-MAY",  "Will there be a government shutdown in the first week of May?",               3.5,  120),
    _market("NATO-SUMMIT-CANCEL","Will the NATO summit be cancelled or postponed before May 3?",                1.0,  144, 900),
    _market("TARIFF-PAUSE-APR",  "Will new tariff hike be paused before end of April?",                        4.0,  30, 5100),
    _market("SPEAKER-MOTION-MAY","Will a motion to vacate the Speaker be filed before May 5?",                  2.0,  192),
    _market("FED-EMERG-RATE",    "Will the Fed make an emergency rate cut before May 1?",                       0.8,  84, 3200),
    _market("EXEC-ORDER-MEDIA",  "Will an executive order targeting media ownership be signed this week?",      1.2,  55, 1200),
    _market("STATES-LAWSUIT-APR","Will 15+ states file a joint lawsuit against EO-2247 before April 30?",      3.8,  40, 4400),
    _market("CONGRESS-RECESS",   "Will Congress go into recess before May 10 without passing the bill?",       2.2,  210),
    _market("PARDON-HUNTER",     "Will there be a new presidential pardon issued before May 1?",                1.8,  60, 2800),
]

# Pre-written Claude-style probability estimates (probability, confidence, velocity, reasoning)
MOCK_ESTIMATES = {
    "PRES-VETO-APR27":   (0.09, 0.65, "developing",  "White House signaled strong opposition yesterday; veto language drafted per two aides. Market underprices this at 3c."),
    "SENATE-CONFIRM-MAY":(0.07, 0.55, "slow",        "Two swing-vote senators remain uncommitted; floor time tight before recess. Slight edge over 2.5c market."),
    "SCOTUS-STAY-APR":   (0.06, 0.70, "developing",  "Emergency application filed Friday; SCOTUS historically grants ~40% of stays at this stage. 1.5c market severely underprices."),
    "GOV-SHUTDOWN-MAY":  (0.05, 0.45, "slow",        "CR extension likely per leadership aides; 3.5c feels about right. Marginal edge."),
    "NATO-SUMMIT-CANCEL":(0.04, 0.50, "stale",       "No credible reports of cancellation; purely speculative. Market price roughly fair."),
    "TARIFF-PAUSE-APR":  (0.12, 0.75, "breaking",    "Treasury Secretary hinted at 'review period' in morning remarks; Bloomberg carried the story. 4c is cheap if true."),
    "SPEAKER-MOTION-MAY":(0.05, 0.55, "slow",        "Dissident caucus counting votes but no whip counts circulating. 2c roughly fair."),
    "FED-EMERG-RATE":    (0.03, 0.80, "stale",       "No Fed officials have signaled emergency action; 0.8c is already generous."),
    "EXEC-ORDER-MEDIA":  (0.07, 0.60, "developing",  "Draft EO language leaked to Politico this week; signing ceremony rumored for Thursday. 1.2c underprices meaningfully."),
    "STATES-LAWSUIT-APR":(0.10, 0.65, "developing",  "AG coalition at 12 states as of yesterday; three more AGs signaled intent on social media. 3.8c looks cheap."),
    "CONGRESS-RECESS":   (0.04, 0.40, "stale",       "Leadership has incentive to stay and vote. Market price roughly fair."),
    "PARDON-HUNTER":     (0.06, 0.55, "slow",        "Legal team submitted clemency petition per court filing. 1.8c slightly underpriced."),
}


async def fake_estimate(self_obj, market, extra_context=""):
    from news_analyzer import ProbabilityEstimate
    import time, random, asyncio
    await asyncio.sleep(random.uniform(0.05, 0.15))   # simulate network latency
    ticker = market.ticker
    prob, conf, vel, reason = MOCK_ESTIMATES.get(
        ticker,
        (market.yes_ask, 0.3, "stale", "No strong signal found.")
    )
    edge = prob / market.yes_ask if market.yes_ask > 0 else 1.0
    est = ProbabilityEstimate(
        probability=prob, confidence=conf,
        news_velocity=vel, reasoning=reason,
        market_prob=market.yes_ask, edge=edge,
    )
    self_obj._cache[ticker] = (est, time.time())
    return est


async def fake_get_all(self_obj, days_ahead=7):
    await asyncio.sleep(0.3)
    return MOCK_MARKETS


async def fake_get_market(self_obj, ticker):
    await asyncio.sleep(0.05)
    # Simulate small price drift on re-fetch
    for m in MOCK_MARKETS:
        if m.ticker == ticker:
            from kalshi_client import Market
            import dataclasses
            drift = random.uniform(-0.002, 0.002)
            new_ask = max(0.005, min(0.05, m.yes_ask + drift))
            return dataclasses.replace(m, yes_ask=new_ask, yes_bid=new_ask - 0.005)
    raise ValueError(f"Unknown ticker: {ticker}")


async def fake_place_order(self_obj, ticker, side, count, price_cents, order_type="limit"):
    from rich.console import Console
    Console().print(f"[bold magenta][PAPER ORDER][/bold magenta] BUY {count}x {ticker} YES @ {price_cents}c")
    return {"status": "paper", "ticker": ticker}


# ── inject mocks and run ──────────────────────────────────────────────────────

async def run_demo():
    from config import Config
    from kalshi_client import KalshiClient
    from news_analyzer import NewsAnalyzer
    from market_scanner import MarketScanner
    from db import Database
    from tracker import MarketTracker
    from rich.console import Console

    console = Console()

    cfg = Config(
        kalshi_email="demo@example.com",
        kalshi_password="demo",
        anthropic_api_key="demo",
        min_market_price_pct=0.5,
        max_market_price_pct=4.0,
        probability_edge_threshold=1.5,
        scan_horizon_days=7,
        top_n_markets=10,
        min_volume=100,
        max_check_interval=8,    # short for demo
        min_check_interval=3,
        sigmoid_inflection_hours=4.0,
        sigmoid_steepness=1.0,
        paper_trading=True,
        max_trade_contracts=50,
        breaking_news_multiplier=2.5,
        slow_news_multiplier=1.4,
        db_path="/tmp/shooter_demo.db",
    )

    console.print()
    console.print("[bold green]╔═══════════════════════════════════════╗[/bold green]")
    console.print("[bold green]║   shooter – Kalshi bot  [DEMO MODE]   ║[/bold green]")
    console.print("[bold green]╚═══════════════════════════════════════╝[/bold green]")
    console.print("  Mode        : [yellow]PAPER TRADING (demo)[/yellow]")
    console.print("  Auth        : mock (no real Kalshi credentials needed)")
    console.print("  Horizon     : 7 days")
    console.print("  Price range : 0.5c – 4.0c YES ask")
    console.print("  Edge min    : 1.5× market price")
    console.print("  Top N       : 10 markets")
    console.print("  Check range : 3s – 8s (demo speed)\n")

    with patch.object(KalshiClient, 'get_all_political_markets', fake_get_all), \
         patch.object(KalshiClient, 'get_market', fake_get_market), \
         patch.object(KalshiClient, 'place_order', fake_place_order), \
         patch.object(NewsAnalyzer, 'estimate_probability', fake_estimate), \
         patch.object(NewsAnalyzer, 'invalidate_cache', lambda self, t: None):

        async with KalshiClient(cfg) as kalshi:
            db = Database(cfg.db_path)
            analyzer = NewsAnalyzer(cfg)
            scanner = MarketScanner(kalshi, analyzer, cfg)
            tracker = MarketTracker(kalshi, analyzer, db, cfg)

            console.print("[bold]Running initial market scan…[/bold]")
            top = await scanner.get_top_markets()

            console.print(f"\n[bold green]Scan complete.[/bold green] {len(top)} markets selected.\n")
            await tracker.set_tracked_markets(top)

            console.print("\n[dim]Tracking for ~35 seconds (demo speed – real bot uses hourly intervals)…[/dim]\n")
            # Run for 35s then stop
            try:
                await asyncio.wait_for(tracker.run(), timeout=35)
            except asyncio.TimeoutError:
                pass

    console.print("\n[bold]Demo finished.[/bold]")
    console.print("To run for real: copy [bold].env.example[/bold] → [bold].env[/bold], fill in credentials, then [bold]python bot.py[/bold]")


if __name__ == "__main__":
    asyncio.run(run_demo())
