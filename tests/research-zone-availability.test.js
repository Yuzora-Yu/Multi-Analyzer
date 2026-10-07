const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const A=require('../research-zone-availability.cjs'),STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture({persistedAt=5*STEP+20,legacy=false,asset='btc'}={}){
 const now=5*STEP+30,root=path.resolve('private-test'),file=legacy?path.join(root,'cohort-v1','snapshots','sample.json'):path.join(root,'predictions','sample','prediction.json');
 const snapshot={id:`${asset}-${4*STEP}-v`,asset,symbol:asset==='btc'?'BTCUSDT':'XAUUSDT',version:'v',settings:{market:asset==='btc'?'spot':'futures',now:5*STEP},bars:{m15:Array.from({length:4},(_,i)=>[(i+1)*STEP,100,102,99,101,5])}};
 const r=legacy?{snapshot,firstObservedAt:5*STEP+10}:{snapshot,transport:{receivedAt:5*STEP+10},generatedAt:5*STEP+15};
 const raw=Buffer.from(JSON.stringify(r)),data=new Map([[file,raw]]),sources=[{file,sha256:hash(raw)}];
 if(!legacy){const receipt=path.join(path.dirname(file),'receipt.json'),rawReceipt=Buffer.from(JSON.stringify({persistedAt,predictionSha256:hash(raw)}));data.set(receipt,rawReceipt);sources.push({file:receipt,sha256:hash(rawReceipt)});}
 const report={asOf:now,rows:[{forecast:{id:'zone',sourceId:'source',identity:{asset:'btc',market:'spot',symbol:'BTCUSDT'},from:STEP,primary:true},outcomes:[{horizon:4,from:STEP,until:5*STEP,status:'resolved',eligibleForSummary:true}]}]};
 return {file,data,report,manifest:{sources},read:f=>data.get(f)};
}
test('receipt availability is independently verified without changing registered report labels',()=>{
 const f=fixture(),before=JSON.stringify(f.report),r=A.audit(f.report,f.manifest,f.read),w=r.rows[0].windows[0];assert.equal(w.receiptComplete,true);assert.equal(w.classified.receipted,4);assert.equal(w.summaryGate,'availability-only-verified');assert.equal(r.accuracyProven,false);assert.equal(JSON.stringify(f.report),before);
});
test('early transport cannot substitute for later persistence at retrospective as-of',()=>{
 const f=fixture({persistedAt:6*STEP}),r=A.audit(f.report,f.manifest,f.read),w=r.rows[0].windows[0];assert.equal(r.sourceCounts.futurePersistence,1);assert.equal(w.classified.missing,4);assert.equal(w.summaryGate,'reject-unverified-price-availability');
});
test('declared legacy timing stays weaker evidence and another physical market never fills gaps',()=>{
 const f=fixture({legacy:true}),w=A.audit(f.report,f.manifest,f.read).rows[0].windows[0];assert.equal(w.classified['declared-only'],4);assert.equal(w.receiptComplete,false);const gold=fixture({asset:'gold'});assert.equal(A.audit(gold.report,gold.manifest,gold.read).rows[0].windows[0].classified.missing,4);
});
test('future slots, conflicting OHLC and changed originals fail closed',()=>{
 const f=fixture();f.report.asOf=4*STEP;f.report.rows[0].outcomes[0].eligibleForSummary=false;let w=A.audit(f.report,f.manifest,f.read).rows[0].windows[0];assert.equal(w.classified['not-closed'],1);assert.equal(w.nextScheduledClose,5*STEP);
 const c=fixture({legacy:true}),r=JSON.parse(c.data.get(c.file));r.snapshot.bars.m15.push([STEP,100,103,99,102,5]);r.snapshot.bars.m15.sort((a,b)=>a[0]-b[0]);const raw=Buffer.from(JSON.stringify(r));c.data.set(c.file,raw);c.manifest.sources[0].sha256=hash(raw);w=A.audit(c.report,c.manifest,c.read).rows[0].windows[0];assert.equal(w.classified.conflicting,1);
 const bad=fixture();bad.data.set(bad.file,Buffer.from('{}'));assert.throws(()=>A.audit(bad.report,bad.manifest,bad.read),/hash mismatch/);
 const changed=fixture();let n=0;assert.throws(()=>A.audit(changed.report,changed.manifest,f=>{if(f===changed.file&&++n>1)return Buffer.from('{}');return changed.read(f);}),/changed during/);
});
