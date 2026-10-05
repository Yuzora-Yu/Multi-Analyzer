/* Explicitly frozen predictions, separate from the hourly collector and legacy cohorts.
 * Public read-only API checks only. No alerts, orders, or writes to observation originals. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Core=require('./strategy-core'),Feed=require('./market-feed');
const {indexSnapshots,linkOutcome,atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const SPEC={id:'post-freeze-price-benchmark-v1',horizons:[1,4,8,16],costBps:[7,14,21],
  purpose:'Analysis-only prediction/price linkage. Separate from EXIT immediate-reversal and structure-retest strategy studies.',
  entry:'First 15m boundary at least 60 seconds after generation in both local and exchange clock bounds. Must also follow completed atomic persistence in exchange-clock upper bound.',
  maxSnapshotAgeMs:1200000,maxClockRttMs:5000,maxAbsoluteClockOffsetMs:120000,guardMs:60000,
  groups:'Preserve P, exitLong, exitShort and actionable flags independently, plus no-sign controls. Never pool assets or market types.',
  outcomes:'Require all closed OHLC bars, keep first received source and flag revisions. Hypothetical fixed-hold long/short cost sensitivity, not execution P&L.',
  overlap:'Earliest saved checkpoint reserves its full horizon per market, including pending/missing outcomes. Nonoverlap is not statistical independence.',
  adoption:'None. Do not optimize or claim edge from this audit. Require a separately frozen untouched chronological validation protocol, costs, expectancy, drawdown and adequate independent events; 30 is not an adoption threshold.'};
function clockBounds(t){
  const {requestedAt,receivedAt,serverTime}=t||{};
  if(![requestedAt,receivedAt,serverTime].every(Number.isFinite)||receivedAt<requestedAt||receivedAt-requestedAt>SPEC.maxClockRttMs)return {valid:false,reason:'missing-or-slow-clock-measurement'};
  const lowerOffsetMs=serverTime-receivedAt,upperOffsetMs=serverTime-requestedAt;
  return {valid:Math.max(Math.abs(lowerOffsetMs),Math.abs(upperOffsetMs))<=SPEC.maxAbsoluteClockOffsetMs,lowerOffsetMs,upperOffsetMs,rttMs:receivedAt-requestedAt,
    assumption:'Exchange timestamp generated during this request; network asymmetry bounded by RTT, local clock stable during capture. Not independent clock certification.'};
}
function prepare(snapshot,transport,clock,generatedAt=Date.now()){
  const generationStartedAt=generatedAt;
  const cfg=Feed.instruments[snapshot?.asset],bounds=clockBounds(clock),cutoff=snapshot?.settings?.now;
  if(!cfg||snapshot.version!==Core.VERSION||snapshot.symbol!==cfg.symbol||snapshot.settings.market!==cfg.market)throw Error('Snapshot identity/version mismatch');
  const input=Feed.input(snapshot),last=input.exec.at(-1),closedAt=last.time+STEP;
  if(snapshot.id!==`${snapshot.asset}-${last.time}-${snapshot.version}`||cutoff<closedAt||cutoff>=closedAt+STEP)throw Error('Snapshot cutoff mismatch');
  for(const [name,minutes] of [['exec',15],['h1',60],['h4',240]])for(const b of input[name]){
    if(![b.time,b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.time%(minutes*60000)!==0||b.time+minutes*60000>cutoff||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.volume<0)throw Error('Unclosed or invalid feature bar');
  }
  if(!Number.isFinite(snapshot.createdAt)||snapshot.createdAt<cutoff||![transport.requestedAt,transport.receivedAt,generatedAt].every(Number.isFinite)||transport.requestedAt>transport.receivedAt||transport.receivedAt>generatedAt)throw Error('Invalid event/receipt sequence');
  const a=Core.analyzeMarket(input,snapshot.settings),f=a.exec.flow?.latest||{};
  generatedAt=Math.max(generatedAt,Date.now());
  const latestInfoEventAt=Math.max(...[['exec',15],['h1',60],['h4',240]].flatMap(([name,m])=>input[name].map(b=>b.time+m*60000)));
  const exchangeUpper=generatedAt+(bounds.valid?bounds.upperOffsetMs:0),ageMs=exchangeUpper-closedAt;
  const issues=[];
  if(!bounds.valid)issues.push('clock-unbounded');
  if(clock.receivedAt>generatedAt||generatedAt-clock.receivedAt>60000)issues.push('clock-measurement-not-contemporaneous');
  if(ageMs<0||ageMs>SPEC.maxSnapshotAgeMs)issues.push('snapshot-stale-or-future');
  if(snapshot.createdAt>transport.receivedAt+(bounds.valid?bounds.upperOffsetMs:0))issues.push('source-created-after-receipt-bound');
  if(!a.exec.ready||a.exec.quality?.gaps||a.exec.quality?.stale)issues.push('input-quality');
  const entryAt=Math.ceil((Math.max(generatedAt,exchangeUpper)+SPEC.guardMs)/STEP)*STEP;
  return {schema:1,specId:SPEC.id,id:snapshot.id,asset:snapshot.asset,market:cfg.market,symbol:cfg.symbol,
    generationStartedAt,generatedAt,transport,clockMeasurement:clock,clockBounds:bounds,sourceCreatedAt:snapshot.createdAt,targetBarOpenAt:last.time,targetBarClosedAt:closedAt,cutoff,
    latestInfoEventAt,informationReceivedAt:transport.receivedAt,observationDelayLocalMs:transport.receivedAt-closedAt,
    observationDelayExchangeBoundsMs:bounds.valid?[transport.receivedAt+bounds.lowerOffsetMs-closedAt,transport.receivedAt+bounds.upperOffsetMs-closedAt]:null,
    observationClass:ageMs<=120000?'near-close':'delayed',entryAt,issues,
    engineVersion:Core.VERSION,settingsSha256:hash(JSON.stringify(snapshot.settings)),
    codeHashes:Object.fromEntries(['strategy-core.js','flow-core.js','smc-core.js','market-feed.js','research-forward.cjs'].map(file=>[file,hash(fs.readFileSync(path.join(__dirname,file)))])),
    prediction:{state:a.state,actionable:a.actionable,direction:a.direction,heldDirection:f.direction,structure:f.structure,ribbon:f.ribbon,
      pullbackConfirmed:f.pullbackConfirmed,exitLong:f.exitLong,exitShort:f.exitShort,noSign:!f.pullbackConfirmed&&!f.exitLong&&!f.exitShort,
      positionDecision:a.positionDecision,session:a.session,regime:a.regime,adx:a.exec.values.adx,atr:a.exec.values.atr,volumeRatio:f.volumeRatio,vetoes:a.vetoes,plan:a.plan},
    snapshot,notificationEvidence:'Not inferred from a signal. Check monitor acceptance separately; no delivery-to-inbox proof.'};
}
function persist(root,record){
  const target=path.join(root,'predictions',record.id);fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.existsSync(target))return {directory:target,reused:true};
  const staging=fs.mkdtempSync(path.join(root,'.freeze-'));
  atomicJSON(path.join(staging,'prediction.json'),record);
  const persistedAt=Date.now(),upper=persistedAt+(record.clockBounds.valid?record.clockBounds.upperOffsetMs:0);
  const receipt={persistedAt,predictionSha256:hash(fs.readFileSync(path.join(staging,'prediction.json'))),prospectiveEligible:record.issues.length===0&&upper+SPEC.guardMs<record.entryAt,
    note:'Timestamp taken after atomic prediction-file persistence; directory publication is later. Local evidence, not third-party notarization.'};
  atomicJSON(path.join(staging,'receipt.json'),receipt);fs.renameSync(staging,target);
  return {directory:target,reused:false,receipt};
}
function evaluate(root,records,asOf){
  const entries=fs.readdirSync(path.join(root,'predictions')).filter(n=>!n.startsWith('.')).map(n=>{
    const p=path.join(root,'predictions',n),raw=fs.readFileSync(path.join(p,'prediction.json')),r=JSON.parse(raw),receipt=JSON.parse(fs.readFileSync(path.join(p,'receipt.json')));
    if(hash(raw)!==receipt.predictionSha256)throw Error('Frozen prediction hash mismatch');
    const sequenceValid=Number.isFinite(receipt.persistedAt)&&receipt.persistedAt>=r.generatedAt&&r.generatedAt>=r.transport?.receivedAt&&r.latestInfoEventAt<=r.cutoff;
    const eligible=sequenceValid&&r.specId===SPEC.id&&r.issues.length===0&&r.clockBounds.valid&&receipt.persistedAt+r.clockBounds.upperOffsetMs+SPEC.guardMs<r.entryAt;
    return {r,receipt:{...receipt,prospectiveEligible:eligible}};
  }).filter(x=>x.receipt.persistedAt<=asOf).sort((a,b)=>a.r.entryAt-b.r.entryAt||a.r.id.localeCompare(b.r.id));
  const index=indexSnapshots(records.filter(x=>x.firstObservedAt<=asOf)),reserved=new Map();
  return entries.map(({r,receipt})=>({id:r.id,asset:r.asset,market:r.market,engineVersion:r.engineVersion,prediction:r.prediction,receipt,
    outcomes:SPEC.horizons.map(h=>{
      const k=`${r.asset}/${r.market}/${r.symbol}`,o=linkOutcome({bar:r.entryAt-STEP},index.markets.get(k),h,asOf),reservation=k+'/'+h;
      const nonOverlapping=r.entryAt>=(reserved.get(reservation)??-Infinity);
      if(nonOverlapping)reserved.set(reservation,o.exitAt);
      return {...o,prospective:receipt.prospectiveEligible,nonOverlapping,interpretation:'Post-freeze hypothetical price benchmark; not immediate EXIT reversal, retest strategy, executable fill or realized P&L.'};
    })}));
}
async function run(){
  const root=path.join(__dirname,'.runtime','hourly-observation','research-forward');fs.mkdirSync(root,{recursive:true});
  const specFile=path.join(root,'spec.json');
  if(!fs.existsSync(specFile))atomicJSON(specFile,{registeredAt:Date.now(),...SPEC});
  const savedSpec=JSON.parse(fs.readFileSync(specFile));delete savedSpec.registeredAt;
  if(JSON.stringify(savedSpec)!==JSON.stringify(SPEC))throw Error('Frozen spec differs; create a new study version');
  async function get(url){const requestedAt=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const raw=await response.text(),receivedAt=Date.now();return {raw,data:JSON.parse(raw),transport:{url,requestedAt,receivedAt,responseSha256:hash(raw)}};}
  const frozen=[];
  for(const asset of ['gold','btc']){
    if(!Feed.collectionPolicy(asset).allowed)continue;
    const fetched=await get('https://multi-analyzer-monitor.rikai-829.workers.dev/api/snapshot?asset='+asset);
    const time=await get('https://api.bybit.com/v5/market/time');
    if(time.data.retCode!==0)throw Error('Exchange clock unavailable');
    const clock={...time.transport,serverTime:Number(time.data.time),raw:time.data};
    if(fetched.data.asset!==asset)throw Error('Wrong asset returned');
    const record=prepare(fetched.data,fetched.transport,clock);record.snapshotResponseText=fetched.raw;frozen.push({id:record.id,...persist(root,record)});
  }
  const records=[],sourceDir=path.join(__dirname,'.runtime','hourly-observation','cohort-v1','snapshots');
  for(const file of fs.readdirSync(sourceDir).filter(n=>n.endsWith('.json'))){const raw=fs.readFileSync(path.join(sourceDir,file));records.push({...JSON.parse(raw),file:'cohort-v1/snapshots/'+file,sha256:hash(raw)});}
  for(const id of fs.readdirSync(path.join(root,'predictions'))){const file=path.join(root,'predictions',id,'prediction.json'),raw=fs.readFileSync(file),r=JSON.parse(raw);records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file:'research-forward/predictions/'+id+'/prediction.json',sha256:hash(raw)});}
  const evaluatedAt=Date.now(),rows=evaluate(root,records,evaluatedAt),file=path.join(root,`evaluation-${evaluatedAt}.json`);
  atomicJSON(file,{evaluatedAt,specId:SPEC.id,rows});
  return {frozen,evaluation:file,rows:rows.length,prospectiveEligible:rows.filter(r=>r.receipt.prospectiveEligible).length};
}
if(require.main===module)run().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={SPEC,clockBounds,prepare,persist,evaluate,run};
