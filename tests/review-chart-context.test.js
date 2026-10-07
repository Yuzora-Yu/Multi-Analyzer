const test=require('node:test'),assert=require('node:assert/strict'),R=require('../review-pack'),Core=require('../strategy-core');
test('review context maps existing engine series by confirmed candle identity, never by raw row offset',()=>{
 const base=Date.UTC(2026,9,7),candles=Array.from({length:65},(_,i)=>({time:base+900000*i,open:100+i,high:102+i,low:99+i,close:101+i,volume:10})),cutoff=base+65*900000,analysis=Core.analyzeTimeframe(candles,15,cutoff,'btc'),r={rows:candles,analysis,minutes:15,cutoff},before=JSON.stringify(r);
 const displayed=[candles[19],{...candles[20],time:123},candles[64]],lines=R.chartContextSeries(r,displayed);
 for(const s of lines){const original=s.label==='EMA20'?analysis.series.ema20:s.label==='EMA50'?analysis.series.ema50:analysis.series.bb[s.label==='BB上限'?'upper':s.label==='BB中央'?'mid':'lower'];assert.deepEqual(s.values,[original[19],null,original[64]]);}
 assert.equal(JSON.stringify(r),before);assert.equal(R.chartContextSeries(r,[candles[0]])[2].values[0],null);
 const forming=structuredClone(r);forming.cutoff=candles[64].time;assert.ok(R.chartContextSeries(forming,[candles[64]]).every(s=>s.values[0]===null));
 const duplicate=structuredClone(r);duplicate.analysis.candles.push({...candles[64]});assert.ok(R.chartContextSeries(duplicate,[candles[64]]).every(s=>s.values[0]===null));
 assert.ok(R.chartContextSeries({...r,analysis:{}},displayed).every(s=>s.values.every(v=>v===null)));
});
