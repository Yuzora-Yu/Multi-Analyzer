const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Z=require('../research-zones.cjs'),Core=require('../strategy-core'),Feed=require('../market-feed'),Forward=require('../research-forward.cjs');
const STEP=900000;
const candidate=()=>({sourceId:'s',identity:{asset:'btc',market:'spot',symbol:'BTCUSDT',codeHash:'c',configurationHash:'q'},rank:0,primary:true,from:STEP,zone:{id:'z',direction:'SHORT',low:100,high:105,invalidationClose:105,protectiveStop:107},pivot:94,eligibility:{eligible:true}});
function bars(rows){return new Map(rows.map(([t,close,high=close+1,low=close-1,open=close])=>[t,{bar:{time:t,open,high,low,close},source:{firstObservedAt:t+STEP,file:'observed'},conflict:false}]));}
test('first-touch wick does not create a same-bar reversal; later close does',()=>{
 const c=candidate(),b=bars([[STEP,93,103,92],[STEP*2,92],[STEP*3,91],[STEP*4,90]]),r=Z.outcome(c,b,4,STEP*5);
 assert.equal(r.touchedAt,STEP*2);assert.equal(r.reactionAt,STEP*3);assert.equal(r.movement.entryAt,STEP*2);assert.equal(r.movement.entry,92);assert.match(r.movement.basis,/not|benchmark/);assert.equal(r.movement.costs.length,3);
 const clone=JSON.stringify(c);Z.outcome(c,b,4,STEP*5);assert.equal(JSON.stringify(c),clone);
});
test('stop and withdrawal stay separate from movement and cannot imply an entry',()=>{
 const c=candidate(),b=bars([[STEP,108,109,101],[STEP*2,102],[STEP*3,93],[STEP*4,90]]),r=Z.outcome(c,b,4,STEP*5);
 assert.equal(r.stopVisitedAt,STEP*2);assert.equal(r.withdrawnAt,STEP*2);assert.equal(r.sameBarAmbiguity,true);assert.equal(r.reactionAt,null);assert.ok(r.movement);assert.match(r.movement.basis,/stop flags do not execute/);
});
test('missing, conflicting, future-received and pending windows never supply movement',()=>{
 const c=candidate(),b=bars([[STEP,102],[STEP*2,93],[STEP*3,92],[STEP*4,91]]);
 assert.equal(Z.outcome(c,b,4,STEP*4).status,'pending');b.get(STEP*3).source.firstObservedAt=STEP*6;assert.equal(Z.outcome(c,b,4,STEP*5).status,'missing');
 b.get(STEP*3).source.firstObservedAt=STEP*4;b.get(STEP*2).conflict=true;assert.equal(Z.outcome(c,b,4,STEP*5).status,'conflicting-price');b.delete(STEP*2);assert.equal(Z.outcome(c,b,4,STEP*5).status,'missing');
});
test('a last-bar touch and no-touch have no next-open return; long side is symmetric',()=>{
 const c=candidate();assert.equal(Z.outcome(c,bars([[STEP,90],[STEP*2,91],[STEP*3,92],[STEP*4,102]]),4,STEP*5).movement,null);
 const none=Z.outcome(c,bars([[STEP,90],[STEP*2,91],[STEP*3,92],[STEP*4,93]]),4,STEP*5);assert.equal(none.touchedAt,null);assert.equal(none.movement,null);
 c.zone={...c.zone,direction:'LONG',invalidationClose:100,protectiveStop:98};c.pivot=106;const r=Z.outcome(c,bars([[STEP,102],[STEP*2,108],[STEP*3,109],[STEP*4,110]]),4,STEP*5);assert.equal(r.reactionAt,STEP*3);assert.ok(r.movement.returnBps>0);
});
test('first source owns a zone; ineligible pending primary reserves overlap, secondary is not independent',()=>{
 const c=candidate();c.eligibility.eligible=false;const duplicate={...c,sourceId:'later',from:STEP*2,eligibility:{eligible:true}},other={...duplicate,zone:{...c.zone,id:'other'}},secondary={...c,rank:1,primary:false,zone:{...c.zone,id:'secondary'}};
 const rows=Z.evaluate([duplicate,other,c,secondary],new Map(),STEP);assert.equal(rows.length,3);assert.equal(rows[0].forecast.sourceId,'s');assert.ok(rows[0].outcomes.every(o=>o.nonOverlapping));assert.ok(rows.slice(1).every(r=>r.outcomes.every(o=>!o.nonOverlapping)));assert.ok(rows.every(r=>r.outcomes.every(o=>!o.eligibleForSummary)));
});
test('confluence groups preserve raw SMC bounds and actual MA/BB families, not a win label',()=>{
 const tf={ready:true,quality:{stale:false,gaps:0},intervalMinutes:15,candles:[{time:0}],values:{atr:5,close:100,ema20:100,ema50:120,bbUpper:140,bbLower:90},series:{bb:{mid:[100.5]}},swings:{lows:[{price:94}],highs:[{price:106}]}};
 const z={...candidate().zone,low:80,high:150},a={generatedAt:STEP,marketMap:{valid:true,candidates:[z,{...z,id:'far',low:160,high:170}]},exec:tf,m15:tf},r={id:'saved',asset:'btc',market:'spot',symbol:'BTCUSDT',engineVersion:Core.VERSION,entryAt:STEP*2,targetBarClosedAt:STEP,generatedAt:STEP+1,snapshot:{settings:{market:'spot'}},codeHashes:{}};
 const before=JSON.stringify({a,r}),f=Z.forecasts(r,a,{eligible:false,issues:['test']});assert.equal(f[0].group,'MA+BB');assert.equal(f[1].group,'none');assert.equal(f[0].primary,true);assert.equal(f[1].primary,false);assert.deepEqual(f[0].zone,z);assert.equal(f[0].pivot,94);assert.equal(JSON.stringify({a,r}),before);assert.match(f[0].interpretation,/not proof/);
});
test('registration is exclusive and changing protocol code cannot silently reuse its root',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zones-study-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const r=Z.register(root,100);assert.deepEqual(Z.register(root,200),r);r.spec.id='edited';fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify(r));assert.throws(()=>Z.register(root,300),/new study root/);
});
test('source proof checks real clock, code, registration and actual source cutoff rather than flags',()=>{
 const now=Date.now(),cutoff=Math.floor(now/STEP)*STEP+1,pack=m=>{const end=Math.floor(cutoff/(m*60000))*m*60000;return Array.from({length:300},(_,i)=>[end-(300-i)*m*60000,100,102,99,101,10]);};
 const snapshot={asset:'btc',symbol:'BTCUSDT',version:Core.VERSION,createdAt:cutoff+100,settings:{now:cutoff,market:'spot'},bars:{m15:pack(15),h1:pack(60),h4:pack(240)}};snapshot.id=`btc-${snapshot.bars.m15.at(-1)[0]}-${Core.VERSION}`;
 const r=Forward.prepare(snapshot,{requestedAt:now-100,receivedAt:now-50},{requestedAt:now-40,receivedAt:now-20,serverTime:now-30},now),receipt={persistedAt:r.generatedAt,predictionSha256:'sha'},registration={registeredAt:cutoff-STEP,codeHashes:r.codeHashes};
 const valid=Z.verifySource(r,receipt,registration,'sha',r.generatedAt+100);assert.equal(valid.eligible,true,JSON.stringify(valid.issues));
 assert.ok(Z.verifySource(r,receipt,{...registration,registeredAt:cutoff},'sha',now+100).issues.includes('pre-registration-source'));
 assert.ok(Z.verifySource({...r,targetBarClosedAt:cutoff+STEP},receipt,registration,'sha',now+100).issues.includes('source-cutoff'));
 assert.ok(Z.verifySource(r,{...receipt,persistedAt:r.entryAt},registration,'sha',r.entryAt).issues.includes('future-guard'));
 assert.ok(Z.verifySource(r,receipt,registration,'changed',now+100).issues.includes('receipt-hash'));
 const clock={requestedAt:r.generatedAt-40,receivedAt:r.generatedAt-20,serverTime:r.generatedAt+21960},skewed={...r,clockMeasurement:clock,clockBounds:Forward.clockBounds(clock)};
 assert.ok(Z.verifySource(skewed,receipt,{...registration,registeredAt:r.targetBarClosedAt-8000},'sha',r.generatedAt+100).issues.includes('pre-registration-source'));
});
