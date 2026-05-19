from dataclasses import dataclass, field
from dotenv import load_dotenv
import os

load_dotenv()


def _env(key: str, default: str = "") -> str:
    return os.getenv(key, default)


def _envf(key: str, default: float) -> float:
    return float(os.getenv(key, str(default)))


def _envi(key: str, default: int) -> int:
    return int(os.getenv(key, str(default)))


def _envb(key: str, default: bool) -> bool:
    return os.getenv(key, str(default)).lower() in ("1", "true", "yes")


@dataclass
class Config:
    # Kalshi auth – exactly one of the two methods must be configured
    kalshi_email: str = field(default_factory=lambda: _env("KALSHI_EMAIL"))
    kalshi_password: str = field(default_factory=lambda: _env("KALSHI_PASSWORD"))
    kalshi_key_id: str = field(default_factory=lambda: _env("KALSHI_KEY_ID"))
    kalshi_private_key_path: str = field(default_factory=lambda: _env("KALSHI_PRIVATE_KEY_PATH", "kalshi_private_key.pem"))
    kalshi_base_url: str = field(default_factory=lambda: _env("KALSHI_BASE_URL", "https://trading-api.kalshi.com/trade-api/v2"))

    # Anthropic
    anthropic_api_key: str = field(default_factory=lambda: _env("ANTHROPIC_API_KEY"))

    # Market scan criteria
    min_market_price_pct: float = field(default_factory=lambda: _envf("MIN_MARKET_PRICE_PCT", 0.5))
    max_market_price_pct: float = field(default_factory=lambda: _envf("MAX_MARKET_PRICE_PCT", 4.0))
    probability_edge_threshold: float = field(default_factory=lambda: _envf("PROBABILITY_EDGE_THRESHOLD", 1.5))
    scan_horizon_days: int = field(default_factory=lambda: _envi("SCAN_HORIZON_DAYS", 7))
    top_n_markets: int = field(default_factory=lambda: _envi("TOP_N_MARKETS", 10))
    min_volume: int = field(default_factory=lambda: _envi("MIN_VOLUME", 100))

    # S-curve scheduling
    max_check_interval: int = field(default_factory=lambda: _envi("MAX_CHECK_INTERVAL", 3600))
    min_check_interval: int = field(default_factory=lambda: _envi("MIN_CHECK_INTERVAL", 60))
    sigmoid_inflection_hours: float = field(default_factory=lambda: _envf("SIGMOID_INFLECTION_HOURS", 4.0))
    sigmoid_steepness: float = field(default_factory=lambda: _envf("SIGMOID_STEEPNESS", 1.0))

    # Trade execution
    paper_trading: bool = field(default_factory=lambda: _envb("PAPER_TRADING", True))
    max_trade_contracts: int = field(default_factory=lambda: _envi("MAX_TRADE_CONTRACTS", 100))
    breaking_news_multiplier: float = field(default_factory=lambda: _envf("BREAKING_NEWS_MULTIPLIER", 3.0))
    slow_news_multiplier: float = field(default_factory=lambda: _envf("SLOW_NEWS_MULTIPLIER", 1.5))

    # Misc
    db_path: str = field(default_factory=lambda: _env("DB_PATH", "shooter.db"))
    log_level: str = field(default_factory=lambda: _env("LOG_LEVEL", "INFO"))

    @property
    def uses_rsa_auth(self) -> bool:
        return bool(self.kalshi_key_id and os.path.exists(self.kalshi_private_key_path))

    @property
    def uses_jwt_auth(self) -> bool:
        return bool(self.kalshi_email and self.kalshi_password)


config = Config()
