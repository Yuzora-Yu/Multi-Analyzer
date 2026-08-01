'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../strategy-core.js');

const MIN = 60_000;

function candle(time, open, high, low, close, volume = 100) {
  return { time, open, high, low, close, volume };
}

function synthetic(count = 420, minutes = 15, start = Date.UTC(2026, 0, 1)) {
  const out = [];
  let price = 2600;
  for (let i = 0; i < count; i++) {
    const drift = i < count * 0.55 ? 0.55 : -0.12;
    const wave = Math.sin(i / 7) * 2.4 + Math.sin(i / 19) * 4.2;
    const open = price;
    const close = Math.max(100, open + drift + wave * 0.13);
    const high = Math.max(open, close) + 2.1 + Math.abs(Math.sin(i)) * 1.2;
    const low = Math.min(open, close) - 2.0 - Math.abs(Math.cos(i)) * 1.1;
    out.push(candle(start + i * minutes * MIN, open, high, low, close, 1000 + (i % 20) * 70));
    price = close;
  }
  return out;
}

test('normalizeCandles sorts, deduplicates and rejects invalid OHLC', () => {
  const t = Date.UTC(2026, 0, 1);
  const rows = [
    candle(t + MIN, 10, 12, 9, 11),
    candle(t, 10, 11, 9, 10.5),
    candle(t + MIN, 10, 13, 8, 12),
    candle(t + 2 * MIN, 10, 9, 8, 10),
  ];
  const result = Core.normalizeCandles(rows);
  assert.equal(result.length, 2);
  assert.equal(result[0].time, t);
  assert.equal(result[1].high, 13);
});

test('filterClosedCandles excludes the forming candle', () => {
  const start = Date.UTC(2026, 0, 1);
  const rows = synthetic(3, 15, start);
  const now = start + 2 * 15 * MIN + 7 * MIN;
  const result = Core.filterClosedCandles(rows, 15, now);
  assert.equal(result.length, 2);
});

test('aggregateCandles only emits complete higher-timeframe buckets', () => {
  const start = Date.UTC(2026, 0, 1);
  const rows = synthetic(10, 15, start);
  const h1 = Core.aggregateCandles(rows, 60, { baseMinutes: 15 });
  assert.equal(h1.length, 2);
  assert.equal(h1[0].open, rows[0].open);
  assert.equal(h1[0].close, rows[3].close);
});

test('swings are unavailable before right-side confirmation', () => {
  const start = Date.UTC(2026, 0, 1);
  const rows = [
    candle(start + 0 * MIN, 5, 6, 4, 5),
    candle(start + 1 * MIN, 5, 7, 4, 6),
    candle(start + 2 * MIN, 6, 8, 5, 7),
    candle(start + 3 * MIN, 7, 12, 6, 8),
    candle(start + 4 * MIN, 8, 9, 5, 6),
    candle(start + 5 * MIN, 6, 8, 4, 5),
    candle(start + 6 * MIN, 5, 7, 3, 4),
  ];
  const before = Core.confirmedSwings(rows, 2, 2, 4);
  const confirmed = Core.confirmedSwings(rows, 2, 2, 5);
  assert.equal(before.highs.some(x => x.index === 3), false);
  assert.equal(confirmed.highs.some(x => x.index === 3), true);
  assert.equal(confirmed.highs.find(x => x.index === 3).confirmIndex, 5);
});

test('analyzeMarket returns independent LONG/SHORT scores and a risk plan', () => {
  const rows = synthetic(480, 15);
  const now = rows.at(-1).time + 15 * MIN + 1;
  const result = Core.analyzeMarket({ exec: rows }, { executionMinutes: 15, now, minBars: 220 });
  assert.ok(Number.isInteger(result.longScore));
  assert.ok(Number.isInteger(result.shortScore));
  assert.ok(result.longScore >= 0 && result.longScore <= 100);
  assert.ok(result.shortScore >= 0 && result.shortScore <= 100);
  assert.ok(result.plan);
  assert.ok(result.plan.stop !== result.plan.entry);
  assert.ok(result.plan.quantity >= 0);
});

test('manual blackout is a hard veto', () => {
  const rows = synthetic(420, 15);
  const now = rows.at(-1).time + 15 * MIN + 1;
  const result = Core.analyzeMarket({ exec: rows }, { executionMinutes: 15, now, blackout: true, minBars: 200 });
  assert.equal(result.state, 'NO_TRADE');
  assert.ok(result.vetoes.some(x => x.includes('ブラックアウト')));
});

test('position guard exits immediately when stop is touched', () => {
  const rows = synthetic(420, 15);
  const now = rows.at(-1).time + 15 * MIN + 1;
  const last = rows.at(-1).close;
  const result = Core.analyzeMarket({ exec: rows }, {
    executionMinutes: 15, now, minBars: 200, livePrice: last - 20,
    position: { direction: 'LONG', entry: last, stop: last - 10 }
  });
  assert.equal(result.positionDecision.action, 'EXIT_LONG');
  assert.equal(result.positionDecision.urgency, 100);
});

test('same-bar stop and target collision is resolved stop-first', () => {
  const rows = [
    candle(0 + MIN, 100, 101, 99, 100),
    candle(1 * MIN + MIN, 100, 104, 96, 101),
    candle(2 * MIN + MIN, 101, 102, 100, 101),
  ];
  const plan = {
    direction: 'LONG', entry: 100, stop: 98, tp1: 102, tp2: 104.4, tp3: 106.4,
    costs: { total: 0 },
  };
  const trade = Core._internal.simulateTrade(rows, 0, plan, { maxHoldBars: 10 });
  assert.equal(trade.reason, 'STOP');
  assert.equal(trade.r, -1);
});


test('after TP1, a same-bar touch of the new break-even stop exits conservatively', () => {
  const rows = [
    candle(1 * MIN, 100, 101, 99, 100),
    candle(2 * MIN, 100, 103, 99, 102),
    candle(3 * MIN, 102, 103, 101, 102),
  ];
  const plan = {
    direction: 'LONG', entry: 100, stop: 98, tp1: 102, tp2: 104.4, tp3: 106.4,
    costs: { total: 0 },
  };
  const trade = Core._internal.simulateTrade(rows, 0, plan, { maxHoldBars: 10 });
  assert.equal(trade.reason, 'TP1_THEN_BE');
  assert.equal(trade.r, 0.5);
});

test('CSV parser accepts ISO time and required columns', () => {
  const text = 'time,open,high,low,close,volume\n2026-01-01T00:00:00Z,10,12,9,11,100';
  const rows = Core.parseCSV(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].close, 11);
});

test('backtest completes without future data exceptions', () => {
  const rows = synthetic(310, 15);
  const result = Core.backtest({
    exec: rows,
    m15: rows,
    h1: Core.aggregateCandles(rows, 60, { baseMinutes: 15 }),
    h4: Core.aggregateCandles(rows, 240, { baseMinutes: 15 }),
  }, {
    executionMinutes: 15,
    now: rows.at(-1).time + 15 * MIN + 1,
    minBars: 220,
    maxBacktestBars: 310,
  });
  assert.equal(result.bars, 310);
  assert.ok(Number.isFinite(result.all.expectancyR));
  assert.ok(Array.isArray(result.trades));
});
