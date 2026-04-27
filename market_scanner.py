"""
Market scanner – fetches political markets, applies filters, scores with
Claude, picks the top-N, then periodically re-runs the whole scan.

Scoring formula:
    score = edge * confidence * velocity_bonus

where edge = our_probability / market_price.

A market only enters candidacy when:
  • status == "open"
  • YES ask in [min_market_price_pct, max_market_price_pct] cents
  • volume >= min_volume
  • edge >= probability_edge_threshold
"""

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_VELOCITY_BONUS = {
    "breaking": 2.0,
    "developing": 1.5,
    "slow": 1.0,
    "stale": 0.7,
}


class MarketScanner:
    def __init__(self, kalshi_client, news_analyzer, config):
        self._kalshi = kalshi_client
        self._analyzer = news_analyzer
        self._cfg = config

    # ── public ────────────────────────────────────────────────────────────────

    async def get_top_markets(self) -> list[tuple]:
        """Return [(market, ProbabilityEstimate), …] for the best N opportunities."""
        logger.info("Scanning political markets (horizon=%d days)…", self._cfg.scan_horizon_days)
        markets = await self._kalshi.get_all_political_markets(self._cfg.scan_horizon_days)
        logger.info("  %d markets in timeframe", len(markets))

        candidates = [m for m in markets if self._passes_filter(m)]
        logger.info("  %d pass basic filter (price %.1fc–%.1fc, volume≥%d)",
                    len(candidates),
                    self._cfg.min_market_price_pct,
                    self._cfg.max_market_price_pct,
                    self._cfg.min_volume)

        # Score concurrently but throttle to avoid hammering the Claude API
        scored = await self._score_batch(candidates)
        scored.sort(key=lambda t: t[0], reverse=True)

        top = scored[: self._cfg.top_n_markets]
        logger.info("  Selected %d markets to track", len(top))
        return [(market, est) for _, market, est in top]

    async def run_periodic_scan(self, tracker, interval: int = 3600):
        """Re-scan every `interval` seconds and hand new top-list to tracker."""
        while True:
            await asyncio.sleep(interval)
            try:
                top = await self.get_top_markets()
                await tracker.set_tracked_markets(top)
            except Exception as exc:
                logger.error("Periodic scan failed: %s", exc)

    # ── internals ─────────────────────────────────────────────────────────────

    def _passes_filter(self, market) -> bool:
        if market.status != "open":
            return False
        yes_cents = market.yes_ask * 100
        if yes_cents < self._cfg.min_market_price_pct:
            return False
        if yes_cents > self._cfg.max_market_price_pct:
            return False
        if market.volume < self._cfg.min_volume:
            return False
        return True

    async def _score_one(self, market) -> Optional[tuple]:
        try:
            est = await self._analyzer.estimate_probability(market)
        except Exception as exc:
            logger.debug("Could not score %s: %s", market.ticker, exc)
            return None

        if est.edge < self._cfg.probability_edge_threshold:
            return None

        bonus = _VELOCITY_BONUS.get(est.news_velocity, 1.0)
        score = est.edge * est.confidence * bonus
        return (score, market, est)

    async def _score_batch(self, markets: list) -> list[tuple]:
        """Score up to 5 markets at a time to avoid rate-limit bursts."""
        results: list[tuple] = []
        chunk = 5
        for i in range(0, len(markets), chunk):
            batch = markets[i: i + chunk]
            out = await asyncio.gather(*[self._score_one(m) for m in batch], return_exceptions=True)
            for item in out:
                if item and not isinstance(item, Exception):
                    results.append(item)
            if i + chunk < len(markets):
                await asyncio.sleep(1.0)   # brief pause between chunks
        return results
