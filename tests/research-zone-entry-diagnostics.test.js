'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('../research-zone-entry-diagnostics.cjs'),T=require('../research-zone-trades.cjs'),W=require('../research-zone-windows.cjs');
const STEP=900000,candidate=()=>({from:STEP,pivot:104,zone:{direction:'LONG',low:100,high:102,protectiveStop:98,invalidationClose:99,targets:[112,120]}});
const bars=(overrides={})=>Array.from({length:16},(_,i)=>({time:(i+1)*STEP,open:101,high:103,low:100,close:101,...overrides[i]}));
const explain=(c,b,arm=T.SPEC.arms[0])=>D.explain(c,b,arm,T.simulate(c,b,arm));
test('no-fill causes distinguish insufficient RR, target gap, stop gap and absent original target',()=>{
 const cases=[
  {b:bars({1:{open:105,high:106,low:104,close:105}}),code:'gross-rr-below-required',rr:1},
  {b:bars({1:{open:114,high:115,low:113,close:114}}),code:'target-passed-at-next-open',rr:-0.125},
  {b:bars({1:{open:97,high:98,low:96,close:97}}),code:'stop-side-gap',rr:null},
  {b:bars(),code:'no-forward-target-at-trigger',rr:null,targets:[99,100]}
 ];
 for(const x of cases){const c=candidate();if(x.targets)c.zone.targets=x.targets;const d=explain(c,x.b);assert.equal(d.originalReason,'gap-or-target-or-RR');assert.deepEqual(d.entryCheck.blockers.map(x=>x.code),[x.code]);assert.equal(d.entryCheck.grossRR,x.rr);assert.equal(d.executedHypothetically,false);assert.equal(d.entryCheck.targetFixedAt,STEP*2);}
});
test('target remains fixed at trigger close; later price path cannot replace target or rescue RR',()=>{
 const c=candidate(),b=bars({1:{open:105,high:106,low:104,close:105}}),before=JSON.stringify({c,b}),first=explain(c,b);
 assert.equal(first.entryCheck.fixedTarget,112);assert.equal(first.entryCheck.originalMinimumGrossRR,1.8);
 const later=structuredClone(b);for(let i=2;i<later.length;i++)Object.assign(later[i],{open:150,high:200,low:90,close:180});
 assert.deepEqual(explain(c,later),first);assert.equal(JSON.stringify({c,b}),before);
});
test('confirmation requires prior touch and later original swing close, with next-open check separately timed',()=>{
 const c=candidate(),b=bars({0:{high:107,close:106},1:{open:102,high:106,low:101,close:105},2:{open:105,high:106,low:104,close:105}});
 const d=explain(c,b,T.SPEC.arms[1]);assert.equal(d.firstTouch.barOpenAt,STEP);assert.equal(d.trigger.barOpenAt,STEP*2);assert.equal(d.trigger.barClosedAt,STEP*3);assert.equal(d.entryCheck.plannedEntryAt,STEP*3);assert.equal(d.entryCheck.grossRR,1);
 const onlyTouch=bars(Object.fromEntries(Array.from({length:16},(_,i)=>[i,{open:106,high:107,low:105,close:106}])));Object.assign(onlyTouch[15],{open:101,low:100,close:106});
 assert.equal(explain(c,onlyTouch,T.SPEC.arms[1]).status,'no-trigger');assert.equal(explain(c,onlyTouch).messageJa,'最終足で条件成立したが、元の評価期間内に次の始値がない');
});
test('pre-entry cancellation identifies first observed bar and stop takes precedence over invalidation',()=>{
 const c=candidate(),b=bars({1:{open:100,high:101,low:97,close:98}}),d=explain(c,b,T.SPEC.arms[1]);
 assert.equal(d.cancellation.reason,'pre-entry-stop');assert.equal(d.cancellation.barOpenAt,STEP*2);assert.equal(d.cancellation.barClosedAt,STEP*3);assert.equal(d.executedHypothetically,false);assert.equal(d.entryCheck,undefined);
 const invalid=explain(c,bars({1:{open:100,high:101,low:98.5,close:98.8}}),T.SPEC.arms[1]);assert.equal(invalid.cancellation.reason,'pre-entry-invalidation');
});
test('mirrored short reasons match and changed saved execution is rejected before explanation',()=>{
 const c=candidate(),b=bars({1:{open:105,high:106,low:104,close:105}}),long=explain(c,b),s={from:STEP,pivot:96,zone:{direction:'SHORT',low:98,high:100,protectiveStop:102,invalidationClose:101,targets:[88,80]}},sb=b.map(x=>({...x,open:200-x.open,high:200-x.low,low:200-x.high,close:200-x.close})),short=explain(s,sb);
 assert.equal(short.entryCheck.grossRR,long.entryCheck.grossRR);assert.deepEqual(short.entryCheck.blockers,long.entryCheck.blockers);
 const forged=T.simulate(c,b,T.SPEC.arms[0]);forged.status='closed';assert.throws(()=>D.explain(c,b,T.SPEC.arms[0],forged),/Frozen execution replay differs/);
});
test('eligible hypothetical stop is retained; excluded windows and future receipts never become simulated zero returns',()=>{
 const c={...candidate(),id:'s1/z',sourceId:'s1',rank:0,primary:true,identity:{asset:'gold',market:'futures',symbol:'XAUUSDT'},eligibility:{eligible:true,issues:[]},flags:{noSign:true}},b=bars({2:{open:95,high:97,low:94,close:96}});
 c.zone.id='z';const second={...structuredClone(c),id:'s2/z',sourceId:'s2',from:STEP*17,eligibility:{eligible:false,issues:['late']}};
 const rows=[{forecast:c,repeatedZoneKey:'gold/futures/XAUUSDT/z',outcomes:[{horizon:16,from:STEP,until:STEP*17,status:'resolved',nonOverlapping:true}],coverage:{receiptComplete:true},eligible:true,arms:T.SPEC.arms.map(arm=>T.simulate(c,b,arm))},
 {forecast:second,repeatedZoneKey:'gold/futures/XAUUSDT/z',outcomes:[{horizon:16,from:STEP*17,until:STEP*33,status:'missing',nonOverlapping:true}],coverage:{receiptComplete:false},eligible:false}];
 const report={registration:{spec:W.SPEC},asOf:STEP*40,rows},index={markets:new Map([['gold/futures/XAUUSDT',new Map(b.map(bar=>[bar.time,{bar,conflict:false,source:{firstObservedAt:STEP*35,snapshotId:'receipt',file:'original',sha256:'hash'}}]))]])},before=JSON.stringify(report),out=D.describe(report,index);
 assert.equal(out[0].arms[0].original.reason,'fixed-stop');assert.equal(out[0].arms[0].original.exit,95);assert.equal(out[0].arms[0].diagnostic.entryCheck.blockers.length,0);
 assert.equal(out[1].arms,undefined);assert.equal(out[1].outcomeEvidence,undefined);assert.equal(out[0].outcomeEvidence[0].source.firstObservedAt,STEP*35);assert.equal(JSON.stringify(report),before);
 index.markets.get('gold/futures/XAUUSDT').get(STEP).source.firstObservedAt=report.asOf+1;assert.throws(()=>D.describe(report,index),/future outcome receipt/);
});
test('offline report writes separate evidence and rejects changed originals before creating output',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'entry-diagnostics-')),root=path.join(base,'study'),output=path.join(base,'diagnostics');t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 fs.mkdirSync(path.join(base,'research-forward/predictions'),{recursive:true});W.register(root,Date.now()-1);const original=W.run({base,root}),reportFile=path.join(original.directory,'report.json'),bytes=fs.readFileSync(reportFile);
 const proof=D.run(original.directory,output),r=JSON.parse(fs.readFileSync(proof.file));assert.equal(r.evidence.replayMatched,true);assert.equal(r.collectorExecuted,false);assert.equal(r.productionChanged,false);assert.equal(r.accuracyProven,false);assert.deepEqual(r.rows,[]);assert.deepEqual(fs.readFileSync(reportFile),bytes);
 const forged=JSON.parse(bytes);forged.controls.push({id:'invented'});fs.writeFileSync(reportFile,JSON.stringify(forged));const rejected=path.join(base,'rejected');assert.throws(()=>D.run(original.directory,rejected),/population changed/);assert.equal(fs.existsSync(rejected),false);
});
