(() => {
  'use strict';

  const Core = window.MultiAnalyzerCore;
  if (!Core) throw new Error('strategy-core.js could not be loaded');

  const INSTRUMENTS = {
    gold: {
      name: 'GOLD', symbol: 'XAUUSDT', market: 'futures', stream: 'xauusdt', digits: 2,
      sourceLabel: 'BINANCE USDⓈ-M', accent: '#e6b85c', up: '#43d49d', down: '#ff6b78'
    },
    silver: {
      name: 'SILVER', symbol: 'XAGUSDT', market: 'futures', stream: 'xagusdt', digits: 4,
      sourceLabel: 'BINANCE USDⓈ-M', accent: '#bfc8d8', up: '#43d49d', down: '#ff6b78'
    },
    btc: {
      name: 'BTC', symbol: 'BTCUSDT', market: 'spot', stream: 'btcusdt', digits: 2,
      sourceLabel: 'BINANCE SPOT', accent: '#f7931a', up: '#43d49d', down: '#ff6b78'
    }
  };
  const TF = {
    '5m': { minutes: 5, api: '5m', label: '5m', limit: 1000 },
    '15m': { minutes: 15, api: '15m', label: '15m', limit: 1000 },
    '1h': { minutes: 60, api: '1h', label: '1H', limit: 1000 },
    '4h': { minutes: 240, api: '4h', label: '4H', limit: 700 },
  };
  const STORAGE_KEY = 'multiAnalyzerUltimate.v3';
  const POSITION_KEY = 'multiAnalyzerUltimate.position';

  const state = {
    instrumentId: 'gold',
    tf: '15m',
    data: { exec: [], m15: [], h1: [], h4: [] },
    analysis: null,
    preview: null,
    livePrice: null,
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
    settings: loadSettings(),
    micro: { bid: null, ask: null, spreadBps: null, bookImbalance: 0, markPrice: null, indexPrice: null, basisBps: 0, fundingRate: 0, nextFundingTime: null },
    microTimer: null,
  };

  const $ = id => document.getElementById(id);
  const qsa = selector => [...document.querySelectorAll(selector)];
  const fmt = (value, digits = currentInstrument().digits) => Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '—';
  const pct = value => Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : '—';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function currentInstrument() { return INSTRUMENTS[state.instrumentId]; }
  function currentTf() { return TF[state.tf]; }

  function loadSettings() {
    const defaults = { ...Core.DEFAULTS, accountEquity: 1_000_000, riskPct: 0.5, feeBpsPerSide: 2, spreadBps: 1.8, slippageBps: 1.2, minNetRR: 1.8, maxLeverage: 3, blackout: false };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
    catch { return defaults; }
  }

  function loadPosition() {
    try { return JSON.parse(localStorage.getItem(POSITION_KEY) || '{}'); }
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
    if (!p.direction || !Number.isFinite(p.entry)) localStorage.removeItem(POSITION_KEY);
    else localStorage.setItem(POSITION_KEY, JSON.stringify(p));
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
      time: Number(row[0]), open: Number(row[1]), high: Number(row[2]), low: Number(row[3]), close: Number(row[4]), volume: Number(row[5])
    } : row));
  }

  async function fetchKlines(tfKey, limit) {
    const cfg = currentInstrument();
    const interval = TF[tfKey].api;
    const params = new URLSearchParams({ market: cfg.market, symbol: cfg.symbol, interval, limit: String(limit) });
    const urls = [
      `/api/klines?${params}`,
      cfg.market === 'futures'
        ? `https://fapi.binance.com/fapi/v1/klines?symbol=${cfg.symbol}&interval=${interval}&limit=${limit}`
        : `https://api.binance.com/api/v3/klines?symbol=${cfg.symbol}&interval=${interval}&limit=${limit}`
    ];
    let lastError = null;
    for (const url of urls) {
      try {
        const data = await fetchJson(url);
        const rows = mapKlines(data);
        if (rows.length) return rows;
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('Kline data unavailable');
  }

  async function loadAllData() {
    stopRealtime();
    state.offlineCsv = false;
    state.micro = { bid: null, ask: null, spreadBps: null, bookImbalance: 0, markPrice: null, indexPrice: null, basisBps: 0, fundingRate: 0, nextFundingTime: null };
    setLoading(true);
    setConnection('pending', 'データ取得中');
    const execKey = state.tf;
    try {
      const [exec, m15, h1, h4] = await Promise.all([
        fetchKlines(execKey, TF[execKey].limit),
        execKey === '15m' ? Promise.resolve(null) : fetchKlines('15m', TF['15m'].limit),
        execKey === '1h' ? Promise.resolve(null) : fetchKlines('1h', TF['1h'].limit),
        fetchKlines('4h', TF['4h'].limit),
      ]);
      state.data.exec = exec;
      state.data.m15 = m15 || exec;
      state.data.h1 = h1 || exec;
      state.data.h4 = h4;
      state.livePrice = exec.at(-1)?.close ?? null;
      await refreshMicroData();
      state.lastConfirmedClose = Core.filterClosedCandles(exec, currentTf().minutes, Date.now()).at(-1)?.close ?? null;
      analyzeAndRender();
      renderChart();
      setLoading(false);
      setConnection('live', '履歴取得済み');
      connectRealtime();
      clearInterval(state.microTimer);
      state.microTimer = setInterval(refreshMicroData, 10000);
    } catch (error) {
      console.error(error);
      setLoading(true, `データ取得失敗: ${error.message}。server.pyで起動してください。`);
      setConnection('error', '取得失敗');
    }
  }

  function analysisSettings(overrides = {}) {
    return {
      ...state.settings,
      spreadBps: Number.isFinite(state.micro.spreadBps) ? Math.max(state.settings.spreadBps, state.micro.spreadBps) : state.settings.spreadBps,
      executionMinutes: currentTf().minutes,
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
      state.analysis = Core.analyzeMarket({ ...state.data, micro: state.micro }, analysisSettings());
      const forming = state.data.exec.at(-1);
      const previewNow = forming ? forming.time + currentTf().minutes * 60_000 + 1500 : Date.now();
      state.preview = Core.analyzeMarket({ ...state.data, micro: state.micro }, analysisSettings({ now: previewNow, position: null }));
      renderAll();
    } catch (error) {
      console.error('Analysis error', error);
      setConnection('error', '分析エラー');
    }
  }

  async function refreshMicroData() {
    if (state.offlineCsv) return;
    const cfg = currentInstrument();
    const params = new URLSearchParams({ market: cfg.market, symbol: cfg.symbol });
    const tickerUrls = [
      `/api/ticker?${params}`,
      cfg.market === 'futures'
        ? `https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${cfg.symbol}`
        : `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${cfg.symbol}`
    ];
    let ticker = null;
    for (const url of tickerUrls) {
      try { ticker = await fetchJson(url, 7000); if (ticker) break; } catch { /* try next */ }
    }
    if (ticker) {
      const bid = Number(ticker.bidPrice), ask = Number(ticker.askPrice);
      const bidQty = Number(ticker.bidQty), askQty = Number(ticker.askQty);
      const mid = (bid + ask) / 2;
      state.micro.bid = bid; state.micro.ask = ask;
      state.micro.spreadBps = mid > 0 ? (ask - bid) / mid * 10000 : null;
      state.micro.bookImbalance = bidQty + askQty > 0 ? (bidQty - askQty) / (bidQty + askQty) : 0;
    }
    if (cfg.market === 'futures') {
      const premiumUrls = [
        `/api/premium-index?${params}`,
        `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${cfg.symbol}`
      ];
      for (const url of premiumUrls) {
        try {
          const p = await fetchJson(url, 7000);
          const mark = Number(p.markPrice), index = Number(p.indexPrice);
          state.micro.markPrice = mark; state.micro.indexPrice = index;
          state.micro.basisBps = index > 0 ? (mark - index) / index * 10000 : 0;
          state.micro.fundingRate = Number(p.lastFundingRate) || 0;
          state.micro.nextFundingTime = Number(p.nextFundingTime) || null;
          break;
        } catch { /* try next */ }
      }
    }
    if (state.analysis) analyzeAndRender();
  }

  function connectRealtime() {
    if (state.offlineCsv) return;
    const cfg = currentInstrument();
    const interval = currentTf().api;
    const base = cfg.market === 'futures' ? 'wss://fstream.binance.com/ws' : 'wss://stream.binance.com:9443/ws';
    const url = `${base}/${cfg.stream}@kline_${interval}`;
    try {
      const ws = new WebSocket(url);
      state.ws = ws;
      ws.onopen = () => {
        setConnection('live', 'リアルタイム');
        clearInterval(state.pollTimer);
      };
      ws.onmessage = event => {
        try {
          const payload = JSON.parse(event.data);
          const k = payload.k;
          if (!k) return;
          const candle = { time: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v) };
          upsertCandle(state.data.exec, candle);
          if (state.tf === '15m') upsertCandle(state.data.m15, candle);
          if (state.tf === '1h') upsertCandle(state.data.h1, candle);
          state.livePrice = candle.close;
          updateLiveHeader();
          updateLiveCandle(candle);
          analyzeAndRender();
          if (k.x) refreshHigherTimeframes();
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
  }

  function startPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = setInterval(async () => {
      try {
        const rows = await fetchKlines(state.tf, 4);
        for (const c of rows) upsertCandle(state.data.exec, c);
        state.livePrice = rows.at(-1)?.close ?? state.livePrice;
        analyzeAndRender();
        renderChart();
      } catch { setConnection('error', '再接続待ち'); }
    }, 15000);
  }

  async function refreshHigherTimeframes() {
    if (state.offlineCsv) return;
    try {
      const tasks = [];
      tasks.push(fetchKlines('15m', 260).then(v => { state.data.m15 = v; }));
      tasks.push(fetchKlines('1h', 300).then(v => { state.data.h1 = v; }));
      tasks.push(fetchKlines('4h', 300).then(v => { state.data.h4 = v; }));
      await Promise.all(tasks);
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

  function initChart() {
    if (state.chart || !window.LightweightCharts) return;
    const container = $('chartContainer');
    state.chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { color: '#0c1117' }, textColor: '#718096', fontFamily: 'JetBrains Mono' },
      grid: { vertLines: { color: '#141d27' }, horzLines: { color: '#141d27' } },
      rightPriceScale: { borderColor: '#263140', scaleMargins: { top: .08, bottom: .18 } },
      timeScale: { borderColor: '#263140', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8 },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { color: '#405166' }, horzLine: { color: '#405166' } },
      handleScroll: true,
      handleScale: true,
    });
    const cfg = currentInstrument();
    state.candleSeries = state.chart.addCandlestickSeries({
      upColor: cfg.up, downColor: cfg.down, borderVisible: false, wickUpColor: cfg.up, wickDownColor: cfg.down,
      priceFormat: { type: 'price', precision: cfg.digits, minMove: 1 / (10 ** cfg.digits) }
    });
    state.ema20Series = state.chart.addLineSeries({ color: '#e6b85c', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    state.ema50Series = state.chart.addLineSeries({ color: '#64a8ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    state.vwapSeries = state.chart.addLineSeries({ color: '#a58cff', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
    const observedChart = state.chart;
    const ro = new ResizeObserver(entries => {
      if (state.chart !== observedChart) return;
      const rect = entries[0].contentRect;
      observedChart.applyOptions({ width: rect.width, height: rect.height });
    });
    ro.observe(container);
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
    const candles = state.analysis.exec.candles;
    const visible = candles.slice(-500);
    const offset = candles.length - visible.length;
    state.candleSeries.setData(visible.map(c => ({ time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close })));
    state.ema20Series.setData(lineData(visible, state.analysis.exec.series.ema20.slice(offset)));
    state.ema50Series.setData(lineData(visible, state.analysis.exec.series.ema50.slice(offset)));
    state.vwapSeries.setData(lineData(visible, state.analysis.exec.series.vwap96.slice(offset)));

    const markers = [];
    for (const s of state.analysis.exec.swings.highs.slice(-12)) if (s.index >= offset) markers.push({ time: toChartTime(s.time), position: 'aboveBar', color: '#ff6b78', shape: 'arrowDown', text: 'SH' });
    for (const s of state.analysis.exec.swings.lows.slice(-12)) if (s.index >= offset) markers.push({ time: toChartTime(s.time), position: 'belowBar', color: '#43d49d', shape: 'arrowUp', text: 'SL' });
    markers.sort((a, b) => a.time - b.time);
    state.candleSeries.setMarkers(markers);

    for (const line of state.priceLines) state.candleSeries.removePriceLine(line);
    state.priceLines = [];
    if (state.analysis.plan) {
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
    state.chart.timeScale().fitContent();
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

  function stateLabel(stateName) { return stateName.replaceAll('_', ' '); }

  function renderDecision() {
    const a = state.analysis;
    const badge = $('signalBadge');
    badge.textContent = stateLabel(a.state);
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
    $('triggerState').textContent = trigger ? 'CONFIRMED' : 'WAIT';
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
    $('quantityValue').textContent = p?.quantity != null ? fmt(p.quantity, 4) : '—';
    $('riskBudgetValue').textContent = p?.riskBudget != null ? `¥${Math.round(p.riskBudget).toLocaleString('ja-JP')}` : '—';
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
    $('settingEquity').value = state.settings.accountEquity;
    $('settingRiskPct').value = state.settings.riskPct;
    $('settingFee').value = state.settings.feeBpsPerSide;
    $('settingSpread').value = state.settings.spreadBps;
    $('settingSlippage').value = state.settings.slippageBps;
    $('settingMinRR').value = state.settings.minNetRR;
    $('settingLeverage').value = state.settings.maxLeverage;
    $('settingBlackout').checked = Boolean(state.settings.blackout);
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

  function bindEvents() {
    qsa('.instrument-tab').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.instrument === state.instrumentId) return;
      state.instrumentId = button.dataset.instrument;
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
      localStorage.removeItem(POSITION_KEY);
      analyzeAndRender();
    });
    window.addEventListener('beforeunload', stopRealtime);
  }

  function destroyChart() {
    if (state.chart) state.chart.remove();
    state.chart = state.candleSeries = state.ema20Series = state.ema50Series = state.vwapSeries = null;
    state.priceLines = [];
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
    bindEvents();
    restorePositionInputs();
    startClock();
    loadAllData();
  }

  window.addEventListener('DOMContentLoaded', init);
})();
