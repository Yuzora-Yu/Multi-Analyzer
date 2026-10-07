const test=require('node:test'),assert=require('node:assert/strict');
const {scorecard,signature,stats}=require('../research-scorecard.cjs');
const {SPEC}=require('../research-forward.cjs');
function fixture(id='x',entryAt=100){
 const record={id,specId:SPEC.id,asset:'gold',market:'futures',symbol:'XAUUSDT',engineVersion:'v1',entryAt,
  codeHashes:Object.fromEntries(['strategy-core.js','flow-core.js','smc-core.js','market-feed.js'].map(k=>[k,'abc'])),
  snapshot:{settings:{market:'futures',now:50,position:null,feeBps:2}},prediction:{direction:'SHORT',pullbackConfirmed:false,exitLong:false,exitShort:false}};
 const row={id,asset:'gold',market:'futures',engineVersion:'v1',receipt:{prospectiveEligible:true},
  prediction:{direction:'LONG'},outcomes:[1,4,8,16].map(h=>({horizon:h,status:'resolved',returnBps:20,exitAt:entryAt+h,prospective:true,nonOverlapping:true}))};
 return {record,row};
}
test('versions, causal code and static settings are isolated while timestamps are not configurations',()=>{
 const x=fixture('a'),y=fixture('b');y.record.snapshot.settings.now=200;x.record.snapshot.settings.livePrice=100;y.record.snapshot.settings.livePrice=200;
 assert.deepEqual(signature(x.record),signature(y.record));
 y.record.codeHashes['flow-core.js']='changed';
 const r=scorecard([x.row,y.row],new Map([['a',x.record],['b',y.record]]),{asOf:1000});
 assert.equal(r.partitions.length,2);
 y.record.engineVersion='v2';y.row.engineVersion='v2';
 assert.equal(scorecard([x.row,y.row],new Map([['a',x.record],['b',y.record]]),{asOf:1000}).partitions.length,2);
});
test('pending/missing reservations remain visible, overlap and late persistence never enter means',()=>{
 const a=fixture('a'),b=fixture('b'),c=fixture('c'),d=fixture('d');
 b.row.outcomes.forEach(o=>o.status='missing');c.row.outcomes.forEach(o=>o.nonOverlapping=false);d.row.receipt.prospectiveEligible=false;
 const r=scorecard([a,b,c,d].map(x=>x.row),new Map([a,b,c,d].map(x=>[x.record.id,x.record])),{asOf:1000}).partitions[0];
 const h=r.horizons[8].all;
 assert.equal(r.prospectiveEligible,3);assert.equal(h.reservedWindows,2);assert.equal(h.overlapExcluded,1);assert.equal(h.statusCounts.missing,1);assert.equal(h.evaluable,1);
 assert.equal(h.costs[0].storedDirectionBenchmark.meanBps,-27); // frozen SHORT, not mutable row LONG.
 assert.equal(h.costs[2].longBenchmark.meanBps,-1);
});
test('EXIT flags never become reverse entries and overlapping groups are not summed',()=>{
 const a=fixture();a.record.prediction.exitLong=true;a.record.prediction.pullbackConfirmed=true;
 const h=scorecard([a.row],new Map([['x',a.record]]),{asOf:1000}).partitions[0].horizons[8];
 assert.equal(h.P.eligible,1);assert.equal(h.EXIT_LONG.eligible,1);assert.equal(h['no-sign'].eligible,0);
 assert.equal(h.EXIT_LONG.costs[0].storedDirectionBenchmark.meanBps,-27);
});
test('unavailable and post-cutoff outcomes cannot manufacture an estimate',()=>{
 const a=fixture();a.row.outcomes.forEach(o=>o.exitAt=2000);
 const report=scorecard([a.row],new Map([['x',a.record]]),{asOf:1000});
 assert.equal(report.partitions[0].horizons[8].all.evaluable,0);
 assert.equal(report.partitions[0].horizons[8].all.costs[0].longBenchmark.meanBps,null);
 delete a.record.codeHashes['smc-core.js'];assert.equal(scorecard([a.row],new Map([['x',a.record]])).issues[0].reason,'missing-causal-code-hashes');
 assert.equal(scorecard([a.row],new Map()).issues[0].reason,'missing-frozen-evidence');
});
test('drawdown follows chronological additive benchmark path and is not labelled account P&L',()=>{
 assert.deepEqual(stats([10,-15,5,-20]),{count:4,meanBps:-5,medianBps:-5,worstBps:-20,additivePathDrawdownBps:30});
 assert.equal(stats([]).additivePathDrawdownBps,null);
 const a=fixture('z',100),b=fixture('a',200),c=fixture('m',300);
 a.row.outcomes.forEach(o=>o.returnBps=-10);b.row.outcomes.forEach(o=>o.returnBps=20);c.row.outcomes.forEach(o=>o.returnBps=-5);
 const r=scorecard([b.row,c.row,a.row],new Map([a,b,c].map(x=>[x.record.id,x.record])),{asOf:1000});
 assert.equal(r.partitions[0].horizons[8].all.costs[0].storedDirectionBenchmark.additivePathDrawdownBps,29);
 assert.match(r.method.drawdown,/not an account-equity/);
});
