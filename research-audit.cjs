/* Offline, read-only source audit. Output belongs only in the ignored research directory. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Feed=require('./market-feed');
const STEP=900000,HORIZONS=[1,4,8,16];
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const key=s=>`${s.asset}/${s.market}/${s.symbol||Feed.instruments[s.asset]?.symbol}`;
function validBar(b){return finite(b.time)&&b.time%STEP===0&&[b.open,b.high,b.low,b.close].every(x=>finite(x)&&x>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low;}
function gaps(times){
  const a=[...new Set(times)].sort((a,b)=>a-b),out=[];
  for(let i=1;i<a.length;i++)if(a[i]-a[i-1]>STEP)out.push({from:a[i-1]+STEP,to:a[i]-STEP,count:(a[i]-a[i-1])/STEP-1});
  return out;
}
function indexSnapshots(records){
  const markets=new Map(),issues=[],ids=new Map();
  for(const r of [...records].sort((a,b)=>a.firstObservedAt-b.firstObservedAt||a.file.localeCompare(b.file))){
    const s=r.snapshot,cfg=Feed.instruments[s?.asset],last=s?.bars?.m15?.at(-1),close=last?.[0]+STEP;
    if(!cfg||s.symbol!==cfg.symbol||s.settings?.market!==cfg.market||!finite(r.firstObservedAt)||!finite(s.createdAt)||!finite(s.settings?.now)||!last||s.id!==`${s.asset}-${last[0]}-${s.version}`||close>s.settings.now||s.settings.now>=close+STEP){issues.push({file:r.file,type:'invalid-identity-or-time'});continue;}
    const snapshotHash=hash(JSON.stringify(s));
    if(ids.has(s.id)){
      const conflict=ids.get(s.id)!==snapshotHash;
      issues.push({file:r.file,id:s.id,type:conflict?'conflicting-snapshot-id':'duplicate-snapshot'});
      if(conflict)for(const bars of markets.values())for(const x of bars.values())if(x.source.snapshotId===s.id){x.conflict=true;x.conflictingSources.push(s.id);}
      continue;
    }
    ids.set(s.id,snapshotHash);
    if(r.firstObservedAt<s.createdAt)issues.push({id:s.id,type:'receipt-before-source-created',deltaMs:r.firstObservedAt-s.createdAt});
    const k=key({asset:s.asset,market:s.settings.market,symbol:s.symbol});
    if(!markets.has(k))markets.set(k,new Map());const bars=markets.get(k);
    for(const b of Feed.unpack(s.bars.m15)){
      if(!validBar(b)||b.time+STEP>s.settings.now){issues.push({id:s.id,time:b.time,type:'invalid-or-unclosed-bar'});continue;}
      const value=[b.open,b.high,b.low,b.close].join('/'),prior=bars.get(b.time);
      if(prior){if(prior.value!==value){prior.conflict=true;prior.conflictingSources.push(s.id);}continue;}
      bars.set(b.time,{bar:b,value,conflict:false,conflictingSources:[],source:{snapshotId:s.id,file:r.file,sha256:r.sha256,firstObservedAt:r.firstObservedAt,sourceCreatedAt:s.createdAt,asOf:s.settings.now}});
    }
  }
  return {markets,issues};
}
function classify(sample,record){
  if(!record)return {valid:false,reason:'snapshot-missing'};
  const s=record.snapshot,last=s.bars?.m15?.at(-1),closedAt=sample.bar+STEP,cfg=Feed.instruments[sample.asset];
  const valid=Boolean(cfg&&s.symbol===cfg.symbol&&sample.market===cfg.market&&sample.id===s.id&&sample.version===s.version&&sample.asset===s.asset&&sample.bar===last?.[0]&&sample.close===last?.[4]&&sample.asOf===s.settings.now&&sample.firstObservedAt===record.firstObservedAt&&sample.sourceCreatedAt===s.createdAt&&finite(sample.firstObservedAt)&&finite(s.createdAt)&&finite(sample.asOf)&&finite(sample.bar)&&sample.bar%STEP===0&&closedAt<=sample.asOf&&sample.asOf<closedAt+STEP);
  const delayMs=sample.firstObservedAt-closedAt;
  return {valid,reason:valid?null:'sample-snapshot-mismatch',closedAt,delayMs,
    observationClass:!valid?'invalid':sample.firstObservedAt<s.createdAt||delayMs<0?'clock-inconsistent':delayMs<=120000?'near-close-receipt':'delayed-receipt',
    // firstObservedAt dates the raw snapshot, not persistence of the derived prediction.
    historicalPredictionFrozenAt:null,historicalFreezeEvidence:'unrecorded',
    receivedBeforeOriginalNextOpen:valid&&sample.firstObservedAt<closedAt&&s.createdAt<=sample.firstObservedAt,
    prospectiveOriginalNextOpenEligible:false};
}
function linkOutcome(sample,bars,horizon,asOf){
  const entryAt=sample.bar+STEP,exitAt=entryAt+horizon*STEP,missing=[],sources=[],window=[];
  for(let t=entryAt;t<exitAt;t+=STEP){const x=bars?.get(t);if(!x){missing.push(t);continue;}window.push(x);sources.push({barOpenAt:t,barClosedAt:t+STEP,...x.source});}
  const common={horizon,entryAt,exitAt,missing,sources,interpretation:'Historical fixed-hold benchmark; not fills or realized P&L.',prospective:false};
  if(exitAt>asOf)return {...common,status:'pending'};
  if(missing.length)return {...common,status:'missing'};
  if(window.some(x=>x.conflict))return {...common,status:'conflicting-price',conflicts:window.filter(x=>x.conflict).map(x=>({time:x.bar.time,ids:x.conflictingSources}))};
  const entry=window[0].bar.open,exit=window.at(-1).bar.close,returnBps=(exit/entry-1)*10000;
  return {...common,status:'resolved',entry,exit,returnBps,costSensitivity:[7,14,21].map(costBps=>({costBps,longBenchmarkBps:returnBps-costBps,shortBenchmarkBps:-returnBps-costBps})),
    firstCompleteReceiptAt:Math.max(...sources.map(x=>x.firstObservedAt))};
}
// Reserve windows even for unresolved rows; do not select winners by availability.
function nonOverlapping(rows,horizon){
  const endByMarket=new Map(),selected=[];
  for(const s of [...rows].sort((a,b)=>a.bar-b.bar||a.id.localeCompare(b.id))){const k=key(s),entry=s.bar+STEP;if(entry<(endByMarket.get(k)??-Infinity))continue;selected.push(s.id);endByMarket.set(k,entry+horizon*STEP);}
  return selected;
}
function audit(records,samples,{asOf=Date.now(),legacyOutcomes=[]}={}){
  const available=records.filter(r=>finite(r.firstObservedAt)&&r.firstObservedAt<=asOf);
  const index=indexSnapshots(available),byId=new Map(available.map(r=>[r.snapshot.id,r])),seen=new Set(),rows=[],issues=[...index.issues];
  const legacy=new Map(legacyOutcomes.map(x=>[x.id,x]));
  for(const sample of samples){
    if(seen.has(sample.id)){issues.push({id:sample.id,type:'duplicate-sample'});continue;}seen.add(sample.id);
    const quality=classify(sample,byId.get(sample.id));
    const outcomes=quality.valid?HORIZONS.map(h=>linkOutcome(sample,index.markets.get(key(sample)),h,asOf)):[];
    for(const o of outcomes){const old=legacy.get(sample.id)?.outcomes?.find(x=>x.horizon===o.horizon);if(old?.status==='resolved'&&(o.status!=='resolved'||old.entry!==o.entry||old.exit!==o.exit))issues.push({id:sample.id,horizon:o.horizon,type:'legacy-outcome-disagreement',currentStatus:o.status});}
    rows.push({id:sample.id,asset:sample.asset,market:sample.market,version:sample.version,bar:sample.bar,state:sample.state,actionable:sample.actionable,
      group:sample.exitLong||sample.exitShort?'EXIT':sample.pullbackConfirmed?'P':'no-sign',quality,outcomes});
  }
  const byMarket={};
  for(const k of new Set(samples.map(key))){const subset=samples.filter(s=>key(s)===k),rr=rows.filter(s=>key(s)===k),times=subset.map(s=>s.bar).filter(finite);
    byMarket[k]={samples:rr.length,observationGaps:gaps(times),outcomeBarGaps:gaps([...(index.markets.get(k)?.keys()||[])]),
      observationClasses:Object.fromEntries(['near-close-receipt','delayed-receipt','clock-inconsistent','invalid'].map(c=>[c,rr.filter(r=>r.quality.observationClass===c).length])),
      groups:Object.fromEntries(['EXIT','P','no-sign'].map(g=>[g,rr.filter(r=>r.group===g).length])),
      horizons:Object.fromEntries(HORIZONS.map(h=>{const selected=nonOverlapping(rr.filter(r=>r.quality.valid),h),set=new Set(selected),os=rr.map(r=>r.outcomes.find(o=>o.horizon===h)).filter(Boolean);return [h,{statuses:Object.fromEntries(['resolved','pending','missing','conflicting-price'].map(status=>[status,os.filter(o=>o.status===status).length])),nonOverlappingWindowIds:selected,nonOverlappingResolved:rr.filter(r=>set.has(r.id)&&r.outcomes.find(o=>o.horizon===h)?.status==='resolved').length,prospectiveEligible:0}];}))};
  }
  return {schema:1,asOf,byMarket,issues,rows,note:'Non-overlapping windows are not proof of statistical independence. Legacy derived prediction persistence times are unknown. No win-rate, calibration or edge claim.'};
}
function atomicJSON(file,value){
  const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{flag:'wx'});
  try{fs.renameSync(tmp,file);}catch(e){fs.rmSync(tmp,{force:true});throw e;}
}
function auditSupplemental(input,read){
  const zlib=require('node:zlib'),market=require('./market-observation.cjs'),out={multiframe:[],microstructure:[]},seenTrades={gold:new Set(),btc:new Set()};
  for(const kind of ['multiframe','microstructure']){
    const dir=path.join(input,kind);if(!fs.existsSync(dir))continue;
    for(const file of fs.readdirSync(dir).filter(n=>n.endsWith('.json.gz')).sort()){
      const value=JSON.parse(zlib.gunzipSync(read(kind+'/'+file)));
      if(kind==='multiframe'){
        const seen=new Set(),invalid=[],duplicates=[];
        for(const r of value.records||[]){const id=r.asset+'/'+r.tf;if(seen.has(id))duplicates.push(id);seen.add(id);
          if(!Feed.instruments[r.asset]||![1,5,15,60,240,1440].includes(r.minutes)||!r.bars?.length||r.bars.some((b,i)=>!Number.isFinite(b[0])||b[0]+r.minutes*60000>r.cutoff||(i&&b[0]<=r.bars[i-1][0])))invalid.push(id);
        }
        out.multiframe.push({file,capturedAt:value.capturedAt,records:seen.size,duplicates,invalid,errors:value.errors,receiptTiming:'unrecorded per endpoint; capturedAt is request-start context, not feature availability'});
      }else for(const [asset,x] of Object.entries(value.assets||{})){
        const rows=x.tradeResponse?.result?.list||[],summary=market.summarizeTrades(rows,x.symbol),t=x.timings?.['recent-trade'];
        let repeatedAcrossCaptures=0;for(const r of rows){if(!seenTrades[asset])continue;if(seenTrades[asset].has(r.execId))repeatedAcrossCaptures++;seenTrades[asset].add(r.execId);}
        const timing=t&&Number.isFinite(t.requestedAt)&&Number.isFinite(t.receivedAt)&&Number.isFinite(Number(t.serverTime))&&t.serverTime!=null?
          {requestedAt:t.requestedAt,receivedAt:t.receivedAt,serverTime:Number(t.serverTime),serverMinusReceiptMs:Number(t.serverTime)-t.receivedAt,serverMinusRequestMs:Number(t.serverTime)-t.requestedAt}:null;
        out.microstructure.push({file,asset,symbol:x.symbol,category:x.category,count:summary.count,durationSeconds:summary.durationSeconds,rejectedOrDuplicate:summary.rejectedOrDuplicate,repeatedAcrossCaptures,
          start:summary.start,end:summary.end,timing,tradeAfterLocalReceipt:timing?summary.end>timing.receivedAt:null,tradeAfterServerTime:timing?summary.end>timing.serverTime:null,
          storedSummaryMatches:x.sample?.count===summary.count&&x.sample?.durationSeconds===summary.durationSeconds,
          spreadBps:x.quote?.spreadBps??null,spreadScope:'Bybit quote only; XM execution spread unavailable',continuousCvd:false,economicCalendar:'unavailable'});
      }
    }
  }
  return out;
}
function run({root=path.join(__dirname,'.runtime','hourly-observation'),now=Date.now()}={}){
  const input=path.join(root,'cohort-v1'),output=path.join(root,'research-audit'),manifest=[];
  fs.mkdirSync(output,{recursive:true});
  const staging=fs.mkdtempSync(path.join(output,'.staging-'));
  function read(file){const raw=fs.readFileSync(path.join(input,file));manifest.push({file,sha256:hash(raw),bytes:raw.length});return raw;}
  const records=fs.readdirSync(path.join(input,'snapshots')).filter(f=>f.endsWith('.json')).sort().map(f=>{const raw=read('snapshots/'+f);return {...JSON.parse(raw),file:'snapshots/'+f,sha256:hash(raw)};});
  const samplesRaw=read('samples.jsonl'),samples=samplesRaw.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const legacyOutcomes=JSON.parse(read('outcomes.json'));
  read('spec.json');read('summary.json');
  // Commit a separate copy now. Never backdate this evidence to snapshot receipt.
  const evidenceCapturedAt=Date.now();
  atomicJSON(path.join(staging,'predictions-frozen-now.json'),{capturedAt:evidenceCapturedAt,notHistoricalPersistenceEvidence:true,samples});
  const result=audit(records,samples,{asOf:now,legacyOutcomes});
  result.supplemental=auditSupplemental(input,read);
  for(const x of manifest)if(hash(fs.readFileSync(path.join(input,x.file)))!==x.sha256)throw Error('Source changed during audit; unpublished staging retained: '+x.file);
  const final=path.join(output,`${now}-${crypto.randomUUID()}`);
  atomicJSON(path.join(staging,'report.json'),result);
  atomicJSON(path.join(staging,'manifest.json'),{schema:1,startedAt:now,completedAt:Date.now(),evidenceCapturedAt,sourceFiles:manifest,codeSha256:hash(fs.readFileSync(__filename)),engineVersion:require('./strategy-core').VERSION,sourceMutation:false,collectorExecuted:false});
  fs.renameSync(staging,final); // Publish the complete report directory, never a partially written report.
  return {directory:final,samples:result.rows.length,issues:result.issues.length,byMarket:Object.fromEntries(Object.entries(result.byMarket).map(([k,v])=>[k,{samples:v.samples,missingObservationBars:v.observationGaps.reduce((n,g)=>n+g.count,0),observationClasses:v.observationClasses,horizon2h:{...v.horizons[8],nonOverlappingWindowIds:undefined}}]))};
}
if(require.main===module){try{console.log(JSON.stringify(run(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={validBar,gaps,indexSnapshots,classify,linkOutcome,nonOverlapping,audit,atomicJSON,auditSupplemental,run};
