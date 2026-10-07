const test=require('node:test'),assert=require('node:assert/strict');
const Gates=require('../research-zone-gates.cjs'),Trades=require('../research-zone-trades.cjs');
function fixture(){
 const identity={asset:'gold',market:'futures',symbol:'XAUUSDT',codeHash:'a',configurationHash:'b'},c={id:'a/z',sourceId:'a',primary:true,identity,from:900000,eligibility:{eligible:true,issues:[]}};
 const outcome={horizon:16,from:c.from,until:c.from+16*900000,status:'pending',nonOverlapping:true};
 return {trades:{asOf:4500000,registration:{spec:Trades.SPEC},rows:[{id:c.id,identity,postRegistration:false,eligible:false,status:'excluded-before-registration'}]},zones:{asOf:4500000,rows:[{forecast:c,outcomes:[outcome]}]},availability:{asOf:4500000,rows:[{id:c.id,sourceId:c.sourceId,primary:true,physical:'gold/futures/XAUUSDT',windows:[{...outcome,reportedStatus:'pending',receiptComplete:false,summaryGate:'pending-or-unverified',classified:{receipted:3,'not-closed':12,missing:1,conflicting:0,'declared-only':0},nextScheduledClose:5400000}]}]}};
}
const run=f=>Gates.diagnose(f.trades,f.zones,f.availability);
test('gate diagnostics preserve simultaneous blockers without changing originals',()=>{
 const f=fixture(),before=JSON.stringify(f),r=run(f);assert.deepEqual(r.rows[0].blockers,['postRegistration','priceOutcomeResolved','receiptComplete']);assert.equal(r.rows[0].registrationExcludedPermanently,true);assert.equal(r.rows[0].canBecomeEligibleWithPricesOnly,false);assert.equal(r.partitions[0].eligible,0);assert.equal(JSON.stringify(f),before);
});
test('future receipt completion cannot rehabilitate a registration-excluded forecast',()=>{
 const f=fixture(),o=f.zones.rows[0].outcomes[0],w=f.availability.rows[0].windows[0];o.status='resolved';w.reportedStatus='resolved';w.receiptComplete=true;w.summaryGate='availability-only-verified';w.classified={receipted:16,'not-closed':0,missing:0,conflicting:0,'declared-only':0};assert.throws(()=>run(f),/Future window/);f.trades.asOf=f.zones.asOf=f.availability.asOf=o.until;assert.deepEqual(run(f).rows[0].blockers,['postRegistration']);
 f.trades.rows[0].postRegistration=true;f.trades.rows[0].eligible=true;f.trades.rows[0].status='evaluated';assert.equal(run(f).rows[0].eligible,true);
});
test('omitted, duplicated, changed market or mismatched evidence is rejected',()=>{
 for(const mutate of [f=>f.trades.rows=[],f=>f.trades.rows.push({...f.trades.rows[0]}),f=>f.availability.rows[0].physical='gold/spot/XAUUSDT',f=>f.availability.asOf++,f=>f.availability.rows[0].windows[0].classified.receipted++,f=>f.trades.rows[0].eligible=true]){const f=fixture();mutate(f);assert.throws(()=>run(f));}
});
test('source and overlap exclusions cannot be disguised as a price-only wait',()=>{
 const f=fixture();f.trades.rows[0].postRegistration=true;f.trades.rows[0].status='pending-or-ineligible';assert.equal(run(f).rows[0].canBecomeEligibleWithPricesOnly,true);
 f.zones.rows[0].forecast.eligibility={eligible:false,issues:['observation-not-fresh']};f.zones.rows[0].outcomes[0].nonOverlapping=false;const r=run(f);assert.equal(r.rows[0].canBecomeEligibleWithPricesOnly,false);assert.deepEqual(r.rows[0].sourceIssues,['observation-not-fresh']);assert.equal(r.partitions[0].blockerCounts.nonOverlapping,1);
});
