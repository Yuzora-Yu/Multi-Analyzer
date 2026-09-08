(() => {
  'use strict';

  const Core = window.MultiAnalyzerCore;
  const Feed = window.MultiAnalyzerFeed;
  const CLOUD = 'https://multi-analyzer-monitor.rikai-829.workers.dev';
  if (!Core) throw new Error('strategy-core.js could not be loaded');

  const INSTRUMENTS = {
    gold: {
      name: 'Gold / USD', symbol: 'XAUUSDT', market: 'futures', stream: 'xauusdt', digits: 2,
      sourceLabel: 'BYBIT GOLD PERP', accent: '#e6b85c', up: '#43d49d', down: '#ff6b78'
    },
    btc: {
      name: 'BTC / USD', symbol: 'BTCUSDT', market: 'spot', stream: 'btcusdt', digits: 2,
      sourceLabel: 'BYBIT SPOT', accent: '#f7931a', up: '#43d49d', down: '#ff6b78'
    }
  };
  const TF = {
    '5m': { minutes: 5, api: '5m', label: '5m', limit: 1000 },
    '15m': { minutes: 15, api: '15m', label: '15m', limit: 1000 },
    '1h': { minutes: 60, api: '1h', label: '1H', limit: 1000 },
    '4h': { minutes: 240, api: '4h', label: '4H', limit: 700 },
  };
  const STORAGE_KEY = 'multiAnalyzerUltimate.v4.usd';
  const POSITION_KEY = 'multiAnalyzerUltimate.position';
  const STATIC_HOST = location.hostname.endsWith('.github.io');
  const INITIAL_PARAMS = new URLSearchParams(location.search);

  const state = {
    instrumentId: INITIAL_PARAMS.get('asset') === 'btc' ? 'btc' : 'gold',
    tf: ['5m', '15m', '1h'].includes(INITIAL_PARAMS.get('tf')) ? INITIAL_PARAMS.get('tf') : '15m',
    data: { exec: [], m15: [], h1: [], h4: [] },
    analysis: null,
    snapshot: null,
    snapshotTimer: null,
    preview: null,
    livePrice: null,
    feedAt: 0,
    loadId: 0,
    reference: null,
    zoneSeries: [],
    analysisKey: null,
    ws: null,
    reconnectTimer: null,
    pollTimer: null,
    lastConfirmedClose: null,
    lastReasonTab: 'positive',
    offlineCsv: false,
    chart: null,
    candleSeries: null,
    ema20Series: null,
    ema50Series: null,
    vwapSeries: null,
    priceLines: [],
    chartResizeObserver: null,
    chartResizeFrame: 0,
    chartSize: { width: 0, height: 0 },
    chartFitted: false,
    insightTab: 'signal',
    settings: loadSettings(),
    micro: { bid: null, ask: null, spreadBps: null, bookImbalance: 0, markPrice: null, indexPrice: null, basisBps: 0, fundingRate: 0, nextFundingTime: null },
    microTimer: null,
  };

  const $ = id => document.getElementById(id);
  const qsa = selector => [...document.querySelectorAll(selector)];
  const fmt = (value, digits = currentInstrument().digits) => value != null && Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';
  const pct = value => value != null && Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function currentInstrument() { return INSTRUMENTS[state.instrumentId]; }
  function currentTf() { return TF[state.tf]; }

  function loadSettings() {
    const defaults = { ...Core.DEFAULTS, accountEquity: 1000, riskPct: 0.5, feeBpsPerSide: 2, spreadBps: 1.8, slippageBps: 1.2, minNetRR: 1.8, maxLeverage: 3, blackout: false };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
    catch { return defaults; }
  }

  function loadPosition() {
    try { return JSON.parse(localStorage.getItem(`${POSITION_KEY}.${state.instrumentId}`) || '{}'); }
    catch { return {}; }
  }

  function inputNumber(id) {
    const raw = $(id).value.trim();
    return raw === '' ? null : Number(raw);
  }

  function savePositionFromInputs() {
    const p = {
      direction: $('positionDirection').value,
      entry: inputNumber('positionEntry'),
      stop: inputNumber('positionStop'),
    };
    if (!p.direction || !Number.isFinite(p.entry)) localStorage.removeItem(`${POSITION_KEY}.${state.instrumentId}`);
    else localStorage.setItem(`${POSITION_KEY}.${state.instrumentId}`,  JSON.stringify(p));
    analyzeAndRender();
  }

  function getPosition() {
    const direction = $('positionDirection').value;
    const entry = inputNumber('positionEntry');
    const stop = inputNumber('positionStop');
    if (!direction || !Number.isFinite(entry) || entry <= 0) return null;
    return { direction, entry, stop: Number.isFinite(stop) && stop > 0 ? stop : null };
  }

  function setConnection(mode, text) {
    $('connectionDot').className = `status-dot ${mode}`;
    $('connectionText').textContent = text;
  }

  function setLoading(show, text = 'マーケットデータ取得中') {
    $('chartLoading').classList.toggle('hidden', !show);
    if (show) $('chartLoading').querySelector('span:last-child').textContent = text;
  }

  async function fetchJson(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }

  function mapKlines(rows) {
    if (!Array.isArray(rows)) return [];
    return Core.normalizeCandles(rows.map(row => Array.isArray(row) ? {
      time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]), takerBuyVolume: row[9] == null ? null : Number(row[9])
    } : row));
  }

  async function fetchKlines(tfKey, limit, cfg = currentInstrument()) {
    const asset=cfg.symbol==='XAUUSDT'?'gold':'btc';
    return Core.normalizeCandles(Feed.parse(await fetchJson(Feed.url(asset,TF[tfKey].minutes,limit))));
  }

  async function refreshSnapshot(){
    if(state.offlineCsv || state.tf!=='15m')return;
    const loadId=state.loadId;
    const id=INITIAL_PARAMS.get('snapshot');
    const snapshot=await fetchJson(CLOUD+'/api/snapshot?asset='+state.instrumentId+(id?'&id='+encodeURIComponent(id):''));
    if(loadId!==state.loadId)return;
    if(snapshot.version!==Core.VERSION)throw new Error('分析バージョンが更新されています。ページを再読み込みしてください');
    if(snapshot.asset!==state.instrumentId)throw new Error('通知の銘柄が一致しません');
    if(state.snapshot?.id===snapshot.id)return;
    state.snapshot=snapshot;
    state.data=Feed.input(snapshot);
    state.analysisKey=null;
    state.livePrice=state.data.exec.at(-1).close;
    state.feedAt=Date.now();
    analyzeAndRender();renderChart();
  }

  async function loadAllData() {
    stopRealtime();
    const loadId = ++state.loadId;
    state.analysisKey = null;
    state.data = { exec: [], m15: [], h1: [], h4: [] };
    state.analysis = null;
    state.snapshot = null;
    state.livePrice = null;
    state.reference = null;
    state.feedAt = 0;
    $('actionHeadline').textContent = 'データ取得中・判断待機';
    $('actionCompass').className = 'action-compass wait';
    $('actionTargets').textContent = '価格と分析を更新中';
    $('sheetSummary').textContent = '判断待機';
    $('signalBadge').textContent = '判断待機';
    $('positionAction').textContent = '判断待機';
    $('positionReasons').innerHTML = '<li>データ取得後に判定します。</li>';
    $('positionUrgency').textContent = '—';
    $('unrealizedR').textContent = '—';
    $('livePrice').textContent = '—';
    $('positionLivePrice').textContent = '—';
    $('symbolName').textContent = currentInstrument().name;
    $('symbolCode').textContent = currentInstrument().symbol;
    $('chartTitle').textContent = `${currentInstrument().name} / ${currentTf().label}`;
    $('sourceNotice').textContent = `分析対象: ${currentInstrument().symbol} / USDT建て参考市場`;
    $('referenceQuote').textContent = 'USD参考価格を取得中';
    refreshServices();
    state.offlineCsv = false;
    state.micro = { bid: null, ask: null, spreadBps: null, bookImbalance: 0, markPrice: null, indexPrice: null, basisBps: 0, fundingRate: 0, nextFundingTime: null };
    setLoading(true);
    setConnection('pending', 'データ取得中');
    const execKey = state.tf;
    try {
      if(state.tf==='15m'){
        await refreshSnapshot();
        if(loadId!==state.loadId)return;
        setLoading(false);if(!INITIAL_PARAMS.has('snapshot'))connectRealtime();
        state.snapshotTimer=setInterval(()=>refreshSnapshot().catch(e=>{setConnection('error',e.message);}),30000);
        return;
      }
      const [exec, m15, h1, h4] = await Promise.all([
        fetchKlines(execKey, TF[execKey].limit),
        execKey === '15m' ? Promise.resolve(null) : fetchKlines('15m', TF['15m'].limit),
        execKey === '1h' ? Promise.resolve(null) : fetchKlines('1h', TF['1h'].limit),
        fetchKlines('4h', TF['4h'].limit),
      ]);
      if (loadId !== state.loadId) return;
      state.feedAt = Date.now();
      state.data.exec = exec;
      state.data.m15 = m15 || exec;
      state.data.h1 = h1 || exec;
      state.data.h4 = h4;
      state.livePrice = exec.at(-1)?.close ?? null;
      await refreshMicroData();
      if (loadId !== state.loadId) return;
      state.lastConfirmedClose = Core.filterClosedCandles(exec, currentTf().minutes, Date.now()).at(-1)?.close ?? null;
      analyzeAndRender();
      renderChart();
      setLoading(false);
      setConnection('live', '履歴取得済み');
      connectRealtime();
      clearInterval(state.microTimer);
      state.microTimer = setInterval(refreshMicroData, 10000);
    } catch (error) {
      if (loadId !== state.loadId) return;
      console.error(error);
      setLoading(true, `データ取得失敗: ${error.message}。${STATIC_HOST ? '公開データへの接続を確認してください。利用地域・提供元の制限がある場合はPC版またはCSVをご利用ください。' : 'server.pyで起動してください。'}`);
      setConnection('error', '取得失敗');
      $('actionHeadline').textContent = '— データ取得失敗・判断待機';
    }
  }

  function analysisSettings(overrides = {}) {
    return {
      ...state.settings,
      spreadBps: Number.isFinite(state.micro.spreadBps) ? Math.max(state.settings.spreadBps, state.micro.spreadBps) : state.settings.spreadBps,
      executionMinutes: currentTf().minutes,
      market: currentInstrument().market,
      feedStale: !state.offlineCsv && Date.now() - state.feedAt > 45000,
      minBars: Math.min(220, Math.max(80, state.data.exec.length - 5)),
      now: state.offlineCsv && state.data.exec.length
        ? state.data.exec.at(-1).time + currentTf().minutes * 60_000 + 1500
        : Date.now(),
      livePrice: state.livePrice,
      position: getPosition(),
      ...overrides,
    };
  }

  function analyzeAndRender() {
    if (!state.data.exec.length) return;
    try {
      let key = `${state.instrumentId}:${state.tf}:${Core.filterClosedCandles(state.data.exec, currentTf().minutes, analysisSettings().now).at(-1)?.time}`;
      state.analysis = state.snapshot && !state.offlineCsv
        ? Core.analyzeMarket(Feed.input(state.snapshot),state.snapshot.settings)
        : Core.analyzeMarket({ ...state.data, micro: state.micro }, analysisSettings());
      if(state.snapshot && !state.offlineCsv){
        state.analysis.positionDecision=getPosition()&&!INITIAL_PARAMS.has('snapshot')?Core.positionDecision(getPosition(),state.analysis,state.livePrice):state.analysis.positionDecision;
        if(!INITIAL_PARAMS.has('snapshot') && Date.now()-state.snapshot.settings.now>1200000){state.analysis.actionable=false;state.analysis.state='NO_TRADE';state.analysis.vetoes.push('共通判定の更新停止・新規判断を保留');}
      }
      key += `:${state.analysis.state}:${state.analysis.vetoes.join()}`;
      const forming = state.data.exec.at(-1);
      const previewNow = forming ? forming.time + currentTf().minutes * 60_000 + 1500 : Date.now();
      state.preview = state.snapshot ? null : Core.analyzeMarket({ ...state.data, micro: state.micro }, analysisSettings({ now: previewNow, position: null }));
      renderAll();
      renderCompass();
      if (state.analysisKey !== key) { state.analysisKey = key; renderChart(); }
    } catch (error) {
      console.error('Analysis error', error);
      setConnection('error', '分析エラー');
    }
  }

  async function refreshMicroData() {
    if (state.offlineCsv) return;
    // Keep order-book snapshots out of the bar-close decision. The cloud and
    // browser must not score different instants of an ephemeral order book.
  }

  function connectRealtime() {
    if (state.offlineCsv) return;
    const cfg = currentInstrument();
    const interval = currentTf().api;
    const url='wss://stream.bybit.com/v5/public/'+(cfg.market==='futures'?'linear':'spot');
    try {
      const ws = new WebSocket(url);
      state.ws = ws;
      ws.onopen = () => {
        if (state.ws !== ws) return;
        ws.send(JSON.stringify({op:'subscribe',args:['kline.'+currentTf().minutes+'.'+cfg.symbol]}));
        setConnection('live', '価格ライブ・判定は確定足');
        clearInterval(state.pollTimer);
      };
      let lastAnalysis = 0;
      ws.onmessage = event => {
        if (state.ws !== ws) return;
        state.feedAt = Date.now();
        setConnection('live', 'リアルタイム');
        try {
          const payload = JSON.parse(event.data);
          const k = payload.data?.[0];
          if (!k) return;
          const candle = { time: Number(k.start), open: Number(k.open), high: Number(k.high), low: Number(k.low), close: Number(k.close), volume: Number(k.volume) };
          upsertCandle(state.data.exec, candle);
          if (state.tf === '15m') upsertCandle(state.data.m15, candle);
          if (state.tf === '1h') upsertCandle(state.data.h1, candle);
          state.livePrice = candle.close;
          updateLiveHeader();
          updateLiveCandle(candle);
          if (k.confirm || Date.now() - lastAnalysis > 1000) { lastAnalysis = Date.now(); analyzeAndRender(); }
          if (k.confirm) { renderChart(); if(state.snapshot)refreshSnapshot().catch(()=>{});else refreshHigherTimeframes(); }
        } catch (error) { console.warn('WebSocket message error', error); }
      };
      ws.onerror = () => setConnection('pending', '接続再試行');
      ws.onclose = () => {
        if (state.ws !== ws || state.offlineCsv) return;
        setConnection('pending', 'ポーリングへ切替');
        startPolling();
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = setTimeout(connectRealtime, 5000);
      };
    } catch {
      startPolling();
    }
  }

  function stopRealtime() {
    if (state.ws) {
      const ws = state.ws;
      state.ws = null;
      try { ws.close(); } catch { /* noop */ }
    }
    clearTimeout(state.reconnectTimer);
    clearInterval(state.pollTimer);
    clearInterval(state.microTimer);
    clearInterval(state.snapshotTimer);
  }

  function startPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      try {
        const loadId = state.loadId;
        const rows = await fetchKlines(state.tf, 4);
        if (loadId !== state.loadId) return;
        state.feedAt = Date.now();
        setConnection('live', '15秒ポーリング');
        for (const c of rows) upsertCandle(state.data.exec, c);
        state.livePrice = rows.at(-1)?.close ?? state.livePrice;
        analyzeAndRender();
        renderChart();
        await refreshHigherTimeframes();
      } catch { setConnection('error', '再接続待ち'); }
    }, 15000);
  }

  async function refreshHigherTimeframes() {
    if (state.offlineCsv || state.snapshot) return;
    try {
      const loadId = state.loadId, cfg = currentInstrument();
      const [m15, h1, h4] = await Promise.all([fetchKlines('15m', 300, cfg), fetchKlines('1h', 300, cfg), fetchKlines('4h', 300, cfg)]);
      if (loadId !== state.loadId) return;
      Object.assign(state.data, { m15, h1, h4 });
      analyzeAndRender();
    } catch (error) { console.warn('HTF refresh failed', error); }
  }

  function upsertCandle(array, candle) {
    const last = array.at(-1);
    if (!last || candle.time > last.time) array.push(candle);
    else if (candle.time === last.time) array[array.length - 1] = candle;
    else {
      const idx = array.findIndex(x => x.time === candle.time);
      if (idx >= 0) array[idx] = candle;
    }
    if (array.length > 1500) array.splice(0, array.length - 1500);
  }

  function resizeChartToContainer() {
    if (!state.chart) return;
    const container = $('chartContainer');
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (width < 80 || height < 120) return;
    if (state.chartSize.width === width && state.chartSize.height === height) return;
    state.chartSize = { width, height };
    state.chart.applyOptions({ width, height });
    state.redrawFlow?.();
  }

  function scheduleChartResize() {
    cancelAnimationFrame(state.chartResizeFrame);
    state.chartResizeFrame = requestAnimationFrame(resizeChartToContainer);
  }

  function initChart() {
    if (state.chart || !window.LightweightCharts) return;
    const container = $('chartContainer');
    const rect = container.getBoundingClientRect();
    const initialWidth = Math.max(320, Math.floor(rect.width || 800));
    const initialHeight = Math.max(240, Math.floor(rect.height || 520));
    state.chartSize = { width: initialWidth, height: initialHeight };
    state.chartFitted = false;
    state.chart = LightweightCharts.createChart(container, {
      width: initialWidth,
      height: initialHeight,
      layout: { background: { color: '#0c1117' }, textColor: '#718096', fontFamily: 'JetBrains Mono' },
      grid: { vertLines: { color: '#141d27' }, horzLines: { color: '#141d27' } },
      rightPriceScale: { borderColor: '#263140', scaleMargins: { top: .10, bottom: .16 } },
      timeScale: { borderColor: '#263140', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { color: '#405166' }, horzLine: { color: '#405166' } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const cfg = currentInstrument();
    state.candleSeries = state.chart.addCandlestickSeries({
      upColor: cfg.up, downColor: cfg.down, borderVisible: false, wickUpColor: cfg.up, wickDownColor: cfg.down,
      priceFormat: { type: 'price', precision: cfg.digits, minMove: 1 / (10 ** cfg.digits) }
    });
    state.ema20Series = state.chart.addLineSeries({ color: '#e6b85c', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    state.ema50Series = state.chart.addLineSeries({ color: '#64a8ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    state.vwapSeries = state.chart.addLineSeries({ color: '#a58cff', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    state.chartResizeObserver = new ResizeObserver(scheduleChartResize);
    state.chartResizeObserver.observe(container);
    state.volumeSeries=state.chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'volume',priceLineVisible:false,lastValueVisible:false});
    state.volumeSeries.priceScale().applyOptions({scaleMargins:{top:.87,bottom:0}});
    const canvas=document.createElement('canvas');canvas.className='flow-overlay';container.appendChild(canvas);state.flowCanvas=canvas;
    const redraw=()=>requestAnimationFrame(()=>{if(state.analysis?.exec?.flow)window.MultiAnalyzerOverlay.draw(canvas,state.chart,state.candleSeries,state.analysis.exec.candles,state.analysis.exec.flow);});
    state.redrawFlow=redraw;
    state.chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    container.addEventListener('pointermove',redraw);container.addEventListener('wheel',redraw,{passive:true});
    scheduleChartResize();
  }

  function toChartTime(ms) { return Math.floor(ms / 1000); }
  function lineData(candles, values) {
    const out = [];
    for (let i = 0; i < candles.length; i++) if (Number.isFinite(values[i])) out.push({ time: toChartTime(candles[i].time), value: values[i] });
    return out;
  }

  function renderChart() {
    initChart();
    if (!state.chart || !state.analysis?.exec?.series) return;
    const candles = INITIAL_PARAMS.has('snapshot') && state.snapshot ? state.analysis.exec.candles : state.data.exec;
    const visible = candles.slice(-140);
    const offset = candles.length - visible.length;
    state.candleSeries.setData(visible.map(c => ({ time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    state.ema20Series.setData(lineData(state.analysis.exec.candles.slice(offset), state.analysis.exec.series.ema20.slice(offset)));
    state.ema50Series.setData(lineData(state.analysis.exec.candles.slice(offset), state.analysis.exec.series.ema50.slice(offset)));
    state.vwapSeries.setData(lineData(state.analysis.exec.candles.slice(offset), state.analysis.exec.series.vwap96.slice(offset)));

    state.volumeSeries.setData(visible.map(c=>({time:toChartTime(c.time),value:c.volume,color:c.close>=c.open?'#43d49d66':'#ff6b7866'})));
    const markers = [];
    for(const f of (state.analysis.exec.flow?.history||[]).slice(-60)){
      if(f.time<visible[0].time)continue;
      if(f.pullbackConfirmed)markers.push({time:toChartTime(f.time),position:f.direction>0?'belowBar':'aboveBar',color:'#bf9dff',shape:'circle',text:'P 押し目条件'});
      if(f.exitLong||f.exitShort)markers.push({time:toChartTime(f.time),position:f.exitLong?'aboveBar':'belowBar',color:'#ffd44a',shape:'circle',text:f.exitLong?'買 EXIT':'売 EXIT'});
    }
    let lastMarkerTime = 0;
    for (const e of (state.analysis.exec.smc?.events || []).slice(-12)) {
      if (e.time - lastMarkerTime < currentTf().minutes * 60000 * 3) continue;
      lastMarkerTime = e.time;
      if (e.time < visible[0].time) continue;
      markers.push({ time: toChartTime(e.time), position: e.side === 'bull' ? 'belowBar' : 'aboveBar', color: e.side === 'bull' ? '#43d49d' : '#ff6b78', shape: e.side === 'bull' ? 'arrowUp' : 'arrowDown', text: e.type });
    }
    if (state.analysis.actionable) markers.push({ time: toChartTime(state.analysis.exec.candles.at(-1).time), position: state.analysis.direction === 'LONG' ? 'belowBar' : 'aboveBar', color: '#e6b85c', shape: 'circle', text: state.analysis.direction === 'LONG' ? '買い候補' : '売り候補' });
    markers.sort((a, b) => a.time - b.time);
    state.candleSeries.setMarkers(markers);

    for (const line of state.priceLines) state.candleSeries.removePriceLine(line);
    state.priceLines = [];
    if (state.analysis.actionable && state.analysis.plan) {
      const levels = [
        ['ENTRY', state.analysis.plan.entry, '#e6b85c', 1],
        ['STOP', state.analysis.plan.stop, '#ff6b78', 2],
        ['TP1', state.analysis.plan.tp1, '#43d49d', 2],
        ['TP2', state.analysis.plan.tp2, '#43d49d', 2],
      ];
      for (const [title, price, color, style] of levels) {
        if (!Number.isFinite(price)) continue;
        state.priceLines.push(state.candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
      }
    }
    renderZones();
    state.redrawFlow?.();
    if (!state.chartFitted) {
      state.chart.timeScale().fitContent();
      state.chartFitted = true;
    }
  }

  function updateLiveCandle(candle) {
    if (!state.candleSeries) return;
    state.candleSeries.update({ time: toChartTime(candle.time), open: candle.open, high: candle.high, low: candle.low, close: candle.close });
  }

  function renderAll() {
    renderHeader();
    renderDecision();
    renderPlan();
    renderPosition();
    renderTimeframes();
    renderReasons();
    renderMetrics();
    renderChart();
  }

  function updateLiveHeader() {
    const cfg = currentInstrument();
    $('livePrice').textContent = fmt(state.livePrice, cfg.digits);
    $('lastUpdate').textContent = `LIVE ${new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}`;
  }

  function renderHeader() {
    const a = state.analysis;
    const cfg = currentInstrument();
    document.documentElement.style.setProperty('--gold', cfg.accent);
    $('symbolName').textContent = cfg.name;
    $('symbolCode').textContent = cfg.symbol;
    $('dataSource').textContent = state.offlineCsv ? 'IMPORTED CSV' : cfg.sourceLabel;
    $('chartTitle').textContent = `${cfg.name} / ${currentTf().label}`;
    $('tfExecLabel').textContent = currentTf().label;
    updateLiveHeader();
    const confirmed = a.exec.candles.at(-1);
    if (confirmed) {
      const previous = a.exec.candles.at(-2)?.close ?? confirmed.open;
      const change = previous ? (state.livePrice - previous) / previous * 100 : 0;
      $('priceChange').textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
      $('priceChange').className = `price-change ${change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral'}`;
    }
    $('sessionName').textContent = a.session.name;
    $('regimeName').textContent = String(a.regime || '—').toUpperCase();
    $('atrValue').textContent = fmt(a.exec.values.atr, cfg.digits);
    $('adxValue').textContent = fmt(a.exec.values.adx, 1);
    $('rsiValue').textContent = fmt(a.exec.values.rsi, 1);
    $('qualityValue').textContent = `${Math.round(a.exec.quality.score)} / 100`;
  }

  function stateLabel(stateName) { return ({ NO_TRADE: '待機', WATCH_LONG: '買い監視', WATCH_SHORT: '売り監視', READY_LONG: '買い候補', STRONG_LONG: '買い条件合致', READY_SHORT: '売り候補', STRONG_SHORT: '売り条件合致' })[stateName] || stateName; }

  function renderDecision() {
    const a = state.analysis;
    const badge = $('signalBadge');
    badge.textContent = stateLabel(a.state);
    const sheetSummary = $('sheetSummary');
    sheetSummary.textContent = stateLabel(a.state);
    sheetSummary.style.color = a.state.includes('LONG') ? 'var(--green)' : a.state.includes('SHORT') ? 'var(--red)' : a.state.startsWith('WATCH') ? 'var(--orange)' : 'var(--muted)';
    badge.className = 'signal-badge';
    if (a.state.includes('LONG')) badge.classList.add(a.state.startsWith('WATCH') ? 'watch' : 'long');
    else if (a.state.includes('SHORT')) badge.classList.add(a.state.startsWith('WATCH') ? 'watch' : 'short');
    else badge.classList.add('no-trade');
    $('confidenceValue').textContent = Math.round(a.confidence);
    $('confidenceRing').style.setProperty('--value', Math.round(a.confidence));
    $('decisionMessage').textContent = a.message;
    $('longScore').textContent = a.longScore;
    $('shortScore').textContent = a.shortScore;
    $('longScoreBar').style.width = `${a.longScore}%`;
    $('shortScoreBar').style.width = `${a.shortScore}%`;
    $('htfBias').textContent = a.htfBias.toUpperCase();
    $('htfBias').className = `trend-${a.htfBias}`;
    $('structureEvent').textContent = a.exec.structure.event || a.exec.structure.trend.toUpperCase();
    const trigger = a.direction === 'LONG'
      ? (a.exec.structure.bullSweep || a.exec.pattern.bullReject || a.exec.pattern.bullEngulf || ['BULL_BOS', 'BULL_CHOCH'].includes(a.exec.structure.event))
      : (a.exec.structure.bearSweep || a.exec.pattern.bearReject || a.exec.pattern.bearEngulf || ['BEAR_BOS', 'BEAR_CHOCH'].includes(a.exec.structure.event));
    $('triggerState').textContent = a.entryModel==='pullback-v1'?(a.exec.flow?.latest?.pullbackConfirmed?'P CONFIRMED':'P WAIT'):trigger?'CONFIRMED':'WAIT';
    $('signalTime').textContent = a.exec.candles.at(-1) ? new Date(a.exec.candles.at(-1).time).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

    if (state.preview) {
      const p = state.preview;
      const changed = p.state !== a.state;
      $('livePreviewText').textContent = changed
        ? `${stateLabel(p.state)} / L${p.longScore} S${p.shortScore}（未確定）`
        : `${stateLabel(a.state)} 維持 / L${p.longScore} S${p.shortScore}`;
    }
  }

  function renderPlan() {
    const a = state.analysis;
    const p = a.plan;
    let action = 'WAIT / NO TRADE';
    if (a.state.includes('LONG')) action = a.actionable ? 'BUY SETUP' : 'WATCH BUY';
    if (a.state.includes('SHORT')) action = a.actionable ? 'SELL SETUP' : 'WATCH SELL';
    $('planAction').textContent = action;
    $('planAction').style.color = action.includes('BUY') ? 'var(--green)' : action.includes('SELL') ? 'var(--red)' : 'var(--muted)';
    for (const [id, val] of [
      ['entryValue', p?.entry], ['stopValue', p?.stop], ['tp1Value', p?.tp1], ['tp2Value', p?.tp2], ['tp3Value', p?.tp3]
    ]) $(id).textContent = fmt(val);
    $('rrValue').textContent = p?.netRR != null ? `${p.netRR} R` : '—';
    $('quantityValue').textContent = p?.quantity != null ? `${fmt(p.quantity, 4)} ${state.instrumentId === 'gold' ? 'oz' : 'BTC'}` : '—';
    $('riskBudgetValue').textContent = p?.riskBudget != null ? `$${fmt(p.riskBudget, 2)}` : '—';
    const notes = [];
    if (p) notes.push(`${p.orderType === 'CLOSE_CONFIRM' ? '確定足確認' : 'リテスト指値候補'}。無効化: ${p.invalidation}。`);
    if (a.vetoes.length) notes.push(`見送り: ${a.vetoes.slice(0, 2).join(' / ')}`);
    else if (a.actionable) notes.push('新規候補。実際のスプレッドと注文可能数量を確認してからペーパートレードで検証してください。');
    else notes.push('方向優位はあっても、確定トリガーまたは最低スコア未達です。');
    $('planNote').textContent = notes.join(' ');
  }

  function renderPosition() {
    const p = state.analysis.positionDecision;
    const box = $('positionDecision');
    if (!state.offlineCsv && Date.now() - state.feedAt > 45000) {
      box.className = 'position-decision hold';
      $('positionAction').textContent = '更新停止・判断待機'; $('positionUrgency').textContent = '—';
      $('positionReasons').innerHTML = '<li>ライブ価格を再取得するまで保有判断を停止します。</li>';
      return;
    }
    if (!p) {
      box.className = 'position-decision hold';
      $('positionAction').textContent = 'NO POSITION';
      $('positionUrgency').textContent = '—';
      $('unrealizedR').textContent = '—';
      $('positionLivePrice').textContent = fmt(state.livePrice);
      $('positionReasons').innerHTML = '<li>方向・建値・ストップを入力すると、ライブ価格でHOLD / REDUCE / EXITを更新します。</li>';
      return;
    }
    const cls = p.action.startsWith('EXIT') ? 'exit' : p.action.startsWith('REDUCE') ? 'reduce' : p.action.startsWith('TRAIL') ? 'trail' : 'hold';
    box.className = `position-decision ${cls}`;
    $('positionAction').textContent = p.action.replaceAll('_', ' ');
    $('positionUrgency').textContent = `URGENCY ${p.urgency}`;
    $('unrealizedR').textContent = `${p.unrealizedR >= 0 ? '+' : ''}${p.unrealizedR} R`;
    $('positionLivePrice').textContent = fmt(p.livePrice);
    $('positionReasons').innerHTML = p.reasons.map(r => `<li>${esc(r)}</li>`).join('');
  }

  function renderCompass() {
    const a = state.analysis, p = a.plan, pos = a.positionDecision;
    const stale = !state.offlineCsv && !INITIAL_PARAMS.has('snapshot') && Date.now() - state.feedAt > 45000;
    const exit = pos?.action.startsWith('EXIT');
    const cls = stale ? 'wait' : exit ? 'exit' : a.actionable ? (a.direction === 'LONG' ? 'buy' : 'sell') : 'wait';
    $('actionCompass').className = `action-compass ${cls}`;
    $('actionHeadline').textContent = stale ? '— 更新停止・判断待機' : exit ? `× ${(getPosition()||state.snapshot?.settings.position)?.direction === 'LONG' ? '買い' : '売り'}ポジション クローズ推奨${!getPosition()?'（前回候補を保有中なら）':''}` : `${cls === 'buy' ? '▲' : cls === 'sell' ? '▼' : '—'} ${stateLabel(a.state)}`;
    $('actionTargets').textContent = stale ? '価格が復旧するまで新規シグナルを停止します' : exit ? pos.reasons.join(' / ') : a.actionable && p ? `目標 ${fmt(p.tp1)} → ${fmt(p.tp2)} ｜ SL ${fmt(p.stop)} ｜ 基準 ${fmt(p.entry)}` : a.vetoes[0] || a.message;
    $('sourceNotice').textContent = state.offlineCsv ? 'CSV検証 / 実相場ではありません・通知しません' : `分析・目標: ${currentInstrument().symbol} (${currentInstrument().market}) / ブローカーのUSD価格とは異なります`;
    if (exit && !stale) { $('sheetSummary').textContent = '× クローズ推奨'; $('sheetSummary').style.color = '#c69cff'; }
    $('currentSnapshotLink').href='?asset='+state.instrumentId+'&tf=15m';
    if(state.snapshot) {
      $('sourceNotice').textContent='共通判定 '+state.snapshot.id+' / Bybit '+state.snapshot.symbol+' / '+(INITIAL_PARAMS.has('snapshot')?'通知時点の保存記録（現在の推奨ではありません）':'メールと同じデータ・設定・確定足');
      $('livePreviewText').textContent='通知と共通の15分確定足 / 設定は共通固定・ライブ価格は判定と別更新';
    }
    const flow=a.exec.flow, f=flow?.latest;
    if(f)$('flowSummary').innerHTML=`<strong>${f.direction>0?'↑ 上向き保持':f.direction<0?'↓ 下向き保持':'— 未確定'}</strong><span>高安構造 ${f.structure>0?'↑':f.structure<0?'↓':'→'} / EMA5対144 ${f.ribbon>0?'↑':f.ribbon<0?'↓':'→'} / 転換票 ${f.votes}/${f.requiredVotes}</span><span>H1一致 ${f.hourlyAligned?'あり':'なし'} ｜ 出来高 ${fmt(f.volumeRatio,2)}倍 ｜ ${f.rank||'—'}${f.badge?' +'+f.badge:''}</span><span>${f.pullbackConfirmed?'P：押し目・奪還・出来高・H1一致':f.absorption?'吸収候補：出来高に対して値幅が小さい（推定）':'P条件待ち'} / ADX ${fmt(a.exec.values.adx,1)} / リボン幅 ${fmt(f.widthATR,2)} ATR</span><small>黄EXIT注意＝EMA13を反対側で2本確定。反転エントリーではありません。S/A/B・V/VRは独自条件の分類で、勝率順位ではありません。POC/VAは直近96本のOHLCV近似。</small>`;
    const m = a.exec.smc;
    if (!m) return;
    $('smcDetails').innerHTML = `<div class="smc-tags"><span>${esc(m.location)} / EQ ${fmt(m.equilibrium)}</span><span>推定POC ${fmt(m.poc)}</span></div>` +
      m.zones.slice(-6).reverse().map(z => `<p class="smc-zone ${z.side}">${esc(z.type)} ${z.side === 'bull' ? '需要帯' : '供給帯'} ${fmt(z.low)} – ${fmt(z.high)}</p>`).join('') +
      `<p class="dialog-note">${m.liquidity.map(l => `${l.type} ${fmt(l.price)}`).join(' / ') || '未消化の等値流動性なし'}<br>POCはOHLCV近似。実際の約定分布・機関注文を観測した値ではありません。</p>`;
  }

  function renderZones() {
    for (const series of state.zoneSeries) state.chart.removeSeries(series);
    state.zoneSeries = [];
    const m = state.analysis.exec.smc;
    if (!m) return;
    const end = toChartTime(state.data.exec.at(-1).time);
    const earliest = toChartTime(state.data.exec.slice(-140)[0].time);
    for (const z of m.zones.slice(-6)) {
      const color = z.side === 'bull' ? '#43d49d55' : '#ff6b7855';
      for (const price of [z.low, z.high]) {
        const series = state.chart.addLineSeries({ color, lineWidth: 2, lineStyle: z.type === 'FVG' ? 2 : 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null });
        const start = Math.max(earliest, toChartTime(z.time));
        series.setData(start < end ? [{ time: start, value: price }, { time: end, value: price }] : [{ time: start, value: price }]);
        state.zoneSeries.push(series);
      }
    }
  }

  async function refreshServices() {
    const id = state.instrumentId;
    const results = await Promise.allSettled([
      fetchJson(STATIC_HOST ? `https://api.gold-api.com/price/${id === 'gold' ? 'XAU' : 'BTC'}` : `/api/reference?asset=${id}`),
      fetchJson(CLOUD+'/api/monitor')
    ]);
    if (id !== state.instrumentId) return;
    if (results[0].status === 'fulfilled') {
      const q = results[0].value;
      const old = !q.updatedAt || Date.now() - Date.parse(q.updatedAt) > 120000;
      $('referenceQuote').textContent = `USD参考値 $${fmt(q.price)} / Gold API ${old ? '更新遅延' : new Date(q.updatedAt).toLocaleTimeString('ja-JP')}（分析には混用しません）`;
    } else $('referenceQuote').textContent = 'USD参考値: 取得できません（分析はUSDT建て）';
    if (results[1].status === 'fulfilled') {
      const m = results[1].value;
      const fresh = m.updatedAt && Date.now() - m.updatedAt < 420000;
      $('monitorStatus').textContent = `${fresh ? '● クラウド監視更新中' : '○ クラウド監視の更新遅延'} / ${m.channels?.join('・') || '通知検証中'} / ${m.summary || '未開始'} / ${m.source || ''}${m.error ? ' / ' + m.error : ''}（通知対象は15分足の共通判定）`;
    } else $('monitorStatus').textContent = 'クラウド監視の状態を取得できません。';
  }

  function renderTfRow(prefix, tf) {
    const trend = tf?.trend || 'neutral';
    $(`${prefix}Trend`).textContent = trend.toUpperCase();
    $(`${prefix}Trend`).className = `trend-${trend}`;
    $(`${prefix}Rsi`).textContent = fmt(tf?.values?.rsi, 1);
    $(`${prefix}Adx`).textContent = fmt(tf?.values?.adx, 1);
  }

  function renderTimeframes() {
    renderTfRow('tf4', state.analysis.h4);
    renderTfRow('tf1', state.analysis.h1);
    renderTfRow('tf15', state.analysis.m15);
    renderTfRow('tfExec', state.analysis.exec);
  }

  function reasonItems() {
    const a = state.analysis;
    if (state.lastReasonTab === 'veto') return a.vetoes.length ? a.vetoes.map(text => ({ text, cls: 'veto' })) : [{ text: 'hard vetoなし', cls: '' }];
    if (state.lastReasonTab === 'warning') return a.warnings.length ? a.warnings.map(text => ({ text, cls: 'warning' })) : [{ text: '追加注意なし', cls: '' }];
    return a.components
      .filter(x => x.long > 0 || x.short > 0)
      .sort((x, y) => Math.max(y.long, y.short) - Math.max(x.long, x.short))
      .slice(0, 10)
      .map(x => ({ text: `${x.text} — LONG +${x.long} / SHORT +${x.short}`, cls: '' }));
  }

  function renderReasons() {
    $('reasonList').innerHTML = reasonItems().map(x => `<li class="${x.cls}">${esc(x.text)}</li>`).join('');
  }

  function renderMetrics() {
    const v = state.analysis.exec.values;
    const close = v.close;
    $('emaDistance').textContent = Number.isFinite(v.ema20) ? `${((close - v.ema20) / v.atr).toFixed(2)} ATR` : '—';
    $('vwapDistance').textContent = Number.isFinite(v.vwap) ? `${((close - v.vwap) / v.atr).toFixed(2)} ATR` : '—';
    $('macdHist').textContent = fmt(v.macdHist, currentInstrument().digits + 2);
    $('diValue').textContent = `${fmt(v.plusDI, 1)} / ${fmt(v.minusDI, 1)}`;
    $('volumeZ').textContent = fmt(v.volZ, 2);
    $('atrRank').textContent = pct(v.atrRank * 100);
    const spread = Number.isFinite(state.micro.spreadBps) ? state.micro.spreadBps : state.settings.spreadBps;
    $('spreadEstimate').textContent = `${spread.toFixed(2)} bps`;
    $('spreadEstimate').title = Number.isFinite(state.micro.basisBps) ? `Basis ${state.micro.basisBps.toFixed(2)}bps / Funding ${(state.micro.fundingRate * 100).toFixed(4)}%` : '';
    $('costRiskRatio').textContent = state.analysis.plan?.costs?.costRiskRatio != null ? pct(state.analysis.plan.costs.costRiskRatio * 100) : '—';
  }

  async function importCsv(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const candles = Core.parseCSV(text);
      if (candles.length < 80) throw new Error('80本以上のデータが必要です');
      stopRealtime();
      state.loadId++;
      state.analysisKey = null;
      state.offlineCsv = true;
      state.micro = { bid: null, ask: null, spreadBps: null, bookImbalance: 0, markPrice: null, indexPrice: null, basisBps: 0, fundingRate: 0, nextFundingTime: null };
      const minutes = Core.inferIntervalMinutes(candles) || currentTf().minutes;
      const match = Object.entries(TF).find(([, v]) => v.minutes === minutes);
      if (match) {
        state.tf = match[0];
        qsa('.timeframes button').forEach(b => b.classList.toggle('active', b.dataset.tf === state.tf));
      }
      state.data.exec = candles;
      state.data.m15 = minutes <= 15 ? Core.aggregateCandles(candles, 15, { baseMinutes: minutes }) : candles;
      state.data.h1 = minutes <= 60 ? Core.aggregateCandles(candles, 60, { baseMinutes: minutes }) : candles;
      state.data.h4 = minutes <= 240 ? Core.aggregateCandles(candles, 240, { baseMinutes: minutes }) : candles;
      state.livePrice = candles.at(-1).close;
      analyzeAndRender();
      renderChart();
      setLoading(false);
      setConnection('live', `CSV ${candles.length}本`);
    } catch (error) {
      alert(`CSV読み込みエラー: ${error.message}`);
    } finally { $('csvInput').value = ''; }
  }

  function runBacktest() {
    if (!state.data.exec.length) return;
    $('backtestButton').disabled = true;
    $('backtestStatus').textContent = '確定足・次足約定・同一足SL優先・コスト込みで計算中…';
    const payload = {
      data: state.data,
      settings: { ...analysisSettings({ position: null, livePrice: null }), maxBacktestBars: 1200, now: Date.now() }
    };
    if (window.Worker) {
      const worker = new Worker('backtest-worker.js');
      worker.onmessage = event => {
        worker.terminate();
        $('backtestButton').disabled = false;
        if (event.data.error) {
          $('backtestStatus').textContent = `バックテスト失敗: ${event.data.error}`;
          return;
        }
        renderBacktest(event.data.result);
      };
      worker.onerror = event => {
        worker.terminate();
        $('backtestButton').disabled = false;
        $('backtestStatus').textContent = `バックテスト失敗: ${event.message}`;
      };
      worker.postMessage(payload);
    } else {
      setTimeout(() => {
        try { renderBacktest(Core.backtest(payload.data, payload.settings)); }
        catch (error) { $('backtestStatus').textContent = `バックテスト失敗: ${error.message}`; }
        $('backtestButton').disabled = false;
      }, 10);
    }
  }

  function renderBacktest(result) {
    const a = result.all;
    $('backtestStatus').textContent = `${result.bars}本 / IS 70%・OOS 30%。過去成績は将来を保証しません。`;
    $('btTrades').textContent = a.trades;
    $('btWinRate').textContent = `${a.winRate}%`;
    $('btExpectancy').textContent = `${a.expectancyR} R`;
    $('btProfitFactor').textContent = a.profitFactor;
    $('btMaxDD').textContent = `${a.maxDrawdownR} R`;
    $('btOos').textContent = `${result.outOfSample.expectancyR} R`;
  }

  function openSettings() {
    const common=Boolean(state.snapshot&&!state.offlineCsv);
    document.querySelectorAll('#settingsDialog input').forEach(el=>{el.disabled=common;});
    $('saveSettingsButton').disabled=common;
    $('settingEquity').value = (state.snapshot&&!state.offlineCsv?state.snapshot.settings:state.settings).accountEquity;
    $('settingRiskPct').value = (state.snapshot&&!state.offlineCsv?state.snapshot.settings:state.settings).riskPct;
    $('settingFee').value = (state.snapshot&&!state.offlineCsv?state.snapshot.settings:state.settings).feeBpsPerSide;
    $('settingSpread').value = (state.snapshot&&!state.offlineCsv?state.snapshot.settings:state.settings).spreadBps;
    $('settingSlippage').value = (state.snapshot&&!state.offlineCsv?state.snapshot.settings:state.settings).slippageBps;
    $('settingMinRR').value = (state.snapshot&&!state.offlineCsv?state.snapshot.settings:state.settings).minNetRR;
    $('settingLeverage').value = (state.snapshot&&!state.offlineCsv?state.snapshot.settings:state.settings).maxLeverage;
    $('settingBlackout').checked = Boolean((state.snapshot&&!state.offlineCsv?state.snapshot.settings:state.settings).blackout);
    $('settingsDialog').showModal();
  }

  function saveSettings(event) {
    event.preventDefault();
    state.settings = {
      ...state.settings,
      accountEquity: Math.max(1, Number($('settingEquity').value)),
      riskPct: Math.max(.05, Number($('settingRiskPct').value)),
      feeBpsPerSide: Math.max(0, Number($('settingFee').value)),
      spreadBps: Math.max(0, Number($('settingSpread').value)),
      slippageBps: Math.max(0, Number($('settingSlippage').value)),
      minNetRR: Math.max(1, Number($('settingMinRR').value)),
      maxLeverage: Math.max(1, Number($('settingLeverage').value)),
      blackout: $('settingBlackout').checked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    $('settingsDialog').close();
    analyzeAndRender();
  }

  function setInsightTab(tab) {
    state.insightTab = tab;
    qsa('[data-insight-tab]').forEach(button => button.classList.toggle('active', button.dataset.insightTab === tab));
    qsa('[data-insight-page]').forEach(page => page.classList.toggle('active', page.dataset.insightPage === tab));
    if (window.matchMedia('(max-width: 760px)').matches) {
      $('insightPanel').classList.remove('sheet-collapsed');
      $('insightToggle').setAttribute('aria-expanded', 'true');
      scheduleChartResize();
    }
  }

  function toggleInsightSheet() {
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    const panel = $('insightPanel');
    const collapsed = panel.classList.toggle('sheet-collapsed');
    $('insightToggle').setAttribute('aria-expanded', String(!collapsed));
    setTimeout(scheduleChartResize, 240);
  }

  function syncInsightLayout() {
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const panel = $('insightPanel');
    if (mobile) {
      panel.classList.add('sheet-collapsed');
      $('insightToggle').setAttribute('aria-expanded', 'false');
    } else {
      panel.classList.remove('sheet-collapsed');
      $('insightToggle').setAttribute('aria-expanded', 'true');
    }
    scheduleChartResize();
  }

  function bindEvents() {
    qsa('[data-insight-tab]').forEach(button => button.addEventListener('click', () => setInsightTab(button.dataset.insightTab)));
    $('insightToggle').addEventListener('click', toggleInsightSheet);
    window.addEventListener('resize', scheduleChartResize, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(scheduleChartResize, 180), { passive: true });
    window.matchMedia('(max-width: 760px)').addEventListener?.('change', syncInsightLayout);
    qsa('.instrument-tab').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.instrument === state.instrumentId) return;
      state.instrumentId = button.dataset.instrument;
      $('positionDirection').value = ''; $('positionEntry').value = ''; $('positionStop').value = '';
      restorePositionInputs();
      qsa('.instrument-tab').forEach(b => b.classList.toggle('active', b === button));
      destroyChart();
      loadAllData();
    }));
    qsa('.timeframes button').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.tf === state.tf) return;
      state.tf = button.dataset.tf;
      qsa('.timeframes button').forEach(b => b.classList.toggle('active', b === button));
      destroyChart();
      loadAllData();
    }));
    qsa('[data-reason-tab]').forEach(button => button.addEventListener('click', () => {
      state.lastReasonTab = button.dataset.reasonTab;
      qsa('[data-reason-tab]').forEach(b => b.classList.toggle('active', b === button));
      renderReasons();
    }));
    $('reloadButton').addEventListener('click', loadAllData);
    $('csvInput').addEventListener('change', event => importCsv(event.target.files[0]));
    $('backtestButton').addEventListener('click', runBacktest);
    $('settingsButton').addEventListener('click', openSettings);
    $('saveSettingsButton').addEventListener('click', saveSettings);
    for (const id of ['positionDirection', 'positionEntry', 'positionStop']) $(id).addEventListener('change', savePositionFromInputs);
    $('clearPositionButton').addEventListener('click', () => {
      $('positionDirection').value = '';
      $('positionEntry').value = '';
      $('positionStop').value = '';
      localStorage.removeItem(`${POSITION_KEY}.${state.instrumentId}`);
      analyzeAndRender();
    });
    window.addEventListener('beforeunload', stopRealtime);
  }

  function destroyChart() {
    if (state.chartResizeObserver) state.chartResizeObserver.disconnect();
    state.chartResizeObserver = null;
    cancelAnimationFrame(state.chartResizeFrame);
    state.chartResizeFrame = 0;
    if (state.chart) state.chart.remove();
    state.chart = state.candleSeries = state.ema20Series = state.ema50Series = state.vwapSeries = null;
    state.priceLines = [];
    state.zoneSeries = [];
    state.chartSize = { width: 0, height: 0 };
    state.chartFitted = false;
  }

  function startClock() {
    const tick = () => { $('clock').textContent = `${new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })} JST`; };
    tick(); setInterval(tick, 1000);
  }

  function restorePositionInputs() {
    const p = loadPosition();
    if (p.direction) $('positionDirection').value = p.direction;
    if (Number.isFinite(p.entry)) $('positionEntry').value = p.entry;
    if (Number.isFinite(p.stop)) $('positionStop').value = p.stop;
  }

  function init() {
    qsa('.instrument-tab').forEach(b => b.classList.toggle('active', b.dataset.instrument === state.instrumentId));
    qsa('.timeframes button').forEach(b => b.classList.toggle('active', b.dataset.tf === state.tf));
    bindEvents();
    restorePositionInputs();
    setInsightTab('signal');
    syncInsightLayout();
    startClock();
    loadAllData();
    refreshServices();
    setInterval(refreshServices, 30000);
    setInterval(() => {
      if (!state.offlineCsv && !INITIAL_PARAMS.has('snapshot') && state.feedAt && Date.now() - state.feedAt > 45000) {
        setConnection('error', '価格更新停止'); analyzeAndRender();
        if (!state.pollTimer) startPolling();
      }
    }, 5000);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
