'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {step,empty,register,readJournal,ingest}=require('../research-reference.cjs');
const STEP=900000;
function o(n,flags={}){return {id:'source-'+n,asset:'btc',market:'spot',symbol:'BTCUSDT',engineVersion:'4.3.4',codeHash:'core',configurationHash:'config',bar:{time:n*STEP,open:100,high:102,low:98,close:100},observedAt:(n+1)*STEP+1000,qualityFresh:true,atr:2,flags:{exitLong:false,exitShort:false,pullbackConfirmed:false,...flags},events:[]};}
function analysis(dir='LONG',p=false){return {actionable:p,direction:dir,plan:{direction:dir,entry:100,stop:dir==='LONG'?90:110,tp2:dir==='LONG'?120:80},exec:{flow:{latest:{exitLong:false,exitShort:false}},values:{close:100,atr:2},structure:{}},shortScore:0,longScore:0,htfBias:'neutral',state:'NO_TRADE',generatedAt:0};}
function advance(s,obs,a=analysis()){return step(s,obs,a,{generatedAt:obs.observedAt,entryAt:obs.bar.time+2*STEP});}
function seeded(dir='LONG'){return advance(empty(),o(0,{pullbackConfirmed:true}),analysis(dir,true));}
function held(dir='LONG'){let s=seeded(dir);s=advance(s,o(1));return advance(s,o(2));}
test('seed requires both original P and final actionable plan; no EXIT-derived entry',()=>{
 assert.equal(advance(empty(),o(0,{exitShort:true}),analysis('LONG',true)).position,null);
 assert.equal(advance(empty(),o(0,{pullbackConfirmed:true}),analysis()).position,null);
 const s=seeded();assert.equal(s.position.phase,'pending');assert.equal(s.position.entry,null);assert.equal(s.position.entryAt,2*STEP);assert.equal(s.position.scope,'research-only');
});
test('future planned fill is learned after its bar closes, with immutable stop and target',()=>{
 const initial=seeded(),before=JSON.stringify(initial);let s=advance(initial,o(1));assert.equal(s.position.phase,'pending');
 const b=o(2);b.bar.open=101;s=advance(s,b);assert.equal(s.position.entry,101);assert.equal(s.position.fillAssumedAt,2*STEP);assert.equal(s.position.fillObservedAt,3*STEP+1000);
 s=advance(s,o(3),{...analysis('LONG',true),plan:{direction:'LONG',entry:100,stop:50,tp2:180}});assert.equal(s.position.stop,90);assert.equal(s.position.target,120);assert.equal(JSON.stringify(initial),before);
});
test('pre-entry touch and entry gap produce no-fill, rather than backdated positions',()=>{
 let b=o(1);b.bar.low=89;assert.equal(advance(seeded(),b).position.reason,'pre-entry-stop-touch');
 let s=advance(seeded(),o(1));b=o(2);Object.assign(b.bar,{open:121,high:122,low:120,close:121});assert.equal(advance(s,b).position.reason,'entry-gap-outside-fixed-bounds');
});
test('stop-first collision and adverse gaps remain conservative in both directions',()=>{
 for(const dir of ['LONG','SHORT']){const b=o(3);b.bar.high=125;b.bar.low=75;const s=advance(held(dir),b);assert.equal(s.position.reason,'frozen-stop');assert.equal(s.episodes.length,0);}
 const b=o(3);Object.assign(b.bar,{open:85,low:84,high:87,close:86});assert.equal(advance(held(),b).position.exitPrice,85);
});
test('only matching yellow EXIT starts the sequence; closure cannot immediately re-seed',()=>{
 const b=o(3,{exitLong:true,pullbackConfirmed:true}),a=analysis('LONG',true);a.exec.flow.latest.exitLong=true;
 const s=advance(held(),b,a);assert.equal(s.position.reason,'matched-yellow-exit');assert.equal(s.episodes.length,1);assert.equal(s.intents[0].arm,'post-save-reversal');assert.equal(s.intents[0].direction,'SHORT');assert.equal(s.position.phase,'closed');
 const target=o(3,{exitLong:true});target.bar.high=121;assert.equal(advance(held(),target,a).position.reason,'fixed-tp2');assert.equal(advance(held(),target,a).episodes.length,0);
});
test('missing observations and code changes terminate the study without bridging the gap',()=>{
 assert.equal(advance(held(),o(4)).position.phase,'incomplete');
 const b=o(3);b.codeHash='new';const s=advance(held(),b);assert.equal(s.position.phase,'incomplete');assert.equal(s.events[0].type,'incomplete-stream');
});
test('later CHoCH/retest produces a separate intent without replacing the reference stop',()=>{
 const b=o(3,{exitLong:true}),a=analysis();a.exec.flow.latest.exitLong=true;let s=advance(held(),b,a);
 const originalStop=s.position.stop,breakBar=o(4);Object.assign(breakBar.bar,{low:96,close:97});breakBar.events=[{time:4*STEP,type:'CHoCH',side:'bear',price:99}];s=advance(s,breakBar);assert.equal(s.intents.length,0);
 const retest=o(5);retest.bar.close=98;s=advance(s,retest);assert.equal(s.intents[0].arm,'choch-retest');assert.equal(s.position.stop,originalStop);assert.equal(s.intents[0].stop,102.2);
});
test('holding expiry and clock upper bounds are explicit rather than mixed local timestamps',()=>{
 let s=held();for(let n=3;n<=49;n++)s=advance(s,o(n));assert.equal(s.position.phase,'closed');assert.ok(['48-bar-expiry','other-position-guard'].includes(s.position.reason));
 const obs=o(0,{pullbackConfirmed:true});obs.observedAt+=22000;const x=step(empty(),obs,analysis('LONG',true),{generatedAt:STEP+1000,decisionAt:STEP+23000,entryAt:2*STEP});assert.equal(x.position.plannedAtLocal,STEP+1000);assert.equal(x.position.planningExchangeUpper,STEP+23000);
});
test('registration is immutable and concurrent ingest refuses a second writer',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-reference-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const r=register(root);assert.deepEqual(register(root),r);
 fs.writeFileSync(path.join(root,'.ingest.lock'),'{}');assert.throws(()=>ingest(root,'missing'),/EEXIST/);assert.ok(fs.existsSync(path.join(root,'.ingest.lock')));
});
test('journal integrity rejects altered saved state',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-reference-row-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'journal.json'),'{}');fs.writeFileSync(path.join(root,'receipt.json'),'{"sha256":"bad"}');assert.throws(()=>readJournal(root),/hash mismatch/);
});
test('saved source ingests with clock skew, controls and hash-linked journals without changing originals',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-reference-ingest-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const Forward=require('../research-forward.cjs'),Core=require('../strategy-core'),closed=Date.UTC(2026,9,7);let now=closed-STEP;
 t.mock.method(Date,'now',()=>now);const study=path.join(root,'study');register(study);
 function source(at){now=at+1200;const bars=m=>{const end=Math.floor(at/(m*60000))*m*60000;return Array.from({length:300},(_,i)=>[end-(300-i)*m*60000,100+i/10,102+i/10,99+i/10,101+i/10,10]);};
  const s={asset:'btc',version:Core.VERSION,symbol:'BTCUSDT',createdAt:at+100,settings:{now:at+1,market:'spot'},bars:{m15:bars(15),h1:bars(60),h4:bars(240)}};s.id=`btc-${s.bars.m15.at(-1)[0]}-${s.version}`;
  const r=Forward.prepare(s,{requestedAt:at+1000,receivedAt:at+1100},{requestedAt:at+1100,receivedAt:at+1150,serverTime:at+23150},now);assert.deepEqual(r.issues,[]);return Forward.persist(path.join(root,'forward'),r).directory;
 }
 const firstSource=source(closed),raw=fs.readFileSync(path.join(firstSource,'prediction.json')),first=ingest(study,firstSource),j=readJournal(first.directory);
 assert.equal(first.futureGuardPassed,true);assert.equal(j.journal.state.position,null);assert.equal(j.journal.controls.noSign,true);assert.equal(j.journal.state.identity.asset,'btc');
 assert.deepEqual(fs.readFileSync(path.join(firstSource,'prediction.json')),raw);assert.equal(ingest(study,firstSource).reused,true);
 const second=ingest(study,source(closed+STEP)),next=readJournal(second.directory);assert.equal(next.journal.previous.sha256,j.sha256);assert.equal(next.journal.previous.barAt,closed-STEP);assert.equal(next.journal.state.events.length,0);
 fs.appendFileSync(path.join(firstSource,'prediction.json'),' ');assert.throws(()=>ingest(study,source(closed+2*STEP)),/hash mismatch/);assert.equal(fs.existsSync(path.join(study,'.ingest.lock')),false);
});
