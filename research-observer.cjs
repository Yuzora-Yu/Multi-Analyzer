/* Private, analysis-only cohort. Never sends alerts or changes the production model. */
const fs=require('node:fs');
const path=require('node:path');
const Core=require('./strategy-core');
const Feed=require('./market-feed');
const STEP=900000;
const DIR=path.join(__dirname,'.runtime','hourly-observation','cohort-v1');
function archiveTargets(last,existing){
  const known=existing.filter(t=>Number.isFinite(t)&&t<=last&&t%STEP===0);
  const earliest=known.length?Math.min(...known):last-3*STEP;
  const start=Math.max(last-23*STEP,Math.min(earliest,last-3*STEP));
  const seen=new Set(known),targets=[];
  for(let t=last;t>=start;t-=STEP)if(!seen.has(t))targets.push(t);
  return targets;
}
function features(s,observedAt){
  const a=Core.analyzeMarket(Feed.input(s),s.settings),e=a.exec,f=e.flow?.latest||{},bar=e.candles.at(-1);
  return {id:s.id,asset:s.asset,version:s.version,bar:bar.time,asOf:s.settings.now,firstObservedAt:observedAt,sourceCreatedAt:s.createdAt,
    observedDelayMinutes:(observedAt-s.settings.now)/60000,source:'Bybit '+s.symbol,market:s.settings.market,
    state:a.state,actionable:a.actionable,direction:a.direction,session:a.session,regime:a.regime,
    structure:f.structure,ribbon:f.ribbon,heldDirection:f.direction,adx:e.values.adx,atr:e.values.atr,volumeRatio:f.volumeRatio,
    hourlyAligned:f.hourlyAligned,pullbackConfirmed:f.pullbackConfirmed,exitLong:f.exitLong,exitShort:f.exitShort,
    events:(e.smc?.events||[]).filter(ev=>ev.time===bar.time),quality:e.quality,netRR:a.plan?.netRR??null,
    h1Structure:a.h1.flow?.latest?.structure,h4Structure:a.h4.flow?.latest?.structure,
    bodyATR:Math.abs(bar.close-bar.open)/(e.values.atr||1),rangeATR:(bar.high-bar.low)/(e.values.atr||1),vetoes:a.vetoes,
    close:bar.close,plan:a.plan,positionDecision:a.positionDecision,
    liveObservation:observedAt-s.settings.now<=2*60000};
}
function outcome(sample,bars,horizon){
  const start=sample.bar+STEP,window=[];
  for(let i=0;i<horizon;i++){const b=bars.get(start+i*STEP);if(!b)return {status:'pending-or-missing',horizon};window.push(b);}
  const entry=window[0].open,exit=window.at(-1).close,move=(exit/entry-1)*10000,hi=Math.max(...window.map(b=>b.high)),lo=Math.min(...window.map(b=>b.low));
  return {status:'resolved',horizon,entryAt:start,exitAt:start+horizon*STEP,entry,exit,returnBps:move,
    longNetBps:move-7,shortNetBps:-move-7,longMfeBps:(hi/entry-1)*10000,longMaeBps:(lo/entry-1)*10000,
    note:'固定保有の比較指標。往復7bps仮定。SL/TP、約定差、資金調達料を再現した取引損益ではない。'};
}
// Summarize existing capture metadata only; never fetch or repair failed frames.
function multiframeErrorEvidence(pack){
  const trace=pack?.acquisition,requests=trace?.requests||[],frames=trace?.frames||[];
  const time=v=>Number.isFinite(v)&&v>=0;
  return (pack?.errors||[]).map((error,errorIndex)=>{
    const cfg=Feed.instruments[error.asset],tf=['1m','5m','15m','1h','4h','1d'].includes(error.tf)?error.tf:null;
    const row={errorIndex,asset:cfg?error.asset:null,tf,evidenceStatus:'UNAVAILABLE',
      scope:'Saved capture transport metadata only; not quota attribution, continuity or a replacement candle.'};
    if(!cfg||!tf||!Array.isArray(requests)||!Array.isArray(frames))return row;
    const matched=frames.filter(f=>f.asset===error.asset&&f.tf===tf&&f.status==='failed'&&f.error===error.error);
    if(matched.length!==1)return row;
    const frame=matched[0];if(!time(frame.startedAt)||!time(frame.completedAt)||frame.completedAt<frame.startedAt)return row;
    const candidates=requests.filter(r=>r.asset===error.asset&&r.tf===tf);
    if(!candidates.length||new Set(candidates.map(r=>r.id)).size!==candidates.length)return row;
    for(const [i,r] of candidates.entries()){
      let u;try{u=new URL(r.url);}catch{return row;}
      if(u.origin!=='https://api.bybit.com'||u.pathname!=='/v5/market/kline'||u.username||u.password||
        u.searchParams.get('symbol')!==cfg.symbol||u.searchParams.get('category')!==cfg.category||
        !Number.isInteger(r.id)||r.id<0||!['received','failed'].includes(r.status)||
        !time(r.requestedAt)||!time(r.completedAt)||r.requestedAt<frame.startedAt||r.completedAt>frame.completedAt||
        r.completedAt<r.requestedAt||(i&&candidates[i-1].completedAt>r.requestedAt)||
        (r.status==='received'&&(!time(r.receivedAt)||r.receivedAt<r.requestedAt||r.receivedAt>r.completedAt)))return row;
    }
    const r=candidates.at(-1),httpStatus=Number.isInteger(r.httpStatus)&&r.httpStatus>=100&&r.httpStatus<=599?r.httpStatus:null;
    const bybitCode=r.status==='received'&&Number.isInteger(r.bybitCode)&&Math.abs(r.bybitCode)<=2147483647?r.bybitCode:null;
    const kind=httpStatus!=null&&(httpStatus<200||httpStatus>=300)?'HTTP_STATUS':
      httpStatus!=null&&bybitCode!=null&&bybitCode!==0?'BYBIT_RET_CODE':'UNCLASSIFIED_FRAME_FAILURE';
    return {...row,evidenceStatus:'RECORDED',requestId:r.id,requestedAt:r.requestedAt,
      receivedAt:r.status==='received'?r.receivedAt:null,completedAt:r.completedAt,httpStatus,bybitCode,kind};
  });
}
async function run(){
  fs.mkdirSync(path.join(DIR,'snapshots'),{recursive:true});
  const specPath=path.join(DIR,'spec.json');
  if(!fs.existsSync(specPath))fs.writeFileSync(specPath,JSON.stringify({schema:1,createdAt:new Date().toISOString(),purpose:'2026年Gold/BTC別の前向き観測。分析専用・本番判定は変更しない。',
    sample:'取得できる各15分共通判定。サインなしも含む。毎時直近4判定を取得し、観測遅延と欠測を保持。',horizons:[1,4,8,16],costBps:7,
    gates:'30件は評価開始の最低目安であり採用条件ではない。重複保有期間を除外し、銘柄・相場環境別、時系列未使用期間、複数仮説、コスト感度・期待値・最大DDを検証する。過去再構築と実時間観測を混ぜない。',
    confounds:'GoldはBybit XAUUSDT永続契約、BTCはBybit現物。XM価格・世界全体出来高とは異なる。イベントカレンダー/実スプレッド/資金調達の未取得値を推定で埋めない。'},null,2));
  const errors=[];
  async function get(asset,id){const r=await fetch('https://multi-analyzer-monitor.rikai-829.workers.dev/api/snapshot?asset='+asset+(id?'&id='+id:''),{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);const s=await r.json();if(s.asset!==asset||s.version!==Core.VERSION||!s.bars?.m15)throw Error('snapshot mismatch');return s;}
  for(const asset of ['gold','btc']){
    if(!Feed.collectionPolicy(asset).allowed)continue;
    try{
      const latest=await get(asset),last=Feed.input(latest).exec.at(-1).time;
      const known=fs.readdirSync(path.join(DIR,'snapshots')).filter(n=>n.startsWith(asset+'-')&&n.endsWith('-'+Core.VERSION+'.json')).map(n=>Number(n.split('-')[1]));
      for(const t of archiveTargets(last,known)){
        const id=`${asset}-${t}-${Core.VERSION}`,file=path.join(DIR,'snapshots',id+'.json');if(fs.existsSync(file))continue;
        try{const snapshot=t===last?latest:await get(asset,id);if(snapshot.id!==id)throw Error('archive identity mismatch');fs.writeFileSync(file,JSON.stringify({firstObservedAt:Date.now(),snapshot}),{flag:'wx'});}catch(e){errors.push({id,error:e.message});}
      }
    }catch(e){errors.push({asset,error:e.message});}
  }
  const snapshots=fs.readdirSync(path.join(DIR,'snapshots')).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(DIR,'snapshots',n),'utf8'))).sort((a,b)=>a.firstObservedAt-b.firstObservedAt);
  const barMaps={gold:new Map(),btc:new Map()};
  for(const {snapshot:s} of snapshots)for(const b of Feed.input(s).exec){if(b.time+STEP<=s.settings.now&&!barMaps[s.asset].has(b.time))barMaps[s.asset].set(b.time,b);}
  const sampleFile=path.join(DIR,'samples.jsonl');
  const previous=new Map(fs.existsSync(sampleFile)?fs.readFileSync(sampleFile,'utf8').trim().split('\n').filter(Boolean).map(line=>{const s=JSON.parse(line);return[s.id,s];}):[]);
  const samples=snapshots.map(({snapshot,firstObservedAt})=>previous.get(snapshot.id)||features(snapshot,firstObservedAt));
  const results=samples.map(s=>({id:s.id,asset:s.asset,outcomes:[1,4,8,16].map(h=>outcome(s,barMaps[s.asset],h))}));
  fs.writeFileSync(path.join(DIR,'samples.jsonl'),samples.map(s=>JSON.stringify(s)).join('\n')+'\n');
  fs.writeFileSync(path.join(DIR,'outcomes.json'),JSON.stringify(results,null,2));
  const summary={updatedAt:new Date().toISOString(),samples:samples.length,byAsset:Object.fromEntries(['gold','btc'].map(asset=>[asset,{samples:samples.filter(s=>s.asset===asset).length,actionable:samples.filter(s=>s.asset===asset&&s.actionable).length,liveObserved:samples.filter(s=>s.asset===asset&&s.liveObservation).length,resolved2h:results.filter(s=>s.asset===asset&&s.outcomes[2].status==='resolved').length}])),errors,note:'分析専用。件数は重複する観測足を含む。勝率・優位性の推定にそのまま使わない。本番モデル変更なし。'};
  if(process.argv.includes('--multiframe')){
    global.MultiAnalyzerCore=Core;global.MultiAnalyzerFeed=Feed;
    try{
      const pack=await require('./review-pack').collect(['gold','btc']);
      const capture={capturedAt:pack.capturedAt,version:pack.version,errors:pack.errors,acquisition:pack.acquisition,records:pack.records.map(r=>({asset:r.asset,tf:r.tf,minutes:r.minutes,cutoff:r.cutoff,snapshotId:r.snapshotId,bars:Feed.pack(r.rows),acquisitionUseIds:r.acquisitionUseIds}))};
      const target=path.join(DIR,'multiframe');fs.mkdirSync(target,{recursive:true});
      const file=path.join(target,`${pack.capturedAt}.json.gz`);fs.writeFileSync(file,require('node:zlib').gzipSync(JSON.stringify(capture)),{flag:'wx'});summary.multiframe={records:capture.records.length,file:path.basename(file),errors:pack.errors,errorEvidence:multiframeErrorEvidence(pack)};
    }catch(e){summary.multiframe={error:e.message};}
  }
  if(process.argv.includes('--multiframe')){
    const observation=await require('./market-observation.cjs').capture();
    const target=path.join(DIR,'microstructure');fs.mkdirSync(target,{recursive:true});
    const file=`${observation.observedAt}.json.gz`;fs.writeFileSync(path.join(target,file),require('node:zlib').gzipSync(JSON.stringify(observation)),{flag:'wx'});
    summary.microstructure={file,errors:observation.errors,samples:Object.fromEntries(Object.entries(observation.assets).map(([asset,x])=>[asset,{count:x.sample?.count,durationSeconds:x.sample?.durationSeconds,spreadBps:x.quote?.spreadBps}]))};
  }
  const nearMissSpec=path.join(DIR,'near-miss-spec-v1.json');
  if(fs.existsSync(nearMissSpec)){
    const nearMiss=require('./research-near-miss.cjs').run({quiet:true});
    summary.nearMiss={version:1,rows:nearMiss.rows,file:'near-miss-report-v1.json',generatedAt:nearMiss.generatedAt};
  }
  fs.writeFileSync(path.join(DIR,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={features,outcome,archiveTargets,multiframeErrorEvidence};
