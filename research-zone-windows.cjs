/* Separate prospective decision-window cohort. Existing studies remain immutable. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Zones=require('./research-zones.cjs'),Trades=require('./research-zone-trades.cjs'),Availability=require('./research-zone-availability.cjs');
const Core=require('./strategy-core'),Feed=require('./market-feed');
const {indexSnapshots,atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const FILES=['research-zone-windows.cjs','research-zones.cjs','research-zone-trades.cjs','research-zone-availability.cjs','research-audit.cjs','zone-focus.js','strategy-core.js','flow-core.js','smc-core.js','market-feed.js','research-forward.cjs','research-scorecard.cjs'];
const SPEC={id:'prospective-zone-decision-windows-v1',horizon:16,costBps:[7,14,21],maxSourceAgeMs:120000,
  question:'Compare original primary-zone touch versus confirmed reaction at future decision times, allowing the same zone to be observed again only after its previous full four-hour reservation expires.',
  population:'Only source closes strictly after registration plus nonnegative exchange upper offset. Reconstruct original candidate rank zero only. Keep every source control, including no-zone, ineligible and overlapping cases. Never promote a secondary after exclusion.',
  reservation:'Earliest primary decision reserves 16 bars per physical asset/market/symbol across code/config versions, even if ineligible, missing or pending. Same source/candidate duplicates are errors. No global forever-dedup of zone ID; repeat-zone windows are correlated, not independent samples.',
  freshness:'Unchanged original clock/source/persistence/future-entry checks plus generation age at most 120 seconds in the conservative exchange upper bound. No retroactive source replacement.',
  execution:Trades.SPEC.execution,trigger:Trades.SPEC.trigger,
  coverage:'All 16 bars require original persistence receipts by as-of. Existing outcome labels, simultaneous stop/target conservatism and 7/14/21bps assumed costs remain unchanged. Spread/slippage/funding/broker basis unmeasured.',
  adoption:'Analysis only, never production promotion from this cohort. At least 100 eligible nonoverlapping windows per market is necessary, not sufficient; repeated zones remain correlated. A separately preregistered untouched validation period, cost sensitivity, expected value and drawdown are required before a proposal. No fitted thresholds or predictive probabilities.'};
const hashes=()=>Object.fromEntries(FILES.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
function register(root,now=Date.now()){
  if(!Number.isFinite(now))throw Error('Invalid registration time');const file=path.join(root,'registration.json'),r={registeredAt:now,spec:structuredClone(SPEC),codeHashes:hashes()};
  if(fs.existsSync(file)){const old=JSON.parse(fs.readFileSync(file));if(!Number.isFinite(old.registeredAt)||JSON.stringify(old.spec)!==JSON.stringify(SPEC)||JSON.stringify(old.codeHashes)!==JSON.stringify(r.codeHashes))throw Error('Changed study requires new registration');return old;}
  fs.mkdirSync(root,{recursive:true});fs.writeFileSync(file,JSON.stringify(r,null,2),{flag:'wx'});return r;
}
function select(candidates){
  const seen=new Set(),reserved=new Map();
  return [...candidates].sort((a,b)=>a.from-b.from||a.sourceId.localeCompare(b.sourceId)||a.rank-b.rank).map(c=>{
    if(seen.has(c.id))throw Error('Duplicate source/candidate');seen.add(c.id);
    if(!Number.isFinite(c.from)||c.from%STEP||c.primary!==(c.rank===0))throw Error('Invalid original rank/boundary');
    const key=[c.identity.asset,c.identity.market,c.identity.symbol].join('/'),nonOverlapping=c.primary&&c.from>=(reserved.get(key)??-Infinity);
    if(nonOverlapping)reserved.set(key,c.from+SPEC.horizon*STEP);
    return {forecast:c,nonOverlapping,repeatedZoneKey:[key,c.zone.id].join('/')};
  });
}
function run({base=path.join(__dirname,'.runtime/hourly-observation'),root=path.join(base,'research-zone-windows-v1'),asOf=Date.now()}={}){
  if(!fs.existsSync(path.join(root,'registration.json')))throw Error('Explicit preregistration required');const registration=register(root);
  if(!Number.isFinite(asOf)||registration.registeredAt>asOf)throw Error('Invalid as-of');
  const sourceDir=path.join(base,'research-forward/predictions'),inventory=()=>fs.readdirSync(sourceDir).filter(n=>!n.startsWith('.')).sort(),names=inventory(),manifest=[],bytes=new Map(),records=[],candidates=[],controls=[];
  function read(file){const raw=fs.readFileSync(file);bytes.set(file,raw);manifest.push({file,sha256:hash(raw)});return JSON.parse(raw);}
  read(path.join(root,'registration.json'));
  for(const name of names){const dir=path.join(sourceDir,name),file=path.join(dir,'prediction.json'),r=read(file),receipt=read(path.join(dir,'receipt.json'));
    if(hash(bytes.get(file))!==receipt.predictionSha256)throw Error('Original receipt hash mismatch');
    records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file,sha256:receipt.predictionSha256});
    if(receipt.persistedAt>asOf||r.targetBarClosedAt<=registration.registeredAt)continue;
    const eligibility=Zones.verifySource(r,receipt,registration,receipt.predictionSha256,asOf),age=r.generatedAt+(r.clockBounds?.upperOffsetMs??Infinity)-r.targetBarClosedAt;
    if(!Number.isFinite(age)||age<0||age>SPEC.maxSourceAgeMs){eligibility.eligible=false;eligibility.issues.push('decision-window-source-not-fresh');}
    if(eligibility.issues.some(i=>['identity','feature-quality','source-cutoff'].includes(i)||i.startsWith('code:')))throw Error('Unsafe original feature identity');
    const a=Core.analyzeMarket(Feed.input(r.snapshot),r.snapshot.settings);
    if(!a.exec.ready||a.exec.quality?.gaps||a.exec.quality?.stale||!a.marketMap.valid){eligibility.eligible=false;eligibility.issues.push('replayed-quality');}
    const f=Zones.forecasts(r,a,eligibility);candidates.push(...f);
    const flow=a.exec.flow?.latest||{},flags={P:flow.pullbackConfirmed===true,EXIT_LONG:flow.exitLong===true,EXIT_SHORT:flow.exitShort===true,noSign:!flow.pullbackConfirmed&&!flow.exitLong&&!flow.exitShort};
    controls.push({id:r.id,asset:r.asset,market:r.market,symbol:r.symbol,sourceClosedAt:r.targetBarClosedAt,entryAt:r.entryAt,eligibility,candidateCount:f.length,primaryId:f[0]?.id||null,flags});
  }
  const index=indexSnapshots(records.filter(r=>r.firstObservedAt<=asOf)),selected=select(candidates);
  const zoneReport={asOf,rows:selected.map(({forecast:c,nonOverlapping})=>({forecast:c,outcomes:[{...Zones.outcome(c,index.markets.get([c.identity.asset,c.identity.market,c.identity.symbol].join('/')),SPEC.horizon,asOf),nonOverlapping}]}))};
  const availability=Availability.audit(zoneReport,{sources:manifest},file=>bytes.get(file));
  const rows=zoneReport.rows.map((r,i)=>{const c=r.forecast,o=r.outcomes[0],coverage=availability.rows[i].windows[0],eligible=c.primary&&c.eligibility.eligible&&o.nonOverlapping&&o.status==='resolved'&&coverage.receiptComplete;
    const result={...r,repeatedZoneKey:selected[i].repeatedZoneKey,coverage,eligible};
    if(eligible){const market=index.markets.get([c.identity.asset,c.identity.market,c.identity.symbol].join('/'));result.arms=Trades.SPEC.arms.map(arm=>Trades.simulate(c,Array.from({length:SPEC.horizon},(_,j)=>market.get(c.from+j*STEP).bar),arm));}
    return result;
  });
  for(const [file,raw] of bytes)if(hash(fs.readFileSync(file))!==hash(raw))throw Error('Original source changed');
  if(JSON.stringify(inventory())!==JSON.stringify(names)||JSON.stringify(hashes())!==JSON.stringify(registration.codeHashes))throw Error('Source inventory or study code changed');
  const summary={sourceControls:controls.length,noZoneControls:controls.filter(c=>!c.candidateCount).length,primary:rows.filter(r=>r.forecast.primary).length,reservedPrimary:rows.filter(r=>r.outcomes[0].nonOverlapping).length,eligibleEvaluated:rows.filter(r=>r.eligible).length,uniquePrimaryZoneKeys:new Set(rows.filter(r=>r.forecast.primary).map(r=>r.repeatedZoneKey)).size};
  const output=path.join(base,'research-zone-window-reports');fs.mkdirSync(output,{recursive:true});const staging=fs.mkdtempSync(path.join(output,'.staging-'));atomicJSON(path.join(staging,'report.json'),{asOf,registration,summary,controls,rows,priceIssues:index.issues,availabilityIssues:availability.issues,accuracyProven:false,collectorExecuted:false});atomicJSON(path.join(staging,'manifest.json'),{sources:manifest});const directory=path.join(output,asOf+'-'+crypto.randomUUID());fs.renameSync(staging,directory);return {directory,...summary,accuracyProven:false};
}
if(require.main===module){try{const root=path.join(__dirname,'.runtime/hourly-observation/research-zone-windows-v1');console.log(JSON.stringify(process.argv[2]==='register'?register(root):run(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={SPEC,register,select,run};
