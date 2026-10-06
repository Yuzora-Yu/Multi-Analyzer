'use strict';
const instruments = {gold:{symbol:'XAUUSDT'},btc:{symbol:'BTCUSDT'}};
const PUBLIC_PAGE = 'https://yuzora-yu.github.io/Multi-Analyzer/';
function alertPolicy(asset, now, bar) {
  const weekend = time => {
    const day = new Date(Number(time) + 9 * 3600000).getUTCDay();
    return !Number.isFinite(day) || day === 0 || day === 6;
  };
  const blocked = asset === 'gold' && (weekend(now) || (bar != null && weekend(bar)));
  return { allowed: !blocked, timezone: 'Asia/Tokyo', rule: asset === 'gold' ? 'GOLD_WEEKDAYS_JST' : 'ALWAYS', reason: blocked ? 'GOLD_WEEKEND_JST' : null };
}
function eventFor(a, asset, position, feed = {}) {
  const bar = a.exec.candles.at(-1)?.time;
  if (!alertPolicy(asset, feed.now ?? a.generatedAt ?? Date.now(), bar).allowed) return null;
  const exit = a.positionDecision?.action.startsWith('EXIT');
  // GOLD leads with prospective zones, independently of P-entry and virtual holdings.
  if(asset==='gold' && a.marketMap) {
    const map=a.marketMap,now=feed.now??Date.now();
    if(!map.valid || now-a.generatedAt>1200000 || map.eventRisk.blocked)return null;
    const nearby=map.candidates.filter(z=>z.phase!=='WAIT'&&z.evidence.some(e=>/EMA|BB/.test(e)));
    if(!nearby.length)return null;
    const z=nearby.sort((x,y)=>(y.direction===a.direction?1:0)-(x.direction===a.direction?1:0)||x.distance-y.distance)[0];
    const direction=z.direction==='SHORT'?'戻り売り':'押し目買い';
    const phase={APPROACH:'接近・反応待ち',IN_ZONE:'帯内・反応待ち',ENTRY_CONFIRMED:'既存P条件も成立'}[z.phase];
    const title=`Multi-Analyzer｜Gold｜${direction}候補 ${z.low}～${z.high}（${phase}）`;
    const url=`${PUBLIC_PAGE}?asset=gold&tf=15m${feed.snapshot?'&snapshot='+encodeURIComponent(feed.snapshot):''}`;
    const lines=[title,`対象: ${feed.symbol||instruments.gold.symbol} / 15分確定足\n基準価格: ${map.price}`,
      `時間足: ${map.trends.map(t=>`${t.name} 構造${t.structure}・MA${t.ma}`).join(' / ')}`,
      ...map.candidates.map(c=>`${c.direction==='SHORT'?'売り':'買い'}候補帯: ${c.low}～${c.high} / ${c.role}\n根拠: ${c.evidence.join(' / ')}\n入場条件: ${c.condition}\n見立て無効化: 15分終値で ${c.invalidationClose} ${c.direction==='SHORT'?'超':'未満'}\n保護SL参考: ${c.protectiveStop}（再訪の高安に合わせ再計算）\n利確・反応確認候補: ${c.targets.join(' / ')||'確認済み価格帯なし'}`),
      `新規判定: ${map.entryState} / ${a.vetoes?.join(' / ')||a.message}\n${map.note}`,
      `指標警戒: ${map.eventRisk.events.map(e=>`${new Date(e.time).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})} JST ${e.name} ${e.source}`).join(' / ')||'最新予定の確認が必要'}\n${map.eventRisk.message}`,
      ...(exit?[`補助の撤退注意: 前回候補を保有中なら ${a.positionDecision.reasons?.join(' / ')||a.positionDecision.action}。反転エントリーの根拠ではありません。`]:[]),
      `判定時刻: ${new Date(a.generatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})} JST`,
      `公開チャート:\n${url}`,`共通判定ID: ${feed.snapshot||'ローカル'} / エンジン ${feed.version||a.version}`,
      feed.note||'USDT参考市場。USDブローカーと価格が異なります。候補帯の収益上の優位性は未確認です。'];
    return {key:`${asset}:MAP:${z.id}:${z.phase}:${map.bias}`,kind:'ANALYSIS',title,url,text:lines.join('\n\n')};
  }
  if (!a.actionable && !exit) return null;
  const state = exit ? a.positionDecision.action : a.state;
  const key = exit ? `${asset}:${state}:${position?.entry}:${position?.stop}` : `${asset}:${state}:${bar}`;
  const p = a.plan;
  const side = state.includes('LONG') ? '買い' : '売り';
  const action = exit ? `${feed.conditionalExit?'前回候補を保有中なら・':''}${side}ポジションのクローズ推奨` : `${a.entryModel==='pullback-v1'?'検証用・':''}${side}候補${state.startsWith('STRONG') ? '（条件強く合致）' : ''}`;
  const title = `Multi-Analyzer｜${asset === 'gold' ? 'Gold' : 'BTC'}｜${action}`;
  const url = `${PUBLIC_PAGE}?asset=${asset}&tf=15m${feed.snapshot ? "&snapshot="+encodeURIComponent(feed.snapshot) : ""}`;
  const reasons = exit ? a.positionDecision.reasons : a.entryModel==='pullback-v1' ? ['継続方向へのEMA21押し・EMA13終値奪還','出来高が直前21本平均以上・H1方向一致','ADX20以上・コスト後R:R確認'] : (a.components || []).filter(c => (side === '買い' ? c.long : c.short) > 0).slice(0, 3).map(c => c.text);
  const lines = [title, `対象: ${feed.symbol || instruments[asset].symbol} / 15分足`,
    exit ? `参考価格: ${a.positionDecision.livePrice ?? '—'}\n保有建値: ${position?.entry ?? '—'} / 保有SL: ${position?.stop ?? '—'}` : `基準価格: ${p.entry}\n損切り（SL）: ${p.stop}\n利確目標 TP1: ${p.tp1} / TP2: ${p.tp2} / TP3: ${p.tp3}`,
    `判定理由: ${reasons.filter(Boolean).join(' / ') || a.message || state}`,
    ...(a.entryModel==='pullback-v1'?['研究段階の候補です。過去検証でプラスの期待値は未確認です。ランクや出来高バッジを勝率と解釈しないでください。']:[]),
    `判定時刻: ${new Date(a.generatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })} JST`,
    `公開チャートを開く:\n${url}`,
    feed.snapshot ? `共通判定ID: ${feed.snapshot} / エンジン ${feed.version}\nリンク先は通知時点の保存記録です。各銘柄の送信済み直近100通知を保持し、保存対象外の場合は表示しません。` : '通知は判定時点の記録です。リンク先は現在の相場を表示します。',
    feed.note || 'USDT参考市場の分析。USDブローカーとは価格が異なります。スコアは勝率ではありません。'];
  return { key, kind:exit?'EXIT':'ENTRY', title, url, text: lines.join('\n\n') };
}

module.exports = { eventFor, alertPolicy };
