# Research log — Gold / BTC, 2026-09-14

## 2026-09-28: auditable prediction persistence

`npm run audit:research` reads the existing private cohort without running its collector or rewriting originals. It publishes a complete private report directory atomically, with source hashes, exact outcome-price provenance, missing versus pending windows, clock anomalies, revised-price conflicts, and non-overlapping window IDs. Raw snapshot receipt does not prove that a derived prediction was saved at that time. Legacy rows therefore remain historical benchmarks; near-close receipt alone does not make the next candle open executable.

`npm run freeze:research` registers a separate analysis-only post-freeze price benchmark and saves the current shared-engine prediction before evaluating later prices. It records generation start/completion, target candle close, latest input event time, request/receipt times, exchange clock bounds, source payload, settings/code hashes and a persistence receipt. Repeated decision IDs retain their first saved record. The price window starts at a future 15-minute boundary with a 60-second persistence guard, separately from the original immediate-EXIT/retest studies. Missing or slow clock measurements and stale inputs are ineligible. This is local persistence evidence, not third-party timestamp certification or a simulated execution strategy.

All data and research outputs stay under ignored `.runtime/hourly-observation/` subfolders. Neither command changes alerts, signal thresholds, UI or the live monitor. Do not run another hourly collector from the research task. No probabilities, calibrated edge, or profitability are established by these tools. Costs of 7/14/21 bps are sensitivity assumptions for fixed-hold price changes, not realized P&L. Non-overlap does not establish statistical independence.

