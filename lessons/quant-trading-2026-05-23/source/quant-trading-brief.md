# Quant Trading — a primer for rigorous readers

A self-directed primer on the math and discipline behind systematic trading.
Written for a reader who is technically literate but new to quantitative
finance — someone who can read code and equations, but hasn't internalized
the difference between "alpha" and "beta" as practitioners use the words.

## Audience and intent

This primer is NOT a how-to-get-rich text. It's an introduction to the
mathematical and procedural foundations that distinguish quantitative
trading from discretionary speculation. The reader finishes able to:

- Read a price series chart with statistical literacy (trend, seasonality,
  cycle, noise — and which parts are tradeable)
- Identify a mean-reversion trade and reason about why it can fail
- Compute and interpret a Sharpe ratio across timeframes
- Size positions using the Kelly criterion and understand WHY professionals
  use fractional Kelly
- Execute a stop-loss protocol without freezing or revenge-trading

## Core concepts to cover

### 1. Why quantitative thinking matters in markets

Markets are a hostile statistical environment: non-stationary, heavy-tailed,
adversarial. Without quantitative discipline, every trade becomes a
narrative — and narratives generate emotional positions that survive long
past their statistical justification. The math is the safety net.

### 2. Time series decomposition

Every price series can be decomposed into:
- **Trend** — long-run direction (linear regression slope)
- **Seasonality** — periodic component (day-of-week, hour-of-day)
- **Cycle** — multi-month wave, non-calendrical
- **Noise** — residual; ideally i.i.d., never actually is

You trade ONE of these. Knowing which is the difference between an edge
and a story you're telling yourself.

### 3. Mean reversion and pairs trading

When two assets co-move, their spread (S_t = log(P^A_t / P^B_t)) tends to
revert to its mean. Strategy:

1. Identify cointegrated pair via Engle-Granger or Johansen test
2. Compute rolling z-score of the spread: z_t = (S_t - μ) / σ
3. Short the spread at z > +2, long at z < -2
4. Exit at z = 0 (target) or |z| > 3.5 (regime break stop)

Failure modes — these kill mean-reversion strategies:
- Regime change (pair decouples, spread runs)
- Crowded trade (everyone arbitrages the edge away)
- Liquidity gaps (can't exit one leg at size)
- Funding shocks (margin call at maximum drawdown)

### 4. Risk-adjusted return — the Sharpe ratio

Returns alone don't measure skill. The Sharpe ratio normalizes:

SR = (E[R_p] - R_f) / σ_p
SR_annualized = SR_daily × √252

Reading the Sharpe:
- < 0.5 — noise; you'd do better in a Treasury bill
- 0.5 - 1.0 — retail-grade
- 1.0 - 2.0 — professional
- 2.0 - 3.0 — rare, top-decile fund
- > 3.0 — suspicious; likely overfit or misspecified volatility

A 30% return at 50% volatility is the same Sharpe as a 6% return at 10%
volatility. The first will scare you out of position; the second won't.

### 5. Position sizing — Kelly criterion

Given an edge with win probability p and payoff ratio b (you risk $1 to
win $b), the growth-optimal position size is:

f* = (p·b - q) / b = (p(b+1) - 1) / b   where q = 1 - p

Full Kelly is mathematically optimal but practically dangerous:
- Drawdowns of 40-60% are not edge cases
- Assumes p and b are KNOWN — in production they're estimates that shrink
- A single estimation error compounds catastrophically

Industry practice: half-Kelly or quarter-Kelly. Sacrifices ~25% of
theoretical growth for ~50% drawdown reduction. The math says full Kelly;
the survival data says don't.

### 6. Risk management — stop losses and drawdown

Position sizing answers "how much"; stop-loss protocol answers "when to
exit when wrong." Rules:

- Set the stop level BEFORE entering. Never widen in-trade.
- Trail the stop UP only (in a long position). Never down.
- At the stop: close immediately, no second-guessing.
- At the target: close, book, do not chase the next leg.
- Drawdown tolerance defined per strategy AND per portfolio.
  Halt trading when portfolio drawdown exceeds budget.

The exit is where amateurs lose money. Even with a positive expectancy
strategy, sloppy exits convert a winning edge into a flat or losing one.

## What this primer is NOT

- Not a beginner's investing guide (assumes you know what an order book is)
- Not a specific strategy playbook (no buy/sell signals)
- Not a backtesting tutorial (we discuss results, not how to run them)
- Not financial advice
