#!/usr/bin/env python3
"""
shooter – Kalshi political prediction-market trading bot.

Usage:
    python bot.py

Configure via .env (see .env.example).
"""

import asyncio
import logging
import sys

from rich.console import Console
from rich.logging import RichHandler

from config import config
from db import Database
from kalshi_client import KalshiClient
from market_scanner import MarketScanner
from news_analyzer import NewsAnalyzer
from tracker import MarketTracker

console = Console(width=160)


def _setup_logging():
    logging.basicConfig(
        level=getattr(logging, config.log_level.upper(), logging.INFO),
        format="%(message)s",
        datefmt="[%X]",
        handlers=[RichHandler(console=console, rich_tracebacks=True, show_path=False)],
    )


def _validate_config():
    errors: list[str] = []
    if not config.anthropic_api_key:
        errors.append("ANTHROPIC_API_KEY is required")
    if not config.uses_rsa_auth and not config.uses_jwt_auth:
        errors.append(
            "Kalshi auth required – set KALSHI_EMAIL+KALSHI_PASSWORD "
            "or KALSHI_KEY_ID+KALSHI_PRIVATE_KEY_PATH"
        )
    if errors:
        console.print("[bold red]Configuration errors:[/bold red]")
        for e in errors:
            console.print(f"  [red]•[/red] {e}")
        console.print("\nCopy [bold].env.example[/bold] → [bold].env[/bold] and fill in your credentials.")
        sys.exit(1)


def _print_banner():
    mode = "[red]LIVE TRADING[/red]" if not config.paper_trading else "[yellow]PAPER TRADING[/yellow]"
    auth = "RSA key" if config.uses_rsa_auth else "email/password"
    console.print()
    console.print("[bold green]╔═══════════════════════════════╗[/bold green]")
    console.print("[bold green]║   shooter – Kalshi bot        ║[/bold green]")
    console.print("[bold green]╚═══════════════════════════════╝[/bold green]")
    console.print(f"  Mode        : {mode}")
    console.print(f"  Auth        : {auth}")
    console.print(f"  Horizon     : {config.scan_horizon_days} days")
    console.print(f"  Price range : {config.min_market_price_pct:.1f}c – {config.max_market_price_pct:.1f}c YES ask")
    console.print(f"  Edge min    : {config.probability_edge_threshold}× market price")
    console.print(f"  Top N       : {config.top_n_markets} markets")
    console.print(
        f"  Check range : {config.min_check_interval}s – {config.max_check_interval}s "
        f"(inflection at {config.sigmoid_inflection_hours:.1f}h)"
    )
    console.print()


async def main():
    _setup_logging()
    _validate_config()
    _print_banner()

    async with KalshiClient(config) as kalshi:
        db = Database(config.db_path)
        analyzer = NewsAnalyzer(config)
        scanner = MarketScanner(kalshi, analyzer, config)
        tracker = MarketTracker(kalshi, analyzer, db, config)

        console.print("[bold]Running initial market scan…[/bold]")
        try:
            top = await scanner.get_top_markets()
        except Exception as exc:
            console.print(f"[red]Initial scan failed: {exc}[/red]")
            console.print("Check your Kalshi credentials and network connection.")
            sys.exit(1)

        if not top:
            console.print(
                "[yellow]No markets matched the current criteria.[/yellow]\n"
                "Try relaxing MAX_MARKET_PRICE_PCT, lowering PROBABILITY_EDGE_THRESHOLD, "
                "or extending SCAN_HORIZON_DAYS."
            )
        else:
            await tracker.set_tracked_markets(top)

        # Run the tracker heartbeat and the hourly rescan concurrently
        async with asyncio.TaskGroup() as tg:
            tg.create_task(tracker.run(), name="tracker-heartbeat")
            tg.create_task(
                scanner.run_periodic_scan(tracker, interval=config.max_check_interval),
                name="periodic-scan",
            )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        console.print("\n[bold]Bot stopped.[/bold]")
