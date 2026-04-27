# shooter

A Kalshi political prediction-market trading bot that hunts for value in long-shot markets.

## What it does

1. **Scans** all open political markets on Kalshi closing within the next N days (default 7).
2. **Filters** to markets where the YES ask is in a target price range (default 0.5 – 4 cents), giving a high win/loss ratio payout structure.
3. **Scores** each candidate by asking Claude to estimate the true probability given current news, polling, and social-media sentiment.  Markets with meaningful edge (our estimate ÷ market price ≥ threshold) become candidates.
4. **Tracks** the top 10 candidates, checking them on a **sigmoid S-curve schedule**:
   - Far from expiry → hourly checks
   - As expiry approaches the curve accelerates checks toward every ~1 minute
   - Breaking-news detection overrides the curve and forces minimum-interval checks immediately
5. **Signals** three tiers of opportunity:
   - `VALUE` – steady edge above threshold
   - `MOMENTUM` – edge has jumped ≥ 20% since last check (slow-brewing story)
   - `BREAKING` – breaking-news velocity + large edge spike
6. **Executes** orders in either **paper mode** (logs only) or **live mode** (submits real orders to Kalshi).

All checks, signals, and orders are persisted to a local SQLite database (`shooter.db`).

---

## Setup

```bash
# 1. Install Python 3.11+, then:
pip install -r requirements.txt

# 2. Configure credentials
cp .env.example .env
# Edit .env with your Kalshi and Anthropic API keys
```

### Kalshi auth – choose one

**Option A – email/password** (simplest):
```
KALSHI_EMAIL=you@example.com
KALSHI_PASSWORD=your_password
```

**Option B – RSA API key** (recommended for production):
```bash
# Generate key pair
openssl genrsa -out kalshi_private_key.pem 2048
openssl rsa -in kalshi_private_key.pem -pubout -out kalshi_public_key.pem
# Upload kalshi_public_key.pem to your Kalshi dashboard → API keys
```
```
KALSHI_KEY_ID=<key-id-from-dashboard>
KALSHI_PRIVATE_KEY_PATH=kalshi_private_key.pem
```

---

## Running

```bash
# Paper trading (safe default – no real orders placed)
PAPER_TRADING=true python bot.py

# Live trading
PAPER_TRADING=false python bot.py
```

---

## Key parameters (via `.env`)

| Variable | Default | Meaning |
|---|---|---|
| `MIN_MARKET_PRICE_PCT` | `0.5` | Min YES ask in cents |
| `MAX_MARKET_PRICE_PCT` | `4.0` | Max YES ask in cents (win/loss ratio gate) |
| `PROBABILITY_EDGE_THRESHOLD` | `1.5` | Our prob must be ≥ 1.5× market price |
| `SCAN_HORIZON_DAYS` | `7` | Only look at markets closing within this many days |
| `TOP_N_MARKETS` | `10` | How many markets to track simultaneously |
| `MAX_CHECK_INTERVAL` | `3600` | Check interval (seconds) when expiry is far |
| `MIN_CHECK_INTERVAL` | `60` | Check interval (seconds) right before expiry |
| `SIGMOID_INFLECTION_HOURS` | `4.0` | Hours-to-expiry where the S-curve is steepest |
| `SIGMOID_STEEPNESS` | `1.0` | How sharply the curve transitions |
| `BREAKING_NEWS_MULTIPLIER` | `3.0` | Extra edge needed to trigger a BREAKING signal |
| `SLOW_NEWS_MULTIPLIER` | `1.5` | Extra edge needed for a MOMENTUM signal |
| `MAX_TRADE_CONTRACTS` | `100` | Contracts per order in live mode |
| `PAPER_TRADING` | `true` | Set `false` to place real orders |

---

## Architecture

```
bot.py               ← entry point, wires everything together
├── config.py        ← env-var configuration
├── kalshi_client.py ← async Kalshi REST API client (RSA + JWT auth)
├── news_analyzer.py ← Claude-based probability estimation with 5-min cache
├── market_scanner.py← filter, score, periodic hourly rescan
├── tracker.py       ← S-curve scheduling, signal detection, order execution
└── db.py            ← SQLite persistence (checks, signals, tracked markets)
```

---

## Database schema

```
tracked_markets  – markets currently being watched
market_checks    – every probability check (full time-series per ticker)
trade_signals    – every generated signal + action taken
```

Query with any SQLite client or:

```bash
sqlite3 shooter.db "SELECT ticker, signal_type, our_prob, edge, action FROM trade_signals ORDER BY signaled_at DESC LIMIT 20;"
```

---

## Disclaimer

This bot is for **educational and research purposes**.  Prediction-market trading involves real financial risk.  Always run in paper mode first, understand the strategy, and never risk more than you can afford to lose.
