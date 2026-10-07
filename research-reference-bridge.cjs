/* Parent-owned post-freeze integration. Explicit existing sources only; no network. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Reference=require('./research-reference.cjs'),Ledger=require('./research-retest-outcomes.cjs'),Forward=require('./research-forward.cjs'),Feed=require('./market-feed');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function preflight(source,registration,now){
 const r=source.record,b=Forward.clockBounds(r.clockMeasurement),upper=Math.max(now,now+(b.upperOffsetMs??0));
 if(!b.valid)return 'invalid-clock';
 if(!Number.isFinite(registration.registeredAt)||!Number.isFinite(r.targetBarClosedAt)||registration.registeredAt+Math.max(0,b.upperOffsetMs)>=r.targetBarClosedAt)return 'not-post-registration';
 if(!Number.isFinite(source.receipt.persistedAt)||source.receipt.persistedAt>now)return 'not-persisted-at-invocation';
 if(!Number.isFinite(now)||now-r.clockMeasurement.receivedAt<0||now-r.clockMeasurement.receivedAt>60000)return 'clock-expired';
 if(upper-r.targetBarClosedAt<0||upper-r.targetBarClosedAt>120000)return 'observation-not-fresh';
 if(!Feed.collectionPolicy(r.asset,upper).allowed)return 'market-closed';
 return null;
}
function bridge(directories,{root,now=Date.now,readSource=Ledger.readSource,ingest=Reference.ingest}={}){
 if(!root||!Array.isArray(directories)||!directories.length||directories.length>2)throw Error('Provide existing reference root and one or two explicit frozen directories');
 const registration=JSON.parse(fs.readFileSync(path.join(root,'registration.json'))),seen=new Set(),attempts=[];
 for(const directory of directories){const invokedAt=now(),attempt={directory:path.resolve(directory),invokedAt,status:'rejected'};
   try{const source=readSource(attempt.directory),r=source.record;Object.assign(attempt,{sourceId:r.id,sourceSha256:source.sha256,asset:r.asset,sourceClosedAt:r.targetBarClosedAt,sourcePersistedAt:source.receipt.persistedAt,clockReceivedAt:r.clockMeasurement?.receivedAt});
     if(seen.has(r.id)){attempt.reason='duplicate-explicit-source';attempts.push(attempt);continue;}seen.add(r.id);
     const reason=preflight(source,registration,invokedAt);if(reason){attempt.status='skipped';attempt.reason=reason;}
     else{attempt.result=ingest(root,attempt.directory);attempt.status=attempt.result.reused?'existing-journal':'journal-saved';}
   }catch(error){attempt.reason=error.message;}
   attempts.push(attempt);
 }
 return {schema:1,bridgeId:'explicit-post-freeze-reference-v1',invokedAt:attempts[0].invokedAt,completedAt:now(),registrationSha256:hash(JSON.stringify(registration)),attempts,collectorExecuted:false,networkRequests:0,accuracyProven:false,note:'Causal replay and immutable publication are enforced by the frozen reference actor. Skips/reused journals are not fresh forecasts. Only explicit parent freeze results are accepted; no directory scan, backfill or retries.'};
}
if(require.main===module){try{const base=path.join(__dirname,'.runtime/hourly-observation'),root=path.join(base,'research-reference-v1'),result=bridge(process.argv.slice(2),{root}),out=path.join(base,'research-reference-bridge');fs.mkdirSync(out,{recursive:true});const file=path.join(out,result.completedAt+'-'+crypto.randomUUID()+'.json');result.bridgeCodeSha256=hash(fs.readFileSync(__filename));fs.writeFileSync(file+'.tmp',JSON.stringify(result,null,2),{flag:'wx'});fs.renameSync(file+'.tmp',file);console.log(JSON.stringify({file,...result},null,2));if(result.attempts.some(a=>a.status==='rejected'))process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={bridge,preflight};
