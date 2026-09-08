'use strict';
const instruments = {gold:{symbol:'XAUUSDT'},btc:{symbol:'BTCUSDT'}};
const PUBLIC_PAGE = 'https://yuzora-yu.github.io/Multi-Analyzer/';
function eventFor(a, asset, position, feed = {}) {
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
  const lines = [title, `対象: ${feed.symbol || instruments[asset].symbol} / 15分足`,
    exit ? `参考価格: ${a.positionDecision.livePrice ?? '—'}\n保有建値: ${position?.entry ?? '—'} / 保有SL: ${position?.stop ?? '—'}` : `基準価格: ${p.entry}\n損切り（SL）: ${p.stop}\n利確目標 TP1: ${p.tp1} / TP2: ${p.tp2} / TP3: ${p.tp3}`,
    `判定理由: ${reasons.filter(Boolean).join(' / ') || a.message || state}`,
    `判定時刻: ${new Date(a.generatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })} JST`,
    `公開チャートを開く:\n${url}`,
    '通知は判定時点の記録です。リンク先は現在の相場を表示します。',
    feed.note || 'USDT参考市場の分析。USDブローカーとは価格が異なります。スコアは勝率ではありません。'];
  return { key, title, url, text: lines.join('\n\n') };
}

module.exports = { eventFor };
