const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {clockBounds,prepare,persist,evaluate}=require('../research-forward.cjs');
const STEP=900000;
test('clock skew is an explicit interval, not automatic proof of future leakage',()=>{
 const b=clockBounds({requestedAt:1000,receivedAt:1120,serverTime:23000});assert.equal(b.valid,true);assert.equal(b.lowerOffsetMs,21880);assert.equal(b.upperOffsetMs,22000);
 assert.equal(clockBounds({requestedAt:1000,receivedAt:900,serverTime:1000}).valid,false);
 assert.equal(clockBounds({requestedAt:1000,receivedAt:9000,serverTime:1000}).valid,false);assert.equal(clockBounds({}).valid,false);
});
test('frozen prediction is immutable on repeat; tampered prediction cannot be evaluated',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-forward-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const now=Date.now(),r={id:'btc-0-4.3.2',specId:require('../research-forward.cjs').SPEC.id,generatedAt:now,transport:{receivedAt:now},latestInfoEventAt:0,cutoff:1,asset:'btc',market:'spot',symbol:'BTCUSDT',entryAt:Math.ceil((now+120000)/STEP)*STEP,clockBounds:{valid:true,upperOffsetMs:22000},issues:[],prediction:{state:'NO_TRADE'}};
 const first=persist(root,r);assert.equal(first.receipt.prospectiveEligible,true);
 const repeated=persist(root,{...r,prediction:{state:'READY_LONG'}});assert.equal(repeated.reused,true);
 const stored=JSON.parse(fs.readFileSync(path.join(first.directory,'prediction.json')));assert.equal(stored.prediction.state,'NO_TRADE');
 const result=evaluate(root,[],Date.now());assert.equal(result[0].outcomes[0].status,'pending');
 assert.equal(result[0].receipt.prospectiveEligible,true);assert.equal(evaluate(root,[],now-1).length,0);
 fs.appendFileSync(path.join(first.directory,'prediction.json'),' ');assert.throws(()=>evaluate(root,[],Date.now()),/hash mismatch/);
});
test('persistence after entry cannot become prospective',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-forward-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.equal(persist(root,{id:'btc-old',entryAt:0,clockBounds:{valid:true,upperOffsetMs:0},issues:[]}).receipt.prospectiveEligible,false);
});
test('future feature bars and wrong markets are rejected before analysis',()=>{
 const s={id:'btc-0-4.3.2',asset:'btc',version:require('../strategy-core').VERSION,symbol:'BTCUSDT',createdAt:STEP+1,settings:{now:STEP+1,market:'spot'},bars:{m15:[[0,100,102,99,101,1]],h1:[[0,100,102,99,101,1]],h4:[]}};
 assert.throws(()=>prepare(s,{requestedAt:STEP,receivedAt:STEP+1},{},STEP+2),/Unclosed/);
 assert.throws(()=>prepare({...s,symbol:'XAUUSDT'},{},{},STEP+2),/identity/);
});
test('complete snapshot freezes the shared decision, actual generation time and future price boundary',()=>{
 const now=Date.now(),cutoff=Math.floor(now/STEP)*STEP+1;
 const bars=m=>{const end=Math.floor(cutoff/(m*60000))*m*60000;return Array.from({length:300},(_,i)=>[end-(300-i)*m*60000,100+i/10,102+i/10,99+i/10,101+i/10,10]);};
 const s={asset:'btc',version:require('../strategy-core').VERSION,symbol:'BTCUSDT',createdAt:cutoff+100,settings:{now:cutoff,market:'spot'},bars:{m15:bars(15),h1:bars(60),h4:bars(240)}};s.id=`btc-${s.bars.m15.at(-1)[0]}-${s.version}`;
 const r=prepare(s,{requestedAt:now-100,receivedAt:now-50},{requestedAt:now-40,receivedAt:now-20,serverTime:now+21960},now);
 const expected=require('../strategy-core').analyzeMarket(require('../market-feed').input(s),s.settings);
 assert.equal(r.prediction.state,expected.state);assert.equal(r.prediction.direction,expected.direction);assert.equal(r.latestInfoEventAt,cutoff-1);
 assert.ok(r.generatedAt>=r.generationStartedAt);assert.ok(r.entryAt>r.generatedAt+r.clockBounds.upperOffsetMs+60000);
 assert.deepEqual(r.issues,[]);assert.equal(r.settingsSha256.length,64);
});
