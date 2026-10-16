/* Gold-only operating route. Frozen research-forward.cjs and registrations remain unchanged. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Core=require('./strategy-core'),Feed=require('./market-feed');
const {SPEC,prepare,persist}=require('./research-forward.cjs');
const {indexSnapshots,linkOutcome,atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function evaluateGold(root,records,asOf){
  const entries=fs.readdirSync(path.join(root,'predictions')).filter(n=>n.startsWith('gold-')).map(n=>{
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
async function runGold(){
  const root=path.join(__dirname,'.runtime','hourly-observation','research-forward');fs.mkdirSync(root,{recursive:true});
  const specFile=path.join(root,'spec.json');
  if(!fs.existsSync(specFile))atomicJSON(specFile,{registeredAt:Date.now(),...SPEC});
  const savedSpec=JSON.parse(fs.readFileSync(specFile));delete savedSpec.registeredAt;
  if(JSON.stringify(savedSpec)!==JSON.stringify(SPEC))throw Error('Frozen spec differs; create a new study version');
  async function get(url){const requestedAt=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('HTTP '+response.status);const raw=await response.text(),receivedAt=Date.now();return {raw,data:JSON.parse(raw),transport:{url,requestedAt,receivedAt,responseSha256:hash(raw)}};}
  const frozen=[];
  for(const asset of ['gold']){
    if(!Feed.collectionPolicy(asset).allowed)continue;
    const fetched=await get('https://multi-analyzer-monitor.rikai-829.workers.dev/api/snapshot?asset='+asset);
    const time=await get('https://api.bybit.com/v5/market/time');
    if(time.data.retCode!==0)throw Error('Exchange clock unavailable');
    const clock={...time.transport,serverTime:Number(time.data.time),raw:time.data};
    if(fetched.data.asset!==asset)throw Error('Wrong asset returned');
    const record=prepare(fetched.data,fetched.transport,clock);record.operatingScope={assets:['gold'],runner:'research-forward-gold.cjs',runnerSha256:hash(fs.readFileSync(__filename)),frozenEngineUnchanged:true};record.snapshotResponseText=fetched.raw;frozen.push({id:record.id,...persist(root,record)});
  }
  const records=[],sourceDir=path.join(__dirname,'.runtime','hourly-observation','cohort-v1','snapshots');
  for(const file of fs.readdirSync(sourceDir).filter(n=>n.startsWith('gold-')&&n.endsWith('.json'))){const raw=fs.readFileSync(path.join(sourceDir,file));records.push({...JSON.parse(raw),file:'cohort-v1/snapshots/'+file,sha256:hash(raw)});}
  for(const id of fs.readdirSync(path.join(root,'predictions')).filter(n=>n.startsWith('gold-'))){const file=path.join(root,'predictions',id,'prediction.json'),raw=fs.readFileSync(file),r=JSON.parse(raw);records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file:'research-forward/predictions/'+id+'/prediction.json',sha256:hash(raw)});}
  const evaluatedAt=Date.now(),rows=evaluateGold(root,records,evaluatedAt),file=path.join(root,`evaluation-${evaluatedAt}.json`);
  atomicJSON(file,{evaluatedAt,specId:SPEC.id,operatingAssets:['gold'],btcStopped:true,rows});
  return {frozen,evaluation:file,rows:rows.length,prospectiveEligible:rows.filter(r=>r.receipt.prospectiveEligible).length};
}
if(require.main===module)runGold().then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={evaluateGold,runGold};
