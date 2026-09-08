'use strict';
// Runs independently of browser tabs; reuses exactly the browser's analysis engine.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Core = require('./strategy-core.js');
const DIR = path.join(__dirname, '.runtime');
const instruments = { gold: { symbol: 'XAUUSDT', market: 'futures' }, btc: { symbol: 'BTCUSDT', market: 'spot' } };
const PUBLIC_PAGE = 'https://yuzora-yu.github.io/Multi-Analyzer/';

function eventFor(a, asset, position) {
  const exit = a.positionDecision?.action.startsWith('EXIT');
  if (!a.actionable && !exit) return null;
  const state = exit ? a.positionDecision.action : a.state;
  const bar = a.exec.candles.at(-1)?.time;
  const key = exit ? `${asset}:${state}:${position?.entry}:${position?.stop}` : `${asset}:${state}:${bar}`;
  const p = a.plan;
  const side = state.includes('LONG') ? '買い' : '売り';
  const action = exit ? `${side}ポジションのクローズ推奨` : `${side}候補${state.startsWith('STRONG') ? '（条件強く合致）' : ''}`;
  const title = `Multi-Analyzer｜${asset === 'gold' ? 'Gold' : 'BTC'}｜${action}`;
  const url = `${PUBLIC_PAGE}?asset=${asset}&tf=15m`;
  const reasons = exit ? a.positionDecision.reasons : (a.components || []).filter(c => (side === '買い' ? c.long : c.short) > 0).slice(0, 3).map(c => c.text);
  const lines = [title, `対象: ${instruments[asset].symbol} / 15分足`,
    exit ? `参考価格: ${a.positionDecision.livePrice ?? '—'}\n保有建値: ${position?.entry ?? '—'} / 保有SL: ${position?.stop ?? '—'}` : `基準価格: ${p.entry}\n損切り（SL）: ${p.stop}\n利確目標 TP1: ${p.tp1} / TP2: ${p.tp2} / TP3: ${p.tp3}`,
    `判定理由: ${reasons.filter(Boolean).join(' / ') || a.message || state}`,
    `判定時刻: ${new Date(a.generatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })} JST`,
    `公開チャートを開く:\n${url}`,
    '通知は判定時点の記録です。リンク先は現在の相場を表示します。',
    'USDT参考市場の分析。USDブローカーとは価格が異なります。スコアは勝率ではありません。'];
  return { key, title, url, text: lines.join('\n\n') };
}

