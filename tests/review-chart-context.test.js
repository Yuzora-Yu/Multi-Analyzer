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

function turnFixture(){
 const base=Date.UTC(2026,9,16,2),rows=Array.from({length:5},(_,i)=>({time:base+i*60000,open:100+i,high:102+i,low:99+i,close:101+i,volume:10}));
 const history=rows.map((b,i)=>({time:b.time,switched:[1,3,4].includes(i),direction:i===3?-1:1,rank:i===1?'B':i===3?'A':'S'}));
 return {asset:'gold',tf:'1m',minutes:1,cutoff:base+4*60000,capturedAt:base+4*60000,timeBasis:'latest-closed',rows,
  analysis:{candles:structuredClone(rows),flow:{history:[history[3],history[0],history[4],history[1],history[2]],latest:history[3]},values:{},quality:{}}};
}
test('review arrows retain the confirmed event rank and close time, excluding forming bars and mere direction state',()=>{
 const r=turnFixture(),before=JSON.stringify(r),turns=R.chartTurns(r);
 assert.deepEqual(turns,[{time:r.rows[1].time,closedAt:r.rows[2].time,direction:1,rank:'B'},{time:r.rows[3].time,closedAt:r.rows[4].time,direction:-1,rank:'A'}]);
 assert.equal(JSON.stringify(r),before);
 assert.deepEqual(R.chartTurns(r,[r.rows[3],r.rows[1]]),turns);
 r.rows=r.rows.slice(0,4);
 assert.match(R.facts(r).join('\n'),/最後の保持方向転換 下向き A \/ 確定 .*11:04:00 JST（新規Pとは別）/);
});
test('review arrows reject ambiguous candle/event identities, mismatched OHLCV and unknown confirmation',()=>{
 const base=turnFixture(),duplicate=structuredClone(base);duplicate.analysis.candles.push({...base.rows[1]});
 assert.deepEqual(R.chartTurns(duplicate).map(t=>t.direction),[-1]);
 const repeatedEvent=structuredClone(base);repeatedEvent.analysis.flow.history.push({...repeatedEvent.analysis.flow.history[0]});
 assert.deepEqual(R.chartTurns(repeatedEvent).map(t=>t.direction),[1]);
 assert.deepEqual(R.chartTurns(base,[base.rows[1],{...base.rows[1]}]),[]);
 assert.deepEqual(R.chartTurns(base,[{...base.rows[1],high:999}]),[]);
 assert.deepEqual(R.chartTurns(base,[{...base.rows[1],volume:999}]),[]);
 const unconfirmed=structuredClone(base);unconfirmed.analysis.flow.history.find(f=>f.time===base.rows[1].time).switched='true';
 assert.deepEqual(R.chartTurns(unconfirmed).map(t=>t.direction),[-1]);
 assert.deepEqual(R.chartTurns({...base,cutoff:NaN}),[]);assert.deepEqual(R.chartTurns({...base,minutes:0}),[]);
 const unknownRank=structuredClone(base);delete unknownRank.analysis.flow.history.find(f=>f.time===base.rows[1].time).rank;
 assert.equal(R.chartTurns(unknownRank)[0].rank,null);
});
