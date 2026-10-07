'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {outcome,evaluate,persist,verify,register,readSource,observation,engineHashes,prepare}=require('../research-retest-outcomes.cjs');
const Forward=require('../research-forward.cjs'),Core=require('../strategy-core');
const STEP=900000;
function candidate(direction='SHORT'){return {id:'a',identity:{asset:'gold',market:'futures',symbol:'XAUUSDT',codeHash:'v1'},plan:{arm:'choch-retest',entryAt:2*STEP,confirmedBarAt:0,direction,stop:direction==='LONG'?90:110,structuralInvalidation:null}};}
function prices(){return new Map(Array.from({length:17},(_,i)=>[i*STEP,{bar:{time:i*STEP,open:100,high:103,low:97,close:101},conflict:false,source:{firstObservedAt:(i+1)*STEP+1,snapshotId:'s'}}]));}
function change(map,n,patch){Object.assign(map.get(n*STEP).bar,patch);}
test('stop touches are symmetric; round-trip cost assumptions do not become realized P&L',()=>{
 for(const dir of ['LONG','SHORT']){const c=candidate(dir),m=prices();change(m,3,dir==='LONG'?{low:89}:{high:111});
  const o=outcome(c,m,4,7*STEP);assert.equal(o.reason,'frozen-stop-touch');assert.equal(o.exit,c.plan.stop);assert.ok(Math.abs(o.returnBps+1000)<1e-8);
  assert.equal(o.costSensitivity[0].hypotheticalNetBps,o.returnBps-7);assert.equal(o.unmeasured.funding,null);assert.match(o.interpretation,/not execution/);
 }
});
test('adverse gap uses the open beyond the stop, never optimistic stop fill',()=>{
 const m=prices();change(m,3,{open:112,high:115,low:111,close:113});const o=outcome(candidate(),m,4,7*STEP);
 assert.equal(o.reason,'adverse-stop-gap');assert.equal(o.exit,112);assert.equal(o.exitBarAt,3*STEP);
});
test('pre-entry invalidation and entry gaps are no-fill, never zero-return wins',()=>{
 const c=candidate(),m=prices();c.plan.structuralInvalidation=105;change(m,1,{close:108,high:109});
 assert.equal(outcome(c,m,4,7*STEP).reason,'pre-entry-structural-invalidation');
 const gap=prices();change(gap,2,{open:112,high:114,low:110,close:111});assert.equal(outcome(candidate(),gap,4,7*STEP).reason,'entry-gap-beyond-stop');
 const touch=prices();change(touch,1,{high:111});assert.equal(outcome(candidate(),touch,4,7*STEP).status,'no-fill');
});
test('future, missing and revised prices cannot resolve the window even after an early stop',()=>{
 const m=prices();change(m,2,{high:111});assert.equal(outcome(candidate(),m,4,4*STEP).status,'pending');
 m.delete(5*STEP);assert.equal(outcome(candidate(),m,4,7*STEP).status,'missing');
 const conflict=prices();conflict.get(3*STEP).conflict=true;assert.equal(outcome(candidate(),conflict,4,7*STEP).status,'conflicting-price');
 const late=prices();late.get(5*STEP).source.firstObservedAt=100*STEP;assert.equal(outcome(candidate(),late,4,7*STEP).status,'missing');
});
test('Gold scheduled closure and BTC absent candles are distinct; horizons never compress',()=>{
 const closed=Date.UTC(2026,9,10),c=candidate();c.plan.confirmedBarAt=closed-2*STEP;c.plan.entryAt=closed;
 const gold=outcome(c,new Map(),4,closed+5*STEP);assert.equal(gold.status,'missing');assert.equal(gold.missingCoverage.scheduledClosed.length,5);assert.equal(gold.exitAt,closed+4*STEP);
 c.identity.asset='btc';const btc=outcome(c,new Map(),4,closed+5*STEP);assert.equal(btc.missingCoverage.scheduledClosed.length,0);assert.equal(btc.missingCoverage.expectedButAbsent.length,5);
});
test('pending/missing/ineligible candidates reserve full windows across versions; arms stay distinct',()=>{
 const a=candidate(),b=candidate(),c=candidate();b.id='b';b.plan.entryAt=3*STEP;b.identity.codeHash='v2';c.id='c';c.plan.arm='post-save-reversal';
 const rows=evaluate([{candidate:a,eligibility:{eligible:false}},{candidate:b,eligibility:{eligible:true}},{candidate:c,eligibility:{eligible:true}}],new Map(),7*STEP);
 const byId=Object.fromEntries(rows.map(r=>[r.id,r]));assert.equal(byId.a.outcomes[0].nonOverlapping,true);assert.equal(byId.b.outcomes[0].nonOverlapping,false);assert.equal(byId.c.outcomes[0].nonOverlapping,true);assert.equal(byId.a.outcomes[0].prospective,false);
});
test('first candidate is immutable and altered receipts/late persistence fail eligibility',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-retest-ledger-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const a=candidate(),first=persist(root,a),again=persist(root,{...a,plan:{...a.plan,stop:120}});
 assert.equal(again.reused,true);assert.equal(JSON.parse(fs.readFileSync(path.join(first.directory,'candidate.json'))).plan.stop,110);
 const r=verify({...a,methodId:'wrong',sources:[],generatedAt:0,clockMeasurement:{}},first.receipt,{registeredAt:0});
 assert.equal(r.eligible,false);assert.ok(r.issues.includes('candidate-receipt-hash-mismatch'));assert.ok(r.issues.includes('persistence-missed-future-guard'));
});
test('source hash, engine identity and preregistration prevent historical replay becoming prospective',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-retest-source-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const now=Date.now(),cutoff=Math.floor(now/STEP)*STEP+1;
 const bars=m=>{const end=Math.floor(cutoff/(m*60000))*m*60000;return Array.from({length:300},(_,i)=>[end-(300-i)*m*60000,100+i/10,102+i/10,99+i/10,101+i/10,10]);};
 const s={asset:'btc',version:Core.VERSION,symbol:'BTCUSDT',createdAt:now-80,settings:{now:cutoff,market:'spot'},bars:{m15:bars(15),h1:bars(60),h4:bars(240)}};s.id=`btc-${s.bars.m15.at(-1)[0]}-${s.version}`;
 const r=Forward.prepare(s,{requestedAt:now-100,receivedAt:now-50},{requestedAt:now-40,receivedAt:now-20,serverTime:now-30},now),saved=Forward.persist(root,r),src=readSource(saved.directory);
 assert.throws(()=>observation(src,{registeredAt:now+1,engineHashes:engineHashes()},Date.now()),/post-registration/);
 assert.throws(()=>observation(src,{registeredAt:0,engineHashes:{}},Date.now()),/engine hash/);
 fs.appendFileSync(path.join(saved.directory,'prediction.json'),' ');assert.throws(()=>readSource(saved.directory),/hash mismatch/);
});
test('ledger registration remains fixed; malformed entry timing cannot reach outcomes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-ledger-reg-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const r=register(root);assert.deepEqual(register(root),r);const c=candidate();c.plan.entryAt=STEP;assert.throws(()=>outcome(c,prices(),4,10*STEP),/Invalid/);
 const hash=crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');assert.equal(hash.length,64);
});
test('a real engine EXIT replays across 22s clock skew; changing the frozen stop fails proof',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-causal-candidate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 // Explicit synthetic clock/source fixture, never research data.
 const closed=Date.UTC(2026,9,7),now=closed+1200;
 const bars=m=>{const end=Math.floor(closed/(m*60000))*m*60000;return Array.from({length:300},(_,i)=>[end-(300-i)*m*60000,100+i/10,102+i/10,99+i/10,101+i/10,10]);};
 const m15=bars(15);for(const b of m15.slice(-2)){b[1]=111;b[2]=112;b[3]=109;b[4]=110;}
 const s={asset:'btc',version:Core.VERSION,symbol:'BTCUSDT',createdAt:closed+100,settings:{now:closed+1,market:'spot',position:{direction:'LONG',entry:125,stop:90}},bars:{m15,h1:bars(60),h4:bars(240)}};s.id=`btc-${m15.at(-1)[0]}-${s.version}`;
 const a=Core.analyzeMarket(require('../market-feed').input(s),s.settings),f=a.exec.flow.latest;assert.equal(f.exitLong,true);assert.equal(a.positionDecision.action,'EXIT_LONG');
 const r={id:s.id,specId:Forward.SPEC.id,asset:'btc',market:'spot',symbol:'BTCUSDT',engineVersion:Core.VERSION,snapshot:s,issues:[],codeHashes:engineHashes(),
  generatedAt:closed+1000,transport:{requestedAt:closed+400,receivedAt:closed+500},clockMeasurement:{requestedAt:closed+100,receivedAt:closed+200,serverTime:closed+22150},
  targetBarOpenAt:closed-STEP,targetBarClosedAt:closed,cutoff:closed+1,latestInfoEventAt:closed,prediction:{exitLong:f.exitLong,exitShort:f.exitShort,pullbackConfirmed:f.pullbackConfirmed}};
 const raw=JSON.stringify(r);fs.writeFileSync(path.join(root,'prediction.json'),raw);fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify({persistedAt:closed+1100,predictionSha256:crypto.createHash('sha256').update(raw).digest('hex')}));
 const registration={...register(path.join(root,'ledger')),registeredAt:closed-STEP},clock={requestedAt:closed+1150,receivedAt:closed+1180,serverTime:closed+23165};
 const prepared=prepare([readSource(root)],registration,clock,now);assert.equal(prepared.candidates.length,1);const c=prepared.candidates[0];assert.equal(c.plan.entryAt,closed+STEP);assert.equal(c.plan.arm,'post-save-reversal');
 assert.equal(c.plan.persistedAt,undefined);assert.equal(c.plan.status,'planned-awaiting-actual-receipt');
 const receipt={persistedAt:closed+1300,publishedAt:closed+1301,sha256:crypto.createHash('sha256').update(JSON.stringify(c,null,2)).digest('hex')};assert.equal(verify(c,receipt,registration).eligible,true);
 const altered=structuredClone(c);altered.plan.stop+=10;receipt.sha256=crypto.createHash('sha256').update(JSON.stringify(altered,null,2)).digest('hex');assert.ok(verify(altered,receipt,registration).issues.includes('candidate-replay-mismatch'));
 receipt.publishedAt=c.plan.entryAt;assert.ok(verify(c,receipt,registration).issues.includes('persistence-missed-future-guard'));
});
