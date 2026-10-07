/* Analysis-only immutable candidate persistence and conservative OHLC outcomes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Core=require('./strategy-core'),Feed=require('./market-feed');
const Sequence=require('./research-retest.cjs'),Forward=require('./research-forward.cjs');
const {signature}=require('./research-scorecard.cjs');
const {atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const FILES=['strategy-core.js','flow-core.js','smc-core.js','market-feed.js'];
const METHOD={id:'retest-candidate-outcomes-v1',horizons:[4,8,16],costBps:[7,14,21],
  validation:'Forward research only; no entry alerts, orders, fitted thresholds or adoption.',
  preEntry:'Every full candle between confirmation close and future entry required. Frozen structural close invalidation and stop touches exclude fills. The first pre-entry candle may include movement before persistence: conservative whole-candle exclusion, not exact tick evidence.',
  execution:'Entry at future open only if on the valid stop side. Stop gaps fill at the adverse open, intrabar stop touches at the frozen stop; otherwise horizon close. No profit target is defined. All horizon bars required even if a stop occurs early.',
  costs:'7/14/21bps hypothetical round-trip friction. Spread, slippage, funding and broker basis are unmeasured; no realized/account P&L claim.',
  overlap:'Reserve complete fixed-wallclock windows per physical market, arm and horizon across code/config partitions, including pending/missing/ineligible. Distinct arms are never summed as one portfolio.',
  eligibility:'Local file hashes and causal code replay only. Not independent timestamp certification. Older reconstructed inputs and delayed candidate persistence are ineligible.'};
function engineHashes(){return Object.fromEntries(FILES.map(file=>[file,hash(fs.readFileSync(path.join(__dirname,file)))]));}
function register(root){
  fs.mkdirSync(root,{recursive:true});const file=path.join(root,'ledger-registration.json');
  const fixed={method:METHOD,protocolSha256:hash(JSON.stringify(Sequence.SPEC)),sequenceCodeSha256:hash(fs.readFileSync(path.join(__dirname,'research-retest.cjs'))),ledgerCodeSha256:hash(fs.readFileSync(__filename)),engineHashes:engineHashes()};
  if(fs.existsSync(file)){const prior=JSON.parse(fs.readFileSync(file));const copy={...prior};delete copy.registeredAt;if(JSON.stringify(copy)!==JSON.stringify(fixed))throw Error('Registered ledger/code differs; use a new study root');return prior;}
  const value={registeredAt:Date.now(),...fixed},temp=path.join(root,'.registration-'+crypto.randomUUID());atomicJSON(temp,value);
  try{fs.linkSync(temp,file);}finally{fs.unlinkSync(temp);}return value;
}
function readSource(directory){
  const raw=fs.readFileSync(path.join(directory,'prediction.json')),receipt=JSON.parse(fs.readFileSync(path.join(directory,'receipt.json'))),record=JSON.parse(raw);
  if(hash(raw)!==receipt.predictionSha256)throw Error('Source prediction hash mismatch');
  return {directory,sha256:hash(raw),record,receipt};
}
function observation(source,registration,now){
  const r=source.record,p=source.receipt,bounds=Forward.clockBounds(r.clockMeasurement),cfg=Feed.instruments[r.asset];
  if(!cfg||r.specId!==Forward.SPEC.id||r.engineVersion!==Core.VERSION||r.snapshot.version!==Core.VERSION||r.snapshot.asset!==r.asset||r.snapshot.symbol!==r.symbol||r.snapshot.settings.market!==r.market||r.symbol!==cfg.symbol||r.market!==cfg.market||r.issues.length||!bounds.valid||r.generatedAt<r.transport.receivedAt||p.persistedAt<r.generatedAt||p.persistedAt>now||r.targetBarClosedAt<registration.registeredAt||r.latestInfoEventAt>r.cutoff||r.cutoff!==r.snapshot.settings.now)throw Error('Source is not a causal post-registration observation');
  if(FILES.some(file=>r.codeHashes[file]!==registration.engineHashes[file]))throw Error('Source engine hash mismatch');
  if(![r.generatedAt,r.transport.requestedAt,r.transport.receivedAt,p.persistedAt,r.snapshot.createdAt,r.cutoff].every(Number.isFinite)||r.transport.requestedAt>r.transport.receivedAt||r.clockMeasurement.receivedAt>r.generatedAt||r.generatedAt-r.clockMeasurement.receivedAt>60000||r.snapshot.createdAt<r.cutoff||r.snapshot.createdAt>r.transport.receivedAt+bounds.upperOffsetMs||r.cutoff<r.targetBarClosedAt||r.cutoff>=r.targetBarClosedAt+STEP)throw Error('Source timestamp bounds invalid');
  const input=Feed.input(r.snapshot);
  const eventTimes=[];
  for(const [name,minutes] of [['exec',15],['h1',60],['h4',240]])for(const b of input[name]){
    if(!Sequence.validBar(b)||!Number.isFinite(b.volume)||b.volume<0||b.time%(minutes*60000)!==0||b.time+minutes*60000>r.cutoff)throw Error('Unclosed or invalid source feature');
    eventTimes.push(b.time+minutes*60000);
  }
  if(Math.max(...eventTimes)!==r.latestInfoEventAt)throw Error('Source information availability mismatch');
  const a=Core.analyzeMarket(input,r.snapshot.settings),f=a.exec.flow?.latest||{},last=a.exec.candles.at(-1);
  if(!last||last.time!==r.targetBarOpenAt||last.time+STEP!==r.targetBarClosedAt||r.id!==r.snapshot.id||r.id!==`${r.asset}-${last.time}-${Core.VERSION}`)throw Error('Source candle/identity mismatch');
  for(const key of ['exitLong','exitShort','pullbackConfirmed'])if(f[key]!==r.prediction[key])throw Error('Source flags differ from causal engine replay');
  const sig=signature(r),upper=p.persistedAt+bounds.upperOffsetMs;
  const o={id:r.id,asset:r.asset,market:r.market,symbol:r.symbol,engineVersion:r.engineVersion,codeHash:sig.codeHash,configurationHash:sig.configurationHash,
    bar:last,observedAt:Math.max(p.persistedAt,upper),qualityFresh:[a.exec,a.h1,a.h4].every(tf=>tf.ready&&!tf.quality?.stale&&!tf.quality?.gaps),atr:a.exec.values.atr,
    flags:{exitLong:f.exitLong,exitShort:f.exitShort,pullbackConfirmed:f.pullbackConfirmed},referencePosition:r.snapshot.settings.position,positionDecision:a.positionDecision?.action,
    events:a.exec.smc?.events||[],context:{h1:a.h1.structure,h4:a.h4.structure,ema20:a.exec.values.ema20,ema50:a.exec.values.ema50,bbUpper:a.exec.values.bbUpper,bbLower:a.exec.values.bbLower},sourceSha256:source.sha256};
  if(!Sequence.validObservation(o))throw Error('Source closed observation stale/delayed/incomplete');
  return o;
}
function prepare(sources,registration,clock,now=Date.now()){
  const bounds=Forward.clockBounds(clock);
  if(!bounds.valid||clock.receivedAt>now||now-clock.receivedAt>60000)throw Error('Fresh bounded clock measurement required');
  const observations=sources.map(s=>observation(s,registration,now)).sort((a,b)=>a.bar.time-b.bar.time);
  if(!observations.length||new Set(observations.map(o=>o.id)).size!==observations.length)throw Error('Empty or duplicate source sequence');
  let episode=Sequence.start(observations[0]);
  if(episode.status==='rejected')return {episode,candidates:[]};
  for(const o of observations.slice(1))episode=Sequence.advance(episode,o);
  const latest=observations.at(-1),availableUpper=now+bounds.upperOffsetMs;
  if(availableUpper-latest.bar.time-STEP>Sequence.SPEC.maxDelayMs||availableUpper<latest.observedAt)throw Error('Candidate generation is delayed or clock-inconsistent');
  const candidates=episode.intents.filter(i=>i.confirmedBarAt===latest.bar.time).map(plan=>{
    if(!Number.isFinite(plan.stop)||plan.stop<=0)throw Error('Invalid frozen stop');
    // Intent availability is an exchange upper bound; `now` is local. Do not
    // compare them as one clock or label a planning timestamp as persistence.
    const entryAt=Math.ceil((Math.max(now,availableUpper)+Sequence.SPEC.guardMs+1)/STEP)*STEP;
    const savedPlan={...plan,entryAt,plannedAtLocal:now,planningExchangeUpper:availableUpper,availableAtBasis:'exchange-upper-bound',status:'planned-awaiting-actual-receipt'};
    if(!Feed.collectionPolicy(latest.asset,availableUpper).allowed||!Feed.collectionPolicy(latest.asset,savedPlan.entryAt).allowed)throw Error('Market/weekend policy forbids candidate or future entry');
    return {schema:1,id:hash([episode.id,plan.arm,plan.confirmedBarAt].join('/')),methodId:METHOD.id,generatedAt:now,clockMeasurement:clock,clockBounds:bounds,
      registrationSha256:hash(JSON.stringify(registration)),identity:episode.identity,episode,plan:savedPlan,
      sources:sources.map(s=>({directory:s.directory,sha256:s.sha256})),controls:episode.controls,interpretation:'Hypothetical candidate, not a live trade or proven edge.'};
  });
  return {episode,candidates};
}
function persist(root,candidate){
  const target=path.join(root,'candidates',candidate.id);fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.existsSync(target))return {directory:target,reused:true};
  const staging=fs.mkdtempSync(path.join(root,'.candidate-'));atomicJSON(path.join(staging,'candidate.json'),candidate);
  const persistedAt=Date.now(),sha256=hash(fs.readFileSync(path.join(staging,'candidate.json')));
  // Publish exclusively; never overwrite the first candidate, even after delayed generation.
  try{fs.renameSync(staging,target);}catch(e){if(fs.existsSync(target))return {directory:target,reused:true};throw e;}
  const receipt={persistedAt,publishedAt:Date.now(),sha256};atomicJSON(path.join(target,'receipt.json'),receipt);
  return {directory:target,reused:false,receipt};
}
function verify(candidate,receipt,registration){
  const rawRegistration=hash(JSON.stringify(registration)),b=Forward.clockBounds(candidate.clockMeasurement),issues=[];
  if(receipt.sha256!==hash(JSON.stringify(candidate,null,2)))issues.push('candidate-receipt-hash-mismatch');
  if(candidate.methodId!==METHOD.id||candidate.registrationSha256!==rawRegistration)issues.push('registration-mismatch');
  if(!b.valid||JSON.stringify(b)!==JSON.stringify(candidate.clockBounds))issues.push('clock-bounds-mismatch');
  if(![receipt.persistedAt,receipt.publishedAt].every(Number.isFinite)||receipt.persistedAt<candidate.generatedAt||receipt.publishedAt<receipt.persistedAt||receipt.publishedAt+Math.max(0,b.upperOffsetMs??Infinity)+Sequence.SPEC.guardMs>=candidate.plan.entryAt)issues.push('persistence-missed-future-guard');
  try{
    const sources=candidate.sources.map(s=>{const source=readSource(s.directory);if(source.sha256!==s.sha256)throw Error('Source changed');return source;});
    const replay=prepare(sources,registration,candidate.clockMeasurement,candidate.generatedAt).candidates.find(c=>c.id===candidate.id);
    if(!replay||JSON.stringify(replay)!==JSON.stringify(candidate))issues.push('candidate-replay-mismatch');
  }catch(e){issues.push('source-proof-failed: '+e.message);}
  return {eligible:issues.length===0,issues};
}
function outcome(candidate,bars,horizon,asOf){
  const {entryAt,confirmedBarAt,stop,structuralInvalidation,direction}=candidate.plan,exitAt=entryAt+horizon*STEP;
  if(!METHOD.horizons.includes(horizon)||![entryAt,confirmedBarAt,stop,asOf].every(Number.isFinite)||stop<=0||entryAt%STEP||confirmedBarAt%STEP||entryAt<=confirmedBarAt+STEP||!['LONG','SHORT'].includes(direction))throw Error('Invalid frozen plan or horizon');
  const common={horizon,entryAt,exitAt,interpretation:'Conservative stop-aware hypothetical OHLC benchmark, not execution P&L.',unmeasured:{spread:null,slippage:null,funding:null,brokerBasis:null}};
  if(exitAt>asOf)return {...common,status:'pending'};
  const window=[],missing=[];
  for(let t=confirmedBarAt+STEP;t<exitAt;t+=STEP){const x=bars?.get(t);if(!x||x.source.firstObservedAt>asOf||x.bar.time+STEP>asOf||!Sequence.validBar(x.bar)){missing.push(t);continue;}window.push(x);}
  if(missing.length)return {...common,status:'missing',missing,missingCoverage:{scheduledClosed:missing.filter(t=>!Feed.barExpected(candidate.identity.asset,t,15)),expectedButAbsent:missing.filter(t=>Feed.barExpected(candidate.identity.asset,t,15))}};
  if(window.some(x=>x.conflict))return {...common,status:'conflicting-price'};
  const long=direction==='LONG',pre=window.filter(x=>x.bar.time<entryAt).map(x=>x.bar);
  for(const b of pre){
    if(Number.isFinite(structuralInvalidation)&&(long?b.close<structuralInvalidation:b.close>structuralInvalidation))return {...common,status:'no-fill',reason:'pre-entry-structural-invalidation'};
    if(long?b.low<=stop:b.high>=stop)return {...common,status:'no-fill',reason:'pre-entry-stop-touch-conservative-whole-candle'};
  }
  const held=window.filter(x=>x.bar.time>=entryAt).map(x=>x.bar),entry=held[0].open;
  if(long?entry<=stop:entry>=stop)return {...common,status:'no-fill',reason:'entry-gap-beyond-stop'};
  let exit=held.at(-1).close,exitBarAt=held.at(-1).time,reason='horizon-close';
  for(const b of held){
    if(long?b.open<=stop:b.open>=stop){exit=b.open;exitBarAt=b.time;reason='adverse-stop-gap';break;}
    if(long?b.low<=stop:b.high>=stop){exit=stop;exitBarAt=b.time;reason='frozen-stop-touch';break;}
  }
  const returnBps=(long?1:-1)*(exit/entry-1)*10000;
  return {...common,status:'resolved',entry,exit,exitBarAt,reason,returnBps,costSensitivity:METHOD.costBps.map(costBps=>({costBps,hypotheticalNetBps:returnBps-costBps})),sources:window.map(x=>({barAt:x.bar.time,...x.source}))};
}
function evaluate(candidates,index,asOf){
  const reserved=new Map();return [...candidates].sort((a,b)=>a.candidate.plan.entryAt-b.candidate.plan.entryAt||a.candidate.id.localeCompare(b.candidate.id)).map(row=>{
    const c=row.candidate,i=c.identity,k=[i.asset,i.market,i.symbol].join('/');
    return {id:c.id,identity:i,arm:c.plan.arm,eligibility:row.eligibility,outcomes:METHOD.horizons.map(h=>{
      const rkey=[k,c.plan.arm,h].join('/'),o=outcome(c,index.get(k),h,asOf),nonOverlapping=c.plan.entryAt>=(reserved.get(rkey)??-Infinity);
      if(nonOverlapping)reserved.set(rkey,o.exitAt);return {...o,nonOverlapping,prospective:row.eligibility.eligible};
    })};
  });
}
function run(root=path.join(__dirname,'.runtime','hourly-observation','research-retest-ledger-v3')){
  const registration=register(root),asOf=Date.now(),candidateDir=path.join(root,'candidates'),rows=[];
  if(fs.existsSync(candidateDir))for(const id of fs.readdirSync(candidateDir).filter(n=>/^[a-f0-9]{64}$/.test(n))){
    const raw=fs.readFileSync(path.join(candidateDir,id,'candidate.json')),candidate=JSON.parse(raw),receiptFile=path.join(candidateDir,id,'receipt.json');
    if(!fs.existsSync(receiptFile)){rows.push({candidate,eligibility:{eligible:false,issues:['missing-publication-receipt']}});continue;}
    const receipt=JSON.parse(fs.readFileSync(receiptFile));
    if(candidate.id!==id||hash(raw)!==receipt.sha256)throw Error('Candidate identity/hash mismatch');
    if(receipt.persistedAt<=asOf)rows.push({candidate,eligibility:verify(candidate,receipt,registration)});
  }
  const observations=path.dirname(root),sources=[],manifest=[];
  const read=file=>{const raw=fs.readFileSync(file);manifest.push({file,sha256:hash(raw)});return raw;};
  const original=path.join(observations,'cohort-v1','snapshots');
  if(fs.existsSync(original))for(const n of fs.readdirSync(original).filter(n=>n.endsWith('.json'))){const file=path.join(original,n),raw=read(file);sources.push({...JSON.parse(raw),file,sha256:hash(raw)});}
  const forward=path.join(observations,'research-forward','predictions');
  if(fs.existsSync(forward))for(const id of fs.readdirSync(forward).filter(n=>!n.startsWith('.'))){const file=path.join(forward,id,'prediction.json'),raw=read(file),r=JSON.parse(raw);sources.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file,sha256:hash(raw)});}
  const index=require('./research-audit.cjs').indexSnapshots(sources.filter(s=>s.firstObservedAt<=asOf)),result=evaluate(rows,index.markets,asOf);
  for(const s of manifest)if(hash(fs.readFileSync(s.file))!==s.sha256)throw Error('Observation original changed during evaluation');
  const output=path.join(root,'evaluations');fs.mkdirSync(output,{recursive:true});const staging=fs.mkdtempSync(path.join(output,'.staging-'));
  atomicJSON(path.join(staging,'report.json'),{asOf,method:METHOD,rows:result,sourceIssues:index.issues,collectorExecuted:false,productionAdoption:false});
  atomicJSON(path.join(staging,'manifest.json'),{sources:manifest,registrationSha256:hash(JSON.stringify(registration)),ledgerCodeSha256:hash(fs.readFileSync(__filename))});
  const directory=path.join(output,asOf+'-'+crypto.randomUUID());fs.renameSync(staging,directory);
  return {directory,candidates:rows.length,eligible:rows.filter(r=>r.eligibility.eligible).length,sourceIssues:index.issues.length,collectorExecuted:false};
}
if(require.main===module){const root=path.join(__dirname,'.runtime','hourly-observation','research-retest-ledger-v3');if(process.argv[2]==='register')console.log(JSON.stringify(register(root),null,2));else if(process.argv[2]==='evaluate')console.log(JSON.stringify(run(root),null,2));else throw Error('Use register/evaluate. Capture hook requires fresh existing frozen sources and bounded clock; no collector or mail is run.');}
module.exports={METHOD,engineHashes,register,readSource,observation,prepare,persist,verify,outcome,evaluate,run};
