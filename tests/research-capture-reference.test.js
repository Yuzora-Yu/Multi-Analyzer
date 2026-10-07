'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const C=require('../research-capture-reference.cjs'),F=require('../research-forward.cjs'),B=require('../research-reference-bridge.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'capture-first-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 for(const dir of ['research-forward/predictions','research-reference-v1','cohort-v1/snapshots'])fs.mkdirSync(path.join(base,dir),{recursive:true});
 fs.writeFileSync(path.join(base,'research-forward/spec.json'),JSON.stringify({registeredAt:1,...F.SPEC}));
 fs.writeFileSync(path.join(base,'research-reference-v1/registration.json'),JSON.stringify({registeredAt:1,codeHashes:{'research-forward.cjs':hash(fs.readFileSync(path.join(__dirname,'../research-forward.cjs')))}}));return base;}
function transport(log,{badAsset,badClock,httpAsset}={}){return async url=>{log.push('get:'+url);let data;
 if(url.includes('/time'))data={retCode:badClock?1:0,time:Date.now()};else{const asset=new URL(url).searchParams.get('asset');data={asset:asset===badAsset?'wrong':asset,id:asset+'-test'};if(asset===httpAsset)return{ok:false,status:503};}
 return{ok:true,status:200,text:async()=>JSON.stringify(data)};};}
function prepare(snapshot,transport,clock,now){return{schema:1,specId:F.SPEC.id,id:snapshot.id,asset:snapshot.asset,transport,clockMeasurement:clock,clockBounds:F.clockBounds(clock),generatedAt:now,targetBarClosedAt:now-30000,entryAt:now+900000,issues:[],snapshot,prediction:{state:'NO_TRADE'}};}
const open=()=>({allowed:true});
test('capture persists and bridges each original before next asset; budget four and no evaluator',async t=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-10-05T12:00:00+09:00'));
 const base=fixture(t),log=[],originals=[];
 const result=await C.capture({base,policy:open,fetchImpl:transport(log),prepare,persist:(root,r)=>{log.push('persist:'+r.asset);const p=F.persist(root,r);originals.push(fs.readFileSync(path.join(p.directory,'prediction.json')));return p;},bridge:(dirs,options)=>{
   const r=JSON.parse(fs.readFileSync(path.join(dirs[0],'prediction.json')));log.push('bridge:'+r.asset);return B.bridge(dirs,{...options,ingest:()=>({reused:false})});
 }});
 assert.equal(result.networkRequests,4);assert.equal(result.collectorExecuted,false);assert.equal(result.evaluationExecuted,false);
 assert.deepEqual(log.map(x=>x.startsWith('get:')?'get':x),['get','get','persist:gold','bridge:gold','get','get','persist:btc','bridge:btc']);
 assert.deepEqual(result.attempts.map(a=>a.bridge.attempts[0].status),['journal-saved','journal-saved']);
 result.attempts.forEach((a,i)=>assert.deepEqual(fs.readFileSync(path.join(a.frozen.directory,'prediction.json')),originals[i]));
 assert.ok(fs.existsSync(result.file));assert.equal(fs.readdirSync(path.join(base,'research-capture-reference')).length,1);
});
test('reused old source is read from disk and rejected as old; fresh transient record never substitutes',async t=>{
 const base=fixture(t),r=prepare({id:'gold-test',asset:'gold'},{requestedAt:1,receivedAt:2},{requestedAt:1,receivedAt:2,serverTime:2},3);r.targetBarClosedAt=100;r.generatedAt=3;
 const saved=F.persist(path.join(base,'research-forward'),r),bytes=fs.readFileSync(path.join(saved.directory,'prediction.json'));
 const result=await C.capture({base,policy:open,fetchImpl:transport([]),prepare,bridge:(dirs,options)=>B.bridge(dirs,{...options,ingest:()=>{throw Error('Must not ingest old source');}})});
 assert.equal(result.attempts[0].frozen.reused,true);assert.equal(result.attempts[0].bridge.attempts[0].reason,'clock-expired');assert.deepEqual(fs.readFileSync(path.join(saved.directory,'prediction.json')),bytes);
});
test('Gold JST weekend performs zero Gold requests, while BTC remains separate',async t=>{
 const base=fixture(t),log=[],at=Date.UTC(2026,9,10,3),result=await C.capture({base,now:()=>at,fetchImpl:transport(log),prepare,bridge:()=>({attempts:[]})});
 assert.equal(result.attempts[0].reason,'market-closed');assert.equal(result.networkRequests,2);assert.ok(!log.some(x=>x.includes('asset=gold')));
});
test('wrong identity, HTTP and exchange errors never retry or persist bad sources',async t=>{
 for(const config of [{badAsset:'gold'},{httpAsset:'gold'},{badClock:true}]){const base=fixture(t),log=[],result=await C.capture({base,policy:open,fetchImpl:transport(log,config),prepare,bridge:()=>({attempts:[]})});
   assert.equal(result.attempts[0].status,'rejected');assert.ok(result.networkRequests<=4);assert.equal(fs.existsSync(path.join(base,'research-forward/predictions/gold-test')),false);
   if(!config.badClock)assert.equal(result.attempts[1].status,'captured');else assert.equal(result.attempts[1].status,'rejected');
 }
});
test('requires existing pinned registration before any request; no implicit study creation',async t=>{
 const base=fixture(t),file=path.join(base,'research-reference-v1/registration.json');fs.unlinkSync(file);let calls=0;
 await assert.rejects(C.capture({base,fetchImpl:async()=>{calls++;}}),/ENOENT/);assert.equal(calls,0);assert.equal(fs.existsSync(file),false);
 fs.writeFileSync(file,JSON.stringify({registeredAt:1,codeHashes:{'research-forward.cjs':'wrong'}}));await assert.rejects(C.capture({base,fetchImpl:async()=>{calls++;}}),/dependency mismatch/);assert.equal(calls,0);
});
test('offline evaluation retains original receipts, writes separate atomic output and rejects mutation or new membership',t=>{
 const base=fixture(t),cohort=path.join(base,'cohort-v1/snapshots/a.json'),value={snapshot:{asset:'btc'},firstObservedAt:1};fs.writeFileSync(cohort,JSON.stringify(value));
 const source=path.join(base,'research-forward/predictions/btc-test');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'prediction.json'),JSON.stringify({snapshot:{asset:'btc'},transport:{receivedAt:2}}));fs.writeFileSync(path.join(source,'receipt.json'),JSON.stringify({persistedAt:3}));
 const before=fs.readFileSync(cohort),result=C.evaluateOffline({base,now:()=>100,evaluate:(root,records,asOf)=>{assert.equal(records.length,2);assert.equal(asOf,100);return[{receipt:{prospectiveEligible:true}}];}});
 assert.equal(result.networkRequests,0);assert.equal(result.captureExecuted,false);assert.deepEqual(fs.readFileSync(cohort),before);assert.ok(fs.existsSync(path.join(result.directory,'manifest.json')));
 const count=fs.readdirSync(path.dirname(result.directory)).length;
 assert.throws(()=>C.evaluateOffline({base,evaluate:()=>{fs.writeFileSync(cohort,'{}');return[];}}),/source changed/i);assert.equal(fs.readdirSync(path.dirname(result.directory)).length,count);fs.writeFileSync(cohort,before);
 assert.throws(()=>C.evaluateOffline({base,evaluate:()=>{fs.writeFileSync(path.join(base,'cohort-v1/snapshots/new.json'),'{}');return[];}}),/inventory changed/i);assert.equal(fs.readdirSync(path.dirname(result.directory)).length,count);
});
