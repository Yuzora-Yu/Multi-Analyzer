const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const V=require('../research-touch-holdout.cjs'),H=require('../research-touch-confirmation.cjs'),STEP=900000;
const registration={registeredAt:V.SPEC.start-86400000*3};
const candidate=t=>({originClosedAt:t,from:t+STEP});
test('calendar partition purges full outcome windows and conservative clock boundaries',()=>{
 const s=V.SPEC.start,e=V.SPEC.end;
 assert.equal(V.classify(candidate(registration.registeredAt),0,registration),'before-registration');
 assert.equal(V.classify(candidate(s-V.SPEC.embargoMs-17*STEP),0,registration),'development');
 assert.equal(V.classify(candidate(s-V.SPEC.embargoMs-16*STEP),0,registration),'embargo-or-start-boundary');
 assert.equal(V.classify(candidate(s),0,registration),'embargo-or-start-boundary');
 assert.equal(V.classify(candidate(s+STEP),STEP,registration),'embargo-or-start-boundary');
 assert.equal(V.classify(candidate(s+STEP),-1000,registration),'validation');
 assert.equal(V.classify(candidate(e-17*STEP),0,registration),'validation');
 assert.equal(V.classify(candidate(e-16*STEP),0,registration),'end-boundary');
 assert.equal(V.classify(candidate(e),0,registration),'after-holdout');
 assert.throws(()=>V.classify(candidate(s+STEP),NaN,registration));
 assert.throws(()=>V.classify({originClosedAt:s,from:s},0,registration));
});
function fixture(asOf){
 const c={...candidate(V.SPEC.start+STEP),id:'p',sourceId:'source',primary:true,identity:{asset:'gold',market:'futures',codeHash:'frozen'},zone:{direction:'SHORT'},flags:{noSign:true}};
 const arms=H.SPEC.arms.map(arm=>({arm,status:'no-trigger'})),o={forecast:c,repeatedZoneKey:'z',eligible:true,outcomes:[{until:c.from+16*STEP,nonOverlapping:true}],coverage:{receiptComplete:true,classified:{receipted:16}},arms:[arms[0]]};
 const r={id:'p',identity:c.identity,repeatedZoneKey:'z',postRegistration:true,originalEligible:true,nonOverlapping:true,coverage:o.coverage.classified,eligible:true,status:'evaluated',arms};
 return {cohort:{asOf,controls:[],rows:[o]},report:{asOf,registration:{registeredAt:registration.registeredAt,spec:H.SPEC},controls:[],rows:[r]},sources:new Map([['source',{clockBounds:{upperOffsetMs:0}}]])};
}
test('statistics remain withheld until fixed end; release preserves complete no-trade denominator',()=>{
 const f=fixture(V.SPEC.end-1),before=JSON.stringify(f);const p=V.partition(f.report,f.cohort,f.sources,registration);assert.equal(p.released,false);assert.equal(p.statistics,null);assert.equal(p.validationEvaluated,1);assert.equal(JSON.stringify(f),before);
 f.report.asOf=f.cohort.asOf=V.SPEC.end;const q=V.partition(f.report,f.cohort,f.sources,registration);assert.equal(q.released,true);assert.equal(q.statistics.partitions[0].costs[0].arms[0].perEligibleWindow.meanBps,0);assert.equal(q.sampleReviews[0].minimumCountMet,false);assert.equal(q.adoptionApproved,false);
});
test('excluded or missing windows do not become validation returns and population tampering fails',()=>{
 const f=fixture(V.SPEC.end);f.cohort.rows[0].eligible=false;f.report.rows[0].originalEligible=false;f.report.rows[0].eligible=false;f.report.rows[0].status='pending-or-ineligible';delete f.report.rows[0].arms;
 const q=V.partition(f.report,f.cohort,f.sources,registration);assert.equal(q.validationEvaluated,0);assert.equal(q.statistics.partitions[0].costs[0].arms[0].perEligibleWindow.meanBps,null);
 f.sources.clear();assert.throws(()=>V.partition(f.report,f.cohort,f.sources,registration),/Missing original/);
 f.report.rows=[];assert.throws(()=>V.partition(f.report,f.cohort,f.sources,registration),/population/);
});
test('preregistration freezes calendar, code and hypothesis; late or implicit registration fails',()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'touch-holdout-')),root=path.join(base,'holdout'),h=path.join(base,'hypothesis');
 try{assert.throws(()=>V.register(root,h,registration.registeredAt),/Existing/);H.register(h,registration.registeredAt-1);assert.throws(()=>V.register(root,h,V.SPEC.start-V.SPEC.embargoMs),/before embargo/);const r=V.register(root,h,registration.registeredAt);assert.deepEqual(V.register(root,h,V.SPEC.end),r);const changed=structuredClone(r);changed.spec.end++;fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify(changed));assert.throws(()=>V.register(root,h,registration.registeredAt),/Changed/);}
 finally{assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(base,{recursive:true,force:true});}
});
