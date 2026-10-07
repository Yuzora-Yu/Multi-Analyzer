/* Parent-owned capture-first workflow. No collector, retries, alerts or new study. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Forward=require('./research-forward.cjs'),Bridge=require('./research-reference-bridge.cjs'),Feed=require('./market-feed');
const {atomicJSON}=require('./research-audit.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const BASE=path.join(__dirname,'.runtime/hourly-observation');
const FILES=['research-capture-reference.cjs','research-reference-bridge.cjs','research-forward.cjs','research-audit.cjs','research-reference.cjs','research-retest.cjs','research-retest-outcomes.cjs','strategy-core.js','flow-core.js','smc-core.js','market-feed.js'];
function pins(){return Object.fromEntries(FILES.map(n=>[n,hash(fs.readFileSync(path.join(__dirname,n)))]));}
function unchanged(before){if(JSON.stringify(before)!==JSON.stringify(pins()))throw Error('Workflow dependencies changed during execution');}
function roots(base){return {forward:path.join(base,'research-forward'),reference:path.join(base,'research-reference-v1'),output:path.join(base,'research-capture-reference')};}
function registered(base){
 const r=roots(base),specRaw=fs.readFileSync(path.join(r.forward,'spec.json')),referenceRaw=fs.readFileSync(path.join(r.reference,'registration.json'));
 const spec=JSON.parse(specRaw),reference=JSON.parse(referenceRaw);delete spec.registeredAt;
 if(JSON.stringify(spec)!==JSON.stringify(Forward.SPEC))throw Error('Existing forward spec differs');
 if(!Number.isFinite(reference.registeredAt))throw Error('Existing reference registration missing timestamp');
 for(const [file,expected] of Object.entries({...reference.codeHashes,...reference.engineHashes})){
   if(!FILES.includes(file)||hash(fs.readFileSync(path.join(__dirname,file)))!==expected)throw Error('Existing reference dependency mismatch: '+file);
 }
 return {...r,registrations:{forward:hash(specRaw),reference:hash(referenceRaw)}};
}
function registrationUnchanged(r){if(hash(fs.readFileSync(path.join(r.forward,'spec.json')))!==r.registrations.forward||hash(fs.readFileSync(path.join(r.reference,'registration.json')))!==r.registrations.reference)throw Error('Registration changed during execution');}
async function capture({base=BASE,fetchImpl=globalThis.fetch,now=Date.now,policy=Feed.collectionPolicy,prepare=Forward.prepare,persist=Forward.persist,bridge=Bridge.bridge}={}){
 const r=registered(base),codeHashes=pins(),startedAt=now(),attempts=[];let networkRequests=0;
 async function get(url){const requestedAt=now();networkRequests++;const response=await fetchImpl(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const raw=await response.text(),receivedAt=now();return {raw,data:JSON.parse(raw),transport:{url,requestedAt,receivedAt,responseSha256:hash(raw)}};}
 for(const asset of ['gold','btc']){
   const attempt={asset,startedAt:now(),status:'skipped'};
   if(!policy(asset,attempt.startedAt).allowed){attempt.reason='market-closed';attempts.push(attempt);continue;}
   try{
     const fetched=await get('https://multi-analyzer-monitor.rikai-829.workers.dev/api/snapshot?asset='+asset);
     if(fetched.data.asset!==asset)throw Error('Wrong asset returned');
     const time=await get('https://api.bybit.com/v5/market/time');
     if(time.data.retCode!==0||!Number.isFinite(Number(time.data.time)))throw Error('Exchange clock unavailable');
     const clock={...time.transport,serverTime:Number(time.data.time),raw:time.data};
     const record=prepare(fetched.data,fetched.transport,clock,now());record.snapshotResponseText=fetched.raw;
     unchanged(codeHashes);registrationUnchanged(r);
     const saved=persist(r.forward,record);Object.assign(attempt,{id:record.id,frozen:saved});
     // Bridge reads persisted originals, including on reuse. Never pass the transient new record.
     attempt.bridge=bridge([saved.directory],{root:r.reference,now});
     attempt.status=attempt.bridge.attempts.some(a=>a.status==='rejected')?'rejected':'captured';
   }catch(error){attempt.status='rejected';attempt.reason=error.message;}
   attempt.completedAt=now();attempts.push(attempt);
 }
 unchanged(codeHashes);registrationUnchanged(r);
 const result={schema:1,workflowId:'capture-first-existing-reference-v1',startedAt,completedAt:now(),codeHashes,registrations:r.registrations,attempts,networkRequests,collectorExecuted:false,evaluationExecuted:false,mailSent:false,accuracyProven:false,
   note:'Same normal snapshot/clock budget, immediate per-asset bridge before expensive collector/evaluation. Original delay, clock, registration, causal replay and future-entry guards remain unchanged. Reused/skipped sources are not fresh observations.'};
 fs.mkdirSync(r.output,{recursive:true});const file=path.join(r.output,'capture-'+result.completedAt+'-'+crypto.randomUUID()+'.json');atomicJSON(file,result);return {file,...result};
}
function evaluateOffline({base=BASE,now=Date.now,evaluate=Forward.evaluate}={}){
 const r=registered(base),codeHashes=pins(),asOf=now(),records=[],manifest=[];
 const directories=['cohort-v1/snapshots','research-forward/predictions'],inventory=directories.map(n=>fs.readdirSync(path.join(base,n)).sort());
 const read=file=>{const raw=fs.readFileSync(path.join(base,file));manifest.push({file,sha256:hash(raw)});return JSON.parse(raw);};
 read('research-forward/spec.json');read('research-reference-v1/registration.json');
 for(const name of fs.readdirSync(path.join(base,'cohort-v1/snapshots')).filter(n=>n.endsWith('.json'))){const file='cohort-v1/snapshots/'+name,s=read(file);records.push({...s,file,sha256:manifest.at(-1).sha256});}
 for(const id of fs.readdirSync(path.join(r.forward,'predictions')).filter(n=>!n.startsWith('.'))){const file='research-forward/predictions/'+id+'/prediction.json',s=read(file);read('research-forward/predictions/'+id+'/receipt.json');records.push({snapshot:s.snapshot,firstObservedAt:s.transport.receivedAt,file,sha256:manifest.at(-2).sha256});}
 const rows=evaluate(r.forward,records,asOf);
 if(JSON.stringify(inventory)!==JSON.stringify(directories.map(n=>fs.readdirSync(path.join(base,n)).sort())))throw Error('Source inventory changed during evaluation');
 for(const source of manifest)if(hash(fs.readFileSync(path.join(base,source.file)))!==source.sha256)throw Error('Original source changed during evaluation: '+source.file);
 unchanged(codeHashes);registrationUnchanged(r);
 const result={evaluatedAt:asOf,specId:Forward.SPEC.id,rows};
 const out=path.join(r.output,'evaluations');fs.mkdirSync(out,{recursive:true});const staging=fs.mkdtempSync(path.join(out,'.evaluation-'));
 atomicJSON(path.join(staging,'evaluation.json'),result);atomicJSON(path.join(staging,'manifest.json'),{schema:1,asOf,completedAt:now(),sourceFiles:manifest,codeHashes,registrations:r.registrations,networkRequests:0,collectorExecuted:false,captureExecuted:false,accuracyProven:false});
 const directory=path.join(out,asOf+'-'+crypto.randomUUID());fs.renameSync(staging,directory);
 return {directory,rows:rows.length,prospectiveEligible:rows.filter(x=>x.receipt.prospectiveEligible).length,networkRequests:0,collectorExecuted:false,captureExecuted:false};
}
if(require.main===module){const mode=process.argv[2];Promise.resolve().then(()=>{
 if(process.argv.length!==3||!['capture','evaluate'].includes(mode))throw Error('Use capture (parent normal run only) or evaluate (existing receipts only)');
 return mode==='capture'?capture():evaluateOffline();
}).then(result=>{console.log(JSON.stringify(result,null,2));if(result.attempts?.some(a=>a.status==='rejected'))process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={capture,evaluateOffline,registered};
