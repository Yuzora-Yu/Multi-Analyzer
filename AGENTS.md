# GOLD review workflow

## MT5 chart-symbol support (2026-10-26 explicit user instruction)

The MT5 indicator supports the attached chart symbol, including BTC/USD, USDJPY and other broker-provided FX/CFD symbols. This supersedes the Gold-only restriction for manual MT5 indicator use and its requested implementation/testing only. Use each symbol's native bars, digits, quote basis and trading sessions; do not claim equal predictive accuracy across instruments. It does not authorize BTC cloud monitoring, emails, scheduled acquisition, research accounts or collectors. The public market analyzer and existing cloud monitoring remain Gold-only. Market-data exports remain local and contain no account/position information. Do not install or operate MT5 charts without the user's current authorization.

## P-only mail and paused collector chat (2026-10-23 user instruction)

Email notifications are limited to canonical confirmed M15 pullback-v1 P events. Do not email zone approach/in-zone or EXIT events. Keep chart EXIT calculations, dots and saved history. Use the operational p-only-mail wrapper; do not rewrite frozen demo dependencies or strategy conditions. No live test email is authorized by this change.

The three existing schedules targeting collector chat 01a07f5f-abd0-7190-b40d-7e5f591d7222 are PAUSED at the user's request (19-24-5, automation, automation-2). Do not restart or duplicate them. This stops that chat's scheduled work, not the existing cloud Gold monitoring or P email. Historical demo records remain retained; the other audit schedule is not implicitly stopped.

## Restore temporary UI settings (2026-10-23 user instruction)

Before changing MT5 chart/window properties for implementation or verification, record the current relevant settings. Restore temporary changes before finishing, including the active chart/timeframe, background/colors, zoom/scale, grid/foreground, panes and window size if changed. Keep user-requested product changes, such as new display controls and the white-background indicator palette. Do not replace the user's chart styling with a default test template or leave cleanup for the user. Indicator code must not change chart-wide properties to force its own theme.

## Active scope (2026-10-16 explicit user instruction)

This chat and the collector chat 「デモ検証」 are Gold-only. Stop BTC acquisition, current research/demo evaluation and every BTC notification. The public application offers only Gold. Keep historical BTC sources, frozen registrations and results; record the user-requested stop without inventing liquidation or completing the unfinished validation period. Preserve Gold strategy hashes and behavior. Deploy `cloudflare/gold-only.mjs`, the operational scope wrapper, without rewriting the frozen `cloudflare/monitor.mjs`; the BTC partition's alarm is cancelled and its execution routes are blocked. Gold monitoring, fixed demo-v1, notifications and market-closure rules continue. Existing automation schedules/models remain unchanged. Discord readthrough continues; other symbols in historical posts provide method context only and do not authorize restarting their live research.

## Research storage policy (2026-10-11 user instruction)

The user explicitly requested that the independent demo/research chats accumulate data in Git instead of growing local downloads. Research observations and sanitized research outputs belong in the dedicated PRIVATE `Yuzora-Yu/Multi-Analyzer-data` repository. This supersedes older instructions that excluded all observation data from Git; secrets, personal information and mail records remain excluded. Never add runtime datasets to the public application repository.

Follow `DATA_STORAGE.md` and the shared `research-git-store.cjs` archiver. The collector task owns routine synchronization; persona tasks write their small output files for that archiver instead of cloning the dataset or creating another collector. Preserve original hashes, registration identities, timestamps and prediction records. Verify remote bytes and restoration before removing local generated copies. Keep working inputs needed by current evaluators; local working storage is not a separate permanent archive. Do not rewrite frozen demo dependencies to implement storage changes.

When the user contacts us about the current GOLD market, first inspect the live analyzer and its current shared snapshot. Do not answer only from prior screenshots, prior messages, or emotional framing.