async function run() {
  fs.mkdirSync(DIR, { recursive: true });
  const stateFile = path.join(DIR, 'alerts.json');
  let saved = { delivered: {}, pending: {}, baselines: {}, disabled: {} };
  try { saved = { ...saved, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch {}
  const channels = [process.env.MA_DISCORD_WEBHOOK && 'Discord', process.env.MA_SMTP_HOST && process.env.MA_EMAIL_TO && process.env.MA_EMAIL_FROM && (!process.env.MA_SMTP_USER || process.env.MA_SMTP_PASSWORD) && 'Email'].filter(Boolean);
  const base = process.env.MA_BASE_URL || 'http://127.0.0.1:8000';
  const cache = new Map();
  const atomic = (file, value) => { fs.writeFileSync(file + '.tmp', JSON.stringify(value)); fs.renameSync(file + '.tmp', file); };
  const fetchJSON = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(`Market API HTTP ${r.status}`); return r.json(); };
  async function candles(asset, interval) {
    const cfg = instruments[asset], key = `${asset}:${interval}`;
    const ttl = interval === '15m' ? 0 : 60000;
    if (cache.has(key) && Date.now() - cache.get(key).at < ttl) return cache.get(key).rows;
    const raw = await fetchJSON(`${base}/api/klines?${new URLSearchParams({ ...cfg, interval, limit: '300' })}`);
    const rows = Core.normalizeCandles(raw.map(b => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] })));
    cache.set(key, { at: Date.now(), rows }); return rows;
  }
  async function tick() {
    const status = { updatedAt: Date.now(), channels, assets: {}, error: null, summary: '' };
    let config = {};
    try { if (process.env.MA_MONITOR_CONFIG) config = JSON.parse(fs.readFileSync(process.env.MA_MONITOR_CONFIG, 'utf8')); }
    catch { status.error = '監視設定ファイルが不正・通知を停止'; atomic(path.join(DIR, 'monitor.json'), status); return; }
    const validKeys = new Set();
    for (const asset of Object.keys(instruments)) {
      try {
        const cfg = instruments[asset];
        const [exec, h1, h4, ticker, premium] = await Promise.all([candles(asset, '15m'), candles(asset, '1h'), candles(asset, '4h'), fetchJSON(`${base}/api/ticker?${new URLSearchParams(cfg)}`), cfg.market === 'futures' ? fetchJSON(`${base}/api/premium-index?${new URLSearchParams(cfg)}`) : Promise.resolve(null)]);
        const bid = Number(ticker.bidPrice), ask = Number(ticker.askPrice);
        if (!(bid > 0 && ask >= bid)) throw new Error('Invalid live quote');
        const position = config.positions?.[asset];
        const bq = Number(ticker.bidQty), aq = Number(ticker.askQty), mid = (bid + ask) / 2;
        const micro = { bookImbalance: bq + aq > 0 ? (bq - aq) / (bq + aq) : 0, basisBps: premium?.indexPrice > 0 ? (Number(premium.markPrice) - Number(premium.indexPrice)) / Number(premium.indexPrice) * 10000 : 0, fundingRate: Number(premium?.lastFundingRate || 0) };
        const a = Core.analyzeMarket({ exec, m15: exec, h1, h4, micro }, { ...config.settings, now: Date.now(), executionMinutes: 15, market: cfg.market, livePrice: (bid + ask) / 2, spreadBps: Math.max(config.settings?.spreadBps || Core.DEFAULTS.spreadBps, (ask - bid) / mid * 10000), position });
        status.assets[asset] = { state: a.state, position: a.positionDecision?.action || null, bar: exec.at(-1)?.time };
        const event = eventFor(a, asset, position);
        // Baseline on first run: don't broadcast existing historical setups.
        if (!saved.baselines[asset]) { saved.baselines[asset] = true; if (event) for (const ch of channels) saved.delivered[`${ch}:${event.key}`] = Date.now(); }
        if (event) for (const ch of channels) {
          const id = `${ch}:${event.key}`; validKeys.add(id);
          if (!saved.delivered[id] && !saved.disabled[ch] && !saved.pending[id]) saved.pending[id] = { ...event, channel: ch, due: Date.now(), asset };
        }
      } catch { status.assets[asset] = { state: 'DATA_ERROR' }; status.error = '市場データ取得失敗・該当銘柄の通知停止'; }
    }
    // Never retry a signal after it has disappeared, become stale, or been superseded.
    for (const [id, event] of Object.entries(saved.pending)) {
      if (!validKeys.has(id)) { delete saved.pending[id]; continue; }
      if (event.due > Date.now()) continue;
      const result = spawnSync(process.env.MA_PYTHON || 'python', [path.join(__dirname, 'alert_delivery.py')], { input: JSON.stringify({ title: event.title, url: event.url, text: event.text, channels: [event.channel] }), encoding: 'utf8', timeout: 20000, windowsHide: true });
      let delivery;
      try { delivery = JSON.parse(result.stdout)[event.channel]; } catch {}
      if (delivery?.ok) { saved.delivered[id] = Date.now(); delete saved.pending[id]; }
      else {
        status.error = `${event.channel}通知失敗・設定を確認`;
        if (delivery?.permanent) { saved.disabled[event.channel] = true; delete saved.pending[id]; }
        else event.due = Date.now() + Math.max(30, delivery?.retryAfter || 60) * 1000;
      }
    }
    if (Object.keys(saved.disabled).length) status.error = `${Object.keys(saved.disabled).join('/')}通知停止（設定修正後 alerts.json の disabled を解除）`;
    status.summary = Object.entries(status.assets).map(([key, a]) => `${key}: ${a.state}`).join(' / ');
    const entries = Object.entries(saved.delivered).sort((a, b) => b[1] - a[1]).slice(0, 2000);
    saved.delivered = Object.fromEntries(entries);
    atomic(stateFile, saved); atomic(path.join(DIR, 'monitor.json'), status);
  }
  while (true) { try { await tick(); } catch { /* keep worker alive; status naturally becomes stale */ } await new Promise(resolve => setTimeout(resolve, 15000)); }
}
if (require.main === module) run().catch(() => { process.exitCode = 1; });
module.exports = { eventFor };
