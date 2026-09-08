/* Original, causal OHLCV heuristics. Zones are hypotheses, not institutional orders. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MultiAnalyzerSMC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function analyze(c, atr, swings, rsi) {
    const zones = [], events = [];
    let high = null, low = null, trend = 0;
    const consumed = new Set();
    const highs = new Map(swings.highs.map(s => [s.confirmIndex, s]));
    const lows = new Map(swings.lows.map(s => [s.confirmIndex, s]));
    for (let i = 2; i < c.length; i++) {
      const b = c[i], prev = c[i - 1], a = atr[i - 1];
      for (let z = zones.length - 1; z >= 0; z--) if (zones[z].status !== 'active' || i - zones[z].index > 150) zones.splice(z, 1);
      // Only information known BEFORE this candle can be broken or swept.
      for (const z of zones) {
        if (z.status !== 'active') continue;
        if (z.type === 'FVG' && (z.side === 'bull' ? b.low <= z.low : b.high >= z.high)) z.status = 'filled';
        if (z.type === 'OB' && (z.side === 'bull' ? b.close < z.low : b.close > z.high)) {
          z.status = 'invalidated'; z.invalidatedAt = b.time;
          events.push({ time: b.time, side: z.side === 'bull' ? 'bear' : 'bull', type: 'OB BREAK' });
        }
        if (z.status === 'active' && i > z.index && b.low <= z.high && b.high >= z.low) z.touchedAt = b.time;
      }
      if (high && !consumed.has(`h${high.index}`) && prev.close <= high.price && b.close > high.price) {
        events.push({ time: b.time, side: 'bull', type: trend < 0 ? 'CHoCH' : 'BOS', price: high.price });
        consumed.add(`h${high.index}`); trend = 1;
        if (a > 0 && b.close - b.open > a * 0.8) addOB('bull', i);
      }
      if (low && !consumed.has(`l${low.index}`) && prev.close >= low.price && b.close < low.price) {
        events.push({ time: b.time, side: 'bear', type: trend > 0 ? 'CHoCH' : 'BOS', price: low.price });
        consumed.add(`l${low.index}`); trend = -1;
        if (a > 0 && b.open - b.close > a * 0.8) addOB('bear', i);
      }
      if (low && b.low < low.price && b.close > low.price) events.push({ time: b.time, side: 'bull', type: 'SWEEP', price: low.price });
      if (high && b.high > high.price && b.close < high.price) events.push({ time: b.time, side: 'bear', type: 'SWEEP', price: high.price });
      if (a > 0 && Math.abs(prev.close - prev.open) > a * 0.8) {
        if (b.low - c[i - 2].high > a * 0.1) zones.push({ type: 'FVG', side: 'bull', low: c[i - 2].high, high: b.low, index: i, time: b.time, status: 'active' });
        if (c[i - 2].low - b.high > a * 0.1) zones.push({ type: 'FVG', side: 'bear', low: b.high, high: c[i - 2].low, index: i, time: b.time, status: 'active' });
      }
      if (highs.has(i)) high = highs.get(i);
      if (lows.has(i)) low = lows.get(i);
    }
    function addOB(side, i) {
      for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
        if (side === 'bull' ? c[j].close < c[j].open : c[j].close > c[j].open) {
          zones.push({ type: 'OB', side, low: c[j].low, high: c[j].high, index: i, time: c[i].time, originTime: c[j].time, status: 'active' });
          break;
        }
      }
    }
    const last = c.at(-1), tolerance = (atr.at(-1) || 0) * 0.15;
    const active = zones.filter(z => z.status === 'active' && c.length - z.index <= 150).slice(-16);
    const nearby = active.filter(z => z.low <= last.high && z.high >= last.low && z.index < c.length - 1);
    const bullRetest = nearby.some(z => z.side === 'bull' && last.close > z.high && last.close > last.open);
    const bearRetest = nearby.some(z => z.side === 'bear' && last.close < z.low && last.close < last.open);
    const rangeHigh = high?.price, rangeLow = low?.price;
    const equilibrium = rangeHigh > rangeLow ? (rangeHigh + rangeLow) / 2 : null;
    const location = equilibrium == null ? 'unknown' : last.close < equilibrium ? 'discount' : 'premium';
    const liquidity = [];
    for (const [side, list] of [['high', swings.highs], ['low', swings.lows]]) {
      const recent = list.slice(-12);
      for (let i = 1; i < recent.length; i++) {
        const s = recent[i], p = recent[i - 1];
        if (Math.abs(s.price - p.price) <= tolerance) {
          const price = (s.price + p.price) / 2;
          if (!c.slice(s.confirmIndex + 1).some(b => side === 'high' ? b.high > price + tolerance : b.low < price - tolerance)) liquidity.push({ type: side === 'high' ? 'EQH' : 'EQL', price });
        }
      }
    }
    const day = Math.floor(last.time / 86400000);
    const previousDay = c.filter(b => Math.floor(b.time / 86400000) === day - 1);
    if (previousDay.length) {
      liquidity.push({ type: 'PDH', price: Math.max(...previousDay.map(b => b.high)) }, { type: 'PDL', price: Math.min(...previousDay.map(b => b.low)) });
    }
    const ls = swings.lows.slice(-2), hs = swings.highs.slice(-2);
    const bullDivergence = ls.length === 2 && c.length - 1 - ls[1].confirmIndex <= 5 && ls[1].price < ls[0].price && Number.isFinite(rsi[ls[0].index]) && rsi[ls[1].index] > rsi[ls[0].index] + 3;
    const bearDivergence = hs.length === 2 && c.length - 1 - hs[1].confirmIndex <= 5 && hs[1].price > hs[0].price && Number.isFinite(rsi[hs[0].index]) && rsi[hs[1].index] < rsi[hs[0].index] - 3;
    // Approximate volume profile: candle volume assigned to typical-price bin, not footprint/delta.
    const window = c.slice(-96), lo = Math.min(...window.map(b => b.low)), hi = Math.max(...window.map(b => b.high));
    const bins = Array(24).fill(0), step = (hi - lo) / 24 || 1;
    for (const b of window) bins[Math.min(23, Math.max(0, Math.floor(((b.high + b.low + b.close) / 3 - lo) / step)))] += b.volume;
    const pocIndex = bins.indexOf(Math.max(...bins));
    const poc = bins.some(v => v > 0) ? lo + (pocIndex + 0.5) * step : null;
    return { zones: active, events: events.slice(-50), liquidity, equilibrium, location, bullRetest, bearRetest, bullDivergence, bearDivergence, poc, trend };
  }
  return { analyze };
});
