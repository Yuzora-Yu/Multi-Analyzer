'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SPEC,start,advance,checkpoint,register}=require('../research-retest.cjs');
const STEP=900000;
function obs(n,patch={}){const bar={time:n*STEP,open:100,high:102,low:98,close:100,...patch.bar};return {id:'episode',asset:'gold',market:'futures',symbol:'XAUUSDT',engineVersion:'4.3.4',codeHash:'engine',configurationHash:'settings',bar,observedAt:bar.time+STEP+1000,qualityFresh:true,atr:2,flags:{exitLong:true,exitShort:false,pullbackConfirmed:false},referencePosition:{direction:'LONG',entry:99},positionDecision:'EXIT_LONG',...patch,bar};}
function broken(){return advance(start(obs(0)),obs(1,{bar:{close:97,low:96},events:[{type:'CHoCH',side:'bear',time:STEP,price:99}]}));}
test('warning EXIT and ambiguous exits cannot start a matched-position study',()=>{
 assert.equal(start(obs(0,{referencePosition:null})).status,'rejected');
 assert.equal(start(obs(0,{flags:{exitLong:true,exitShort:true}})).status,'rejected');
 const e=start(obs(0));assert.equal(e.direction,'SHORT');assert.equal(e.intents[0].entryAt,null);assert.equal(e.intents[0].arm,'post-save-reversal');
});
test('CHoCH recognition and a later strict retest are distinct; inputs remain unchanged',()=>{
 const initial=start(obs(0)),before=JSON.stringify(initial);
 const b=advance(initial,obs(1,{bar:{close:97,low:96},events:[{type:'CHoCH',side:'bear',time:STEP,price:99}]}));
 assert.equal(b.status,'awaiting-retest');assert.equal(b.intents.length,1);assert.equal(JSON.stringify(initial),before);
 const e=advance(b,obs(2,{bar:{high:100,close:98}}));assert.equal(e.status,'confirmed-intent');assert.equal(e.intents[1].stop,102.2);assert.equal(e.break.level,99);
 const future=advance(e,obs(3,{bar:{high:120,close:119}}));assert.deepEqual(future,e); // Future bars cannot rewrite the saved intent.
});
test('old recognition, BOS and equality cannot silently substitute for CHoCH retest',()=>{
 for(const event of [{type:'CHoCH',side:'bear',time:0,price:99},{type:'BOS',side:'bear',time:STEP,price:99}])assert.equal(advance(start(obs(0)),obs(1,{bar:{close:97,low:96},events:[event]})).status,'awaiting-choch');
 assert.equal(advance(broken(),obs(2,{bar:{high:100,close:99}})).status,'awaiting-retest');
});
test('missing/delayed observations terminate the episode; no recovered hindsight entry',()=>{
 assert.equal(advance(broken(),obs(3)).status,'incomplete');
 assert.equal(advance(broken(),obs(2,{observedAt:3*STEP+SPEC.maxDelayMs+1})).status,'incomplete');
 assert.equal(advance(broken(),obs(2,{qualityFresh:false})).status,'incomplete');
});
test('asset, physical market, code and configuration cannot change within an episode',()=>{
 for(const key of ['asset','market','symbol','engineVersion','codeHash','configurationHash']){
  assert.equal(advance(broken(),obs(2,{[key]:'changed'})).reason,'market-or-engine-identity-changed');
 }
 assert.equal(start(obs(0,{codeHash:null})).reason,'missing-market-or-version-identity');
});
test('invalidation/deadline are frozen; another break cannot widen or extend them',()=>{
 const b=broken(),e=advance(b,obs(2,{bar:{high:105,close:104},events:[{type:'CHoCH',side:'bear',time:2*STEP,price:105}]}));
 assert.equal(e.status,'invalidated');assert.deepEqual(e.break,b.break);assert.equal(e.deadlineAt,b.deadlineAt);
 let x=start(obs(0));for(let n=1;n<=4;n++)x=advance(x,obs(n));assert.equal(x.status,'expired');
 assert.equal(advance(x,obs(5)).status,'expired');
});
test('long sequence is symmetric and requires its own matched-position EXIT',()=>{
 const o=obs(0,{flags:{exitLong:false,exitShort:true,pullbackConfirmed:false},referencePosition:{direction:'SHORT',entry:101},positionDecision:'EXIT_SHORT'});
 let e=start(o);e=advance(e,obs(1,{bar:{close:103,high:104},events:[{type:'CHoCH',side:'bull',time:STEP,price:101}]}));
 e=advance(e,obs(2,{bar:{low:99,close:102}}));assert.equal(e.status,'confirmed-intent');assert.equal(e.intents[1].stop,97.8);
});
test('persistence plans a future guarded boundary, never the original next open',()=>{
 const p=start(obs(0)).intents[0],c=checkpoint(p,{persistedAt:STEP+3000,clockUpperOffsetMs:500,registeredAt:0});
 assert.equal(c.entryAt,2*STEP);assert.ok(c.entryAt>c.persistedAt+500+SPEC.guardMs);assert.equal(p.entryAt,null);
 assert.throws(()=>checkpoint(p,{persistedAt:STEP,clockUpperOffsetMs:0,registeredAt:0}));
 assert.throws(()=>checkpoint(p,{persistedAt:STEP+3000,clockUpperOffsetMs:0,registeredAt:STEP+2000}));
});
test('first registration remains immutable and changed registered code/spec is rejected',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-retest-'));
 try{const r=register(root);assert.deepEqual(register(root),r);assert.equal(r.historicalReplayEligible,false);
 r.specSha256='altered';fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify(r));assert.throws(()=>register(root),/differs/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