- Re-fetch session-filtered closed candles for daily, H4, H1, M15, M5 and M1; inspect M30 when requested or provided. Record source and JST retrieval/last closed candle times. Distinguish live/forming quotes from confirmed analysis.
- Explain higher-timeframe structure and MA direction separately from the short-term trigger. A short-term bounce does not by itself change the higher-timeframe thesis.
- Give prospective SMC OB/FVG/liquidity zones and MA/BB confluence, entry confirmation, structural invalidation, protective stop placement and relevant target/obstacle zones. Distinguish countertrend scenarios.
- Check current economic releases, central-bank events and relevant market background. Never infer a specific news cause from price alone. Do not treat expired/partial calendars as complete.
- Analyzer XAUUSDT perpetual quotes differ from the user's broker GOLD/USD. Do not translate prices using a fixed assumed offset.
- Zone analysis is primary. Exit warnings are supplemental and never imply a reversal entry. An unconfirmed zone is not an instruction to trade.
- Preserve existing SMC and experimental P strategy; new contextual features must not be represented as proven profitable or silently promoted to trade execution.
- Start each follow-up review with the previously stated checkpoint and its ORIGINAL price basis, timeframe, confirmation and invalidation rules. Report actual touch, closed-candle evidence and status (not reached / awaiting confirmation / confirmed / invalidated) before introducing farther zones.
- Never widen an invalidated zone or protective stop after the move to preserve a directional thesis. A new zone is a separate hypothesis; explicitly close the old one first. Do not equate short invalidation with long entry confirmation.
- Evaluate the CURRENT checkpoint on its own merits. Keep higher-timeframe bias separate from actual local price/MA behavior; a delayed structure label cannot override a visibly reclaimed swing or a closed-candle zone break. Preserve the existing trigger rules when updating the review.
- GOLD collection/analysis/notifications remain stopped on JST weekends and market closures. Honor the separately agreed research pause; market review and interface/notification fixes do not authorize restarting strategy research.

## Knowledge-led context and prospective zones (2026-10-15 explicit user authorization)

The user requested resuming broad public-knowledge research and implementation of a tool that combines technical analysis, time of day, announcement aftermath through the next session, macroeconomics and geopolitics into prospective trading zones. This explicitly authorizes that context work; it does not authorize rewriting frozen demo-v1 conditions or reviving the three stopped reviewer chats.

- Start from existing research and practitioners' hypotheses as well as our observations. Do not require a new proprietary dataset before using generally available knowledge as a qualified hypothesis. Record sources, study periods, markets, time horizons, counterexamples and the difference between established clocks and untested trading interpretations.
- Read `MARKET_CONTEXT.md`, `market-knowledge.js` and `market-brief.js`. Keep public research knowledge in the app Git, private observations in the dedicated private data Git, and personal trading details out of both. Preserve the existing archive lock workflow.
- Continue adding and reconciling primary research, market-specific official clocks and actual release records. WGC session tendencies are regime-dependent; macro studies of FX or monthly gold must not become a minute-level gold win rate. A news article is evidence of a report, not automatic proof of a price cause.
- Maintain the current-context overlay's source/review times and calendar expiry. BLS-only schedules are partial. Update verified future schedules and released results when doing the existing review; do not fabricate consensus, live yields, dollar reactions or the absence of geopolitical news. No extra collector, paid source, duplicate automation or mail is implied.
- Before the relevant session/event, present a preferred conditional scenario and an opposing scenario with original SMC/MA/BB zones, confirmations, price basis, invalidation, protective stop references and obstacles. Freeze any actual forward test before its window; revised context is a new observation, not a rewrite of a failed earlier prediction.
- Keep current context separate from canonical M15 P/EXIT decisions, saved predictions and fixed accounts. Archived/CSV views without saved contemporary context must not acquire today's knowledge or calendar. Treat signal adoption as a separately versioned validation task.

## Independent cross-market synthesis (2026-10-16 user instruction)

- Treat the user's directional view as a hypothesis to challenge, not as the search scope or desired answer. Seek both supporting and opposing evidence before choosing a preferred scenario. If the prior interpretation was mistaken, identify the reasoning error rather than claiming unchanged facts are new market information.
- Review major-currency strength beyond USD/JPY, gold and silver relative performance, a consistently based gold/silver ratio, nominal and real yields, crude oil, copper and equity participation. Add positioning, ETF flows, economic releases and geopolitical reports when their observation dates and sources can be verified. Unavailable evidence stays unavailable.
- Align comparison endpoints, quote direction, market, contract and currency before comparing returns. Keep delayed quotes, daily Treasury observations, futures prices, spot references, monthly flows and current candles separate. Reject stale carried-forward endpoints as intraday reactions. Synthetic cross-currency gold returns are not separately observed local gold prices.
- Explain which evidence reflects the same dollar/rates factor; do not count correlated indicators as independent votes or an invented confidence percentage. Separate broad dollar weakness from country-specific FX moves and defensive rotation from a general risk rally. Report counterevidence such as silver failing to recover its pre-event level even when its daily rebound exceeds gold's.
- Combine this evidence into one preferred intraday scenario, the relevant session/event windows, original entry geography and explicit withdrawal/stop conditions. Do not rewrite an earlier stop or zone to preserve the thesis. Separate a discretionary contextual hypothesis from canonical P/EXIT and fixed demo-v1 entries.
- This authorizes broader reviews using free public sources, not another scheduled collector, paid data contract, order, email, restarted reviewer chat or altered fixed execution dependency. Preserve small sanitized observation records through the existing private-Git archive workflow; do not accumulate full chart histories or Downloads copies unnecessarily.

