/* Read-only replay of reference journals before linking any future outcomes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Reference=require('./research-reference.cjs'),Sequence=require('./research-retest.cjs'),Ledger=require('./research-retest-outcomes.cjs');
const Core=require('./strategy-core'),Feed=require('./market-feed'),Forward=require('./research-forward.cjs');
const {atomicJSON,indexSnapshots}=require('./research-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex'),equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function replay(rows,registration,{asOf=Date.now(),loadSource=Ledger.readSource}={}){
  let previous=null,trusted=true;const output=[];
  for(const row of [...rows].sort((a,b)=>a.journal.observation.bar.time-b.journal.observation.bar.time)){
    const j=row.journal,r=row.receipt,issues=[];
    if(!Number.isFinite(r.publishedAt)||r.publishedAt>asOf){output.push({id:j.observation.id,status:'not-published-at-cutoff',eligible:false,issues:[]});continue;}
    if(!trusted)issues.push('inherited-unverified-reference-state');
    if(row.sha256!==r.sha256||hash(JSON.stringify(j,null,2))!==r.sha256)issues.push('journal-receipt-hash-mismatch');
    if(j.specId!==Reference.SPEC.id||j.registrationSha256!==hash(JSON.stringify(registration)))issues.push('registration-mismatch');
    if(!Number.isFinite(j.generatedAt)||!Number.isFinite(r.persistedAt)||j.generatedAt>r.persistedAt||r.persistedAt>r.publishedAt)issues.push('publication-sequence-invalid');
    const expectedPrevious=previous?{barAt:previous.journal.observation.bar.time,sha256:previous.sha256}:null;
    if(!equal(j.previous,expectedPrevious))issues.push('previous-link-mismatch');
    let expectedState=null,entryAt=null,guard=false;
    try{
      const source=loadSource(j.source.directory);if(source.sha256!==j.source.sha256)throw Error('Source hash differs');
      const clock=Forward.clockBounds(source.record.clockMeasurement);
      if(!clock.valid||!Number.isFinite(registration.registeredAt)||registration.registeredAt+Math.max(0,clock.upperOffsetMs)>=source.record.targetBarClosedAt)throw Error('Registration not before source close in exchange upper clock bound');
      const o=Ledger.observation(source,registration,j.generatedAt);
      if(!clock.valid||!equal(clock,j.clockBounds)||j.generatedAt-source.record.clockMeasurement.receivedAt>60000||j.generatedAt+clock.upperOffsetMs-o.bar.time-STEP>Sequence.SPEC.maxDelayMs)throw Error('Saved derivation clock/staleness invalid');
      if(!equal(o,j.observation)||!equal(Sequence.controls(o),j.controls))throw Error('Saved observation/control differs from source replay');
      if(!Feed.collectionPolicy(o.asset,j.generatedAt+clock.upperOffsetMs).allowed)throw Error('Closed/weekend collection');
      entryAt=Math.ceil((Math.max(j.generatedAt,j.generatedAt+clock.upperOffsetMs)+Reference.SPEC.guardMs+1)/STEP)*STEP;
      guard=r.publishedAt+Math.max(0,clock.upperOffsetMs)+Reference.SPEC.guardMs<entryAt;
      if(r.futureGuardPassed!==guard)issues.push('guard-flag-not-supported-by-times');
      let priorState=previous?.expectedState;
      if(priorState){priorState=structuredClone(priorState);if(previous.guard!==true&&priorState.position?.phase==='pending'&&priorState.position.plannedAtLocal===previous.journal.generatedAt)priorState.position={...priorState.position,phase:'no-fill',closedBarAt:priorState.lastBarAt,reason:'proposal-publication-missed-guard'};}
      const analysis=Core.analyzeMarket(Feed.input(source.record.snapshot),source.record.snapshot.settings);
      expectedState=Reference.step(priorState,o,analysis,{generatedAt:j.generatedAt,decisionAt:Math.max(j.generatedAt,j.generatedAt+clock.upperOffsetMs),entryAt});
      if(!equal(expectedState,j.state))issues.push('reference-state-differs-from-causal-replay');
      if((expectedState.position?.plannedAtLocal===j.generatedAt||expectedState.intents.length)&&!Feed.collectionPolicy(o.asset,entryAt).allowed)issues.push('planned-entry-outside-session');
    }catch(e){issues.push('source-replay-failed: '+e.message);}
    if(issues.length)trusted=false;
    const eligible=trusted&&issues.length===0;
    output.push({id:j.observation.id,barAt:j.observation.bar.time,identity:j.state.identity,controls:j.controls,status:eligible?'verified':'unverified',eligible,guard,entryAt,issues,journalSha256:row.sha256,journalPublishedAt:r.publishedAt,
      position:expectedState?.position??null,events:expectedState?.events??[],intents:eligible?expectedState.intents:[]});
    previous={...row,expectedState,guard};
  }
  return output;
}
function extract(rows){
  const candidates=[],seen=new Set();
  for(const row of rows){if(!row.eligible)continue;
    for(const plan of row.intents){const id=hash([row.journalSha256,plan.episodeId,plan.arm,plan.confirmedBarAt].join('/'));if(seen.has(id))continue;seen.add(id);
      candidates.push({candidate:{id,identity:row.identity,plan,journalProof:{sha256:row.journalSha256,publishedAt:row.journalPublishedAt}},eligibility:{eligible:row.guard===true,issues:row.guard?[]:['intent-publication-missed-future-guard']}});
    }
  }
  return candidates;
}
function run(root=path.join(__dirname,'.runtime','hourly-observation','research-reference-v1')){
  const registration=Reference.register(root),asOf=Date.now(),markets=path.join(root,'markets'),manifest=[],records=[],audits=[];
  const read=file=>{const raw=fs.readFileSync(file);manifest.push({file,sha256:hash(raw)});return raw;};
  read(path.join(root,'registration.json'));
  const loadSource=directory=>{
    const raw=read(path.join(directory,'prediction.json')),r=JSON.parse(raw),receipt=JSON.parse(read(path.join(directory,'receipt.json')));
    if(hash(raw)!==receipt.predictionSha256)throw Error('Original frozen source hash mismatch');
    records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file:directory,sha256:hash(raw)});return {directory,record:r,receipt,sha256:hash(raw)};
  };
  if(fs.existsSync(markets))for(const market of fs.readdirSync(markets)){
    const dir=path.join(markets,market);if(!fs.statSync(dir).isDirectory())continue;
    const rows=[];
    for(const id of fs.readdirSync(dir).filter(n=>/^\d+$/.test(n))){const folder=path.join(dir,id),raw=read(path.join(folder,'journal.json')),receiptFile=path.join(folder,'receipt.json');
      rows.push({journal:JSON.parse(raw),receipt:fs.existsSync(receiptFile)?JSON.parse(read(receiptFile)):{},sha256:hash(raw)});
    }
    audits.push({market,rows:replay(rows,registration,{asOf,loadSource})});
  }
  // Original price archives provide outcome bars only; they are never predictions.
  const rawDir=path.join(path.dirname(root),'cohort-v1','snapshots');
  if(fs.existsSync(rawDir))for(const file of fs.readdirSync(rawDir).filter(n=>n.endsWith('.json'))){const full=path.join(rawDir,file),raw=read(full);records.push({...JSON.parse(raw),file:full,sha256:hash(raw)});}
  const index=indexSnapshots(records.filter(r=>r.firstObservedAt<=asOf)),candidates=extract(audits.flatMap(a=>a.rows)),outcomes=Ledger.evaluate(candidates,index.markets,asOf);
  for(const m of manifest)if(hash(fs.readFileSync(m.file))!==m.sha256)throw Error('Original changed during reference audit');
  const output=path.join(path.dirname(root),'research-reference-audit');fs.mkdirSync(output,{recursive:true});const staging=fs.mkdtempSync(path.join(output,'.staging-'));
  const rows=audits.flatMap(a=>a.rows),summary={journals:rows.length,verified:rows.filter(r=>r.eligible).length,candidates:candidates.length,prospectiveCandidates:candidates.filter(c=>c.eligibility.eligible).length,
    controls:Object.fromEntries(['P','EXIT_LONG','EXIT_SHORT','noSign'].map(k=>[k,rows.filter(r=>r.eligible&&r.controls[k]).length])),
    note:'Controls overlap; no-sign observations are not zero-return trades. Full-horizon reservations are not statistical independence. Untouched future outcomes only; no adoption/precision claim.'};
  atomicJSON(path.join(staging,'report.json'),{asOf,summary,audits,outcomes,sourceIssues:index.issues,collectorExecuted:false});atomicJSON(path.join(staging,'manifest.json'),{sources:manifest,auditCodeSha256:hash(fs.readFileSync(__filename))});
  const directory=path.join(output,asOf+'-'+crypto.randomUUID());fs.renameSync(staging,directory);return {directory,...summary};
}
if(require.main===module)console.log(JSON.stringify(run(),null,2));
module.exports={replay,extract,run};
