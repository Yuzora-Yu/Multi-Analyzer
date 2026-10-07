/* Registered, offline SMC-zone diagnostics. No collector, alert or order changes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Core=require('./strategy-core'),Feed=require('./market-feed'),Focus=require('./zone-focus');
const Forward=require('./research-forward.cjs'),Score=require('./research-scorecard.cjs');
const {validBar,indexSnapshots,atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const FILES=['research-zones.cjs','zone-focus.js','strategy-core.js','flow-core.js','smc-core.js','market-feed.js','research-forward.cjs','research-scorecard.cjs','research-audit.cjs'];
const SPEC={id:'registered-smc-zone-diagnostics-v1',horizons:[4,8,16],costBps:[7,14,21],
  purpose:'Test frozen SMC-zone observations, not a trading strategy or a published forecast win rate.',
  source:'Deterministic later reconstruction from immutable source features and the exact frozen engine. Protocol registration must precede source closed time. This is not proof that a zone was displayed or mailed at capture.',
  selection:'Preserve all original ranked candidates; deduplicate zone IDs within market/code/config at their first registered source, including ineligible sources. Primary = original candidate index zero; secondary zones remain correlated descriptions.',
  context:'Separate asset/market/symbol, code/config, frame/type/role and no/single/multiple/MA+BB local confluence. Do not interpret unmatched groups as a causal MA/BB improvement.',
  clock:'Use verified original capture/receipt clock bounds and guarded future entry boundary. Start only after original features were persisted; no touch from a pre-save candle.',
  events:'Future full M15 wick overlap establishes touch. Withdrawal = original M15 close beyond boundary. Stop-reference visit is separate. Reaction requires a prior touch and a later close beyond both original zone and original confirmed swing; never same-bar ordering.',
  outcomes:'Fixed wall-clock windows require every price bar and receipt available by as-of. Missing, conflicts, pending and no-touch remain visible. Scheduled closures do not shrink horizons.',
  movement:'Following first touch, next bar open to fixed-window close and subsequent wick extrema are diagnostic movements. Stop/withdrawal are flags; these movements are not stop-managed trades or realized P&L. 7/14/21bps are assumed cost sensitivity; real spread/slippage/funding/broker basis unmeasured.',
  overlap:'Primary forecasts reserve whole future windows per physical market across versions, including missing/pending/no-touch/ineligible. Nonoverlap is not independence. Secondary forecasts are not added as independent observations.',
  adoption:'None. No probabilities, win-rate optimization, fitted parameters or production trigger changes. Record every trial and failed result; require separate untouched validation before adoption.'};
const hashes=()=>Object.fromEntries(FILES.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
function register(root,now=Date.now()){
  fs.mkdirSync(root,{recursive:true});const file=path.join(root,'registration.json'),r={schema:1,registeredAt:now,spec:structuredClone(SPEC),codeHashes:hashes()};
  if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file));if(JSON.stringify(old.spec)!==JSON.stringify(SPEC)||JSON.stringify(old.codeHashes)!==JSON.stringify(r.codeHashes))throw Error('Changed protocol requires a new study root');return old;}
  fs.writeFileSync(file,JSON.stringify(r,null,2),{flag:'wx'});return r;
}
function verifySource(r,receipt,registration,rawHash,asOf){
  const issues=[],cfg=Feed.instruments[r.asset],b=Forward.clockBounds(r.clockMeasurement),s=r.snapshot,last=s?.bars?.m15?.at(-1),closeAt=last?.[0]+STEP;
  if(!cfg||r.market!==cfg.market||r.symbol!==cfg.symbol||s?.asset!==r.asset||s.symbol!==cfg.symbol||s.settings?.market!==cfg.market||s.version!==Core.VERSION||r.engineVersion!==Core.VERSION||s.id!==r.id||r.id!==`${r.asset}-${last?.[0]}-${Core.VERSION}`)issues.push('identity');
  if(rawHash!==receipt.predictionSha256)issues.push('receipt-hash');
  if(!b.valid||JSON.stringify(b)!==JSON.stringify(r.clockBounds))issues.push('clock-bounds');
  if(!(registration.registeredAt<closeAt))issues.push('pre-registration-source');
  if(r.targetBarClosedAt!==closeAt||r.targetBarOpenAt!==last?.[0]||r.cutoff!==s?.settings?.now||r.specId!==Forward.SPEC.id)issues.push('source-cutoff');
  if(![closeAt,r.generatedAt,r.transport?.requestedAt,r.transport?.receivedAt,receipt.persistedAt,r.entryAt,s?.createdAt,s?.settings?.now].every(Number.isFinite)||r.transport.requestedAt>r.transport.receivedAt||r.generatedAt<r.transport.receivedAt||receipt.persistedAt<r.generatedAt||receipt.persistedAt>asOf||closeAt>s.settings.now||s.settings.now>=closeAt+STEP||s.createdAt<s.settings.now||s.createdAt>r.transport.receivedAt+(b.upperOffsetMs??0))issues.push('event-sequence');
  if(!Number.isFinite(r.clockMeasurement?.receivedAt)||r.generatedAt-r.clockMeasurement.receivedAt<0||r.generatedAt-r.clockMeasurement.receivedAt>60000)issues.push('old-clock');
  if(r.entryAt%STEP||r.entryAt<=receipt.persistedAt+Math.max(0,b.upperOffsetMs??Infinity)+Forward.SPEC.guardMs||r.entryAt<=r.generatedAt+Math.max(0,b.upperOffsetMs??Infinity)+Forward.SPEC.guardMs)issues.push('future-guard');
  const age=r.generatedAt+(b.upperOffsetMs??0)-closeAt;if(age<0||age>Forward.SPEC.maxSnapshotAgeMs||r.issues?.length)issues.push('source-quality');
  for(const f of ['strategy-core.js','flow-core.js','smc-core.js','market-feed.js','research-forward.cjs'])if(r.codeHashes?.[f]!==registration.codeHashes[f])issues.push('code:'+f);
  for(const [name,m] of [['m15',15],['h1',60],['h4',240]])for(const row of s?.bars?.[name]||[]){const bar=Feed.unpack([row])[0];if(!bar||!validBar(bar)||bar.time%(m*60000)||bar.time+m*60000>s.settings.now||!Number.isFinite(bar.volume)||bar.volume<0)issues.push('feature-quality');}
  return {eligible:issues.length===0,issues:[...new Set(issues)]};
}
function forecasts(r,a,eligibility){
  const sig=Score.signature(r),identity={asset:r.asset,market:r.market,symbol:r.symbol,engineVersion:r.engineVersion,...sig};
  const f=a.exec?.flow?.latest||{},flags={P:f.pullbackConfirmed===true,EXIT_LONG:f.exitLong===true,EXIT_SHORT:f.exitShort===true,noSign:!f.pullbackConfirmed&&!f.exitLong&&!f.exitShort};
  return (a.marketMap?.candidates||[]).map((z,rank)=>{
    const f=Focus.describe(a,z),windows=f.windows||[],both=windows.some(w=>w.families?.includes('MA')&&w.families?.includes('BB'));
    const group=both?'MA+BB':windows.some(w=>w.labels.length>1)?'multiple-same-family':windows.length?'single':'none';
    const pivot=(z.direction==='SHORT'?a.m15?.swings?.lows:a.m15?.swings?.highs)?.at(-1)?.price;
    return {id:r.id+'/'+z.id,sourceId:r.id,identity,flags,rank,primary:rank===0,zone:structuredClone(z),focus:f,group,pivot:Number.isFinite(pivot)?pivot:null,
      from:r.entryAt,originClosedAt:r.targetBarClosedAt,generatedAt:r.generatedAt,eligibility,interpretation:SPEC.source};
  });
}
function outcome(c,bars,horizon,asOf){
  if(!SPEC.horizons.includes(horizon)||![c.from,asOf,c.zone?.low,c.zone?.high,c.zone?.invalidationClose,c.zone?.protectiveStop].every(Number.isFinite)||c.from%STEP||c.zone.low<=0||c.zone.high<c.zone.low||!['LONG','SHORT'].includes(c.zone?.direction))throw Error('Invalid zone window');
  const until=c.from+horizon*STEP,base={horizon,from:c.from,until,unmeasured:{spread:null,slippage:null,funding:null,brokerBasis:null}};
  if(until>asOf)return {...base,status:'pending'};
  const rows=[],missing=[];for(let t=c.from;t<until;t+=STEP){const x=bars?.get(t);if(!x||!validBar(x.bar)||!Number.isFinite(x.source?.firstObservedAt)||x.source.firstObservedAt>asOf||x.bar.time!==t||t+STEP>asOf)missing.push(t);else rows.push(x);}
  if(missing.length)return {...base,status:'missing',missing,scheduledClosed:missing.filter(t=>!Feed.barExpected(c.identity.asset,t,15))};
  if(rows.some(x=>x.conflict))return {...base,status:'conflicting-price'};
  const z=c.zone,long=z.direction==='LONG';let touchedAt=null,withdrawnAt=null,stopVisitedAt=null,reactionAt=null,touchIndex=-1,sameBarAmbiguity=false;
  rows.forEach((x,i)=>{const b=x.bar,knownTouch=touchedAt!==null;
    if((long?b.low<=z.protectiveStop:b.high>=z.protectiveStop)&&stopVisitedAt===null)stopVisitedAt=b.time+STEP;
    const overlaps=b.high>=z.low&&b.low<=z.high;
    if(overlaps&&touchedAt===null&&!withdrawnAt){touchedAt=b.time+STEP;touchIndex=i;sameBarAmbiguity=stopVisitedAt===b.time+STEP;}
    if((long?b.close<z.invalidationClose:b.close>z.invalidationClose)&&withdrawnAt===null)withdrawnAt=b.time+STEP;
    if(knownTouch&&!withdrawnAt&&!stopVisitedAt&&Number.isFinite(c.pivot)&&(long?b.close>z.high&&b.close>c.pivot:b.close<z.low&&b.close<c.pivot)&&reactionAt===null)reactionAt=b.time+STEP;
  });
  let movement=null;if(touchIndex>=0&&touchIndex<rows.length-1){const later=rows.slice(touchIndex+1).map(x=>x.bar),entry=later[0].open,exit=later.at(-1).close,sign=long?1:-1,ret=sign*(exit/entry-1)*10000;
    movement={basis:'Hypothetical next-open to fixed-window close movement; stop flags do not execute this benchmark.',entryAt:later[0].time,entry,exit,returnBps:ret,
      favorableBps:Math.max(0,...later.map(b=>sign*((long?b.high:b.low)/entry-1)*10000)),adverseBps:Math.min(0,...later.map(b=>sign*((long?b.low:b.high)/entry-1)*10000)),
      costs:SPEC.costBps.map(costBps=>({costBps,assumedNetMovementBps:ret-costBps}))};}
  return {...base,status:'resolved',touchedAt,withdrawnAt,stopVisitedAt,reactionAt,sameBarAmbiguity,movement,sources:rows.map(x=>({...x.source,barAt:x.bar.time}))};
}
function evaluate(candidates,index,asOf){
  const seen=new Set(),reserved=new Map(),rows=[];
  for(const c of [...candidates].sort((a,b)=>a.from-b.from||a.sourceId.localeCompare(b.sourceId)||a.rank-b.rank)){
    const i=c.identity,physical=[i.asset,i.market,i.symbol].join('/'),dedup=[physical,i.codeHash,i.configurationHash,c.zone.id].join('/');if(seen.has(dedup))continue;seen.add(dedup);
    const outcomes=SPEC.horizons.map(h=>{const key=physical+'/'+h,o=outcome(c,index.get(physical),h,asOf),nonOverlapping=c.primary&&c.from>=(reserved.get(key)??-Infinity);if(nonOverlapping)reserved.set(key,o.until);return {...o,nonOverlapping,eligibleForSummary:c.eligibility.eligible&&nonOverlapping&&o.status==='resolved'};});
    rows.push({forecast:c,outcomes});
  }
  return rows;
}
function run({base=path.join(__dirname,'.runtime','hourly-observation'),root=path.join(base,'research-zones-v1'),asOf=Date.now()}={}){
  const registration=JSON.parse(fs.readFileSync(path.join(root,'registration.json')));if(JSON.stringify(registration.spec)!==JSON.stringify(SPEC)||JSON.stringify(registration.codeHashes)!==JSON.stringify(hashes()))throw Error('Study code differs from registration');
  if(!Number.isFinite(registration.registeredAt)||registration.registeredAt>asOf)throw Error('Registration time is invalid or future');
  const manifest=[],records=[],candidates=[],issues=[],controls=[],read=file=>{const raw=fs.readFileSync(file);manifest.push({file,sha256:hash(raw)});return raw;};read(path.join(root,'registration.json'));
  const dir=path.join(base,'research-forward','predictions');for(const id of fs.readdirSync(dir).filter(n=>!n.startsWith('.')).sort()){
    const file=path.join(dir,id,'prediction.json'),raw=read(file),r=JSON.parse(raw),receipt=JSON.parse(read(path.join(dir,id,'receipt.json')));
    if(hash(raw)!==receipt.predictionSha256)throw Error('Original source hash mismatch');records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file,sha256:hash(raw)});
    if(!(registration.registeredAt<r.targetBarClosedAt)||receipt.persistedAt>asOf)continue;
    const eligibility=verifySource(r,receipt,registration,hash(raw),asOf);
    if(eligibility.issues.some(i=>i==='identity'||i==='feature-quality'||i==='source-cutoff'||i.startsWith('code:')))throw Error('Cannot safely reconstruct source '+r.id+': '+eligibility.issues.join(','));
    const a=Core.analyzeMarket(Feed.input(r.snapshot),r.snapshot.settings);
    if(!a.exec.ready||a.exec.quality?.gaps||a.exec.quality?.stale||!a.marketMap.valid){eligibility.eligible=false;eligibility.issues.push('replayed-quality');}
    const f=a.exec?.flow?.latest||{};controls.push({id:r.id,asset:r.asset,market:r.market,symbol:r.symbol,entryAt:r.entryAt,eligibility,P:f.pullbackConfirmed===true,EXIT_LONG:f.exitLong===true,EXIT_SHORT:f.exitShort===true,noSign:!f.pullbackConfirmed&&!f.exitLong&&!f.exitShort,noZones:!a.marketMap.candidates.length});
    if(eligibility.issues.length)issues.push({id:r.id,issues:eligibility.issues});candidates.push(...forecasts(r,a,eligibility));
  }
  const archives=path.join(base,'cohort-v1','snapshots');for(const name of fs.readdirSync(archives).filter(n=>n.endsWith('.json'))){const file=path.join(archives,name),raw=read(file);records.push({...JSON.parse(raw),file,sha256:hash(raw)});}
  const index=indexSnapshots(records.filter(r=>r.firstObservedAt<=asOf)),rows=evaluate(candidates,index.markets,asOf);
  for(const m of manifest)if(hash(fs.readFileSync(m.file))!==m.sha256)throw Error('Source changed during zone audit');
  const summary={sourceControls:controls.length,zoneForecasts:rows.length,primaryForecasts:rows.filter(r=>r.forecast.primary).length,eligiblePrimary:rows.filter(r=>r.forecast.primary&&r.forecast.eligibility.eligible).length,eligibleResolvedByHorizon:Object.fromEntries(SPEC.horizons.map(h=>[h,rows.filter(r=>r.outcomes.find(o=>o.horizon===h)?.eligibleForSummary).length])),accuracyProven:false,interpretation:'Do not pool horizons, confluence groups or secondary zones. No probability/edge estimate; source flags are overlapping controls, not independent trades.'};
  const output=path.join(base,'research-zones-reports');fs.mkdirSync(output,{recursive:true});const staging=fs.mkdtempSync(path.join(output,'.staging-'));atomicJSON(path.join(staging,'report.json'),{asOf,registration,summary,rows,controls,issues,priceIssues:index.issues});atomicJSON(path.join(staging,'manifest.json'),{sources:manifest,collectorExecuted:false});const directory=path.join(output,asOf+'-'+crypto.randomUUID());fs.renameSync(staging,directory);return {directory,...summary};
}
if(require.main===module){try{const base=path.join(__dirname,'.runtime','hourly-observation'),root=path.join(base,'research-zones-v1');console.log(JSON.stringify(process.argv[2]==='register'?register(root):run(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={SPEC,register,verifySource,forecasts,outcome,evaluate,run};
