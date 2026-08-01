/*
 * Multi-Analyzer Ultimate - strategy engine
 * Rule-based research / paper-trading analytics only. No order execution.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MultiAnalyzerCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '3.0.0';
  const MINUTE = 60_000;
  const DEFAULTS = Object.freeze({
    executionMinutes: 15,
    minBars: 220,
    riskPct: 0.5,
    accountEquity: 1_000_000,
    feeBpsPerSide: 2.0,
    spreadBps: 1.8,
    slippageBps: 1.2,
    minNetRR: 1.8,
    maxLeverage: 3,
    scoreDiffMin: 8,
    watchScore: 58,
    readyScore: 70,
    strongScore: 82,
    maxExtensionATR: 1.05,
    maxHoldBars: 48,
    cooldownBars: 12,
    lossStreakCooldownBars: 36,
    dailyLossLimitR: 2.5,
    position: null,
    blackout: false,
    now: Date.now(),
  });

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function finite(v, fallback = 0) { return Number.isFinite(Number(v)) ? Number(v) : fallback; }
  function round(v, digits = 4) {
    if (!Number.isFinite(v)) return null;
    const p = 10 ** digits;
    return Math.round(v * p) / p;
  }
  function mean(values) {
    const a = values.filter(Number.isFinite);
    return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  }
  function stdev(values) {
    const m = mean(values);
    if (m == null) return null;
    const a = values.filter(Number.isFinite);
    if (a.length < 2) return 0;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
  }
  function median(values) {
    const a = values.filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
  function percentileRank(values, value) {
    const a = values.filter(Number.isFinite);
    if (!a.length || !Number.isFinite(value)) return 0.5;
    let n = 0;
    for (const x of a) if (x <= value) n += 1;
    return n / a.length;
  }

  function parseTime(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') {
      if (value > 1e12) return value;
      if (value > 1e9) return value * 1000;
      return NaN;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return NaN;
      if (/^\d+(\.\d+)?$/.test(trimmed)) return parseTime(Number(trimmed));
      return Date.parse(trimmed);
    }
    return NaN;
  }

  function normalizeCandles(input) {
    const byTime = new Map();
    for (const raw of Array.isArray(input) ? input : []) {
      const time = parseTime(raw.time ?? raw.timestamp ?? raw.date ?? raw.openTime);
      const open = finite(raw.open, NaN);
      const high = finite(raw.high, NaN);
      const low = finite(raw.low, NaN);
      const close = finite(raw.close, NaN);
      const volume = Math.max(0, finite(raw.volume, 0));
      if (![time, open, high, low, close].every(Number.isFinite)) continue;
      if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
      if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue;
      byTime.set(time, { time, open, high, low, close, volume });
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }

  function filterClosedCandles(candles, intervalMinutes, now = Date.now()) {
    const duration = intervalMinutes * MINUTE;
    return normalizeCandles(candles).filter(c => c.time + duration <= now + 1000);
  }

  function dataQuality(candles, intervalMinutes, now = Date.now()) {
    const c = normalizeCandles(candles);
    const expected = intervalMinutes * MINUTE;
    let gaps = 0;
    let maxGap = 0;
    for (let i = 1; i < c.length; i++) {
      const gap = c[i].time - c[i - 1].time;
      maxGap = Math.max(maxGap, gap);
      if (gap > expected * 1.55) gaps += Math.max(1, Math.round(gap / expected) - 1);
    }
    const last = c.at(-1);
    const ageMs = last ? Math.max(0, now - (last.time + expected)) : Infinity;
    const stale = !last || ageMs > expected * 2.25;
    const score = clamp(100 - gaps * 3 - (stale ? 30 : 0) - (c.length < 180 ? 25 : 0), 0, 100);
    return { bars: c.length, gaps, maxGapMs: maxGap, ageMs, stale, score };
  }

  function sma(values, period) {
    const out = Array(values.length).fill(null);
    let sum = 0;
    let valid = 0;
    const queue = [];
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i]);
      queue.push(Number.isFinite(v) ? v : null);
      if (Number.isFinite(v)) { sum += v; valid += 1; }
      if (queue.length > period) {
        const old = queue.shift();
        if (Number.isFinite(old)) { sum -= old; valid -= 1; }
      }
      if (queue.length === period && valid === period) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let seed = [];
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i]);
      if (!Number.isFinite(v)) continue;
      if (prev == null) {
        seed.push(v);
        if (seed.length === period) {
          prev = seed.reduce((s, x) => s + x, 0) / period;
          out[i] = prev;
        }
      } else {
        prev = v * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function trueRange(candles) {
    const out = Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const prevClose = i ? candles[i - 1].close : c.close;
      out[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
    }
    return out;
  }

  function wilder(values, period) {
    const out = Array(values.length).fill(null);
    let sum = 0;
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i]);
      if (!Number.isFinite(v)) continue;
      if (i < period) {
        sum += v;
        if (i === period - 1) {
          prev = sum / period;
          out[i] = prev;
        }
      } else {
        prev = ((prev * (period - 1)) + v) / period;
        out[i] = prev;
      }
    }
    return out;
  }

  function atr(candles, period = 14) { return wilder(trueRange(candles), period); }

  function rsi(values, period = 14) {
    const gains = Array(values.length).fill(0);
    const losses = Array(values.length).fill(0);
    for (let i = 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gains[i] = Math.max(0, d);
      losses[i] = Math.max(0, -d);
    }
    const avgGain = wilder(gains, period);
    const avgLoss = wilder(losses, period);
    return values.map((_, i) => {
      if (avgGain[i] == null || avgLoss[i] == null) return null;
      if (avgLoss[i] === 0) return 100;
      const rs = avgGain[i] / avgLoss[i];
      return 100 - 100 / (1 + rs);
    });
  }

  function macd(values, fast = 12, slow = 26, signal = 9) {
    const ef = ema(values, fast);
    const es = ema(values, slow);
    const line = values.map((_, i) => ef[i] == null || es[i] == null ? null : ef[i] - es[i]);
    const sig = ema(line, signal);
    const hist = values.map((_, i) => line[i] == null || sig[i] == null ? null : line[i] - sig[i]);
    return { line, signal: sig, hist };
  }

  function bollinger(values, period = 20, mult = 2) {
    const mid = sma(values, period);
    const upper = Array(values.length).fill(null);
    const lower = Array(values.length).fill(null);
    const width = Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      const window = values.slice(i - period + 1, i + 1);
      const sd = stdev(window);
      if (mid[i] == null || sd == null) continue;
      upper[i] = mid[i] + mult * sd;
      lower[i] = mid[i] - mult * sd;
      width[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : null;
    }
    return { mid, upper, lower, width };
  }

  function dmi(candles, period = 14) {
    const n = candles.length;
    const plusDM = Array(n).fill(0);
    const minusDM = Array(n).fill(0);
    const tr = trueRange(candles);
    for (let i = 1; i < n; i++) {
      const up = candles[i].high - candles[i - 1].high;
      const down = candles[i - 1].low - candles[i].low;
      plusDM[i] = up > down && up > 0 ? up : 0;
      minusDM[i] = down > up && down > 0 ? down : 0;
    }
    const atrW = wilder(tr, period);
    const plusW = wilder(plusDM, period);
    const minusW = wilder(minusDM, period);
    const plusDI = Array(n).fill(null);
    const minusDI = Array(n).fill(null);
    const dx = Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (!atrW[i]) continue;
      plusDI[i] = 100 * plusW[i] / atrW[i];
      minusDI[i] = 100 * minusW[i] / atrW[i];
      const den = plusDI[i] + minusDI[i];
      dx[i] = den ? 100 * Math.abs(plusDI[i] - minusDI[i]) / den : 0;
    }
    const adx = wilder(dx.map(v => v ?? 0), period);
    return { plusDI, minusDI, adx };
  }

  function rollingVWAP(candles, period = 96) {
    const out = Array(candles.length).fill(null);
    let pv = 0;
    let vol = 0;
    const q = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const typical = (c.high + c.low + c.close) / 3;
      const item = { pv: typical * c.volume, vol: c.volume };
      q.push(item); pv += item.pv; vol += item.vol;
      if (q.length > period) {
        const old = q.shift(); pv -= old.pv; vol -= old.vol;
      }
      out[i] = vol > 0 ? pv / vol : mean(candles.slice(Math.max(0, i - period + 1), i + 1).map(x => x.close));
    }
    return out;
  }

  function anchoredVWAP(candles, anchor = 'day') {
    const out = Array(candles.length).fill(null);
    let key = null, pv = 0, vol = 0;
    for (let i = 0; i < candles.length; i++) {
      const d = new Date(candles[i].time);
      const thisKey = anchor === 'week'
        ? `${d.getUTCFullYear()}-${Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 604800000)}`
        : `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      if (thisKey !== key) { key = thisKey; pv = 0; vol = 0; }
      const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
      pv += typical * candles[i].volume;
      vol += candles[i].volume;
      out[i] = vol > 0 ? pv / vol : typical;
    }
    return out;
  }

  function rollingZ(values, period = 30) {
    const out = Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      const window = values.slice(i - period + 1, i + 1);
      const m = mean(window), sd = stdev(window);
      out[i] = sd ? (values[i] - m) / sd : 0;
    }
    return out;
  }

  function confirmedSwings(candles, left = 3, right = 3, asOfIndex = candles.length - 1) {
    const highs = [], lows = [];
    const lastCandidate = Math.min(candles.length - 1 - right, asOfIndex - right);
    for (let i = left; i <= lastCandidate; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - left; j <= i + right; j++) {
        if (j === i) continue;
        if (candles[j].high >= candles[i].high) isHigh = false;
        if (candles[j].low <= candles[i].low) isLow = false;
      }
      if (isHigh) highs.push({ index: i, confirmIndex: i + right, time: candles[i].time, price: candles[i].high });
      if (isLow) lows.push({ index: i, confirmIndex: i + right, time: candles[i].time, price: candles[i].low });
    }
    return { highs, lows };
  }

  function detectStructure(candles, swings) {
    const last = candles.at(-1);
    const prev = candles.at(-2) || last;
    const h = swings.highs.at(-1);
    const l = swings.lows.at(-1);
    const hPrev = swings.highs.at(-2);
    const lPrev = swings.lows.at(-2);
    let trend = 'neutral';
    if (h && hPrev && l && lPrev) {
      if (h.price > hPrev.price && l.price > lPrev.price) trend = 'bull';
      else if (h.price < hPrev.price && l.price < lPrev.price) trend = 'bear';
      else trend = 'range';
    }
    let event = null;
    if (h && prev.close <= h.price && last.close > h.price) event = trend === 'bear' ? 'BULL_CHOCH' : 'BULL_BOS';
    if (l && prev.close >= l.price && last.close < l.price) event = trend === 'bull' ? 'BEAR_CHOCH' : 'BEAR_BOS';
    const bullSweep = l && last.low < l.price && last.close > l.price;
    const bearSweep = h && last.high > h.price && last.close < h.price;
    return { trend, event, lastSwingHigh: h || null, lastSwingLow: l || null, bullSweep, bearSweep };
  }

  function candlePattern(candles) {
    const c = candles.at(-1), p = candles.at(-2);
    if (!c || !p) return { bullReject: false, bearReject: false, bullEngulf: false, bearEngulf: false };
    const range = Math.max(c.high - c.low, Number.EPSILON);
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    return {
      bullReject: lowerWick / range > 0.48 && c.close > c.open && body / range > 0.18,
      bearReject: upperWick / range > 0.48 && c.close < c.open && body / range > 0.18,
      bullEngulf: c.close > c.open && p.close < p.open && c.close >= p.open && c.open <= p.close,
      bearEngulf: c.close < c.open && p.close > p.open && c.open >= p.close && c.close <= p.open,
    };
  }

  function sessionInfo(time) {
    const d = new Date(time);
    const parts = (zone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit'
    }).formatToParts(d).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    const lon = parts('Europe/London');
    const ny = parts('America/New_York');
    const tokyo = parts('Asia/Tokyo');
    const hm = x => Number(x.hour) * 60 + Number(x.minute);
    const l = hm(lon), n = hm(ny), t = hm(tokyo);
    const london = l >= 7 * 60 && l < 16 * 60 + 30;
    const newYork = n >= 8 * 60 && n < 17 * 60;
    const overlap = london && newYork;
    const asia = t >= 8 * 60 && t < 17 * 60;
    const rollover = n >= 16 * 60 + 45 && n <= 17 * 60 + 15;
    const londonOpen = l >= 7 * 60 && l < 10 * 60;
    const nyOpen = n >= 8 * 60 && n < 11 * 60;
    let name = overlap ? 'LONDON / NY OVERLAP' : london ? 'LONDON' : newYork ? 'NEW YORK' : asia ? 'ASIA' : 'OFF HOURS';
    return { name, london, newYork, overlap, asia, rollover, londonOpen, nyOpen };
  }

  function aggregateCandles(candles, targetMinutes, options = {}) {
    const c = normalizeCandles(candles);
    const targetMs = targetMinutes * MINUTE;
    const baseMinutes = options.baseMinutes || inferIntervalMinutes(c) || targetMinutes;
    const baseMs = baseMinutes * MINUTE;
    const buckets = new Map();
    for (const bar of c) {
      const bucket = Math.floor(bar.time / targetMs) * targetMs;
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push(bar);
    }
    const expected = Math.max(1, Math.round(targetMs / baseMs));
    const out = [];
    for (const [time, bars] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      bars.sort((a, b) => a.time - b.time);
      const contiguous = bars.every((b, i) => i === 0 || b.time - bars[i - 1].time <= baseMs * 1.25);
      if (options.dropIncomplete !== false && (bars.length < expected || !contiguous)) continue;
      out.push({
        time,
        open: bars[0].open,
        high: Math.max(...bars.map(x => x.high)),
        low: Math.min(...bars.map(x => x.low)),
        close: bars.at(-1).close,
        volume: bars.reduce((s, x) => s + x.volume, 0),
      });
    }
    return out;
  }

  function inferIntervalMinutes(candles) {
    if (!candles || candles.length < 3) return null;
    const diffs = [];
    for (let i = 1; i < candles.length; i++) {
      const d = candles[i].time - candles[i - 1].time;
      if (d > 0) diffs.push(d / MINUTE);
    }
    return Math.round(median(diffs) || 0) || null;
  }

  function analyzeTimeframe(rawCandles, intervalMinutes, now = Date.now()) {
    const candles = filterClosedCandles(rawCandles, intervalMinutes, now);
    const quality = dataQuality(candles, intervalMinutes, now);
    if (candles.length < 60) return { candles, quality, ready: false, reason: 'INSUFFICIENT_DATA' };
    const close = candles.map(c => c.close);
    const volume = candles.map(c => c.volume);
    const ema20 = ema(close, 20), ema50 = ema(close, 50), ema200 = ema(close, 200);
    const atr14 = atr(candles, 14);
    const rsi14 = rsi(close, 14);
    const macdData = macd(close);
    const bb = bollinger(close, 20, 2);
    const dmiData = dmi(candles, 14);
    const vwap96 = rollingVWAP(candles, Math.min(96, Math.max(20, Math.round(1440 / intervalMinutes))));
    const dayVwap = anchoredVWAP(candles, 'day');
    const weekVwap = anchoredVWAP(candles, 'week');
    const volZ = rollingZ(volume, 30);
    const swings = confirmedSwings(candles, 3, 3);
    const structure = detectStructure(candles, swings);
    const pattern = candlePattern(candles);
    const i = candles.length - 1;
    const last = candles[i];
    const atrNow = atr14[i] || mean(trueRange(candles).slice(-14)) || 0;
    const atrPct = last.close ? atrNow / last.close : 0;
    const atrRank = percentileRank(atr14.slice(Math.max(0, i - 120), i + 1), atrNow);
    const adxNow = dmiData.adx[i] || 0;
    const bbWidth = bb.width[i] || 0;
    const emaSlope = ema20[i] != null && ema20[Math.max(0, i - 5)] != null ? (ema20[i] - ema20[Math.max(0, i - 5)]) / Math.max(atrNow, Number.EPSILON) : 0;
    let trend = 'neutral';
    if (ema20[i] && ema50[i]) {
      if (last.close > ema20[i] && ema20[i] > ema50[i] && emaSlope > 0.05) trend = 'bull';
      else if (last.close < ema20[i] && ema20[i] < ema50[i] && emaSlope < -0.05) trend = 'bear';
      else trend = 'range';
    }
    let regime = 'range';
    if (atrRank > 0.92) regime = 'volatile';
    else if (adxNow >= 25 && Math.abs(emaSlope) > 0.18) regime = 'trend';
    else if (bbWidth < median(bb.width.slice(Math.max(0, i - 100), i + 1).filter(Number.isFinite)) * 0.75) regime = 'compression';
    const reference = mean([ema20[i], vwap96[i], dayVwap[i]].filter(Number.isFinite)) || last.close;
    const extensionATR = atrNow ? (last.close - reference) / atrNow : 0;
    const nearReference = atrNow ? Math.abs(last.close - reference) <= atrNow * 0.45 : false;
    const values = {
      close: last.close, ema20: ema20[i], ema50: ema50[i], ema200: ema200[i],
      atr: atrNow, atrPct, atrRank, rsi: rsi14[i], macd: macdData.line[i],
      macdSignal: macdData.signal[i], macdHist: macdData.hist[i],
      macdHistPrev: macdData.hist[i - 1], plusDI: dmiData.plusDI[i], minusDI: dmiData.minusDI[i],
      adx: adxNow, bbUpper: bb.upper[i], bbLower: bb.lower[i], bbWidth,
      vwap: vwap96[i], dayVwap: dayVwap[i], weekVwap: weekVwap[i], volZ: volZ[i],
      extensionATR, nearReference, emaSlope,
    };
    return { candles, quality, ready: candles.length >= 60, intervalMinutes, trend, regime, structure, pattern, swings, values, series: { ema20, ema50, ema200, atr14, rsi14, macd: macdData, bb, dmi: dmiData, vwap96, dayVwap, weekVwap, volZ } };
  }

  function addScore(bucket, key, longPts, shortPts, text) {
    bucket.long += longPts;
    bucket.short += shortPts;
    bucket.components.push({ key, long: longPts, short: shortPts, text });
  }

  function calculateCosts(entry, stop, settings) {
    const fee = entry * ((settings.feeBpsPerSide * 2) / 10_000);
    const spread = entry * (settings.spreadBps / 10_000);
    const slippage = entry * (settings.slippageBps / 10_000);
    const total = fee + spread + slippage;
    const riskDistance = Math.abs(entry - stop);
    return { fee, spread, slippage, total, riskDistance, costRiskRatio: riskDistance ? total / riskDistance : Infinity };
  }

  function buildTradePlan(direction, exec, settings) {
    const v = exec.values;
    const last = exec.candles.at(-1);
    const atrNow = v.atr;
    const swingLow = exec.structure.lastSwingLow?.price;
    const swingHigh = exec.structure.lastSwingHigh?.price;
    const entry = last.close;
    let stop;
    if (direction === 'LONG') {
      const structureStop = Number.isFinite(swingLow) ? swingLow - atrNow * 0.12 : entry - atrNow;
      stop = Math.min(structureStop, entry - atrNow * 0.75);
    } else {
      const structureStop = Number.isFinite(swingHigh) ? swingHigh + atrNow * 0.12 : entry + atrNow;
      stop = Math.max(structureStop, entry + atrNow * 0.75);
    }
    let risk = Math.abs(entry - stop);
    if (!risk || !Number.isFinite(risk)) risk = Math.max(entry * 0.004, atrNow || entry * 0.005);
    stop = direction === 'LONG' ? entry - risk : entry + risk;
    const sign = direction === 'LONG' ? 1 : -1;
    const tp1 = entry + sign * risk;
    const tp2 = entry + sign * risk * 2.2;
    const tp3 = entry + sign * risk * 3.2;
    const costs = calculateCosts(entry, stop, settings);
    const netRR = (Math.abs(tp2 - entry) - costs.total) / Math.max(risk + costs.total, Number.EPSILON);
    const riskBudget = settings.accountEquity * settings.riskPct / 100;
    const rawQty = riskBudget / Math.max(risk + costs.total, Number.EPSILON);
    const leverageQtyCap = settings.accountEquity * settings.maxLeverage / entry;
    const quantity = Math.min(rawQty, leverageQtyCap);
    return {
      direction, orderType: v.nearReference ? 'CLOSE_CONFIRM' : 'LIMIT_RETEST',
      entry: round(entry, 6), stop: round(stop, 6), tp1: round(tp1, 6), tp2: round(tp2, 6), tp3: round(tp3, 6),
      riskDistance: round(risk, 6), netRR: round(netRR, 2), quantity: round(quantity, 6),
      riskBudget: round(riskBudget, 2), costs: Object.fromEntries(Object.entries(costs).map(([k, val]) => [k, round(val, 6)])),
      invalidation: direction === 'LONG' ? `確定足で ${round(stop, 6)} 未満` : `確定足で ${round(stop, 6)} 超`,
    };
  }

  function positionDecision(position, signal, livePrice) {
    if (!position || !position.direction || !Number.isFinite(position.entry)) return null;
    const dir = String(position.direction).toUpperCase();
    const entry = finite(position.entry, NaN);
    const stop = finite(position.stop, NaN);
    const price = finite(livePrice, signal.exec.values.close);
    const opposite = dir === 'LONG' ? signal.shortScore : signal.longScore;
    const same = dir === 'LONG' ? signal.longScore : signal.shortScore;
    const rDist = Number.isFinite(stop) ? Math.abs(entry - stop) : Math.max(signal.exec.values.atr, entry * 0.005);
    const unrealizedR = rDist ? ((price - entry) * (dir === 'LONG' ? 1 : -1)) / rDist : 0;
    const stopHit = Number.isFinite(stop) && (dir === 'LONG' ? price <= stop : price >= stop);
    const oppositeReady = dir === 'LONG'
      ? ['READY_SHORT', 'STRONG_SHORT'].includes(signal.state)
      : ['READY_LONG', 'STRONG_LONG'].includes(signal.state);
    const structureFlip = dir === 'LONG'
      ? ['BEAR_CHOCH', 'BEAR_BOS'].includes(signal.exec.structure.event)
      : ['BULL_CHOCH', 'BULL_BOS'].includes(signal.exec.structure.event);
    const htfFlip = dir === 'LONG' ? signal.htfBias === 'bear' : signal.htfBias === 'bull';
    let action = dir === 'LONG' ? 'HOLD_LONG' : 'HOLD_SHORT';
    let urgency = 25;
    const reasons = [];
    if (stopHit) { action = dir === 'LONG' ? 'EXIT_LONG' : 'EXIT_SHORT'; urgency = 100; reasons.push('ストップ水準に到達'); }
    else if (oppositeReady && structureFlip) { action = dir === 'LONG' ? 'EXIT_LONG' : 'EXIT_SHORT'; urgency = 92; reasons.push('反対方向の確定シグナルと構造転換'); }
    else if (htfFlip && opposite >= same + 8) { action = dir === 'LONG' ? 'EXIT_LONG' : 'EXIT_SHORT'; urgency = 82; reasons.push('上位足の方向が反転'); }
    else if (structureFlip && opposite > same) { action = dir === 'LONG' ? 'REDUCE_LONG' : 'REDUCE_SHORT'; urgency = 68; reasons.push('執行足で構造転換'); }
    else if (unrealizedR >= 2.2 && signal.exec.values.macdHist != null && signal.exec.values.macdHistPrev != null &&
      (dir === 'LONG' ? signal.exec.values.macdHist < signal.exec.values.macdHistPrev : signal.exec.values.macdHist > signal.exec.values.macdHistPrev)) {
      action = dir === 'LONG' ? 'TRAIL_LONG' : 'TRAIL_SHORT'; urgency = 55; reasons.push('2R超でモメンタム鈍化、追随ストップ候補');
    } else {
      reasons.push(same >= opposite ? '保有方向の優位を維持' : '反対圧力はあるが確定撤退条件未達');
    }
    return { action, urgency, unrealizedR: round(unrealizedR, 2), livePrice: price, reasons };
  }

  function analyzeMarket(input, userSettings = {}) {
    const settings = { ...DEFAULTS, ...userSettings };
    const now = finite(settings.now, Date.now());
    const execMinutes = settings.executionMinutes;
    const execRaw = input.exec || input.m15 || input.candles || [];
    const tf15Raw = input.m15 || (execMinutes === 15 ? execRaw : aggregateCandles(execRaw, 15, { baseMinutes: execMinutes }));
    const h1Raw = input.h1 || aggregateCandles(execRaw, 60, { baseMinutes: execMinutes });
    const h4Raw = input.h4 || aggregateCandles(execRaw, 240, { baseMinutes: execMinutes });
    const exec = analyzeTimeframe(execRaw, execMinutes, now);
    const m15 = analyzeTimeframe(tf15Raw, 15, now);
    const h1 = analyzeTimeframe(h1Raw, 60, now);
    const h4 = analyzeTimeframe(h4Raw, 240, now);
    const score = { long: 0, short: 0, components: [] };
    const micro = input.micro || {};
    const vetoes = [];
    const warnings = [];

    if (!exec.ready || exec.candles.length < settings.minBars) vetoes.push('十分な確定足がありません');
    if (exec.quality.stale) vetoes.push('最終確定足が古く、データが停止している可能性があります');
    if (exec.quality.gaps > 3) vetoes.push('時間足データに複数の欠損があります');
    if (settings.blackout) vetoes.push('重要指標・手動ブラックアウト中');
    const sess = sessionInfo(exec.candles.at(-1)?.time || now);
    if (sess.rollover) vetoes.push('NYロールオーバー周辺');

    const h1Trend = h1.trend || 'neutral';
    const h4Trend = h4.trend || 'neutral';
    let htfBias = 'neutral';
    if (h1Trend === 'bull' && h4Trend === 'bull') htfBias = 'bull';
    else if (h1Trend === 'bear' && h4Trend === 'bear') htfBias = 'bear';
    else if (h1Trend !== 'neutral' && h4Trend !== 'neutral' && h1Trend !== h4Trend) warnings.push('1Hと4Hが不一致');

    addScore(score, 'HTF_4H', h4Trend === 'bull' ? 11 : 0, h4Trend === 'bear' ? 11 : 0, `4H ${h4Trend}`);
    addScore(score, 'HTF_1H', h1Trend === 'bull' ? 11 : 0, h1Trend === 'bear' ? 11 : 0, `1H ${h1Trend}`);
    addScore(score, 'M15_TREND', m15.trend === 'bull' ? 8 : 0, m15.trend === 'bear' ? 8 : 0, `15m ${m15.trend}`);
    addScore(score, 'EXEC_TREND', exec.trend === 'bull' ? 8 : 0, exec.trend === 'bear' ? 8 : 0, `執行足 ${exec.trend}`);

    const st = exec.structure;
    addScore(score, 'STRUCTURE',
      (st.trend === 'bull' ? 7 : 0) + (['BULL_BOS', 'BULL_CHOCH'].includes(st.event) ? 7 : 0),
      (st.trend === 'bear' ? 7 : 0) + (['BEAR_BOS', 'BEAR_CHOCH'].includes(st.event) ? 7 : 0),
      st.event || `構造 ${st.trend}`);
    addScore(score, 'SWEEP', st.bullSweep ? 8 : 0, st.bearSweep ? 8 : 0, st.bullSweep ? '売り側流動性スイープ' : st.bearSweep ? '買い側流動性スイープ' : 'スイープなし');

    const p = exec.pattern;
    addScore(score, 'TRIGGER', (p.bullReject || p.bullEngulf ? 7 : 0), (p.bearReject || p.bearEngulf ? 7 : 0), 'ローソク足トリガー');

    const v = exec.values || {};
    const longMomentum = (v.rsi >= 48 && v.rsi <= 68 ? 4 : 0) + (v.macdHist > 0 ? 4 : 0) + (v.macdHist > v.macdHistPrev ? 3 : 0) + (v.plusDI > v.minusDI ? 3 : 0);
    const shortMomentum = (v.rsi >= 32 && v.rsi <= 52 ? 4 : 0) + (v.macdHist < 0 ? 4 : 0) + (v.macdHist < v.macdHistPrev ? 3 : 0) + (v.minusDI > v.plusDI ? 3 : 0);
    addScore(score, 'MOMENTUM', longMomentum, shortMomentum, `RSI ${round(v.rsi, 1)} / ADX ${round(v.adx, 1)}`);

    const longLocation = v.nearReference ? 7 : (v.extensionATR < -0.4 && v.extensionATR > -1.05 ? 8 : 0);
    const shortLocation = v.nearReference ? 7 : (v.extensionATR > 0.4 && v.extensionATR < 1.05 ? 8 : 0);
    addScore(score, 'LOCATION', longLocation, shortLocation, `基準価格乖離 ${round(v.extensionATR, 2)} ATR`);

    addScore(score, 'REGIME', exec.regime === 'trend' && exec.trend === 'bull' ? 5 : exec.regime === 'range' ? 2 : 0,
      exec.regime === 'trend' && exec.trend === 'bear' ? 5 : exec.regime === 'range' ? 2 : 0, `相場環境 ${exec.regime}`);
    addScore(score, 'VOLUME', v.volZ > 0.5 ? 5 : v.volZ > -0.2 ? 2 : 0, v.volZ > 0.5 ? 5 : v.volZ > -0.2 ? 2 : 0, `出来高Z ${round(v.volZ, 2)}`);
    addScore(score, 'SESSION', sess.overlap ? 5 : (sess.londonOpen || sess.nyOpen ? 4 : (sess.london || sess.newYork ? 3 : 1)),
      sess.overlap ? 5 : (sess.londonOpen || sess.nyOpen ? 4 : (sess.london || sess.newYork ? 3 : 1)), sess.name);

    const imbalance = finite(micro.bookImbalance, 0);
    if (Math.abs(imbalance) >= 0.08) {
      addScore(score, 'ORDER_BOOK', imbalance > 0 ? 2 : 0, imbalance < 0 ? 2 : 0, `板厚偏り ${round(imbalance * 100, 1)}%`);
    }
    const basisBps = finite(micro.basisBps, 0);
    const fundingRate = finite(micro.fundingRate, 0);
    if (Math.abs(basisBps) > 15) warnings.push(`マーク価格と指数価格の乖離 ${round(basisBps, 1)}bps`);
    if (Math.abs(basisBps) > 35) vetoes.push('マーク価格と指数価格の乖離が大きい');
    if (Math.abs(fundingRate) > 0.0005) warnings.push(`資金調達率 ${round(fundingRate * 100, 4)}%`);
    if (Math.abs(fundingRate) > 0.0015) vetoes.push('資金調達率が極端');

    if (v.atrRank > 0.96) vetoes.push('ATRが過去レンジ上位4%で急変動中');
    if (v.atrRank < 0.05) warnings.push('極端な低ボラティリティ');
    if (v.rsi > 76) warnings.push('RSI過熱');
    if (v.rsi < 24) warnings.push('RSI売られ過ぎ');

    score.long = clamp(Math.round(score.long), 0, 100);
    score.short = clamp(Math.round(score.short), 0, 100);
    const diff = Math.abs(score.long - score.short);
    const direction = score.long >= score.short ? 'LONG' : 'SHORT';
    const best = Math.max(score.long, score.short);
    const trigger = direction === 'LONG'
      ? (st.bullSweep || ['BULL_BOS', 'BULL_CHOCH'].includes(st.event) || p.bullReject || p.bullEngulf)
      : (st.bearSweep || ['BEAR_BOS', 'BEAR_CHOCH'].includes(st.event) || p.bearReject || p.bearEngulf);
    if (direction === 'LONG' && v.extensionATR > settings.maxExtensionATR) vetoes.push('上方向に伸び切り、LONG追随不可');
    if (direction === 'SHORT' && v.extensionATR < -settings.maxExtensionATR) vetoes.push('下方向に伸び切り、SHORT追随不可');
    if (diff < settings.scoreDiffMin) vetoes.push(`LONG/SHORT優位差が${settings.scoreDiffMin}点未満`);
    if (direction === 'LONG' && htfBias === 'bear') vetoes.push('上位足に逆行するLONG');
    if (direction === 'SHORT' && htfBias === 'bull') vetoes.push('上位足に逆行するSHORT');

    const plan = exec.ready ? buildTradePlan(direction, exec, settings) : null;
    if (plan && plan.costs.costRiskRatio > 0.22) vetoes.push('コストがストップ幅の22%超');
    if (plan && plan.netRR < settings.minNetRR) vetoes.push(`コスト後R:Rが${settings.minNetRR}未満`);

    let state = 'NO_TRADE';
    if (!vetoes.length) {
      if (best >= settings.strongScore && trigger) state = `STRONG_${direction}`;
      else if (best >= settings.readyScore && trigger) state = `READY_${direction}`;
      else if (best >= settings.watchScore) state = `WATCH_${direction}`;
    }

    let message = '見送り。条件が揃うまで待機します。';
    if (state.startsWith('STRONG_LONG')) message = '私なら、確定足後の押し目確認で買い候補にします。';
    else if (state.startsWith('READY_LONG')) message = '私なら、提示ゾーンで反発を確認して買いを検討します。';
    else if (state.startsWith('WATCH_LONG')) message = '買い優位ですが、構造転換または反発トリガー待ちです。';
    else if (state.startsWith('STRONG_SHORT')) message = '私なら、確定足後の戻り確認で売り候補にします。';
    else if (state.startsWith('READY_SHORT')) message = '私なら、提示ゾーンで失速を確認して売りを検討します。';
    else if (state.startsWith('WATCH_SHORT')) message = '売り優位ですが、構造転換または反落トリガー待ちです。';

    const result = {
      version: VERSION, generatedAt: now, state, direction, message,
      longScore: score.long, shortScore: score.short, scoreDiff: diff, confidence: clamp(best - vetoes.length * 8, 0, 100),
      htfBias, session: sess, regime: exec.regime, exec, m15, h1, h4, micro,
      components: score.components, vetoes: [...new Set(vetoes)], warnings: [...new Set(warnings)],
      plan: state === 'NO_TRADE' ? plan : plan,
      actionable: ['READY_LONG', 'STRONG_LONG', 'READY_SHORT', 'STRONG_SHORT'].includes(state),
      disclaimer: '研究・ペーパートレード用のルールベース表示です。自動発注や利益保証はありません。',
    };
    result.positionDecision = positionDecision(settings.position, result, settings.livePrice ?? exec.values?.close);
    return result;
  }

  function parseCSV(text) {
    const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
    const idx = nameList => nameList.map(n => headers.indexOf(n)).find(i => i >= 0);
    const ti = idx(['time', 'timestamp', 'date', 'datetime', 'open time']);
    const oi = idx(['open', 'o']);
    const hi = idx(['high', 'h']);
    const li = idx(['low', 'l']);
    const ci = idx(['close', 'c']);
    const vi = idx(['volume', 'vol', 'v']);
    if ([ti, oi, hi, li, ci].some(i => i == null || i < 0)) throw new Error('CSVには time/open/high/low/close 列が必要です');
    return normalizeCandles(lines.slice(1).map(line => {
      const cols = line.split(delimiter).map(x => x.trim().replace(/^"|"$/g, ''));
      return { time: cols[ti], open: cols[oi], high: cols[hi], low: cols[li], close: cols[ci], volume: vi >= 0 ? cols[vi] : 0 };
    }));
  }

  function simulateTrade(candles, startIndex, plan, settings) {
    const dir = plan.direction;
    const sign = dir === 'LONG' ? 1 : -1;
    const entryBar = candles[startIndex + 1];
    if (!entryBar) return null;
    const entry = entryBar.open;
    const baseRisk = Math.abs(plan.entry - plan.stop);
    if (!baseRisk) return null;
    const stop = dir === 'LONG' ? entry - baseRisk : entry + baseRisk;
    const tp1 = entry + sign * baseRisk;
    const tp2 = entry + sign * baseRisk * 2.2;
    const tp3 = entry + sign * baseRisk * 3.2;
    let remaining = 1, realizedR = 0, hit1 = false, hit2 = false;
    let activeStop = stop;
    const maxEnd = Math.min(candles.length - 1, startIndex + 1 + settings.maxHoldBars);
    for (let i = startIndex + 1; i <= maxEnd; i++) {
      const b = candles[i];
      const stopTouched = dir === 'LONG' ? b.low <= activeStop : b.high >= activeStop;
      const tp1Touched = dir === 'LONG' ? b.high >= tp1 : b.low <= tp1;
      const tp2Touched = dir === 'LONG' ? b.high >= tp2 : b.low <= tp2;
      const tp3Touched = dir === 'LONG' ? b.high >= tp3 : b.low <= tp3;
      if (stopTouched) {
        const stopR = ((activeStop - entry) * sign) / baseRisk;
        realizedR += remaining * stopR;
        const costR = plan.costs.total / baseRisk;
        return { exitIndex: i, entryIndex: startIndex + 1, direction: dir, r: realizedR - costR, reason: 'STOP', entry, exit: activeStop };
      }
      if (!hit1 && tp1Touched) {
        realizedR += 0.5;
        remaining -= 0.5;
        hit1 = true;
        activeStop = entry + sign * plan.costs.total;
        const newStopTouchedSameBar = dir === 'LONG' ? b.low <= activeStop : b.high >= activeStop;
        if (newStopTouchedSameBar) {
          const stopR = ((activeStop - entry) * sign) / baseRisk;
          realizedR += remaining * stopR;
          const costR = plan.costs.total / baseRisk;
          return { exitIndex: i, entryIndex: startIndex + 1, direction: dir, r: realizedR - costR, reason: 'TP1_THEN_BE', entry, exit: activeStop };
        }
      }
      if (hit1 && !hit2 && tp2Touched) {
        realizedR += 0.3 * 2.2;
        remaining -= 0.3;
        hit2 = true;
        activeStop = entry + sign * baseRisk;
        const trailTouchedSameBar = dir === 'LONG' ? b.low <= activeStop : b.high >= activeStop;
        if (trailTouchedSameBar) {
          realizedR += remaining;
          const costR = plan.costs.total / baseRisk;
          return { exitIndex: i, entryIndex: startIndex + 1, direction: dir, r: realizedR - costR, reason: 'TP2_THEN_TRAIL', entry, exit: activeStop };
        }
      }
      if (hit2 && tp3Touched) {
        realizedR += remaining * 3.2;
        const costR = plan.costs.total / baseRisk;
        return { exitIndex: i, entryIndex: startIndex + 1, direction: dir, r: realizedR - costR, reason: 'TP3', entry, exit: tp3 };
      }
    }
    const b = candles[maxEnd];
    const exit = b.close;
    realizedR += remaining * (((exit - entry) * sign) / baseRisk);
    const costR = plan.costs.total / baseRisk;
    return { exitIndex: maxEnd, entryIndex: startIndex + 1, direction: dir, r: realizedR - costR, reason: 'TIME', entry, exit };
  }

  function summarizeTrades(trades) {
    if (!trades.length) return { trades: 0, winRate: 0, expectancyR: 0, profitFactor: 0, maxDrawdownR: 0, totalR: 0, longestLosingStreak: 0 };
    const wins = trades.filter(t => t.r > 0);
    const gains = wins.reduce((s, t) => s + t.r, 0);
    const losses = Math.abs(trades.filter(t => t.r <= 0).reduce((s, t) => s + t.r, 0));
    let equity = 0, peak = 0, maxDD = 0, streak = 0, maxStreak = 0;
    for (const t of trades) {
      equity += t.r; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak - equity);
      if (t.r <= 0) { streak += 1; maxStreak = Math.max(maxStreak, streak); } else streak = 0;
    }
    return {
      trades: trades.length,
      winRate: round(wins.length / trades.length * 100, 1),
      expectancyR: round(trades.reduce((s, t) => s + t.r, 0) / trades.length, 3),
      profitFactor: losses ? round(gains / losses, 2) : gains > 0 ? 99 : 0,
      maxDrawdownR: round(maxDD, 2),
      totalR: round(equity, 2),
      longestLosingStreak: maxStreak,
    };
  }

  function backtest(rawInput, userSettings = {}) {
    const settings = { ...DEFAULTS, ...userSettings };
    const interval = settings.executionMinutes;
    const source = Array.isArray(rawInput) ? { exec: rawInput } : (rawInput || {});
    const allExec = filterClosedCandles(source.exec || source.candles || [], interval, settings.now || Date.now());
    const cap = Math.min(allExec.length, settings.maxBacktestBars || 1200);
    const c = allExec.slice(-cap);
    const sourceM15 = normalizeCandles(source.m15 || []);
    const sourceH1 = normalizeCandles(source.h1 || []);
    const sourceH4 = normalizeCandles(source.h4 || []);
    const closedThrough = (bars, minutes, cutoff) => bars.filter(b => b.time + minutes * MINUTE <= cutoff);
    const trades = [];
    let i = Math.max(settings.minBars, 220);
    let cooldownUntil = 0;
    let lossStreak = 0;
    const dailyR = new Map();
    while (i < c.length - 2) {
      if (i < cooldownUntil) { i += 1; continue; }
      const dayKey = new Date(c[i].time).toISOString().slice(0, 10);
      if ((dailyR.get(dayKey) || 0) <= -settings.dailyLossLimitR) { i += 1; continue; }
      const slice = c.slice(0, i + 1);
      const cutoff = c[i].time + interval * MINUTE + 1;
      const marketInput = { exec: slice };
      if (sourceM15.length) marketInput.m15 = closedThrough(sourceM15, 15, cutoff);
      if (sourceH1.length) marketInput.h1 = closedThrough(sourceH1, 60, cutoff);
      if (sourceH4.length) marketInput.h4 = closedThrough(sourceH4, 240, cutoff);
      const sig = analyzeMarket(marketInput, { ...settings, now: cutoff, position: null });
      if (sig.actionable && sig.plan) {
        const trade = simulateTrade(c, i, sig.plan, settings);
        if (trade) {
          trade.signalState = sig.state;
          trade.signalTime = c[i].time;
          trades.push(trade);
          const exitDay = new Date(c[trade.exitIndex].time).toISOString().slice(0, 10);
          dailyR.set(exitDay, (dailyR.get(exitDay) || 0) + trade.r);
          if (trade.r <= 0) lossStreak += 1; else lossStreak = 0;
          cooldownUntil = trade.exitIndex + (lossStreak >= 2 ? settings.lossStreakCooldownBars : settings.cooldownBars);
          i = trade.exitIndex + 1;
          continue;
        }
      }
      i += 1;
    }
    const splitTime = c[Math.floor(c.length * 0.7)]?.time || Infinity;
    const inSample = trades.filter(t => t.signalTime < splitTime);
    const outSample = trades.filter(t => t.signalTime >= splitTime);
    return { settings, bars: c.length, trades, all: summarizeTrades(trades), inSample: summarizeTrades(inSample), outOfSample: summarizeTrades(outSample) };
  }

  return {
    VERSION, DEFAULTS, normalizeCandles, filterClosedCandles, dataQuality, inferIntervalMinutes,
    sma, ema, atr, rsi, macd, bollinger, dmi, rollingVWAP, anchoredVWAP, rollingZ,
    confirmedSwings, detectStructure, candlePattern, sessionInfo, aggregateCandles,
    analyzeTimeframe, analyzeMarket, positionDecision, parseCSV, backtest, summarizeTrades,
    _internal: { calculateCosts, buildTradePlan, simulateTrade, clamp, round, percentileRank }
  };
});
