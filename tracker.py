"""
Market tracker with S-curve adaptive scheduling.

Check interval formula (sigmoid):
    interval = min_i + (max_i - min_i) * σ(k * (hours_remaining - inflection))

where σ is the logistic function.  Effect:
  • Far from expiry  → long interval (≈ max, e.g. 1 h)
  • Near inflection  → interval ≈ midpoint
  • Close to expiry  → short interval (≈ min, e.g. 1 min)

After detecting "breaking" news the next interval is forced to min regardless
of hours_remaining, so the bot tracks hot markets at maximum frequency.

Signal types (in decreasing urgency):
  BREAKING  – velocity=="breaking" AND edge ≥ threshold × breaking_multiplier
  MOMENTUM  – edge ≥ threshold × slow_multiplier AND edge jumped ≥ 20% vs prev check
  VALUE     – edge ≥ threshold (quiet opportunity)
"""

import asyncio
import logging
import math
from datetime import datetime, timezone

from rich.console import Console
from rich.table import Table

logger = logging.getLogger(__name__)
console = Console()


def sigmoid_interval(
    hours_remaining: float,
    min_interval: int,
    max_interval: int,
    k: float,
    inflection: float,
) -> int:
    """Return check interval in seconds on the S-curve."""
    sig = 1.0 / (1.0 + math.exp(-k * (hours_remaining - inflection)))
    return int(min_interval + (max_interval - min_interval) * sig)


