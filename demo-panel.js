(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MultiAnalyzerDemoPanel = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ORDER = ['trend', 'reversion', 'confirmation', 'baseline'];
  const LABELS = { trend: '順張り', reversion: '反発', confirmation: '確認', baseline: 'P条件・未来始値' };
  const APPROACH = {trend:'上位足の構造・MAが一致するOB/FVGの再訪とMA回復を待ちます。',reversion:'流動性スイープの後、後続足の構造転換を待ちます。',confirmation:'初回接触・明確な離脱・二度目の接触・後続の突破確認を待ちます。'};
  const ACTIONS = { WAIT: '見送り', PENDING: '予約待ち', HOLD: '仮想保有', CLOSED: '決済済み', NO_FILL: '未約定', INCOMPLETE: '評価不能' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const number = (value, digits = 2) => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
  const money = value => finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}$${number(Math.abs(value))}` : '—';
  const count = value => finite(value) && value >= 0 ? number(value, 0) : '—';
  const tone = value => finite(value) && value !== 0 ? value > 0 ? 'demo-positive' : 'demo-negative' : '';
  const direction = value => value === 'LONG' ? '買い' : value === 'SHORT' ? '売り' : '—';
  function stamp(value) {
    if (!finite(value) || value <= 0) return '未取得';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '未取得';
    return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date) + ' JST';
  }

  function validate(payload, asset) {
    if (!payload || payload.schemaVersion !== 1 || payload.asset !== asset || !Array.isArray(payload.books)) throw new Error('DEMO_INVALID_RESPONSE');
    if (!['ACTIVE', 'WAITING', 'NOT_STARTED', 'DATA_ERROR', 'MARKET_CLOSED'].includes(payload.status)) throw new Error('DEMO_INVALID_STATUS');
    const seen = new Set();
    for (const book of payload.books) {
      if (!book || !ORDER.includes(book.id) || seen.has(book.id)) throw new Error('DEMO_INVALID_BOOK');
      seen.add(book.id);
    }
    return payload;
  }

  function headline(payload, context, record) {
    if (context.offline || context.archived) return { title: '保存分析と現在のデモを分けて表示', text: 'この画面では最新デモ記録を表示しません。現在の分析画面で「デモ」を開いてください。', kind: 'paused' };
    if (record.error) return { title: 'デモ記録を更新できません', text: payload ? `下の成績は前回取得分です。取得失敗 ${stamp(record.errorAt)}。` : `取得失敗 ${stamp(record.errorAt)}。成績は未取得です。`, kind: 'error' };
    if (context.marketClosed || payload?.status === 'MARKET_CLOSED') return { title: 'GOLD休場・最後のデモ記録', text: '休場中は新しい価格の収集とデモ判断を停止します。', kind: 'paused' };
    if (!payload) return { title: record.loading ? 'デモ記録を確認中' : 'デモ記録は未取得', text: '3人の判断とP条件を、同じ資金・想定費用で比較します。', kind: 'waiting' };
    if (payload.status === 'DATA_ERROR') return { title: 'データ不備・デモ判断を保留', text: '下の成績は保存された時点の記録です。欠損区間は利益や損失に置き換えません。', kind: 'error' };
    if (payload.status === 'NOT_STARTED') return { title: '実験の登録待ち', text: '開始前の値動きから、後付けの取引を作りません。', kind: 'waiting' };
    if (payload.status === 'WAITING') return { title: '実験開始・次の確定足を待機', text: '開始後の判断から蓄積します。成績の優劣はまだ未検証です。', kind: 'waiting' };
    if (finite(context.now) && finite(payload.lastClosedAt) && context.now - payload.lastClosedAt > 20 * 60000) return { title: '最新デモ記録の更新が遅延', text: '下の成績は最後に保存された記録です。最新の売買判断として扱いません。', kind: 'paused' };
    const held = payload.books.filter(book => book.position).length;
    const pending = payload.books.filter(book => book.pending).length;
    return { title: '3人＋P条件のデモを蓄積中', text: `${held ? `仮想保有 ${held}方式` : '仮想保有なし'}・${pending ? `予約待ち ${pending}方式` : '予約なし'}。確定した仮想損益と最大DDで比較します。`, kind: 'active' };
  }

  function stats(items) {
    return '<dl class="demo-stats">' + items.map(([label, value, cls]) => `<div><dt>${esc(label)}</dt><dd class="${esc(cls || '')}">${esc(value)}</dd></div>`).join('') + '</dl>';
  }
  function sensitivity(net) {
    if (!net || ![7, 14, 21].some(cost => finite(net[cost]))) return '';
    return '<div class="demo-sensitivity"><span>往復想定費用ごとの仮想損益</span>' + [7, 14, 21].map(cost => `<div><span>${cost} bps</span><strong class="${tone(net[cost])}">${esc(money(net[cost]))}</strong></div>`).join('') + '</div>';
  }
  function tradeHtml(trade) {
    const status = ACTIONS[trade.status] || (trade.status === 'CLOSED' ? '決済済み' : '記録');
    return `<article class="demo-trade"><div class="demo-trade-heading"><strong>${esc(direction(trade.direction))}・${esc(status)}</strong><span class="${tone(trade.netPnl)}">${esc(money(trade.netPnl))}</span></div><p>${esc(stamp(trade.openedAt))} → ${esc(stamp(trade.closedAt))}</p>${stats([['想定建値 → 決済', `${number(trade.entry)} → ${number(trade.exit)}`], ['固定ストップ / 目標', `${number(trade.stop)} / ${number(trade.target)}`], ['費用前仮想損益', money(trade.grossPnl)], ['控除した想定費用', finite(trade.costs) ? '$' + number(trade.costs) : '—']])}<p>${esc(trade.reason || '理由は未取得')}</p>${sensitivity(trade.netByCost)}</article>`;
  }
  function bookHtml(book) {
    const active = book.position || book.pending;
    const label = LABELS[book.id];
    const phase = book.position ? '仮想保有' : book.pending ? '予約待ち' : ACTIONS[book.lastDecision?.action] || '判断待ち';
    const details = active ? `<div class="demo-plan"><strong>${esc(direction(active.direction))} ${book.position ? 'を仮想保有' : 'の予約'}</strong>${stats([['想定建値', book.position ? number(active.entry) : '未来足の始値で判定'], ['固定ストップ', number(active.stop)], ['固定目標', number(active.target)]])}<p>${book.position ? '想定約定 ' + esc(stamp(active.openedAt)) : '想定約定は ' + esc(stamp(active.entryAfter)) + ' 以降'}。実注文ではありません。</p></div>` : '';
    const recent = Array.isArray(book.recentTrades) ? book.recentTrades.slice(0, 12) : [];
    return `<article class="demo-book" data-demo-book="${esc(book.id)}"><div class="demo-book-heading"><h3>${esc(label)}</h3><span class="demo-phase">${esc(phase)}</span></div>${APPROACH[book.id] ? `<p class="demo-note">${esc(APPROACH[book.id])}</p>` : ''}<div class="demo-result"><span>確定した仮想損益</span><strong class="${tone(book.realizedNet)}">${esc(money(book.realizedNet))}</strong></div>${stats([['仮想残高', finite(book.equity) ? '$' + number(book.equity) : '—'], ['最大DD（仮想USD）', finite(book.maxDrawdown) ? '$' + number(book.maxDrawdown) + (finite(book.maxDrawdownPct) ? ' / ' + number(book.maxDrawdownPct) + '%' : '') : '—'], ['決済件数', count(book.closed)], ['見送り / 未約定', `${count(book.skipped)} / ${count(book.unfilled)}`], ['評価不能', count(book.incomplete)], ['含み損益（費用前）', money(book.unrealizedGross)]])}${details}<p class="demo-reason">${esc(book.lastDecision?.reason || '開始後の判断を待っています。')}</p><p class="demo-time">判断記録 ${esc(stamp(book.lastDecision?.at))}</p>${sensitivity(book.netByCost)}<details class="demo-history" data-demo-detail="${esc(book.id)}"><summary>直近の取引記録（${recent.length}件）</summary>${recent.length ? recent.map(tradeHtml).join('') : '<p>まだ決済・未約定の記録はありません。</p>'}</details>${book.id === 'baseline' ? '<p class="demo-note">既存Pが出た後の未来始値で比較します。既存Pの指値約定を再現する記録とは別です。</p>' : ''}</article>`;
  }

  function render(payload, context = {}, record = {}) {
    const h = headline(payload, context, record);
    const header = `<div class="section-heading"><div><span class="eyebrow">FORWARD DEMO LAB</span><h2>判断を実績で比べる</h2></div><span class="research-badge">未検証</span></div><div class="demo-status demo-${h.kind}" role="status"><strong>${esc(h.title)}</strong><p>${esc(h.text)}</p></div>`;
    if (context.offline || context.archived) return header;
    if (!payload) return header;
    const protocol = payload.protocol || {};
    const ordered = [...payload.books].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    const comparison = payload.lastSnapshotId && context.snapshotId && payload.lastSnapshotId !== context.snapshotId ? '<p class="demo-note">チャートとデモの最新判定IDが異なります。下の記録時刻・IDを基準に確認してください。</p>' : '';
    return header + `<p class="demo-time">最新15分足確定 ${esc(stamp(payload.lastClosedAt))}<br>記録更新 ${esc(stamp(payload.updatedAt))}</p><div class="demo-protocol"><strong>${esc(payload.asset === 'gold' ? 'GOLD' : 'BTC')}・各担当の独立した仮想口座</strong><p>初期 $${number(protocol.initialEquity)} ／ 通常SLの想定リスク ${number(protocol.riskPct)}% ／ 往復想定費用 ${number(protocol.costBps, 0)} bps</p><p>ルール ${esc(protocol.version || '未取得')}。変更時は別バージョンとして評価します。</p></div><details class="demo-provenance" data-demo-detail="provenance"><summary>データの時刻・判定ID</summary><dl><div><dt>実験登録</dt><dd>${esc(stamp(payload.registeredAt))}</dd></div><div><dt>記録更新</dt><dd>${esc(stamp(payload.updatedAt))}</dd></div><div><dt>最新15分足確定</dt><dd>${esc(stamp(payload.lastClosedAt))}</dd></div><div><dt>この画面の取得</dt><dd>${esc(stamp(record.receivedAt))}</dd></div><div><dt>判定ID</dt><dd>${esc(payload.lastSnapshotId || '次の確定足待ち')}</dd></div><div><dt>市場</dt><dd>Bybit ${esc(payload.symbol || '')} / ${esc(payload.market || '')}</dd></div></dl></details>${comparison}<div class="demo-books">${ordered.map(bookHtml).join('')}</div><div class="demo-footnote"><p>記録した判定 ${count(payload.coverage?.decisions)} ／ 欠損足 ${count(payload.coverage?.missingBars)} ／ 遅延判断 ${count(payload.coverage?.delayedDecisions)}</p><p>仮想損益は想定費用を控除した実験値です。ギャップで想定リスクを超える場合があります。実スプレッド・借入等の費用は未取得。Bybit元価格で評価し、価格補正は適用しません。</p>${payload.asset === 'btc' ? '<p>BTC現物価格の仮想ショートを含みます。借入可能性や借入費用は未取得です。</p>' : ''}</div><button class="ghost-button demo-export" type="button" data-demo-export>表示記録をJSONで保存</button>`;
  }

  function create(options) {
    const { root, fetchJson, getContext, baseUrl } = options;
    const now = options.now || Date.now;
    const records = new Map();
    function record(asset) {
      if (!records.has(asset)) records.set(asset, { payload: null, receivedAt: null, error: null, errorAt: null, loading: false, request: null, attemptedAt: null });
      return records.get(asset);
    }
    function sync() {
      const context = {...getContext(),now:now()};
      const current = record(context.asset);
      const html=render(current.payload, context, current);
      if(root.innerHTML===html)return;
      const opened=new Set([...root.querySelectorAll('[data-demo-detail][open]')].map(node=>node.dataset.demoDetail));
      root.innerHTML=html;
      for(const node of root.querySelectorAll('[data-demo-detail]'))node.open=opened.has(node.dataset.demoDetail);
    }
    async function refresh() {
      const context = getContext(), current = record(context.asset);
      if (context.archived || context.offline || context.marketClosed) { sync(); return; }
      if (current.request) return current.request;
      if (current.attemptedAt != null && now() - current.attemptedAt < 5000) { sync(); return; }
      current.loading = !current.payload;
      current.attemptedAt = now();
      sync();
      current.request = Promise.resolve().then(() => fetchJson(baseUrl + '/api/demo?asset=' + encodeURIComponent(context.asset))).then(payload => {
        const valid = validate(payload, context.asset);
        if (finite(current.payload?.updatedAt) && finite(valid.updatedAt) && valid.updatedAt < current.payload.updatedAt) throw new Error('DEMO_OLDER_RESPONSE');
        current.payload = valid;
        current.receivedAt = now();
        current.error = current.errorAt = null;
      }).catch(error => {
        current.error = error?.message || 'DEMO_FETCH_ERROR';
        current.errorAt = now();
      }).finally(() => {
        current.loading = false;
        current.request = null;
        sync();
      });
      return current.request;
    }
    root.addEventListener('click', event => {
      if (!event.target.closest('[data-demo-export]')) return;
      const context = getContext(), current = record(context.asset);
      if (context.archived || context.offline || !current.payload) return;
      const exported = { kind: 'DEMO_DISPLAY_RECORD', schemaVersion: 1, exportedAt: now(), receivedAt: current.receivedAt, refreshError: Boolean(current.error), refreshErrorAt: current.errorAt, context: { asset: context.asset, marketClosed: Boolean(context.marketClosed), chartSnapshotId: context.snapshotId || null }, data: current.payload };
      if (options.download) { options.download(exported); return; }
      const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `multi-analyzer-demo-${context.asset}-${now()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    sync();
    return { sync, refresh };
  }

  return { validate, headline, render, create, stamp };
});
