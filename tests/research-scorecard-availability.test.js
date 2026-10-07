const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const A=require('../research-scorecard-availability.cjs'),Score=require('../research-scorecard.cjs'),Forward=require('../research-forward.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(t,{legacy=false,late=false,overlap=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'score-availability-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const forward=path.join(root,'research-forward'),sources=[],records=[],evidence=new Map(),asOf=5*STEP+30;
 fs.mkdirSync(path.join(forward,'predictions'),{recursive:true});
 function save(file,r){fs.mkdirSync(path.dirname(file),{recursive:true});const raw=Buffer.from(JSON.stringify(r));fs.writeFileSync(file,raw);sources.push({file,sha256:hash(raw)});return raw;}
 function snapshot(last,version){return {id:`btc-${last*STEP}-${version}`,asset:'btc',symbol:'BTCUSDT',version,createdAt:(last+1)*STEP,settings:{market:'spot',now:(last+1)*STEP},bars:{m15:Array.from({length:last+1},(_,i)=>[i*STEP,100,102,99,101,5])}};}
 function prediction(last,version,persistedAt){const s=snapshot(last,version),r={id:s.id,asset:'btc',market:'spot',symbol:'BTCUSDT',engineVersion:version,specId:Forward.SPEC.id,snapshot:s,cutoff:s.settings.now,latestInfoEventAt:s.settings.now,entryAt:(last+2)*STEP,generatedAt:s.settings.now+15,transport:{receivedAt:s.settings.now+10},clockBounds:{valid:true,upperOffsetMs:0},issues:[],prediction:{direction:'SHORT',pullbackConfirmed:false,exitLong:false,exitShort:false},codeHashes:Object.fromEntries(['strategy-core.js','flow-core.js','smc-core.js','market-feed.js'].map(k=>[k,'test-hash']))};
  const file=path.join(forward,'predictions',r.id,'prediction.json'),raw=save(file,r);save(path.join(path.dirname(file),'receipt.json'),{persistedAt: persistedAt??s.settings.now+20,predictionSha256:hash(raw)});records.push({snapshot:s,firstObservedAt:r.transport.receivedAt,file,sha256:hash(raw)});evidence.set(r.id,r);return r;}
 const first=prediction(0,'v1');if(overlap)prediction(0,'v2');
 if(legacy){const s=snapshot(4,'prices'),r={snapshot:s,firstObservedAt:5*STEP+10},file=path.join(root,'cohort-v1','snapshots','prices.json'),raw=save(file,r);records.push({...r,file,sha256:hash(raw)});}else prediction(4,'prices',late?6*STEP:undefined);
 const report=Score.scorecard(Forward.evaluate(forward,records,asOf),evidence,{asOf});
 return {root,first,report,manifest:{asOf,sourceFiles:sources},read:f=>fs.readFileSync(f)};
}
test('original scorecard replays exactly; receipted closed prices verify without profitability claims',t=>{
 const f=fixture(t),before=JSON.stringify(f.report),r=A.audit(f.report,f.manifest,f.read),w=r.rows.find(x=>x.id===f.first.id).windows.find(x=>x.horizon===1);
 assert.equal(r.replayMatches,true);assert.equal(w.receiptComplete,true);assert.equal(w.classified.receipted,1);assert.equal(w.slots[0].sources,undefined);assert.equal(w.slots[0].sourceEvidence.receiptedSourceCount,1);assert.match(w.slots[0].sourceEvidence.evidenceSha256,/^[a-f0-9]{64}$/);assert.equal(r.accuracyProven,false);assert.equal(JSON.stringify(f.report),before);
 const g=r.partitions.find(p=>p.engineVersion==='v1').horizons[1].all;assert.equal(g.reportedEvaluable,1);assert.equal(g.verifiedPriceWindows,1);assert.equal(g.rejectedPriceWindows,0);assert.equal(g.costs,undefined);
});
test('legacy declarations and future persistence cannot certify original evaluable outcomes',t=>{
 for(const options of [{legacy:true},{late:true}]){const f=fixture(t,options),r=A.audit(f.report,f.manifest,f.read),g=r.partitions.find(p=>p.engineVersion==='v1').horizons[1].all;assert.equal(g.reportedEvaluable,1);assert.equal(g.verifiedPriceWindows,0);assert.equal(g.rejectedPriceWindows,1);if(options.late)assert.equal(r.sourceCounts.futurePersistence,1);}
});
test('pending windows and cross-version full reservations are preserved',t=>{
 const f=fixture(t,{overlap:true}),r=A.audit(f.report,f.manifest,f.read),p=r.partitions.find(p=>p.engineVersion==='v1'),excluded=r.partitions.find(p=>p.engineVersion==='v2');assert.equal(p.horizons[4].all.reportedEvaluable,0);assert.equal(p.horizons[4].all.pendingOrUnverifiedWindows,1);assert.equal(excluded.horizons[1].all.reservedWindows,0);assert.equal(excluded.horizons[1].all.verifiedPriceWindows,0);
});
test('tampered report, manifest, missing receipt and concurrently changed originals fail closed',t=>{
 const f=fixture(t),changed=structuredClone(f.report);changed.partitions[0].horizons[1].all.evaluable++;assert.throws(()=>A.audit(changed,f.manifest,f.read),/cannot be reproduced/);
 const wrong=structuredClone(f.manifest);wrong.sourceFiles[0].sha256='bad';assert.throws(()=>A.audit(f.report,wrong,f.read),/hash mismatch/);
 const missing=structuredClone(f.manifest);missing.sourceFiles=missing.sourceFiles.filter(m=>!m.file.endsWith('receipt.json'));assert.throws(()=>A.audit(f.report,missing,f.read),/Missing original prediction receipt/);
 let count=0;const target=f.manifest.sourceFiles[0].file;assert.throws(()=>A.audit(f.report,f.manifest,file=>file===target&&++count>1?Buffer.from('{}'):f.read(file)),/hash mismatch|changed during/);
});
test('file runner pins original report bytes and auditor implementations',t=>{
 const f=fixture(t),directory=path.join(f.root,'report'),manifest={...f.manifest,codeSha256:hash(fs.readFileSync(path.join(__dirname,'../research-scorecard.cjs')))};
 fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(f.report));fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));
 const result=A.run(directory);assert.equal(result.replayMatches,true);assert.equal(Object.keys(result.auditorCodeHashes).length,6);assert.match(result.input.reportSha256,/^[a-f0-9]{64}$/);
 manifest.codeSha256='changed';fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));assert.throws(()=>A.run(directory),/Original scorecard implementation changed/);
});