class MarketTracker:
    def __init__(self, kalshi_client, news_analyzer, db, config):
        self._kalshi = kalshi_client
        self._analyzer = news_analyzer
        self._db = db
        self._cfg = config

        # ticker → (market, estimate, prev_edge)
        self._tracked: dict[str, tuple] = {}
        # ticker → asyncio.Task
        self._tasks: dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()

    # ── public ────────────────────────────────────────────────────────────────

    async def set_tracked_markets(self, markets_with_estimates: list[tuple]):
        """Replace the tracked set with a new top-N list."""
        async with self._lock:
            new_tickers = {m.ticker for m, _ in markets_with_estimates}

            # Cancel markets that fell out of top-N
            for ticker in list(self._tasks):
                if ticker not in new_tickers:
                    self._tasks.pop(ticker).cancel()
                    self._tracked.pop(ticker, None)
                    self._db.remove_tracked(ticker)
                    console.print(f"[dim]Dropped {ticker}[/dim]")

            # Start tasks for newly added markets
            for market, estimate in markets_with_estimates:
                if market.ticker not in self._tasks:
                    self._db.upsert_tracked(
                        market.ticker,
                        market.title,
                        market.close_time.timestamp(),
                        market.yes_ask,
                    )
                    self._tracked[market.ticker] = (market, estimate, estimate.edge)
                    task = asyncio.create_task(
                        self._track_loop(market.ticker),
                        name=f"track-{market.ticker}",
                    )
                    self._tasks[market.ticker] = task
                    console.print(
                        f"[green]+[/green] Tracking [bold]{market.ticker}[/bold]: "
                        f"{market.title[:60]} "
                        f"([cyan]{market.yes_ask*100:.1f}c[/cyan])"
                    )

        self._print_status_table()

    async def run(self):
        """Periodic status heartbeat (runs forever alongside the track tasks)."""
        while True:
            await asyncio.sleep(300)
            async with self._lock:
                if self._tracked:
                    self._print_status_table()

    # ── per-market loop ───────────────────────────────────────────────────────

    async def _track_loop(self, ticker: str):
        force_min_interval = False   # set True after breaking-news detection

        while True:
            try:
                market = await self._kalshi.get_market(ticker)

                if market.hours_remaining <= 0 or market.status != "open":
                    console.print(f"[yellow]{ticker}[/yellow] closed/expired – stopped.")
                    async with self._lock:
                        self._tasks.pop(ticker, None)
                        self._tracked.pop(ticker, None)
                    return

                # Force-fresh analysis (skip cache) each time the loop fires
                self._analyzer.invalidate_cache(ticker)
                estimate = await self._analyzer.estimate_probability(market)

                self._db.log_check(
                    ticker,
                    market.yes_ask,
                    estimate.probability,
                    estimate.confidence,
                    estimate.edge,
                    estimate.news_velocity,
                    estimate.reasoning,
                )

                # Retrieve previous edge before updating state
                async with self._lock:
                    prev = self._tracked.get(ticker)
                    prev_edge = prev[2] if prev else estimate.edge
                    self._tracked[ticker] = (market, estimate, prev_edge)

                # Signal detection
                fired_breaking = await self._check_signals(market, estimate, prev_edge)
                force_min_interval = fired_breaking

                # Compute next sleep (S-curve, overridden after breaking news)
                if force_min_interval:
                    interval = self._cfg.min_check_interval
                else:
                    interval = sigmoid_interval(
                        market.hours_remaining,
                        self._cfg.min_check_interval,
                        self._cfg.max_check_interval,
                        self._cfg.sigmoid_steepness,
                        self._cfg.sigmoid_inflection_hours,
                    )
                    # Also shorten if edge is accelerating
                    if estimate.edge > prev_edge * 1.3:
                        interval = max(interval // 2, self._cfg.min_check_interval)

                logger.debug(
                    "%s next check in %ds (hrs_left=%.1f edge=%.2fx velocity=%s)",
                    ticker, interval, market.hours_remaining, estimate.edge, estimate.news_velocity,
                )
                await asyncio.sleep(interval)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Error in track loop for %s: %s", ticker, exc)
                await asyncio.sleep(60)

    # ── signal detection ──────────────────────────────────────────────────────

    async def _check_signals(self, market, estimate, prev_edge: float) -> bool:
        """Evaluate signal conditions; return True if BREAKING fired."""
        cfg = self._cfg
        breaking_edge = cfg.probability_edge_threshold * cfg.breaking_news_multiplier
        momentum_edge = cfg.probability_edge_threshold * cfg.slow_news_multiplier

        if estimate.news_velocity == "breaking" and estimate.edge >= breaking_edge:
            signal = "BREAKING"
        elif estimate.edge >= momentum_edge and estimate.edge >= prev_edge * 1.2:
            signal = "MOMENTUM"
        elif estimate.edge >= cfg.probability_edge_threshold:
            signal = "VALUE"
        else:
            return False

        action = "PAPER_BUY" if cfg.paper_trading else "LIVE_BUY"
        self._db.log_signal(
            market.ticker, signal,
            market.yes_ask, estimate.probability, estimate.edge, action,
        )
        self._print_signal(market, estimate, signal)

        # Execute if live and signal is urgent
        if not cfg.paper_trading and signal in ("BREAKING", "MOMENTUM"):
            price_cents = int(market.yes_ask * 100) + 1   # 1c premium for fill probability
            try:
                await self._kalshi.place_order(
                    market.ticker, "yes", cfg.max_trade_contracts, price_cents
                )
            except Exception as exc:
                logger.error("Order failed for %s: %s", market.ticker, exc)

        return signal == "BREAKING"

    # ── display ───────────────────────────────────────────────────────────────

    def _print_signal(self, market, estimate, signal_type: str):
        colors = {"BREAKING": "bold red", "MOMENTUM": "bold yellow", "VALUE": "bold cyan"}
        c = colors.get(signal_type, "white")
        bar = "═" * 62
        console.print(f"\n[{c}]{bar}[/{c}]")
        console.print(f"[{c}]▶  SIGNAL: {signal_type}[/{c}]  {market.ticker}")
        console.print(f"   {market.title}")
        console.print(
            f"   Mkt: [cyan]{market.yes_ask*100:.1f}c[/cyan]  "
            f"Our: [green]{estimate.probability*100:.1f}%[/green]  "
            f"Edge: [bold]{estimate.edge:.2f}x[/bold]  "
            f"Conf: {estimate.confidence*100:.0f}%  "
            f"Velocity: {estimate.news_velocity}"
        )
        console.print(f"   {estimate.reasoning[:220]}")
        console.print(f"[{c}]{bar}[/{c}]\n")

    def _print_status_table(self):
        t = Table(title="Tracked Markets", show_header=True, header_style="bold magenta")
        t.add_column("Ticker",   style="cyan",  width=22)
        t.add_column("Title",                   width=48)
        t.add_column("Mkt%",  justify="right",  width=6)
        t.add_column("Our%",  justify="right",  width=6)
        t.add_column("Edge",  justify="right",  width=7)
        t.add_column("Hrs",   justify="right",  width=7)
        t.add_column("Vel",                     width=11)

        for ticker, (mkt, est, _) in self._tracked.items():
            edge_color = "green" if est.edge >= 2 else "yellow" if est.edge >= 1.5 else "white"
            t.add_row(
                ticker,
                mkt.title[:48],
                f"{mkt.yes_ask*100:.1f}",
                f"{est.probability*100:.1f}",
                f"[{edge_color}]{est.edge:.2f}x[/{edge_color}]",
                f"{mkt.hours_remaining:.1f}",
                est.news_velocity,
            )

        console.print(t)
