/* Offline, preregistered zone entry comparison. Never an order or alert engine. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Zones=require('./research-zones.cjs'),Availability=require('./research-zone-availability.cjs');
const Core=require('./strategy-core.js'),Feed=require('./market-feed.js');
const {validBar,indexSnapshots,atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const SPEC={id:'zone-entry-comparison-v1',horizon:16,costBps:[7,14,21],
  arms:['touch-next-open','confirmed-reaction-next-open'],
  trigger:'First future full-bar touch; confirmation additionally requires prior touch and a later close beyond original zone and original confirmed pivot. Stop visit or close invalidation before entry cancels both arms. No same-bar chronology inference.',
  execution:'Hypothetical next-full-bar open only. Original protective stop and nearest original target on the profitable side of trigger close, fixed before entry. Entry must remain between stop and target with minimum gross RR 1.8; otherwise no fill. No retuning, partial exits or stop movement. Adverse stop gaps use open; target gaps use fixed target. Stop first if both touched. Invalidation closes at bar close unless stop/target already touched. Expiry at original 16-bar window close.',
  population:'Only original primary deduplicated zones whose source close is strictly after this registration with conservative exchange upper clock offset; original global 16-bar reservations and eligibility retained. Do not resurrect a secondary or overlap-excluded zone. Pair arms within each unchanged zone.',
  evidence:'Require independently receipted complete 16-bar coverage. Later causal simulation is not a live saved order, fill, broker profitability or forecast publication proof.',
  adoption:'Analysis only. No production promotion or probabilities. Require a separately preregistered untouched validation period, at least 100 nonoverlapping eligible primary windows per market and cost sensitivity plus drawdown before considering a proposal. Count is necessary, not sufficient; nonoverlap is not independence.'};
const FILES=['research-zone-trades.cjs','research-zones.cjs','research-zone-availability.cjs','research-audit.cjs','zone-focus.js','strategy-core.js','flow-core.js','smc-core.js','market-feed.js','research-forward.cjs','research-scorecard.cjs'];
function hashes(){return Object.fromEntries(FILES.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));}
function register(root,now=Date.now()){
  const fixed={spec:SPEC,codeHashes:hashes()},file=path.join(root,'registration.json');
  if(fs.existsSync(file)){const r=JSON.parse(fs.readFileSync(file)),{registeredAt,...prior}=r;if(!Number.isFinite(registeredAt)||JSON.stringify(prior)!==JSON.stringify(fixed))throw Error('Changed study requires a new registration');return r;}
  fs.mkdirSync(root,{recursive:true});const r={registeredAt:now,...fixed};fs.writeFileSync(file,JSON.stringify(r,null,2),{flag:'wx'});return r;
}
function simulate(c,bars,arm){
  if(!SPEC.arms.includes(arm)||bars.length!==SPEC.horizon||bars.some((b,i)=>!validBar(b)||b.time!==c.from+i*STEP))throw Error('Complete ordered 16-bar window required');
  const z=c.zone,long=z.direction==='LONG',sign=long?1:-1;
  if(!['LONG','SHORT'].includes(z.direction)||![z.low,z.high,z.protectiveStop,z.invalidationClose].every(Number.isFinite)||z.high<z.low)throw Error('Invalid original zone');
  let touched=false,queued=false,holding=null,fixedTarget=null;
  const base={arm,status:'no-trigger',sameBarAmbiguity:false};
  const stopHit=b=>long?b.low<=z.protectiveStop:b.high>=z.protectiveStop;
  const invalid=b=>long?b.close<z.invalidationClose:b.close>z.invalidationClose;
  function close(b,price,reason,ambiguous=false){const grossBps=sign*(price/holding.entry-1)*10000;return {...base,...holding,status:'closed',exitAt:b.time+STEP,exit:price,reason,sameBarAmbiguity:ambiguous,grossBps,costs:SPEC.costBps.map(costBps=>({costBps,assumedNetBps:grossBps-costBps})),interpretation:'Stop-managed hypothetical candle simulation, not actual P&L.'};}
  for(let i=0;i<bars.length;i++){
    const b=bars[i];
    if(queued&&!holding){
      const risk=sign*(b.open-z.protectiveStop),target=fixedTarget;
      if(risk<=0||!Number.isFinite(target)||sign*(target-b.open)/risk<1.8)return {...base,status:'no-fill',reason:'gap-or-target-or-RR',plannedEntryAt:b.time};
      holding={entryAt:b.time,entry:b.open,stop:z.protectiveStop,target,grossRR:sign*(target-b.open)/risk};
    }
    if(holding){const targetHit=long?b.high>=holding.target:b.low<=holding.target;
      if(stopHit(b))return close(b,long?Math.min(b.open,z.protectiveStop):Math.max(b.open,z.protectiveStop),'fixed-stop',targetHit);
      if(targetHit)return close(b,holding.target,'fixed-target');
      if(invalid(b))return close(b,b.close,'closed-invalidation');
      if(i===bars.length-1)return close(b,b.close,'window-expiry');
      continue;
    }
    if(stopHit(b)||invalid(b))return {...base,status:'cancelled',reason:stopHit(b)?'pre-entry-stop':'pre-entry-invalidation'};
    const overlap=b.high>=z.low&&b.low<=z.high;
    const reaction=touched&&Number.isFinite(c.pivot)&&(long?b.close>z.high&&b.close>c.pivot:b.close<z.low&&b.close<c.pivot);
    if((arm===SPEC.arms[0]&&overlap)||(arm===SPEC.arms[1]&&reaction)){
      if(i===bars.length-1)return {...base,status:'no-fill',reason:'no-next-bar-within-window'};
      fixedTarget=(z.targets||[]).filter(t=>Number.isFinite(t)&&sign*(t-b.close)>0).sort((a,d)=>sign*(a-d))[0];
      queued=true;
    }
    touched=touched||overlap;
  }
  return base;
}
function run(directory,root=path.join(__dirname,'.runtime/hourly-observation/research-zone-trades-v1')){
  if(!fs.existsSync(path.join(root,'registration.json')))throw Error('Explicit preregistration required');
  const registration=register(root),raw=fs.readFileSync(path.join(directory,'report.json')),report=JSON.parse(raw),manifestRaw=fs.readFileSync(path.join(directory,'manifest.json')),manifest=JSON.parse(manifestRaw),availability=Availability.run(directory);
  if(report.registration.spec.id!==Zones.SPEC.id||JSON.stringify(report.registration.codeHashes)!==JSON.stringify(Object.fromEntries(Object.keys(report.registration.codeHashes).map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]))))throw Error('Original zone engine differs');
  const records=[],sourceBytes=new Map(),candidates=[];
  for(const m of manifest.sources){const bytes=fs.readFileSync(m.file);if(hash(bytes)!==m.sha256)throw Error('Original manifest changed');sourceBytes.set(m.file,bytes);const r=JSON.parse(bytes);
    if(path.basename(m.file)==='prediction.json'){
      records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file:m.file,sha256:m.sha256});
      const receiptFile=path.join(path.dirname(m.file),'receipt.json'),receiptRaw=fs.readFileSync(receiptFile),receipt=JSON.parse(receiptRaw);
      if(!manifest.sources.some(x=>x.file===receiptFile&&x.sha256===hash(receiptRaw)))throw Error('Original receipt missing from manifest');
      if(report.registration.registeredAt<r.targetBarClosedAt&&receipt.persistedAt<=report.asOf){
        const eligibility=Zones.verifySource(r,receipt,report.registration,m.sha256,report.asOf),a=Core.analyzeMarket(Feed.input(r.snapshot),r.snapshot.settings);
        if(!a.exec.ready||a.exec.quality?.gaps||a.exec.quality?.stale||!a.marketMap.valid){eligibility.eligible=false;eligibility.issues.push('replayed-quality');}
        candidates.push(...Zones.forecasts(r,a,eligibility));
      }
    }
    else if(r.snapshot)records.push({...r,file:m.file,sha256:m.sha256});
  }
  const index=indexSnapshots(records.filter(r=>r.firstObservedAt<=report.asOf)),rows=[];
  if(JSON.stringify(Zones.evaluate(candidates,index.markets,report.asOf))!==JSON.stringify(report.rows))throw Error('Original candidate/outcome replay differs');
  for(const r of report.rows.filter(r=>r.forecast.primary)){
    const c=r.forecast;
    const prediction=records.find(x=>x.snapshot?.id===c.sourceId&&path.basename(x.file)==='prediction.json');
    if(!prediction)throw Error('Original forecast source missing');
    const original=JSON.parse(sourceBytes.get(prediction.file)),after=registration.registeredAt+Math.max(0,original.clockBounds?.upperOffsetMs??Infinity)<c.originClosedAt;
    const outcome=r.outcomes.find(o=>o.horizon===SPEC.horizon),coverage=availability.rows.find(a=>a.id===c.id)?.windows.find(w=>w.horizon===SPEC.horizon);
    const eligible=after&&c.eligibility.eligible&&outcome.nonOverlapping&&outcome.status==='resolved'&&coverage?.summaryGate==='availability-only-verified';
    const row={id:c.id,identity:c.identity,group:c.group,flags:c.flags,postRegistration:after,eligible,status:!after?'excluded-before-registration':!eligible?'pending-or-ineligible':'evaluated'};
    if(eligible){const market=[c.identity.asset,c.identity.market,c.identity.symbol].join('/'),bars=Array.from({length:SPEC.horizon},(_,i)=>index.markets.get(market)?.get(c.from+i*STEP)?.bar);row.arms=SPEC.arms.map(arm=>simulate(c,bars,arm));}
    rows.push(row);
  }
  if(hash(fs.readFileSync(path.join(directory,'report.json')))!==hash(raw)||hash(fs.readFileSync(path.join(directory,'manifest.json')))!==hash(manifestRaw))throw Error('Report changed');
  for(const [file,bytes] of sourceBytes)if(hash(fs.readFileSync(file))!==hash(bytes))throw Error('Source changed during simulation');
  if(JSON.stringify(hashes())!==JSON.stringify(registration.codeHashes))throw Error('Study code changed');
  const result={asOf:report.asOf,registration,input:{reportSha256:hash(raw),manifestSha256:hash(manifestRaw)},rows,accuracyProven:false,collectorExecuted:false};
  const output=path.join(path.dirname(root),'research-zone-trades-reports');fs.mkdirSync(output,{recursive:true});const file=path.join(output,Date.now()+'-'+crypto.randomUUID()+'.json');atomicJSON(file,result);return {file,primary:rows.length,evaluated:rows.filter(r=>r.eligible).length,accuracyProven:false};
}
if(require.main===module){try{const root=path.join(__dirname,'.runtime/hourly-observation/research-zone-trades-v1');console.log(JSON.stringify(process.argv[2]==='register'?register(root):run(path.resolve(process.argv[2]||'')),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={SPEC,simulate,register,run};
