const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../strategy-core');
const SMC = require('../smc-core');
const { eventFor } = require('../monitor');
const start = Date.UTC(2026, 0, 5);
const bar = (i, o, h, l, c) => ({ time: start + i * 900000, open: o, high: h, low: l, close: c, volume: 100 });
const empty = { highs: [], lows: [] };
test('FVG is born only on candle three and removed after full fill', () => {
  const c = [bar(0, 100, 101, 99, 100), bar(1, 100, 105, 100, 104), bar(2, 104, 106, 103, 105)];
  assert.equal(SMC.analyze(c.slice(0, 2), [1, 1], empty, []).zones.length, 0);
  const z = SMC.analyze(c, [1, 1, 1], empty, []).zones[0];
  assert.equal(z.low, 101); assert.equal(z.high, 103); assert.equal(z.time, c[2].time);
  c.push(bar(3, 105, 106, 100, 102));
  assert.equal(SMC.analyze(c, [1, 1, 1, 1], empty, []).zones.some(z => z.time === c[2].time), false);
});
test('SMC events use confirmation time and never backdate an order block', () => {
  const c = [bar(0, 100, 102, 99, 101), bar(1, 101, 103, 100, 102), bar(2, 102, 103, 100, 101), bar(3, 101, 106, 101, 105)];
  const swings = { highs: [{ index: 1, confirmIndex: 2, time: c[1].time, price: 103 }], lows: [] };
  assert.equal(SMC.analyze(c.slice(0, 3), [1, 1, 1], swings, []).events.length, 0);
  const a = SMC.analyze(c, [1, 1, 1, 1], swings, []);
  assert.equal(a.events[0].time, c[3].time);
  assert.equal(a.zones.find(z => z.type === 'OB').time, c[3].time);
});
test('empty and short input fail closed rather than crashing', () => {
  for (const c of [[], [bar(0, 100, 101, 99, 100)]]) {
    const a = Core.analyzeMarket({ exec: c }, { now: start + 900000 });
    assert.equal(a.actionable, false); assert.equal(a.plan, null);
  }
});
test('EMA skips missing values rather than treating null as zero', () => {
  assert.deepEqual(Core.ema([null, null, 10, 12, 14], 3), [null, null, null, null, 12]);
});
test('forming candle is excluded even one millisecond before close', () => {
  assert.equal(Core.filterClosedCandles([bar(0, 100, 101, 99, 100)], 15, start + 900000 - 1).length, 0);
});
test('alert identity is stable for same bar, and exit dedup survives new bars', () => {
  const a = { actionable: true, state: 'READY_LONG', exec: { candles: [bar(0, 1, 2, 1, 2)] }, generatedAt: start, plan: { entry: 1, stop: .9, tp1: 1.1, tp2: 1.2, tp3: 1.3 } };
  assert.equal(eventFor(a, 'gold').key, eventFor({ ...a, generatedAt: start + 5000 }, 'gold').key);
  a.positionDecision = { action: 'EXIT_LONG', reasons: ['stop'] };
  const p = { entry: 1, stop: .9 };
  const id = eventFor(a, 'gold', p).key;
  a.exec.candles.push(bar(1, 1, 2, 1, 2));
  assert.equal(eventFor(a, 'gold', p).key, id);
  assert.equal(eventFor({ ...a, actionable: false, positionDecision: null }, 'gold'), null);
});

test('recommendation includes Japanese action, SL, targets and correct public asset link', () => {
  const a = { actionable: true, state: 'READY_SHORT', exec: { candles: [bar(0, 100, 101, 99, 100)] }, generatedAt: start,
    components: [{ long: 0, short: 11, text: '4H bear' }], plan: { entry: 100, stop: 102, tp1: 98, tp2: 96, tp3: 94 } };
  const event = eventFor(a, 'btc');
  assert.match(event.title, /売り候補/);
  assert.match(event.text, /損切り（SL）: 102/);
  assert.match(event.text, /TP3: 94/);
  assert.match(event.text, /4H bear/);
  assert.equal(new URL(event.url).searchParams.get('asset'), 'btc');
  assert.equal(new URL(event.url).origin, 'https://yuzora-yu.github.io');
  assert.match(event.text, /リンク先は現在の相場/);
});
