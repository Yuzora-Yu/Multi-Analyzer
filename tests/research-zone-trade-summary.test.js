const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../research-zone-trade-summary.cjs'),T=require('../research-zone-trades.cjs');
const STEP=900000,identity={asset:'gold',market:'futures',symbol:'XAUUSDT',engineVersion:'4.3.4',codeHash:'c',configurationHash:'q'};
function fixture(){
 const zones={asOf:STEP*100,rows:[]},report={asOf:zones.asOf,registration:{spec:T.SPEC},rows:[]};
 for(let i=0;i<3;i++){const from=(1+i*16)*STEP,id='z'+i,c={id,from,primary:true,identity:{...identity},zone:{direction:'LONG'},eligibility:{eligible:true}};
  zones.rows.push({forecast:c,outcomes:[{horizon:16,until:from+16*STEP,status:'resolved',nonOverlapping:true}]});
  const close=(arm,exit)=>{const grossBps=(exit/100-1)*10000;return {arm,status:'closed',entry:100,stop:99,target:103,entryAt:from,exitAt:from+STEP,exit,grossBps,costs:T.SPEC.costBps.map(costBps=>({costBps,assumedNetBps:grossBps-costBps}))};};
  report.rows.push({id,identity:{...identity},postRegistration:true,eligible:true,status:'evaluated',arms:[close(T.SPEC.arms[0],i===0?101:99),i===0?close(T.SPEC.arms[1],100.5):{arm:T.SPEC.arms[1],status:i===1?'no-trigger':'no-fill'}]});
 }
 return {report,zones};
}
test('per-window denominator retains no trades, per-trade average remains separate',()=>{
 const {report,zones}=fixture(),r=S.summarize(report,zones),c=r.partitions[0].costs[0],confirmation=c.arms[1];
 assert.equal(confirmation.perEligibleWindow.count,3);assert.equal(confirmation.perExecutedHypotheticalTrade.count,1);
 assert.equal(confirmation.perEligibleWindow.meanBps,confirmation.perExecutedHypotheticalTrade.meanBps/3);
 assert.deepEqual(confirmation.statusCounts,{closed:1,'no-trigger':1,cancelled:0,'no-fill':1});
 assert.equal(c.pairedConfirmationMinusTouch.count,3);
});
test('drawdown includes initial loss and trade loss streak does not reset on unexecuted windows',()=>{
 assert.deepEqual(S.stats([-4,-3,5,-2]).additiveDrawdownBps,7);assert.equal(S.stats([-4,-3,5,-2]).maxConsecutiveNegative,2);
 const {report,zones}=fixture();report.rows[1].arms[0]={arm:T.SPEC.arms[0],status:'cancelled'};
 const trade=S.summarize(report,zones).partitions[0].costs[0].arms[0].perExecutedHypotheticalTrade;assert.equal(trade.count,2);assert.equal(trade.negative,1);
});
test('cost sensitivity charges executed trades only; paired no-trade windows remain zero',()=>{
 const {report,zones}=fixture(),costs=S.summarize(report,zones).partitions[0].costs;
 assert.equal(costs[0].arms[1].perEligibleWindow.sumBps-costs[2].arms[1].perEligibleWindow.sumBps,14);
 assert.equal(costs[0].arms[0].perEligibleWindow.sumBps-costs[2].arms[0].perEligibleWindow.sumBps,42);
 assert.equal(S.stats([]).meanBps,null);assert.equal(S.stats([]).additiveDrawdownBps,null);
});
test('exclusions never become zero-return opportunities and missing arms fail',()=>{
 const {report,zones}=fixture();report.rows[2]={...report.rows[2],eligible:false,postRegistration:false,status:'excluded-before-registration'};delete report.rows[2].arms;
 assert.equal(S.summarize(report,zones).partitions[0].evaluated,2);
 delete report.rows[0].arms;assert.throws(()=>S.summarize(report,zones),/paired arm/);
});
test('drop/duplicate populations, altered identity and invented costs are rejected',()=>{
 for(const change of [r=>r.rows.pop(),r=>r.rows.push(r.rows[0]),r=>r.rows[0].identity.market='spot',r=>r.rows[0].arms[0].costs[0].assumedNetBps=1000]){
  const {report,zones}=fixture();change(report);assert.throws(()=>S.summarize(report,zones));
 }
});
test('chronological source ordering is stable and physical markets are never pooled',()=>{
 const {report,zones}=fixture(),before=JSON.stringify({report,zones});
 const a=S.summarize(report,zones);assert.equal(JSON.stringify({report,zones}),before);report.rows.reverse();assert.deepEqual(S.summarize(report,zones),a);
 report.rows[0].identity={...identity,asset:'btc',market:'spot',symbol:'BTCUSDT'};zones.rows[2].forecast.identity={...report.rows[0].identity};
 const r=S.summarize(report,zones);assert.equal(r.partitions.length,2);assert.equal(r.partitions.reduce((s,p)=>s+p.evaluated,0),3);
});
