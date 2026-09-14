const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeTrades,quoteMetrics}=require('../market-observation.cjs');
const {sampleQuality}=require('../market-observation.cjs');
test('research coverage stays incomplete for dense, old, empty and clock-skewed samples',()=>{
 const timing={requestedAt:2000,receivedAt:2100,serverTime:2050};
 const dense=sampleQuality({count:60,start:1907,end:2000},timing);
 assert.equal(dense.observedSpanMs,93);assert.equal(dense.availableAt,2100);
 assert.equal(dense.lastTradeAgeAtReceiptMs,100);assert.equal(dense.lastTradeAgeAtServerMs,50);
 assert.equal(dense.fullCandleCoverage,false);assert.equal(dense.comparableAcrossAssets,false);
 assert.equal(sampleQuality({count:1000,start:1,end:1900},timing).continuousOrderFlow,false);
 assert.equal(sampleQuality({count:0,start:null,end:null},timing).observedSpanMs,null);
 assert.equal(sampleQuality({count:1,start:2200,end:2200},timing).futureTradeTimestamp,true);
 assert.equal(sampleQuality({count:1,start:1900,end:1900},{...timing,serverTime:null}).lastTradeAgeAtServerMs,null);
});
test('trade research rejects duplicates, unknown sides, wrong markets and invalid amounts',()=>{
 const r={execId:'a',symbol:'BTCUSDT',price:'100',size:'2',time:'1000',side:'Buy'};
 const result=summarizeTrades([r,r,{...r,execId:'b',side:'Sell',size:'1',time:'2000'},{...r,execId:'c',side:'Unknown'},{...r,execId:'d',symbol:'XAUUSDT'},{...r,execId:'e',price:'Infinity'}],'BTCUSDT');
 assert.equal(result.count,2);assert.equal(result.buyNotionalUSDT,200);assert.equal(result.sellNotionalUSDT,100);assert.equal(result.imbalance,1/3);assert.equal(result.durationSeconds,1);
 assert.equal(summarizeTrades([],'BTCUSDT').imbalance,null);
});
test('missing quote fields remain unknown and crossed book is not a zero-cost quote',()=>{
 const q=quoteMetrics({bid1Price:'100',ask1Price:'101',fundingRate:''});assert.ok(q.spreadBps>99);assert.equal(q.fundingRate,null);
 assert.equal(quoteMetrics({bid1Price:'102',ask1Price:'101'}).spreadBps,null);assert.equal(quoteMetrics({}).spreadBps,null);
});
