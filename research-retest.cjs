/* Analysis-only prospective sequence protocol. Never imported by the live engine. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const SPEC={id:'post-exit-choch-retest-v2',timeframeMinutes:15,searchBars:4,stopBufferATR:0.1,guardMs:60000,maxDelayMs:120000,
  purpose:'Analysis-only, distinct from legacy EMA13 rule B and inaccessible next-open reversal. No live alert or order changes.',
  trigger:'Matched tracked-position EXIT on a fresh closed 15m bar. Warning flags alone are not a matched-position EXIT. Both flags or missing position reject the trigger.',
  sequence:'Opposite-direction CHoCH recognized on one of the next four consecutive closed bars; freeze its exact level and recognition-bar adverse extreme. A later bar must touch that level and close strictly back on the intended side. No same-bar break/retest.',
  invalidation:'Before entry, close beyond the frozen recognition-bar adverse extreme invalidates. No replacing the break level or extending the four-bar deadline. Missing consecutive observations make the episode incomplete.',
  entry:'Intent only until separately persisted before a future 15m boundary with a 60s clock-upper-bound guard. Never backdate to the bar close or original next open. A later price observation must check pre-entry invalidation before any hypothetical fill.',
  stop:'Retest arm: beyond the worse of recognition-bar and retest-bar adverse extremes plus 0.1 retest ATR; immediate arm: beyond EXIT-bar extreme plus 0.1 EXIT ATR. Original bounds remain immutable. Entry gap beyond stop means no fill.',
  controls:'Keep stored P, EXIT_LONG, EXIT_SHORT and exact no-sign flags. Separate matched EXIT episodes, immediate post-save reversal intents, CHoCH-retest intents and no-trade. Do not pool overlapping groups.',
  partitions:'Separate asset, physical market, symbol, engine version/code and static configuration; Gold sessions/weekend policy and BTC spot remain separate.',
  evaluation:'Untouched future period only for validation. Require all fixed-wallclock bars at horizons 4/8/16, costs 7/14/21bps, full-window reservations including missing/pending, stop-first ambiguity, gap/slippage and funding/spread unknowns. No realized P&L or independence claims from OHLC.',
  adoption:'Disabled. No threshold selection from replay or 30 samples. Additional untouched chronological validation with trial accounting and independent-event uncertainty is required before a separate adoption proposal.'};
function validBar(b){return b&&[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.time%STEP===0&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low;}
function validObservation(o){return validBar(o?.bar)&&Number.isFinite(o.observedAt)&&o.observedAt>=o.bar.time+STEP&&o.observedAt-o.bar.time-STEP<=SPEC.maxDelayMs&&o.qualityFresh===true&&Number.isFinite(o.atr)&&o.atr>0;}
function controls(o){const p=o.flags||{};return {P:p.pullbackConfirmed===true,EXIT_LONG:p.exitLong===true,EXIT_SHORT:p.exitShort===true,noSign:p.pullbackConfirmed===false&&p.exitLong===false&&p.exitShort===false};}
function intent(episode,o,arm,stop){return {specId:SPEC.id,episodeId:episode.id,arm,direction:episode.direction,confirmedBarAt:o.bar.time,availableAt:o.observedAt,
  level:episode.break?.level??null,structuralInvalidation:episode.break?.invalidation??null,stop,
  status:'intent-needs-prospective-persistence',entryAt:null,productionUse:'analysis-only'};}
function start(o){
  if(!validObservation(o))return {status:'rejected',reason:'invalid-stale-or-delayed-observation',controls:controls(o||{})};
  if(!['asset','market','symbol','engineVersion','codeHash','configurationHash','id'].every(k=>typeof o[k]==='string'&&o[k].length>0))return {status:'rejected',reason:'missing-market-or-version-identity',controls:controls(o)};
  const p=o.referencePosition,f=o.flags||{},long=o.positionDecision==='EXIT_LONG',short=o.positionDecision==='EXIT_SHORT';
  if(long===short||f.exitLong===true&&f.exitShort===true||!p||!Number.isFinite(p.entry)||p.entry<=0||p.direction!==(long?'LONG':'SHORT')||!(long?f.exitLong===true:f.exitShort===true))return {status:'rejected',reason:'no-unambiguous-matched-position-exit',controls:controls(o)};
  const identity=Object.fromEntries(['asset','market','symbol','engineVersion','codeHash','configurationHash'].map(k=>[k,o[k]]));
  const direction=long?'SHORT':'LONG',episode={schema:1,id:o.id,identity,direction,originAt:o.bar.time,lastAt:o.bar.time,deadlineAt:o.bar.time+SPEC.searchBars*STEP,
    status:'awaiting-choch',break:null,controls:controls(o),intents:[]};
  episode.intents.push(intent(episode,o,'post-save-reversal',direction==='LONG'?o.bar.low-SPEC.stopBufferATR*o.atr:o.bar.high+SPEC.stopBufferATR*o.atr));
  return episode;
}
function advance(previous,o){
  const e=structuredClone(previous);
  if(!['awaiting-choch','awaiting-retest'].includes(e.status))return e;
  if(Object.entries(e.identity).some(([key,value])=>o?.[key]!==value))return {...e,status:'incomplete',reason:'market-or-engine-identity-changed'};
  if(!validObservation(o)||o.bar.time!==e.lastAt+STEP)return {...e,status:'incomplete',reason:'missing-consecutive-fresh-observation'};
  const b=o.bar;e.lastAt=b.time;
  if(b.time>e.deadlineAt)return {...e,status:'expired',reason:'four-bar-window-ended'};
  if(e.break){
    const invalid=e.direction==='LONG'?b.close<e.break.invalidation:b.close>e.break.invalidation;
    if(invalid)return {...e,status:'invalidated',reason:'frozen-recognition-extreme-broken'};
    const retest=e.direction==='LONG'?b.low<=e.break.level&&b.close>e.break.level:b.high>=e.break.level&&b.close<e.break.level;
    if(retest){
      const stop=e.direction==='LONG'?Math.min(e.break.invalidation,b.low)-SPEC.stopBufferATR*o.atr:Math.max(e.break.invalidation,b.high)+SPEC.stopBufferATR*o.atr;
      e.intents.push(intent(e,o,'choch-retest',stop));e.status='confirmed-intent';return e;
    }
  }else{
    const side=e.direction==='LONG'?'bull':'bear';
    const events=(o.events||[]).filter(x=>x.type==='CHoCH'&&x.side===side&&x.time===b.time&&Number.isFinite(x.price)&&x.price>0&&(side==='bull'?b.close>x.price:b.close<x.price));
    // Ambiguous simultaneous levels are not selected retrospectively.
    if(events.length>1)return {...e,status:'incomplete',reason:'ambiguous-choch-level'};
    if(events.length===1){e.break={level:events[0].price,recognizedAt:b.time,availableAt:o.observedAt,invalidation:e.direction==='LONG'?b.low:b.high};e.status='awaiting-retest';}
  }
  if(b.time===e.deadlineAt)return {...e,status:'expired',reason:'no-later-qualifying-retest-in-four-bars'};
  return e;
}
function checkpoint(plan,{persistedAt,clockUpperOffsetMs,registeredAt}){
  if(!Number.isFinite(plan?.availableAt)||![persistedAt,clockUpperOffsetMs,registeredAt].every(Number.isFinite)||persistedAt<plan.availableAt||registeredAt>plan.availableAt||Math.abs(clockUpperOffsetMs)>120000)throw Error('Invalid prospective checkpoint sequence/clock');
  const entryAt=Math.ceil((Math.max(persistedAt,persistedAt+clockUpperOffsetMs)+SPEC.guardMs+1)/STEP)*STEP;
  return {...structuredClone(plan),entryAt,persistedAt,registeredAt,clockUpperOffsetMs,status:'saved-hypothetical-entry',prospectiveEvidence:'Requires verified immutable receipt, matching code/registration and pre-entry invalidation check; timestamps alone are not eligibility proof.'};
}
function register(root=path.join(__dirname,'.runtime','hourly-observation','research-retest')){
  fs.mkdirSync(root,{recursive:true});const file=path.join(root,'registration.json'),specSha256=hash(JSON.stringify(SPEC)),codeSha256=hash(fs.readFileSync(__filename));
  if(fs.existsSync(file)){const r=JSON.parse(fs.readFileSync(file));if(r.specSha256!==specSha256||r.codeSha256!==codeSha256)throw Error('Registered spec/code differs; create a new study directory/version');return r;}
  const r={registeredAt:Date.now(),specSha256,codeSha256,spec:SPEC,status:'registered-not-yet-observing',historicalReplayEligible:false,productionAdoption:false};
  // Link publication is exclusive; a concurrent registrar cannot replace the first registration.
  const staging=path.join(root,'.registration-'+crypto.randomUUID()+'.json');atomicJSON(staging,r);
  try{fs.linkSync(staging,file);}finally{fs.unlinkSync(staging);}return r;
}
function auditLegacy(root=path.join(__dirname,'.runtime','hourly-observation')){
  const source=path.join(root,'cohort-v1'),names=['post-exit-spec-v1.json','rule-b.cjs','compare-exits.cjs','exit-comparison.json','exit-summary.json','post-exit-observations-v1.jsonl'];
  const raw=Object.fromEntries(names.map(n=>[n,fs.readFileSync(path.join(source,n))])),manifest=names.map(n=>({file:n,sha256:hash(raw[n]),bytes:raw[n].length}));
  const spec=JSON.parse(raw['post-exit-spec-v1.json']),comparison=JSON.parse(raw['exit-comparison.json']),summary=JSON.parse(raw['exit-summary.json']);
  const results=(comparison.result||[]).flatMap(row=>(row.results||[]).map(r=>({...r,asset:row.asset}))),counts={};
  for(const asset of ['gold','btc'])for(const arm of ['A','B']){
    const rows=results.filter(r=>r.asset===asset&&r.rule===arm&&r.horizon===8);
    counts[asset+'/'+arm]={rows:rows.length,resolved:rows.filter(r=>r.status==='resolved').length,
      reportedBeforeEntry:rows.filter(r=>r.originObservedBeforeEntry===true&&r.triggerObservedBeforeEntry===true).length,
      eligibleProspectiveChochRetest:0};
  }
  const report={auditedAt:Date.now(),sourceSpecCreatedAt:spec.createdAt,comparisonAt:comparison.at,summaryAt:summary.at,counts,
    findings:[{severity:'invalid-comparison-label',declared:'Later CHoCH then retest of its frozen structure level.',implemented:'EMA13 recurrence seeded from reconstructed current engine plus touch and origin-candle extreme break.',
      evidence:['post-exit-spec-v1.json arms.structureRetest','rule-b.cjs trigger','compare-exits.cjs original snapshot EMA13 seed'],consequence:'Rule B is a separate EMA13 hypothesis. This comparison cannot validate the declared CHoCH-retest arm.'},
      {severity:'unverified-causal-version',evidence:'compare-exits.cjs loads the current strategy-core rather than verifying the original engine code hash.',consequence:'Reconstructed EMA13 features must not be called immutable original predictions.'},
      {severity:'unverified-trigger',evidence:'Comparison filters EXIT flags; it does not require a tracked reference position or matched positionDecision.',consequence:'Warning flags alone cannot establish matched-position EXIT execution.'},
      {severity:'chronology',evidence:'exit-summary timestamp precedes the spec createdAt field.',consequence:'Date fields alone cannot certify preregistration; preserve both and audit their independent provenance.'}],
    originalRecordsChanged:false,productionUse:'none',outcomeOptimization:false,interpretation:'Separate 3-row narrative observations and automated EMA13 comparison; no pooled win rate or accuracy claim.'};
  for(const item of manifest)if(hash(fs.readFileSync(path.join(source,item.file)))!==item.sha256)throw Error('Legacy source changed during audit');
  const output=path.join(root,'research-retest-audit');fs.mkdirSync(output,{recursive:true});const staging=fs.mkdtempSync(path.join(output,'.staging-'));
  atomicJSON(path.join(staging,'report.json'),report);atomicJSON(path.join(staging,'manifest.json'),{sources:manifest,scriptSha256:hash(fs.readFileSync(__filename)),collectorExecuted:false});
  const directory=path.join(output,report.auditedAt+'-'+crypto.randomUUID());fs.renameSync(staging,directory);return {directory,findings:report.findings,counts};
}
if(require.main===module){const command=process.argv[2];if(!['register','audit-legacy'].includes(command))throw Error('Only register/audit-legacy supported. No collector, strategy outcomes or alerts.');console.log(JSON.stringify(command==='register'?register():auditLegacy(),null,2));}
module.exports={SPEC,validBar,validObservation,controls,start,advance,checkpoint,register,auditLegacy};
