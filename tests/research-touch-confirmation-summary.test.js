const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../research-touch-confirmation-summary.cjs'),H=require('../research-touch-confirmation.cjs'),STEP=900000;
function fixture(){
 const from=STEP*10,until=from+STEP*16,c={id:'a',primary:true,from,zone:{direction:'LONG'},identity:{asset:'btc',market:'spot',codeHash:'frozen'},flags:{noSign:true}};
 const arm=(name,exit)=>({arm:name,status:'closed',entry:100,exit,entryAt:from+STEP*2,exitAt:from+STEP*3,grossBps:(exit/100-1)*10000,costs:[7,14,21].map(costBps=>({costBps,assumedNetBps:(exit/100-1)*10000-costBps})),...(name===H.SPEC.arms[1]?{confirmationReference:{price:102,barOpenAt:from,knownAt:from+STEP}}:{})});
 const strict=arm(H.SPEC.arms[0],99),early=arm(H.SPEC.arms[1],101),original={forecast:c,repeatedZoneKey:'same',eligible:true,outcomes:[{until,nonOverlapping:true}],coverage:{receiptComplete:true,classified:{receipted:16}},arms:[strict]},cohort={asOf:until,controls:[],rows:[original]},r={id:c.id,identity:c.identity,repeatedZoneKey:'same',postRegistration:true,originalEligible:true,nonOverlapping:true,coverage:original.coverage.classified,eligible:true,status:'evaluated',arms:[strict,early]},report={asOf:until,registration:{registeredAt:1,spec:H.SPEC},controls:[],rows:[r]};return {report,cohort};
}
test('paired costs use the same windows, preserving input and executed denominators',()=>{
 const {report,cohort}=fixture(),before=JSON.stringify({report,cohort}),s=S.summarize(report,cohort).partitions[0].costs[0];assert.equal(s.arms[0].perEligibleWindow.count,1);assert.equal(s.arms[1].perExecutedHypotheticalTrade.count,1);assert.ok(Math.abs(s.pairedTouchExtremeMinusSourceSwing.meanBps-200)<1e-8);assert.equal(JSON.stringify({report,cohort}),before);
 report.rows[0].arms[1]={arm:H.SPEC.arms[1],status:'no-fill'};const nofill=S.summarize(report,cohort).partitions[0].costs[0].arms[1];assert.equal(nofill.perEligibleWindow.meanBps,0);assert.equal(nofill.perExecutedHypotheticalTrade.meanBps,null);
});
test('missing, pending and pre-registration cases are not zero outcomes',()=>{
 const {report,cohort}=fixture();cohort.rows[0].eligible=false;cohort.rows[0].coverage={receiptComplete:false,classified:{receipted:15,missing:1}};report.rows[0]={...report.rows[0],coverage:cohort.rows[0].coverage.classified,originalEligible:false,eligible:false,status:'pending-or-ineligible'};delete report.rows[0].arms;
 const p=S.summarize(report,cohort).partitions[0];assert.equal(p.pendingOrIneligible,1);assert.equal(p.costs[0].arms[0].perEligibleWindow.meanBps,null);assert.equal(p.costs[0].pairedTouchExtremeMinusSourceSwing.additiveDrawdownBps,null);
 report.rows[0].postRegistration=false;report.rows[0].status='excluded-before-registration';assert.equal(S.summarize(report,cohort).partitions[0].excludedBeforeRegistration,1);
});
test('population, cost, execution time, reference timing and baseline tampering are rejected',()=>{
 for(const mutate of [r=>r.rows.push(r.rows[0]),r=>r.rows[0].identity={asset:'gold'},r=>r.rows[0].arms[1].costs[0].assumedNetBps=1,r=>r.rows[0].arms[1].entryAt=0,r=>r.rows[0].arms[1].confirmationReference.knownAt=r.rows[0].arms[1].entryAt,r=>r.rows[0].arms[0]={arm:H.SPEC.arms[0],status:'no-trigger'}]){const {report,cohort}=fixture(),cloned=structuredClone(report);mutate(cloned);assert.throws(()=>S.summarize(cloned,cohort));}
});
test('market and repeated-zone counts remain separate and losses start drawdown at zero',()=>{
 const {report,cohort}=fixture(),btcOriginal=structuredClone(cohort.rows[0]),btcRow=structuredClone(report.rows[0]);btcOriginal.forecast.id='b';btcOriginal.forecast.from+=STEP*16;btcOriginal.outcomes[0].until+=STEP*16;btcRow.id='b';for(const a of btcRow.arms){a.entryAt+=STEP*16;a.exitAt+=STEP*16;if(a.confirmationReference){a.confirmationReference.barOpenAt+=STEP*16;a.confirmationReference.knownAt+=STEP*16;}}btcOriginal.arms[0]=btcRow.arms[0];report.rows.push(btcRow);cohort.rows.push(btcOriginal);report.asOf+=STEP*16;cohort.asOf=report.asOf;
 const p=S.summarize(report,cohort).partitions[0];assert.equal(p.uniqueEvaluatedZoneKeys,1);assert.equal(p.repeatedEvaluatedWindows,1);assert.equal(p.costs[0].arms[0].perEligibleWindow.maxConsecutiveNegative,2);assert.ok(p.costs[0].arms[0].perEligibleWindow.additiveDrawdownBps>200);
 const goldOriginal=structuredClone(btcOriginal),goldRow=structuredClone(btcRow);goldOriginal.forecast.id='g';goldRow.id='g';goldRow.identity=goldOriginal.forecast.identity={asset:'gold',market:'futures',codeHash:'frozen'};report.rows.push(goldRow);cohort.rows.push(goldOriginal);assert.equal(S.summarize(report,cohort).partitions.length,2);
});