The [Bybit candle documentation](https://bybit-exchange.github.io/docs/v5/market/kline) distinguishes an unfinished candle's last traded price from a completed close. The [server-time endpoint](https://bybit-exchange.github.io/docs/v5/market/time) also warns of delayed responses during extreme volatility; record request/receipt bounds instead of silently correcting original timestamps. [Recent trades](https://bybit-exchange.github.io/docs/v5/market/recent-trade) remain count-limited and must not become continuous CVD. [CME's 2026 trading calendars](https://www.cmegroup.com/trading-hours.html) and [24/7 product schedule](https://www.cmegroup.com/markets/trade-24-7.html) are venue/product-specific context, not proof of Bybit liquidity or XM execution hours. Session, volatility and EXIT/retest effects require their own frozen, market-specific validation.

## 2026-09-15: collection coverage amendment

Hourly scheduling can drift across five 15-minute boundaries. Fetching only the latest four snapshots then misses a candle. The collector now compares saved IDs with the server's latest 24-bar retention window and retrieves missing snapshots, newest first. Initial collection remains four bars; gaps older than retention cannot be recovered by this change. Existing snapshots and their first observation times remain immutable. Recovered records receive their actual receipt time, never the historical candle-close time. This amends collection coverage, not the original study's entry rules or its frozen private specification.

Boundary-drift, repeat-run and retention-limit fixtures cover the recovery behavior. Late recovery is research reconstruction, not evidence that a real-time alert or executable entry existed at candle close.

The [author-hosted PBO paper](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) is now accessible; its abstract was checked directly. This reinforces recording tried strategies and separating selection from evaluation. No PBO estimate or validated profitable edge is claimed. Bybit's official recent-trade limits were rechecked: 60 for spot and 1,000 for other categories, so the existing sampling comparability restrictions remain necessary.

## Goal and current evidence

Optimize cost-adjusted expectancy, loss severity and decision clarity, rather than the largest historical win rate. There is no demonstrated profitable edge in the current P model. The new forward cohort began with 10 observations and no resolved two-hour outcomes; current counts are recorded in the private summary on each run. These are overlapping observations, not independent trades. No signal thresholds were changed in this update.

## Sources checked and implications

- [Bybit recent public trades](https://bybit-exchange.github.io/docs/v5/market/recent-trade): each execution includes the taker side, size, price and ID. Spot returns at most 60 recent trades; other supported categories allow 1,000. Therefore a snapshot of BTC spot and Gold perpetual is not a matching time window. Store raw executions, IDs, timestamps, sample duration and rejected records. Do not infer full-candle delta, continuous CVD or trader identity from this sample.
- [Bybit tickers](https://bybit-exchange.github.io/docs/v5/market/tickers): best bid/ask and derivative market fields provide execution-environment observations. Store quote spread and available funding/index/mark/open-interest fields without replacing missing fields with zero. Bybit's quote spread is not XM's execution cost.
- [Bailey et al., The Probability of Backtest Overfitting — author institution abstract](https://scholarworks.wmich.edu/math_pubs/42/): ordinary holdout alone can be unreliable when selecting investment backtests; the paper discusses PBO and CSCV. This review checked the abstract, not the paywalled full text. PBO/CSCV are not implemented or claimed as passed here. Maintain a registry of all tried rules, including failures, before future model selection.

## Research-only collection added

`node research-observer.cjs --multiframe` now also saves `.runtime/hourly-observation/cohort-v1/microstructure/*.json.gz`. The first successful sample contained 1,000 Gold executions across 438.99 seconds and 60 BTC executions across 31.76 seconds. This difference demonstrates why sample imbalance cannot be compared as if it covered a common minute. Hourly polling leaves gaps and is unsuitable for continuous footprint reconstruction. All these records remain outside Git and outside the live signal engine.

## Predeclared next comparisons

### Sampling-quality follow-up

Each endpoint now records request start, receipt and exchange response times separately. Trade quality records the observed span, age of the last execution and future-timestamp anomalies. The receipt time is the earliest locally available feature time: a request-start timestamp must not make later data appear available earlier. Even a long timestamp span does not establish complete candle coverage. Missing server time remains unknown. These quality flags are descriptive, not new trading thresholds.

[Bybit public WebSocket trades](https://bybit-exchange.github.io/docs/v5/websocket/public/trade) provides streaming executions, with up to 1,024 trades per futures/spot message. A future continuous collector would need disconnect/gap tracking, deduplication, storage limits and aligned time windows before a footprint or CVD feature could be evaluated. Hourly REST sampling does not meet that requirement; no continuous collection is claimed here.

1. EXIT reversal versus waiting for a subsequent structure break and failed retest. Preserve the previously registered EXIT study separately; do not relabel its history as this cohort's prospective data.
2. P candidates with and without upper-timeframe alignment, split by asset, session and volatility regime. Keep non-signal control observations and report coverage/missing periods.
3. Assess whether quote conditions and sampled trade imbalance add information only after matching observation time and sampling coverage. These samples occur at retrieval time, not retrospectively at the frozen 15m candle close. Never join later trade data as a feature available at an earlier signal.

Before a production change: freeze definitions and trial counts; exclude overlapping outcome windows; use untouched chronological periods; examine costs at multiple assumptions, expectancy, drawdown and sample size; investigate stability by asset and market regime. Thirty observations is only a starting point for evaluation, not proof or an adoption threshold. Where data is inadequate, retain the current model and continue analysis. No paid sources, orders or automatic threshold optimization are introduced.

## Clarity improvements

The review workspace now starts with a per-asset six-timeframe table and reasons for waiting. Snapshots older than 20 minutes are explicitly treated as past records in that table. The ZIP includes `overview.png` in addition to the individual charts and evidence. Directional agreement remains a description, not a new confidence score or entry rule.

## UI6: explain the next condition, using shared engine facts

The review workspace now exposes a collapsible decision checklist with continuation, EMA21 pullback, EMA13 reclaim, ribbon integrity, volume, confirmed H1 alignment and ADX. Current EMA13/21 levels, the final engine vetoes, EXIT caution and the reference plan are shown together. Missing fields remain unknown. These are diagnostic facts emitted by the same flow calculation; no counting rule or new trade trigger is introduced.

The AI export now includes decision.png and decision.json, and the copied consultation text includes the same checklist. Both-asset export contains 18 files. Expanded/collapsed state survives the periodic freshness refresh. Mobile touch targets and wrapping were checked at 390px, and desktop layout was checked at 1280px.

Validation: 41 automated tests pass, including future-bar invariance of the diagnostic fields and missing/stale-data handling. A one-off comparison of all 204 stored snapshots against commit 41aa5e0 found identical existing flow histories after excluding the added diagnostic object. Production signal thresholds are unchanged. This improves decision clarity, not demonstrated profitability.

## UI7: current environment versus saved decision

Live reviews now freeze non-15m frames at capture start, while canonical 15m signals remain exactly the saved inputs and settings. Archived reviews retain the historical cutoff for every frame. Schema 2 records each frame cutoff, decisionCutoff and timeBasis; images and AI text explicitly distinguish post-decision observations. These later observations must never be used as past prediction features.

Presentation-only veto explanations list actual failed or unknown setup checks. Original signals, thresholds, veto arrays, notifications and engine version are unchanged. The UI identifies candidate conditions as experimental, not a position-management verdict. Regression tests cover latest minute closure, historical isolation and canonical signal equality.
