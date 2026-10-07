const test=require('node:test'),assert=require('node:assert/strict');
const {classify,indexSnapshots,linkOutcome,nonOverlapping,audit,gaps,gapCoverage}=require('../research-audit.cjs');
const STEP=900000;
function fixture(bar=0,received=STEP+30000,extra=[]){
 const id=`btc-${bar}-4.3.2`,snapshot={id,asset:'btc',version:'4.3.2',symbol:'BTCUSDT',createdAt:bar+STEP+20000,settings:{now:bar+STEP+1,market:'spot'},bars:{m15:[[bar,100,102,99,101,5],...extra]}};
 return {file:id+'.json',sha256:id,firstObservedAt:received,snapshot};
}
function sample(r){const s=r.snapshot,b=s.bars.m15.at(-1);return {id:s.id,asset:s.asset,version:s.version,market:s.settings.market,bar:b[0],close:b[4],asOf:s.settings.now,sourceCreatedAt:s.createdAt,firstObservedAt:r.firstObservedAt,state:'NO_TRADE',actionable:false};}
test('near-close receipt does not establish pre-entry prediction persistence; negative delay fails closed',()=>{
 const r=fixture(),s=sample(r),q=classify(s,r);assert.equal(q.observationClass,'near-close-receipt');assert.equal(q.prospectiveOriginalNextOpenEligible,false);assert.equal(q.historicalPredictionFrozenAt,null);
 const early=fixture(0,STEP-1);assert.equal(classify(sample(early),early).observationClass,'clock-inconsistent');
 assert.equal(classify({...s,market:'futures'},r).valid,false);assert.equal(classify({...s,close:999},r).valid,false);
});
test('outcomes retain exact source and distinguish pending, missing and conflicting historical prices',()=>{
 const r=fixture(STEP,2*STEP+30000),s=sample(fixture()),i=indexSnapshots([r]),bars=i.markets.get('btc/spot/BTCUSDT');
 const o=linkOutcome(s,bars,1,3*STEP);assert.equal(o.status,'resolved');assert.equal(o.entry,100);assert.equal(o.sources[0].snapshotId,r.snapshot.id);assert.equal(o.sources[0].sha256,r.sha256);assert.equal(o.prospective,false);
 assert.equal(linkOutcome(s,bars,4,3*STEP).status,'pending');assert.equal(linkOutcome(s,bars,4,6*STEP).status,'missing');
 const later=fixture(2*STEP,3*STEP+30000);later.snapshot.bars.m15.unshift([STEP,100,104,99,103,5]);
 assert.equal(linkOutcome(s,indexSnapshots([r,later]).markets.get('btc/spot/BTCUSDT'),1,4*STEP).status,'conflicting-price');
});
test('future receipts cannot resolve an earlier as-of evaluation; duplicate samples are counted once',()=>{
 const r=fixture(),future=fixture(STEP,4*STEP),s=sample(r);
 const out=audit([r,future],[s,s],{asOf:3*STEP});assert.equal(out.rows.length,1);assert.equal(out.rows[0].outcomes[0].status,'missing');assert.equal(out.issues[0].type,'duplicate-sample');
});
test('overlap selection reserves unresolved windows and separates markets',()=>{
 const rows=[0,STEP,2*STEP,4*STEP].map(t=>sample(fixture(t,t+STEP+30000)));
 const gold={...rows[1],asset:'gold',market:'futures',id:'gold-test'};
 assert.deepEqual(nonOverlapping([...rows,gold],4),[rows[0].id,gold.id,rows[3].id]);
 assert.deepEqual(gaps([0,STEP,STEP,4*STEP]),[{from:2*STEP,to:3*STEP,count:2}]);
});
test('invalid OHLC and market identity never enter the price index',()=>{
 const r=fixture();r.snapshot.bars.m15[0][2]=90;
 assert.equal(indexSnapshots([r]).markets.get('btc/spot/BTCUSDT').size,0);
 r.snapshot.symbol='XAUUSDT';assert.equal(indexSnapshots([r]).markets.size,0);
});
test('audit distinguishes GOLD collection pause from absent tradable bars without changing outcome horizons',()=>{
 const fridayOpen=Date.parse('2026-10-02T20:00:00Z'); // NY16:00, JST Saturday05:00.
 const intervals=[{from:fridayOpen,to:fridayOpen+STEP,count:2}];
 const observation=gapCoverage(intervals,'gold'),bars=gapCoverage(intervals,'gold','outcome-bars');
 assert.equal(observation.scheduledExcludedSlots,2);assert.equal(observation.expectedMissingSlots,0);
 assert.equal(bars.expectedMissingSlots,2);assert.equal(bars.scheduledExcludedSlots,0);
 const closed=gapCoverage([{from:fridayOpen+3600000,to:fridayOpen+3600000,count:1}],'gold','outcome-bars');
 assert.equal(closed.scheduledExcludedSlots,1);
 assert.equal(gapCoverage(intervals,'btc').expectedMissingSlots,2);
 assert.match(observation.interpretation,/not evidence of the historical collector policy/);
 assert.match(observation.interpretation,/outcome windows remain unchanged/);
 const winter=Date.parse('2026-11-06T21:00:00Z'); // NY16:00 after DST ends.
 assert.equal(gapCoverage([{from:winter,to:winter,count:1}],'gold','outcome-bars').expectedMissingSlots,1);
 assert.equal(gapCoverage([],'gold').totalAbsentSlots,0);
});
