"""
Async Kalshi REST API client.

Supports two auth methods:
  RSA  – KALSHI_KEY_ID + PEM private key (recommended for production)
  JWT  – email + password login (simpler, token valid ~24 h)
"""

import asyncio
import base64
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


@dataclass
class Market:
    ticker: str
    title: str
    subtitle: str
    yes_bid: float      # 0.0–1.0 (fraction, not cents)
    yes_ask: float
    no_bid: float
    no_ask: float
    last_price: float
    volume: int
    open_interest: int
    close_time: datetime
    status: str
    category: str
    series_ticker: str

    @property
    def mid_price(self) -> float:
        return (self.yes_bid + self.yes_ask) / 2.0

    @property
    def spread(self) -> float:
        return self.yes_ask - self.yes_bid

    @property
    def hours_remaining(self) -> float:
        now = datetime.now(timezone.utc)
        delta = self.close_time - now
        return max(0.0, delta.total_seconds() / 3600.0)


class KalshiClient:
    def __init__(self, config):
        self.config = config
        self._base = config.kalshi_base_url.rstrip("/")
        # Derive the path prefix used in RSA signing (everything after the host)
        parsed = urlparse(self._base)
        self._path_prefix = parsed.path  # e.g. "/trade-api/v2"

        self._client: Optional[httpx.AsyncClient] = None
        self._jwt: Optional[str] = None
        self._jwt_expiry: float = 0.0
        self._private_key = None

    # ── lifecycle ─────────────────────────────────────────────────────────────

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=30.0)
        if self.config.uses_rsa_auth:
            self._load_private_key()
        return self

    async def __aexit__(self, *_):
        if self._client:
            await self._client.aclose()

    def _load_private_key(self):
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        with open(self.config.kalshi_private_key_path, "rb") as f:
            self._private_key = load_pem_private_key(f.read(), password=None)
        logger.debug("Loaded RSA private key from %s", self.config.kalshi_private_key_path)

    # ── authentication ────────────────────────────────────────────────────────

    async def _auth_headers(self, method: str, path: str) -> dict:
        if self.config.uses_rsa_auth:
            return self._rsa_headers(method, path)
        if self.config.uses_jwt_auth:
            token = await self._get_jwt()
            return {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
        raise RuntimeError("No Kalshi auth configured – set KALSHI_EMAIL/PASSWORD or KALSHI_KEY_ID/PRIVATE_KEY_PATH")

    def _rsa_headers(self, method: str, path: str) -> dict:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding

        ts_ms = int(round(time.time() * 1000))
        # Kalshi signs: "{timestamp_ms}{METHOD}{/full/path}"
        msg = f"{ts_ms}{method.upper()}{self._path_prefix}{path}".encode()
        sig = self._private_key.sign(msg, padding.PKCS1v15(), hashes.SHA256())
        return {
            "KALSHI-ACCESS-KEY": self.config.kalshi_key_id,
            "KALSHI-ACCESS-TIMESTAMP": str(ts_ms),
            "KALSHI-ACCESS-SIGNATURE": base64.b64encode(sig).decode(),
            "Content-Type": "application/json",
        }

    async def _get_jwt(self) -> str:
        if self._jwt and time.time() < self._jwt_expiry:
            return self._jwt
        resp = await self._client.post(
            f"{self._base}/login",
            json={"email": self.config.kalshi_email, "password": self.config.kalshi_password},
        )
        resp.raise_for_status()
        self._jwt = resp.json()["token"]
        self._jwt_expiry = time.time() + 20 * 3600   # refresh well before 24-h expiry
        logger.debug("Obtained Kalshi JWT (valid ~20 h)")
        return self._jwt

    # ── helpers ───────────────────────────────────────────────────────────────

    async def _get(self, path: str, params: dict | None = None) -> dict:
        headers = await self._auth_headers("GET", path)
        resp = await self._client.get(f"{self._base}{path}", headers=headers, params=params or {})
        resp.raise_for_status()
        return resp.json()

    async def _post(self, path: str, body: dict) -> dict:
        headers = await self._auth_headers("POST", path)
        resp = await self._client.post(f"{self._base}{path}", headers=headers, json=body)
        resp.raise_for_status()
        return resp.json()

    # ── public API ────────────────────────────────────────────────────────────

    async def get_markets(
        self,
        *,
        category: str = "politics",
        status: str = "open",
        limit: int = 100,
        cursor: Optional[str] = None,
        min_close_ts: Optional[int] = None,
        max_close_ts: Optional[int] = None,
    ) -> tuple[list[Market], Optional[str]]:
        params: dict = {"status": status, "limit": limit}
        if category:
            params["category"] = category
        if cursor:
            params["cursor"] = cursor
        if min_close_ts is not None:
            params["min_close_ts"] = min_close_ts
        if max_close_ts is not None:
            params["max_close_ts"] = max_close_ts

        data = await self._get("/markets", params)
        markets = [self._parse_market(m) for m in data.get("markets", [])]
        return markets, data.get("cursor") or None

    async def get_all_political_markets(self, days_ahead: int = 7) -> list[Market]:
        now_ts = int(time.time())
        max_ts = now_ts + days_ahead * 86400
        all_markets: list[Market] = []
        cursor: Optional[str] = None

        while True:
            markets, cursor = await self.get_markets(
                category="politics",
                min_close_ts=now_ts,
                max_close_ts=max_ts,
                cursor=cursor,
            )
            all_markets.extend(markets)
            if not cursor or not markets:
                break
            await asyncio.sleep(0.25)   # gentle rate-limiting

        return all_markets

    async def get_market(self, ticker: str) -> Market:
        data = await self._get(f"/markets/{ticker}")
        return self._parse_market(data["market"])

    async def place_order(
        self,
        ticker: str,
        side: str,       # "yes" | "no"
        count: int,
        price_cents: int,
        order_type: str = "limit",
    ) -> dict:
        if self.config.paper_trading:
            logger.info(
                "[PAPER] %s %s x%d on %s @ %dc",
                order_type, side, count, ticker, price_cents,
            )
            return {"status": "paper", "ticker": ticker, "side": side, "count": count, "price": price_cents}

        price_key = "yes_price" if side == "yes" else "no_price"
        body = {
            "action": "buy",
            "count": count,
            "side": side,
            "ticker": ticker,
            "type": order_type,
            price_key: price_cents,
        }
        return await self._post("/portfolio/orders", body)

    # ── parsing ───────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_market(d: dict) -> Market:
        raw_close = d.get("close_time", "")
        try:
            close_time = datetime.fromisoformat(raw_close.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            close_time = datetime.now(timezone.utc)

        def cents(v) -> float:
            """Kalshi returns prices in cents (0-100); normalise to 0-1."""
            return int(v or 0) / 100.0

        return Market(
            ticker=d.get("ticker", ""),
            title=d.get("title", ""),
            subtitle=d.get("subtitle", "") or "",
            yes_bid=cents(d.get("yes_bid")),
            yes_ask=cents(d.get("yes_ask")),
            no_bid=cents(d.get("no_bid")),
            no_ask=cents(d.get("no_ask")),
            last_price=cents(d.get("last_price")),
            volume=int(d.get("volume", 0)),
            open_interest=int(d.get("open_interest", 0)),
            close_time=close_time,
            status=d.get("status", ""),
            category=d.get("category", ""),
            series_ticker=d.get("series_ticker", ""),
        )
