/* Descriptive companion; never changes the registered cohort or live decisions. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const W=require('./research-zone-windows.cjs'),Z=require('./research-zones.cjs'),T=require('./research-zone-trades.cjs'),A=require('./research-zone-availability.cjs');
const Core=require('./strategy-core'),Feed=require('./market-feed'),{indexSnapshots,atomicJSON}=require('./research-audit.cjs'),{stats}=require('./research-zone-trade-summary.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),STEP=900000;
function assertReplayRows(rows,saved){
  // JSON stores numeric -0 as 0. Preserve every other value and field difference.
  function normalize(value){
    if(Object.is(value,-0))return 0;
    if(!Array.isArray(value)&&(!value||Object.getPrototypeOf(value)!==Object.prototype))return value;
    const copy=Array.isArray(value)?new Array(value.length):{};
    for(const key of Reflect.ownKeys(value))if(Object.prototype.propertyIsEnumerable.call(value,key))
      Object.defineProperty(copy,key,{value:normalize(value[key]),enumerable:true,writable:true,configurable:true});
    return copy;
  }
  assert.deepEqual(normalize(rows),saved,'Original forecast/outcome/execution replay changed');
}
function summarize(report){
  if(JSON.stringify(report.registration?.spec)!==JSON.stringify(W.SPEC)||!Number.isFinite(report.asOf))throw Error('Cohort protocol mismatch');
  const selected=W.select(report.rows.map(r=>r.forecast)),partitions=new Map();
  for(let i=0;i<report.rows.length;i++){
    const r=report.rows[i],c=r.forecast,o=r.outcomes?.[0];
    if(c.id!==selected[i].forecast.id||o?.nonOverlapping!==selected[i].nonOverlapping||r.repeatedZoneKey!==selected[i].repeatedZoneKey)throw Error('Original selection mismatch');
    if(o?.horizon!==16||o.from!==c.from||o.until!==c.from+16*STEP)throw Error('Original window mismatch');
    const eligible=c.primary&&c.eligibility.eligible&&o.nonOverlapping&&o.status==='resolved'&&r.coverage?.receiptComplete===true;
    if(r.eligible!==eligible||(eligible&&o.until>report.asOf))throw Error('Original eligibility mismatch');
    if(eligible){
      if(r.arms?.length!==2||new Set(r.arms.map(a=>a.arm)).size!==2||r.arms.some(a=>!T.SPEC.arms.includes(a.arm)))throw Error('Missing paired arms');
      for(const a of r.arms){if(!['closed','no-trigger','cancelled','no-fill'].includes(a.status))throw Error('Unknown arm status');
        if(a.status==='closed'){
          if(![a.entry,a.exit,a.entryAt,a.exitAt,a.grossBps].every(Number.isFinite)||a.entry<=0||a.exit<=0||a.entryAt<c.from||a.exitAt<=a.entryAt||a.exitAt>o.until)throw Error('Invalid execution boundaries');
          const expected=(c.zone.direction==='LONG'?1:-1)*(a.exit/a.entry-1)*10000;
          if(a.grossBps!==expected||a.costs?.length!==3||T.SPEC.costBps.some(cost=>a.costs.filter(x=>x.costBps===cost&&x.assumedNetBps===expected-cost).length!==1))throw Error('Execution/cost mismatch');
        }
      }
    }else if(r.arms)throw Error('Excluded window has simulated arms');
    if(!c.primary)continue;
    const key=JSON.stringify(c.identity);if(!partitions.has(key))partitions.set(key,{identity:c.identity,rows:[]});partitions.get(key).rows.push(r);
  }
  return {schema:1,asOf:report.asOf,sourceControls:report.controls?.length??null,noZoneControls:report.controls?.filter(c=>c.candidateCount===0).length??null,analysisScope:'Descriptive frozen-cohort comparison, not untouched validation or a production adoption result.',accuracyProven:false,
    unit:'Additive equal-notional hypothetical net basis points; not account equity, real broker P&L or executable spread/funding.',
    partitions:[...partitions.values()].map(({identity,rows})=>{
      const evaluated=rows.filter(r=>r.eligible),keys=evaluated.map(r=>r.repeatedZoneKey);
      return {identity,primaryWindows:rows.length,evaluated:evaluated.length,excludedOrPending:rows.length-evaluated.length,uniqueEvaluatedZoneKeys:new Set(keys).size,repeatEvaluatedZoneWindows:keys.length-new Set(keys).size,
        noSignEvaluated:evaluated.filter(r=>r.forecast.flags.noSign).length,P:evaluated.filter(r=>r.forecast.flags.P).length,EXIT:evaluated.filter(r=>r.forecast.flags.EXIT_LONG||r.forecast.flags.EXIT_SHORT).length,
        costs:T.SPEC.costBps.map(costBps=>{
          const net=(r,arm)=>{const a=r.arms.find(a=>a.arm===arm);return a.status==='closed'?a.costs.find(c=>c.costBps===costBps).assumedNetBps:0;};
          const arms=T.SPEC.arms.map(arm=>({arm,
            statusCounts:Object.fromEntries(['closed','no-trigger','cancelled','no-fill'].map(status=>[status,evaluated.filter(r=>r.arms.find(a=>a.arm===arm).status===status).length])),
            perEligibleWindow:stats(evaluated.map(r=>net(r,arm))),
            perExecutedHypotheticalTrade:stats(evaluated.filter(r=>r.arms.find(a=>a.arm===arm).status==='closed').map(r=>net(r,arm)))}));
          return {costBps,arms,pairedConfirmationMinusTouch:stats(evaluated.map(r=>net(r,T.SPEC.arms[1])-net(r,T.SPEC.arms[0])))};
        })};
    }),note:'Missing/pending/excluded windows never become zero returns. In complete eligible windows, unexecuted arms contribute zero only to the per-window comparison. Repeated zones and overlapping P/EXIT/no-sign flags are not independent evidence.'};
}
function replay(report,manifest,read){
  if(JSON.stringify(report.registration?.spec)!==JSON.stringify(W.SPEC)||!Number.isFinite(report.registration.registeredAt)||!Number.isFinite(report.asOf))throw Error('Cohort protocol mismatch');
  for(const [file,h] of Object.entries(report.registration.codeHashes))if(path.basename(file)!==file||hash(fs.readFileSync(path.join(__dirname,file)))!==h)throw Error('Registered code changed');
  const bytes=new Map(),records=[],candidates=[],controls=[];
  for(const m of manifest.sources){if(bytes.has(m.file))throw Error('Duplicate manifest source');const raw=read(m.file);if(hash(raw)!==m.sha256)throw Error('Original source hash mismatch');bytes.set(m.file,raw);}
  const registrations=[...bytes].filter(([file])=>path.basename(file)==='registration.json');if(registrations.length!==1)throw Error('Original registration missing or duplicated');assert.deepEqual(JSON.parse(registrations[0][1]),report.registration,'Original registration changed');
  for(const [file,raw] of bytes){if(path.basename(file)!=='prediction.json')continue;const r=JSON.parse(raw),receipt=JSON.parse(bytes.get(path.join(path.dirname(file),'receipt.json')));
    if(receipt.predictionSha256!==hash(raw))throw Error('Original receipt mismatch');
    records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file,sha256:hash(raw)});
    if(receipt.persistedAt>report.asOf||r.targetBarClosedAt<=report.registration.registeredAt)continue;
    const eligibility=Z.verifySource(r,receipt,report.registration,hash(raw),report.asOf),age=r.generatedAt+(r.clockBounds?.upperOffsetMs??Infinity)-r.targetBarClosedAt;
    if(!Number.isFinite(age)||age<0||age>W.SPEC.maxSourceAgeMs){eligibility.eligible=false;eligibility.issues.push('decision-window-source-not-fresh');}
    if(eligibility.issues.some(i=>['identity','feature-quality','source-cutoff'].includes(i)||i.startsWith('code:')))throw Error('Unsafe original feature identity');
    const a=Core.analyzeMarket(Feed.input(r.snapshot),r.snapshot.settings);
    if(!a.exec.ready||a.exec.quality?.gaps||a.exec.quality?.stale||!a.marketMap.valid){eligibility.eligible=false;eligibility.issues.push('replayed-quality');}
    const f=Z.forecasts(r,a,eligibility);candidates.push(...f);const flow=a.exec.flow?.latest||{},flags={P:flow.pullbackConfirmed===true,EXIT_LONG:flow.exitLong===true,EXIT_SHORT:flow.exitShort===true,noSign:!flow.pullbackConfirmed&&!flow.exitLong&&!flow.exitShort};
    controls.push({id:r.id,asset:r.asset,market:r.market,symbol:r.symbol,sourceClosedAt:r.targetBarClosedAt,entryAt:r.entryAt,eligibility,candidateCount:f.length,primaryId:f[0]?.id||null,flags});
  }
  assert.deepEqual(controls,report.controls,'Original control population changed');
  const index=indexSnapshots(records.filter(r=>r.firstObservedAt<=report.asOf)),selected=W.select(candidates),zoneReport={asOf:report.asOf,rows:selected.map(({forecast:c,nonOverlapping})=>({forecast:c,outcomes:[{...Z.outcome(c,index.markets.get([c.identity.asset,c.identity.market,c.identity.symbol].join('/')),16,report.asOf),nonOverlapping}]}))};
  const availability=A.audit(zoneReport,manifest,file=>bytes.get(file));
  const rows=zoneReport.rows.map((r,i)=>{const c=r.forecast,o=r.outcomes[0],coverage=availability.rows[i].windows[0],eligible=c.primary&&c.eligibility.eligible&&o.nonOverlapping&&o.status==='resolved'&&coverage.receiptComplete,result={...r,repeatedZoneKey:selected[i].repeatedZoneKey,coverage,eligible};
    if(eligible){const market=index.markets.get([c.identity.asset,c.identity.market,c.identity.symbol].join('/'));result.arms=T.SPEC.arms.map(arm=>T.simulate(c,Array.from({length:16},(_,j)=>market.get(c.from+j*STEP).bar),arm));}return result;});
  assertReplayRows(rows,report.rows);
  for(const [file,raw] of bytes)if(hash(read(file))!==hash(raw))throw Error('Source changed during replay');
  for(const [file,h] of Object.entries(report.registration.codeHashes))if(hash(fs.readFileSync(path.join(__dirname,file)))!==h)throw Error('Registered code changed during replay');
  return {sources:bytes.size,replayMatched:true};
}
function run(directory){
  const analysisHashes=Object.fromEntries(['research-zone-window-summary.cjs','research-zone-trade-summary.cjs'].map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
  const files=['report.json','manifest.json'].map(f=>path.join(directory,f)),raw=files.map(f=>fs.readFileSync(f)),report=JSON.parse(raw[0]),manifest=JSON.parse(raw[1]),evidence=replay(report,manifest,f=>fs.readFileSync(f)),result=summarize(report);
  files.forEach((f,i)=>{if(hash(fs.readFileSync(f))!==hash(raw[i]))throw Error('Input changed during summary');});
  for(const [file,h] of Object.entries(analysisHashes))if(hash(fs.readFileSync(path.join(__dirname,file)))!==h)throw Error('Analysis code changed');
  const root=path.join(__dirname,'.runtime/hourly-observation/research-zone-window-summaries');fs.mkdirSync(root,{recursive:true});const file=path.join(root,Date.now()+'-'+crypto.randomUUID()+'.json');atomicJSON(file,{...result,evidence,input:{reportSha256:hash(raw[0]),manifestSha256:hash(raw[1])},analysisHashes,collectorExecuted:false});return {file,...evidence,partitions:result.partitions.length,accuracyProven:false};
}
if(require.main===module){try{if(!process.argv[2])throw Error('Provide original private cohort report directory');console.log(JSON.stringify(run(path.resolve(process.argv[2])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={summarize,replay,run,assertReplayRows};
