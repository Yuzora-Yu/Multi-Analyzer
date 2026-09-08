'use strict';
importScripts('smc-core.js', 'strategy-core.js');
self.onmessage = event => {
  try {
    const result = self.MultiAnalyzerCore.backtest(event.data.data, event.data.settings);
    self.postMessage({ result: { ...result, trades: undefined } });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
