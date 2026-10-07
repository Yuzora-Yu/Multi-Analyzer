/* Offline capture-latency diagnostics. Original forecasts and gates remain unchanged. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const F=require('./research-forward.cjs'),Z=require('./research-zones.cjs'),W=require('./research-zone-windows.cjs'),Score=require('./research-scorecard.cjs'),{atomicJSON}=require('./research-audit.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function sourceCreationTiming(r,b){
 const created=r.snapshot?.createdAt,close=r.targetBarClosedAt,received=r.transport?.receivedAt,issues=[];
 if(!b.valid||![created,close,received].every(Number.isFinite))issues.push('source-clock-or-timestamp-unavailable');
 else if(created<close||created>received+b.upperOffsetMs||(r.sourceCreatedAt!=null&&r.sourceCreatedAt!==created))issues.push('source-event-chronology');
 return issues.length?{available:false,issues,creationAfterCloseMs:null,receiptMinusCreationBoundsMs:null}:{available:true,issues:[],creationAfterCloseMs:created-close,receiptMinusCreationBoundsMs:[received+b.lowerOffsetMs-created,received+b.upperOffsetMs-created]};
}
function timing(r,receipt){
 const b=F.clockBounds(r.clockMeasurement);assert.deepEqual(b,r.clockBounds,'Original clock bounds differ from recomputation');
 const t=r.transport,close=r.targetBarClosedAt,issues=[];
 if(![close,t?.requestedAt,t?.receivedAt,r.generatedAt,receipt.persistedAt].every(Number.isFinite)||t.requestedAt>t.receivedAt||t.receivedAt>r.generatedAt||r.generatedAt>receipt.persistedAt)issues.push('invalid-local-event-sequence');
 if(!b.valid)issues.push('clock-unbounded');
 if(issues.length)return {available:false,issues,clock:b,components:null,fresh:null};
 const components={requestRelativeCloseMs:t.requestedAt-close,snapshotRequestMs:t.receivedAt-t.requestedAt,afterSnapshotReceiptMs:r.generatedAt-t.receivedAt,clockUpperOffsetMs:b.upperOffsetMs,persistenceAfterGenerationMs:receipt.persistedAt-r.generatedAt};
 const nominalGenerationAgeMs=r.generatedAt-close,conservativeGenerationAgeMs=nominalGenerationAgeMs+b.upperOffsetMs;
 assert.equal(components.requestRelativeCloseMs+components.snapshotRequestMs+components.afterSnapshotReceiptMs+components.clockUpperOffsetMs,conservativeGenerationAgeMs,'Latency components do not reconcile');
 const generationAgeBoundsMs=[nominalGenerationAgeMs+b.lowerOffsetMs,conservativeGenerationAgeMs];
 return {available:true,clock:b,components,sourceCreationTiming:sourceCreationTiming(r,b),generationAgeBoundsMs,freshnessClassification:conservativeGenerationAgeMs<0?'negative-age':conservativeGenerationAgeMs<=W.SPEC.maxSourceAgeMs?'within-bound':generationAgeBoundsMs[0]>W.SPEC.maxSourceAgeMs?'above-bound':'boundary-uncertain',nominalGenerationAgeMs,conservativeGenerationAgeMs,fresh:conservativeGenerationAgeMs>=0&&conservativeGenerationAgeMs<=W.SPEC.maxSourceAgeMs,
  thresholdMs:W.SPEC.maxSourceAgeMs,overThresholdMs:Math.max(0,conservativeGenerationAgeMs-W.SPEC.maxSourceAgeMs),
  monitorCreationRelativeCloseMs:Number.isFinite(r.snapshot?.createdAt)?r.snapshot.createdAt-close:null,
  note:'Request-relative-close includes unknown orchestration/scheduling waits; it is not measured scheduler latency. Receipt-minus-creation compares server metadata with exchange-bounded local receipt, assuming the monitor server clock is aligned to exchange time. Monitor clock error is unmeasured: these differences are not certified physical duration bounds or measured collector duration. A negative lower difference is retained. afterSnapshotReceipt includes clock request and local preparation, not pure CPU time. Persistence delay is separate from generation-age freshness.'};
}
function distribution(values){if(values.some(v=>!Number.isFinite(v)))throw Error('Nonfinite timing value');const a=[...values].sort((x,y)=>x-y);return {count:a.length,minMs:a[0]??null,medianMs:a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null,p90NearestRankMs:a.length?a[Math.ceil(a.length*.9)-1]:null,maxMs:a.at(-1)??null};}
function summarize(rows){
 const groups=new Map();for(const r of rows){const key=JSON.stringify(r.identity);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 return [...groups.values()].map(list=>{const post=list.filter(r=>r.postRegistration===true),available=post.filter(r=>r.timing.available);return {identity:list[0].identity,allSources:list.length,postRegistration:post.length,beforeRegistration:list.filter(r=>r.postRegistration===false).length,registrationClockUnknown:list.filter(r=>r.postRegistration===null).length,baseSourceEligible:post.filter(r=>r.baseEligibility.eligible).length,timingAvailable:available.length,freshWithin120Seconds:available.filter(r=>r.timing.fresh).length,excludedByFreshnessAlone:post.filter(r=>r.baseEligibility.eligible&&r.timing.available&&!r.timing.fresh).length,
  simultaneousIssues:Object.fromEntries([...new Set(post.flatMap(r=>r.baseEligibility.issues))].sort().map(issue=>[issue,post.filter(r=>r.baseEligibility.issues.includes(issue)).length])),
  timing:Object.fromEntries(['conservativeGenerationAgeMs','monitorCreationRelativeCloseMs'].map(k=>[k,distribution(available.map(r=>r.timing[k]).filter(Number.isFinite))])),
  components:Object.fromEntries(['requestRelativeCloseMs','snapshotRequestMs','afterSnapshotReceiptMs','clockUpperOffsetMs','persistenceAfterGenerationMs'].map(k=>[k,distribution(available.map(r=>r.timing.components[k]))])),
  sourceCreationTiming:{available:available.filter(r=>r.timing.sourceCreationTiming?.available).length,unavailable:available.filter(r=>!r.timing.sourceCreationTiming?.available).length,creationAfterClose:distribution(available.filter(r=>r.timing.sourceCreationTiming?.available).map(r=>r.timing.sourceCreationTiming.creationAfterCloseMs)),receiptMinusCreationLower:distribution(available.filter(r=>r.timing.sourceCreationTiming?.available).map(r=>r.timing.sourceCreationTiming.receiptMinusCreationBoundsMs[0])),receiptMinusCreationUpper:distribution(available.filter(r=>r.timing.sourceCreationTiming?.available).map(r=>r.timing.sourceCreationTiming.receiptMinusCreationBoundsMs[1]))}};});
}
function run(base=path.join(__dirname,'.runtime/hourly-observation'),asOf=Date.now()){
 if(!Number.isFinite(asOf))throw Error('Invalid audit as-of');const root=path.join(base,'research-zone-windows-v1');if(!fs.existsSync(path.join(root,'registration.json')))throw Error('Existing decision-window registration required');const registration=W.register(root),dir=path.join(base,'research-forward/predictions'),inventory=()=>fs.readdirSync(dir).filter(n=>!n.startsWith('.')).sort(),names=inventory(),bytes=new Map(),read=f=>{const b=fs.readFileSync(f);bytes.set(f,b);return b;},rows=[];
 read(path.join(root,'registration.json'));const analysisHashes=Object.fromEntries(['research-source-timing.cjs','research-scorecard.cjs'].map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
 for(const name of names){const folder=path.join(dir,name),raw=read(path.join(folder,'prediction.json')),r=JSON.parse(raw),receipt=JSON.parse(read(path.join(folder,'receipt.json')));if(hash(raw)!==receipt.predictionSha256)throw Error('Original receipt hash mismatch');if(receipt.persistedAt>asOf)continue;
  const baseEligibility=Z.verifySource(r,receipt,registration,hash(raw),asOf),t=timing(r,receipt),postRegistration=t.clock.valid?r.targetBarClosedAt>registration.registeredAt+Math.max(0,t.clock.upperOffsetMs):null;
  rows.push({id:r.id,sourceClosedAt:r.targetBarClosedAt,persistedAt:receipt.persistedAt,identity:{asset:r.asset,market:r.market,symbol:r.symbol,engineVersion:r.engineVersion,...Score.signature(r)},postRegistration,baseEligibility,timing:t});
 }
 if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Duplicate original source IDs');
 for(const [f,b]of bytes)if(hash(fs.readFileSync(f))!==hash(b))throw Error('Original timing source changed');assert.deepEqual(inventory(),names,'Original inventory changed');W.register(root);for(const [f,h]of Object.entries(analysisHashes))if(hash(fs.readFileSync(path.join(__dirname,f)))!==h)throw Error('Timing audit code changed');
 const output=path.join(base,'research-source-timing-reports');fs.mkdirSync(output,{recursive:true});const file=path.join(output,Date.now()+'-'+crypto.randomUUID()+'.json');atomicJSON(file,{schema:1,asOf,method:'Original source-gate replay and clock-bound recomputation; component conservation checked. Diagnostics only; no counterfactual source is promoted.',rows,partitions:summarize(rows),manifest:[...bytes].map(([file,b])=>({file,sha256:hash(b)})),analysisHashes,collectorExecuted:false,productionChanged:false,accuracyProven:false});return {file,sources:rows.length,postRegistration:rows.filter(r=>r.postRegistration===true).length,partitions:summarize(rows),accuracyProven:false};
}
if(require.main===module){try{console.log(JSON.stringify(run(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={timing,distribution,summarize,run,sourceCreationTiming};
