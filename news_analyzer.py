"""
Probability estimator powered by Claude.

For each market it builds a structured prompt containing the market question,
current price, hours-to-close, and today's date, then asks Claude to return:
  - probability  (0–1)  our best estimate the YES resolves
  - confidence   (0–1)  how sure we are
  - news_velocity  breaking | developing | slow | stale
  - reasoning    short prose explanation

Results are cached per-ticker for cache_ttl seconds so rapid re-checks don't
burn through API quota.  Call invalidate_cache(ticker) to force a fresh call.
"""

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)

NEWS_VELOCITY_VALUES = ("breaking", "developing", "slow", "stale")


@dataclass
class ProbabilityEstimate:
    probability: float      # 0–1 our estimate
    confidence: float       # 0–1
    news_velocity: str      # breaking | developing | slow | stale
    reasoning: str
    market_prob: float      # market's implied probability (= yes_ask)
    edge: float             # probability / market_prob  (>1 means we see value)

    @property
    def edge_pct(self) -> float:
        return (self.edge - 1.0) * 100.0


_SYSTEM = """\
You are a sharp political prediction-market analyst.
You have deep knowledge of current events up to your training cutoff.
You reason clearly about probabilities and never hedge with vague non-answers.
Always reply with valid JSON only – no markdown, no preamble.
"""

_USER_TMPL = """\
Today's date: {today}

Kalshi binary market:
  Ticker  : {ticker}
  Question: {title}
  Detail  : {subtitle}
  Closes  : {close_time}  ({hours_left:.1f} h remaining)

Market-implied YES probability: {market_pct:.2f}%
Volume: {volume:,} contracts   Open interest: {oi:,}

Your task:
1. Estimate the TRUE probability (0–1) that YES resolves, incorporating:
   - Recent political news you know about
   - Polling/approval data, official statements, social media chatter
   - Proximity to the close date (is there still time for things to change?)
2. Rate your confidence (0–1) in the estimate.
3. Classify news velocity:
   - "breaking"   – major new development in the past few hours
   - "developing" – story building over days, momentum clear
   - "slow"       – gradual drift, no sudden catalyst
   - "stale"      – no meaningful recent movement
4. Short reasoning (≤3 sentences).

Reply with this exact JSON schema – no other text:
{{
  "probability": <float 0-1>,
  "confidence": <float 0-1>,
  "news_velocity": "<breaking|developing|slow|stale>",
  "reasoning": "<string>"
}}
"""


class NewsAnalyzer:
    def __init__(self, config, cache_ttl: int = 300):
        self._client = anthropic.AsyncAnthropic(api_key=config.anthropic_api_key)
        self._cache: dict[str, tuple[ProbabilityEstimate, float]] = {}
        self._cache_ttl = cache_ttl

    async def estimate_probability(
        self,
        market,
        extra_context: str = "",
    ) -> ProbabilityEstimate:
        ticker = market.ticker
        now = time.time()

        cached = self._cache.get(ticker)
        if cached and (now - cached[1]) < self._cache_ttl:
            return cached[0]

        market_prob = market.yes_ask
        today = datetime.now(timezone.utc).strftime("%B %d, %Y")

        prompt = _USER_TMPL.format(
            today=today,
            ticker=ticker,
            title=market.title,
            subtitle=market.subtitle or "—",
            close_time=market.close_time.strftime("%Y-%m-%d %H:%M UTC"),
            hours_left=market.hours_remaining,
            market_pct=market_prob * 100,
            volume=market.volume,
            oi=market.open_interest,
        )
        if extra_context:
            prompt += f"\nAdditional context: {extra_context}"

        try:
            response = await self._client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=512,
                system=_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text.strip()
            data = self._parse_json(text)

            prob = float(data["probability"])
            conf = float(data["confidence"])
            vel = data.get("news_velocity", "stale")
            if vel not in NEWS_VELOCITY_VALUES:
                vel = "stale"

            estimate = ProbabilityEstimate(
                probability=min(max(prob, 0.0), 1.0),
                confidence=min(max(conf, 0.0), 1.0),
                news_velocity=vel,
                reasoning=str(data.get("reasoning", "")),
                market_prob=market_prob,
                edge=prob / market_prob if market_prob > 0 else 1.0,
            )

        except Exception as exc:
            logger.warning("Analysis failed for %s: %s", ticker, exc)
            estimate = ProbabilityEstimate(
                probability=market_prob,
                confidence=0.05,
                news_velocity="stale",
                reasoning=f"Analysis unavailable: {exc}",
                market_prob=market_prob,
                edge=1.0,
            )

        self._cache[ticker] = (estimate, now)
        return estimate

    def invalidate_cache(self, ticker: str):
        self._cache.pop(ticker, None)

    @staticmethod
    def _parse_json(text: str) -> dict:
        # Strip possible markdown code fences
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
        return json.loads(text)
