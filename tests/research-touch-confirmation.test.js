const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const H=require('../research-touch-confirmation.cjs'),T=require('../research-zone-trades.cjs'),STEP=900000;
const candidate=()=>({from:STEP,pivot:110,zone:{direction:'LONG',low:100,high:102,protectiveStop:98,invalidationClose:99,targets:[130]}});
const bars=(changes={})=>Array.from({length:16},(_,i)=>({time:(i+1)*STEP,open:104,high:105,low:103,close:104,...changes[i]}));
test('touch extreme is known only at touch close; later confirmation can differ from source swing',()=>{
 const c=candidate(),b=bars({0:{open:101,high:103,low:100,close:101},1:{open:102,high:105,low:101,close:104},3:{open:105,high:131,low:104,close:130}}),before=JSON.stringify({c,b}),h=H.simulate(c,b),strict=T.simulate(c,b,T.SPEC.arms[1]);
 assert.equal(h.confirmationReference.price,103);assert.equal(h.confirmationReference.knownAt,STEP*2);assert.equal(h.entryAt,STEP*3);assert.equal(h.reason,'fixed-target');assert.notEqual(h.entryAt,strict.entryAt);assert.equal(JSON.stringify({c,b}),before);
 const changed=structuredClone(b);changed[2].high=109;assert.deepEqual(H.simulate(c,changed).confirmationReference,h.confirmationReference);
});
test('same-bar reaction cannot trigger; pre-touch stop and missing windows cannot supply a reference',()=>{
 const c=candidate(),b=bars({0:{open:101,high:108,low:100,close:107}}),h=H.simulate(c,b);assert.equal(h.status,'no-trigger');assert.equal(h.confirmationReference.price,108);
 const stop=H.simulate(c,bars({0:{open:99,high:101,low:97,close:100},1:{open:101,high:103,low:100,close:102}}));assert.equal(stop.status,'cancelled');assert.equal(stop.confirmationReference,null);
 assert.throws(()=>H.simulate(c,b.slice(1)),/Complete ordered/);
});
test('original risk/target/cost rules and short mirror remain unchanged',()=>{
 const c=candidate(),b=bars({0:{open:101,high:103,low:100,close:101},1:{open:102,high:105,low:101,close:104},2:{open:104,high:131,low:97,close:105}}),long=H.simulate(c,b);
 assert.equal(long.exit,98);assert.equal(long.sameBarAmbiguity,true);assert.deepEqual(long.costs.map(x=>x.costBps),[7,14,21]);
 const short=H.simulate({from:STEP,pivot:90,zone:{direction:'SHORT',low:98,high:100,protectiveStop:102,invalidationClose:101,targets:[70]}},b.map(x=>({...x,open:200-x.open,high:200-x.low,low:200-x.high,close:200-x.close})));
 assert.equal(short.exit,102);assert.equal(short.reason,long.reason);assert.equal(short.confirmationReference.price,200-long.confirmationReference.price);
 const gap=structuredClone(b);gap[2]={...gap[2],open:129,high:131,low:128,close:130};assert.equal(H.simulate(c,gap).status,'no-fill');
});
test('new registration and conservative source boundary cannot rehabilitate prior observations',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'touch-confirmation-')),r=H.register(root,1000),before=fs.readFileSync(path.join(root,'registration.json'));
 assert.equal(H.register(root,2000).registeredAt,1000);assert.deepEqual(fs.readFileSync(path.join(root,'registration.json')),before);
 assert.equal(H.eligibleAfter({originClosedAt:1100},{clockBounds:{upperOffsetMs:100}},r),false);assert.equal(H.eligibleAfter({originClosedAt:1101},{clockBounds:{upperOffsetMs:100}},r),true);
 assert.equal(H.eligibleAfter({originClosedAt:2000},{clockBounds:{}},r),false);
 const bad={...r,spec:{...r.spec,horizon:8}};fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify(bad));assert.throws(()=>H.register(root),/new registration/);
 assert.ok(root.startsWith(path.join(path.resolve(os.tmpdir()),'touch-confirmation-')));fs.rmSync(root,{recursive:true,force:true});
});
test('offline cohort pipeline excludes sources preceding this new registration and rejects tampered reports',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'touch-confirmation-pipeline-')),W=require('../research-zone-windows.cjs'),Forward=require('../research-forward.cjs'),Core=require('../strategy-core'),root=path.join(base,'new-study'),now=Date.now(),cutoff=Math.floor(now/STEP)*STEP+1;
 t.after(()=>{assert.ok(base.startsWith(path.join(path.resolve(os.tmpdir()),'touch-confirmation-pipeline-')));fs.rmSync(base,{recursive:true,force:true});});
 const oldRoot=path.join(base,'old-study');W.register(oldRoot,cutoff-STEP);H.register(root,now+1);
 const make=m=>{const end=Math.floor(cutoff/(m*60000))*m*60000;return Array.from({length:300},(_,i)=>[end-(300-i)*m*60000,100+i/10,102+i/10,99+i/10,101+i/10,10]);};
 const snapshot={asset:'btc',version:Core.VERSION,symbol:'BTCUSDT',createdAt:cutoff+1,settings:{now:cutoff,market:'spot'},bars:{m15:make(15),h1:make(60),h4:make(240)}};snapshot.id=`btc-${snapshot.bars.m15.at(-1)[0]}-${Core.VERSION}`;
 const record=Forward.prepare(snapshot,{requestedAt:now-10,receivedAt:now-5},{requestedAt:now-4,receivedAt:now-2,serverTime:now-3},now);Forward.persist(path.join(base,'research-forward'),record);
 const original=W.run({base,root:oldRoot}),result=H.run(original.directory,root),saved=JSON.parse(fs.readFileSync(result.file));assert.equal(result.postRegistration,0);assert.equal(result.evaluated,0);assert.equal(saved.controls.length,1);assert.equal(saved.productionChanged,false);assert.ok(saved.rows.every(r=>r.status==='excluded-before-registration'&&!r.arms));
 const file=path.join(original.directory,'report.json'),report=JSON.parse(fs.readFileSync(file));report.controls[0].id='tampered';fs.writeFileSync(file,JSON.stringify(report));assert.throws(()=>H.run(original.directory,root),/population|control|replay|changed/i);
});
