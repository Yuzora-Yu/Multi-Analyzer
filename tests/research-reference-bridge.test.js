const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const B=require('../research-reference-bridge.cjs');
const now=Date.UTC(2026,9,7,14,45,30),close=now-30000;
function source(extra={}){return{sha256:'original',receipt:{persistedAt:now-100},record:{id:'gold-source',asset:'gold',targetBarClosedAt:close,clockMeasurement:{requestedAt:now-200,receivedAt:now-100,serverTime:now-150},...extra}};}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'reference-bridge-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify({registeredAt:close-900000}));return root;}
test('explicit fresh source invokes existing actor once; duplicate and reused journals are not new forecasts',t=>{
 const root=fixture(t),calls=[],r=B.bridge(['a','a'],{root,now:()=>now,readSource:()=>source(),ingest:(...args)=>{calls.push(args);return{reused:true};}});assert.equal(calls.length,1);assert.equal(r.attempts[0].status,'existing-journal');assert.equal(r.attempts[1].reason,'duplicate-explicit-source');assert.equal(r.networkRequests,0);assert.equal(r.collectorExecuted,false);
});
test('expired clock, delayed observation, future persistence and unsafe registration never invoke actor',t=>{
 const root=fixture(t);for(const modify of [s=>s.record.clockMeasurement={requestedAt:now-70000,receivedAt:now-69000,serverTime:now-69500},s=>s.record.targetBarClosedAt=now-130000,s=>s.receipt.persistedAt=now+1]){const s=source();modify(s);const r=B.bridge(['a'],{root,now:()=>now,readSource:()=>s,ingest:()=>{throw Error('must not run');}});assert.equal(r.attempts[0].status,'skipped');}
 assert.equal(B.preflight(source(),{registeredAt:close},now),'not-post-registration');
 const skew=source({clockMeasurement:{requestedAt:now-200,receivedAt:now-100,serverTime:now+20000}});assert.equal(B.preflight(skew,{registeredAt:close-10000},now),'not-post-registration');
});
test('source errors and actor failure are retained separately without retry or source rewriting',t=>{
 const root=fixture(t),s=source(),before=JSON.stringify(s);let calls=0;const r=B.bridge(['a','b'],{root,now:()=>now,readSource:p=>{if(p.endsWith('b'))throw Error('Source prediction hash mismatch');return s;},ingest:()=>{calls++;throw Error('Reference derivation finished too late');}});assert.equal(calls,1);assert.ok(r.attempts.every(a=>a.status==='rejected'));assert.match(r.attempts[1].reason,/hash mismatch/);assert.equal(JSON.stringify(s),before);
});
test('missing registration and empty or oversized source list fail rather than creating a study',t=>{
 const root=fixture(t);assert.throws(()=>B.bridge([],{root}),/explicit/);assert.throws(()=>B.bridge(['a','b','c'],{root}),/explicit/);fs.unlinkSync(path.join(root,'registration.json'));assert.throws(()=>B.bridge(['a'],{root}),/ENOENT/);
});
