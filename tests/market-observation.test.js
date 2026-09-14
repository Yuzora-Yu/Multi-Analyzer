const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeTrades,quoteMetrics}=require('../market-observation.cjs');
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
