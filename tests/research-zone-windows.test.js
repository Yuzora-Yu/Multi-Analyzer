const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const W=require('../research-zone-windows.cjs'),STEP=900000;
const c=(source,from,options={})=>({id:source+'/z',sourceId:source,from,rank:0,primary:true,identity:{asset:'gold',market:'futures',symbol:'XAUUSDT',codeHash:'v1'},zone:{id:'same-zone'},eligibility:{eligible:true,issues:[]},...options});
test('same zone can be sampled again after full reservation but not inside it',()=>{
 const input=[c('later',STEP*17),c('middle',STEP*2),c('first',STEP)],before=JSON.stringify(input),r=W.select(input);assert.deepEqual(r.map(x=>x.nonOverlapping),[true,false,true]);assert.equal(new Set(r.map(x=>x.repeatedZoneKey)).size,1);assert.equal(JSON.stringify(input),before);
});
test('ineligible pending source still reserves; secondary never replaces it',()=>{
 const r=W.select([c('a',STEP,{eligibility:{eligible:false,issues:['delay']}}),c('b',STEP*2),c('secondary',STEP,{rank:1,primary:false})]);assert.equal(r.filter(x=>x.nonOverlapping).length,1);assert.equal(r.find(x=>x.forecast.sourceId==='a').nonOverlapping,true);
});
test('reservation crosses versions but physical markets remain separate',()=>{
 const r=W.select([c('a',STEP),c('b',STEP*2,{identity:{asset:'gold',market:'futures',symbol:'XAUUSDT',codeHash:'v2'}}),c('btc',STEP*2,{identity:{asset:'btc',market:'spot',symbol:'BTCUSDT'}})]);assert.deepEqual(r.map(x=>x.nonOverlapping),[true,false,true]);
});
test('duplicate source/rank mismatch cannot create repeated successes',()=>{
 assert.throws(()=>W.select([c('a',STEP),c('a',STEP)]),/Duplicate/);assert.throws(()=>W.select([c('a',STEP,{rank:1})]),/rank/);assert.throws(()=>W.select([c('a',STEP+1)]),/boundary/);
});
test('registration cannot silently change protocol and evaluation cannot create one',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zone-window-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));assert.throws(()=>W.run({root,base:root}),/preregistration/);const r=W.register(root,100);assert.deepEqual(W.register(root,200),r);r.spec.horizon=8;fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify(r));assert.throws(()=>W.register(root),/new registration/);
});
test('offline pipeline retains a causally frozen synthetic source and detects receipt tampering',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'zone-window-pipeline-')),root=path.join(base,'study');t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const Forward=require('../research-forward.cjs'),Core=require('../strategy-core'),now=Date.now(),cutoff=Math.floor(now/STEP)*STEP+1;
 W.register(root,cutoff-STEP);
 const bars=m=>{const end=Math.floor(cutoff/(m*60000))*m*60000;return Array.from({length:300},(_,i)=>[end-(300-i)*m*60000,100+i/10,102+i/10,99+i/10,101+i/10,10]);};
 const snapshot={asset:'btc',version:Core.VERSION,symbol:'BTCUSDT',createdAt:cutoff+1,settings:{now:cutoff,market:'spot'},bars:{m15:bars(15),h1:bars(60),h4:bars(240)}};snapshot.id=`btc-${snapshot.bars.m15.at(-1)[0]}-${Core.VERSION}`;
 const record=Forward.prepare(snapshot,{requestedAt:now-10,receivedAt:now-5},{requestedAt:now-4,receivedAt:now-2,serverTime:now-3},now),saved=Forward.persist(path.join(base,'research-forward'),record);
 const r=W.run({base,root}),report=JSON.parse(fs.readFileSync(path.join(r.directory,'report.json')));assert.equal(r.sourceControls,1);assert.equal(r.eligibleEvaluated,0);assert.equal(report.collectorExecuted,false);assert.equal(report.controls[0].id,record.id);assert.ok(report.rows.every(r=>r.outcomes[0].status==='pending'&&!r.arms));
 const receiptFile=path.join(saved.directory,'receipt.json'),receipt=JSON.parse(fs.readFileSync(receiptFile));receipt.predictionSha256='tampered';fs.writeFileSync(receiptFile,JSON.stringify(receipt));assert.throws(()=>W.run({base,root}),/hash mismatch/);
});
