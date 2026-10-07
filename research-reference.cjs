/* Isolated P-derived reference-position benchmark; never user holdings or live alerts. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Core=require('./strategy-core'),Feed=require('./market-feed'),Forward=require('./research-forward.cjs');
const Ledger=require('./research-retest-outcomes.cjs'),Sequence=require('./research-retest.cjs');
const {atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const SPEC={id:'p-reference-lifecycle-v1',maxHoldingBars:48,guardMs:60000,
  seed:'Original confirmed P plus shared-engine actionable=true and matching LONG/SHORT plan. One reference per physical market/config/code. No EXIT-derived seed and no same-bar re-entry.',
  fill:'P-derived market-at-future-open benchmark, not execution of LIMIT_RETEST/CLOSE_CONFIRM orders. Original stop and TP2 are fixed. A pre-entry stop/target touch or entry gap beyond either gives no fill. Fill is hypothetical, learned after the entry bar closes; its plan must already be saved before that open.',
  close:'Frozen stop first, including adverse open gap; then fixed TP2 (no optimistic gap improvement), then closed-price shared position guard, then 48-bar expiry. No TP1 partial, breakeven shift, widening, pyramiding or automatic reversal.',
  exitStudy:'Only a matching confirmed yellow EXIT from a still-held reference opens a separate post-EXIT sequence. Stop/target/other guard closures are separately counted, not relabelled yellow EXIT.',
  continuity:'Every subsequent confirmed M15 observation must be consecutive and fresh, with the same market/code/config. Missing observations terminate references and episodes as incomplete, not completed trades.',
  persistence:'Immutable hash-linked journals, post-registration closed sources, verified source receipts and causal engine replay. Pending references/intents require a receipt published at least 60s before the future entry, using bounded clock upper offset.',
  scope:'Private research only. Do not modify source snapshots, production positions, SMC/P conditions or email holdings. Retain all P/EXIT/no-sign controls and no-trade/expired/incomplete records. No accuracy or executable profitability claim.'};
function empty(){return {lastBarAt:null,identity:null,position:null,episodes:[],intents:[],events:[]};}
function sameIdentity(a,b){return !a||Object.entries(a).every(([k,v])=>b[k]===v);}
function step(previous,o,analysis,{entryAt,generatedAt,decisionAt=Math.max(generatedAt,o.observedAt)}){
  const state=structuredClone(previous||empty()),b=o.bar,identity=Object.fromEntries(['asset','market','symbol','engineVersion','codeHash','configurationHash'].map(k=>[k,o[k]]));
  if(!Sequence.validObservation(o)||![generatedAt,decisionAt].every(Number.isFinite)||decisionAt<o.observedAt||decisionAt<generatedAt||!Number.isFinite(entryAt)||entryAt%STEP||entryAt<=decisionAt+SPEC.guardMs)throw Error('Invalid fresh reference observation or guarded future entry');
  state.intents=[];state.events=[];
  const continuous=state.lastBarAt===null||(b.time===state.lastBarAt+STEP&&sameIdentity(state.identity,identity));
  if(!continuous){
    if(['pending','held'].includes(state.position?.phase))state.position={...state.position,phase:'incomplete',closedBarAt:b.time,reason:'missing-observation-or-identity-change'};
    state.episodes=state.episodes.map(e=>['awaiting-choch','awaiting-retest'].includes(e.status)?{...e,status:'incomplete',reason:'missing-observation-or-identity-change'}:e);
    state.events.push({type:'incomplete-stream',barAt:b.time});
  }else state.episodes=state.episodes.map(e=>Sequence.advance(e,o));
  for(const e of state.episodes)for(const i of e.intents||[])if(i.confirmedBarAt===b.time)state.intents.push({...i,entryAt,plannedAtLocal:generatedAt,planningExchangeUpper:decisionAt,availableAtBasis:'exchange-upper-bound',status:'awaiting-publication-receipt'});
  const p=state.position,long=p?.direction==='LONG';
  const stopTouch=p&&(long?b.low<=p.stop:b.high>=p.stop),targetTouch=p&&(long?b.high>=p.target:b.low<=p.target);
  function close(phase,reason,exitPrice){state.position={...state.position,phase,reason,closedBarAt:b.time,exitPrice:exitPrice??null,closureObservedAt:o.observedAt};state.events.push({type:reason,barAt:b.time,referenceId:p.id});}
  if(continuous&&p?.phase==='pending'){
    if(b.time<p.entryAt){if(stopTouch||targetTouch)close('no-fill',stopTouch?'pre-entry-stop-touch':'pre-entry-target-touch');}
    else if(b.time===p.entryAt){
      if(long?b.open<=p.stop||b.open>=p.target:b.open>=p.stop||b.open<=p.target)close('no-fill','entry-gap-outside-fixed-bounds');
      else state.position={...p,phase:'held',entry:b.open,fillAssumedAt:p.entryAt,fillObservedAt:o.observedAt};
    }else close('incomplete','entry-bar-not-observed');
  }
  if(continuous&&state.position?.phase==='held'){
    const held=state.position,isLong=held.direction==='LONG';
    if(isLong?b.low<=held.stop:b.high>=held.stop)close('closed','frozen-stop',isLong?Math.min(b.open,held.stop):Math.max(b.open,held.stop));
    else if(isLong?b.high>=held.target:b.low<=held.target)close('closed','fixed-tp2',held.target);
    else{
      const ref={direction:held.direction,entry:held.entry,stop:held.stop,openedAt:held.entryAt,referenceOnly:true};
      const decision=Core.positionDecision(ref,analysis,b.close),matched=decision?.action===(isLong?'EXIT_LONG':'EXIT_SHORT');
      if(matched){
        const yellow=isLong?o.flags.exitLong===true:o.flags.exitShort===true;
        close('closed',yellow?'matched-yellow-exit':'other-position-guard',b.close);
        if(yellow){const e=Sequence.start({...o,id:held.id+'/'+o.id,referencePosition:ref,positionDecision:decision.action});state.episodes.push(e);for(const i of e.intents||[])state.intents.push({...i,entryAt,plannedAtLocal:generatedAt,planningExchangeUpper:decisionAt,availableAtBasis:'exchange-upper-bound',status:'awaiting-publication-receipt'});}
      }else if(b.time+STEP>=held.expiresAt)close('closed','48-bar-expiry',b.close);
    }
  }
  const canSeed=continuous&&!['pending','held'].includes(state.position?.phase)&&state.position?.closedBarAt!==b.time;
  const plan=analysis.plan,dir=analysis.direction,eligible=o.flags.pullbackConfirmed===true&&analysis.actionable===true&&['LONG','SHORT'].includes(dir)&&plan?.direction===dir;
  if(canSeed&&eligible&&[plan.entry,plan.stop,plan.tp2].every(Number.isFinite)&&plan.stop>0&&plan.tp2>0&&(dir==='LONG'?plan.stop<plan.entry&&plan.tp2>plan.entry:plan.stop>plan.entry&&plan.tp2<plan.entry)){
    state.position={id:o.id+'/P-reference',scope:'research-only',phase:'pending',direction:dir,originBarAt:b.time,plannedAtLocal:generatedAt,planningExchangeUpper:decisionAt,entryAt,expiresAt:entryAt+SPEC.maxHoldingBars*STEP,stop:plan.stop,target:plan.tp2,entry:null};
    state.events.push({type:'P-reference-planned',barAt:b.time,referenceId:state.position.id});
  }
  state.lastBarAt=b.time;state.identity=identity;state.episodes=state.episodes.slice(-32);
  return state;
}
function register(root){
  fs.mkdirSync(root,{recursive:true});const file=path.join(root,'registration.json'),fixed={spec:SPEC,sequenceSpecHash:hash(JSON.stringify(Sequence.SPEC)),codeHashes:Object.fromEntries(['research-reference.cjs','research-retest.cjs','research-retest-outcomes.cjs','research-forward.cjs'].map(n=>[n,hash(fs.readFileSync(path.join(__dirname,n)))])),engineHashes:Ledger.engineHashes()};
  if(fs.existsSync(file)){const r=JSON.parse(fs.readFileSync(file)),copy={...r};delete copy.registeredAt;if(JSON.stringify(copy)!==JSON.stringify(fixed))throw Error('Reference registration/code differs; use a new study root');return r;}
  const r={registeredAt:Date.now(),...fixed},temp=path.join(root,'.registration-'+crypto.randomUUID());atomicJSON(temp,r);try{fs.linkSync(temp,file);}finally{fs.unlinkSync(temp);}return r;
}
function readJournal(directory){
  const raw=fs.readFileSync(path.join(directory,'journal.json')),journal=JSON.parse(raw),receipt=JSON.parse(fs.readFileSync(path.join(directory,'receipt.json')));
  if(hash(raw)!==receipt.sha256)throw Error('Reference journal hash mismatch');return {journal,receipt,sha256:hash(raw)};
}
function verifyChain(dir,registration){
  const ids=fs.readdirSync(dir).filter(n=>/^\d+$/.test(n)).sort((a,b)=>Number(a)-Number(b));let previous=null;
  for(const id of ids){const row=readJournal(path.join(dir,id)),j=row.journal;
    if(j.registrationSha256!==hash(JSON.stringify(registration))||j.observation.bar.time!==Number(id)||j.source.sha256!==Ledger.readSource(j.source.directory).sha256||JSON.stringify(j.previous)!==JSON.stringify(previous?{barAt:Number(previous.id),sha256:previous.row.sha256}:null))throw Error('Reference journal source/registration/chain mismatch');
    previous={id,row};
  }
  return previous;
}
function ingestUnlocked(root,sourceDirectory){
  const registration=register(root),source=Ledger.readSource(sourceDirectory),marketKey=[source.record.asset,source.record.market,source.record.symbol].join('/'),dir=path.join(root,'markets',hash(marketKey));fs.mkdirSync(dir,{recursive:true});
  const target=path.join(dir,String(source.record.targetBarOpenAt));
  if(fs.existsSync(target)){const prior=readJournal(target);if(prior.journal.source.sha256!==source.sha256)throw Error('Source changed for a saved reference observation');return {directory:target,reused:true};}
  const now=Date.now(),clock=Forward.clockBounds(source.record.clockMeasurement);
  if(!clock.valid||now-source.record.clockMeasurement.receivedAt>60000||!Feed.collectionPolicy(source.record.asset,now+clock.upperOffsetMs).allowed)throw Error('Fresh bounded clock and open collection session required');
  const o=Ledger.observation(source,registration,now);
  if(now+clock.upperOffsetMs-o.bar.time-STEP>Sequence.SPEC.maxDelayMs)throw Error('Reference capture delayed beyond 2m; no reconstructed entry');
  const verified=verifyChain(dir,registration),last=verified?.id,previous=verified?.row;
  if(last&&Number(last)>=o.bar.time)throw Error('Out-of-order reference observation');
  let previousState=previous?.journal.state;
  if(previousState){previousState=structuredClone(previousState);if(previous.receipt.futureGuardPassed!==true&&previousState.position?.phase==='pending'&&previousState.position.plannedAtLocal===previous.journal.generatedAt){previousState.position={...previousState.position,phase:'no-fill',closedBarAt:previousState.lastBarAt,reason:'proposal-publication-missed-guard'};}}
  const analysis=Core.analyzeMarket(Feed.input(source.record.snapshot),source.record.snapshot.settings),generatedAt=Date.now(),entryAt=Math.ceil((Math.max(generatedAt,generatedAt+clock.upperOffsetMs)+SPEC.guardMs+1)/STEP)*STEP;
  if(generatedAt-source.record.clockMeasurement.receivedAt>60000||generatedAt+clock.upperOffsetMs-o.bar.time-STEP>Sequence.SPEC.maxDelayMs)throw Error('Reference derivation finished too late for fresh-clock/observation protocol');
  const decisionAt=Math.max(generatedAt,generatedAt+clock.upperOffsetMs),state=step(previousState,o,analysis,{generatedAt,decisionAt,entryAt});
  if((state.position?.plannedAtLocal===generatedAt||state.intents.length)&&!Feed.collectionPolicy(o.asset,entryAt).allowed)throw Error('Future reference/candidate entry violates market/weekend policy');
  const journal={schema:1,specId:SPEC.id,registrationSha256:hash(JSON.stringify(registration)),generatedAt,clockBounds:clock,source:{directory:sourceDirectory,sha256:source.sha256},previous:last?{barAt:Number(last),sha256:previous.sha256}:null,observation:o,controls:Sequence.controls(o),state};
  const staging=fs.mkdtempSync(path.join(dir,'.journal-'));atomicJSON(path.join(staging,'journal.json'),journal);const persistedAt=Date.now();fs.renameSync(staging,target);
  const publishedAt=Date.now(),receipt={persistedAt,publishedAt,sha256:hash(fs.readFileSync(path.join(target,'journal.json'))),futureGuardPassed:publishedAt+Math.max(0,clock.upperOffsetMs)+SPEC.guardMs<entryAt};atomicJSON(path.join(target,'receipt.json'),receipt);
  return {directory:target,reused:false,referencePhase:state.position?.phase??'none',intents:state.intents.length,events:state.events,futureGuardPassed:receipt.futureGuardPassed};
}
function ingest(root,sourceDirectory){
  fs.mkdirSync(root,{recursive:true});const lock=path.join(root,'.ingest.lock'),handle=fs.openSync(lock,'wx');
  try{fs.writeFileSync(handle,JSON.stringify({pid:process.pid,startedAt:Date.now()}));return ingestUnlocked(root,sourceDirectory);}
  finally{fs.closeSync(handle);fs.unlinkSync(lock);}
}
if(require.main===module){const root=path.join(__dirname,'.runtime','hourly-observation','research-reference-v1');if(process.argv[2]==='register')console.log(JSON.stringify(register(root),null,2));else if(process.argv[2]==='ingest'&&process.argv[3])console.log(JSON.stringify(ingest(root,path.resolve(process.argv[3])),null,2));else throw Error('Use register or ingest <already-frozen-prediction-directory>. No collector, email or orders.');}
module.exports={SPEC,empty,step,register,readJournal,verifyChain,ingest};