## Iterative quality of reversal zones (2026-10-22 user instruction)

The user expects each requested review to improve the quality of the analysis and to examine whether the analyzer's own candidate bands are sufficient. A list of breakout boundaries or generic technical levels does not satisfy a request for likely reversal areas.

- Inspect the actual analyzer output and original SMC events. Reconcile active, touched and withdrawn OB/FVG with liquidity sweeps, displacement, later confirmed structure changes, first retests and the higher-timeframe dealing range. Do not call a reaction area an active OB/FVG unless the original source supports that classification, or infer actual institutional orders from a candle pattern.
- Assess candidate coverage as well as the displayed candidates. Explain relevant sweep-return areas or liquidity pools that the current candidate list omits. Keep these additional discretionary hypotheses distinct from the analyzer's active zones and fixed entry conditions. Do not restore a withdrawn band by renaming or widening it.
- For each prospective reversal area, preserve the original observation time, price basis, formation and confirmation frames, freshness/repeated-touch status, supporting and opposing evidence, withdrawal boundary, protective-stop basis and nearby obstacles. Separate the place where a reversal may occur from evidence that it has occurred. Unavailable macro or cross-market confirmation stays unavailable.
- Record missed reactions, false reversals, late confirmation and failed hypotheses with the same care as successful examples. Use these findings to refine the next review and to identify concrete display, data-quality or candidate-coverage improvements; do not merely repeat an earlier explanation or make a change for its own sake.
- Carry safe, authorized display and evaluation improvements through appropriate verification and published-screen inspection. Any new trading condition or claim of improved predictive accuracy requires a separately fixed specification and unused validation period. Preserve demo-v1, original predictions, notification adoption restrictions, Gold closure rules and the existing automation settings.

## Discretionary entry and position management (2026-10-28 user instruction)

Read `execution-practice-knowledge.json` for sourced execution concepts and their limits. The user explicitly wants uncertainty handled through bounded risk and small initial positions, rather than requiring near-certainty before every entry. This is guidance for human-requested discretionary reviews, not authorization to execute orders or change canonical signals.

- Present a small zone probe, a confirmation entry/addition and a skip decision as distinct alternatives. Do not silently impose every confirmation-entry condition on the earlier probe. State whether a probe is reasonable at the actual entry geography, with local invalidation, stop reference and reward distance.
- Separate the first reaction obstacle from the main target. A minor M1 opposing zone is not automatically equivalent to H1 resistance/support or a mandatory full exit. Keep source-timeframe importance and evidence against the trade visible.
- Treat temporary adverse movement within the predeclared boundary separately from structural failure. Fix the relevant horizon and invalidation before entry; do not move the boundary to rescue a losing attempt.
- Discuss size in terms of the loss to the intended stop and available costs, not merely lot count. For planned scale-ins or retries, keep realized losses and planned risk on open portions within the original idea budget. Planned zone ladders and favorable-confirmation additions are different choices; neither is a blanket instruction to average into losses.
- Publish entry/stop/targets before the next move. Keep failed probes, no fills, early exits, adverse/favorable excursion and confirmation delay. A large nominal reward/risk ratio or a successful replay is not proof of an edge, and unknown hit rates do not require withholding every bounded discretionary hypothesis.
- Do not copy an author's account-risk percentage or ATR stop directly into Gold M1/M5. Preserve fixed demo-v1, P/EXIT, notification restrictions, Gold-only cloud scope, paused research/schedules and the prohibition on automatic orders.
