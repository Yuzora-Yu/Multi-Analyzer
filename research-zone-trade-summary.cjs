/* Descriptive paired summary of the frozen zone simulation; no strategy fitting. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Trades=require('./research-zone-trades.cjs');
const {atomicJSON}=require('./research-audit.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const METHOD={id:'paired-zone-summary-v1',unit:'Additive equal-notional hypothetical net basis points; not account equity, compounded return or real broker P&L.',
  population:'Original nonoverlapping eligible primary windows. No-trigger, cancelled and no-fill contribute zero only inside a fully evaluated window; excluded/pending/missing windows never contribute zero.',
  comparison:'Confirmation minus touch within the same original zone/window, including no-trade windows. Per-executed-trade averages are also separate; a small set of selected trades cannot stand in for all eligible windows.',
  uncertainty:'No probability, significance or causal confluence advantage. Nonoverlap does not prove independence. Sparse samples and assumed execution costs cannot establish adoption.'};
function stats(values){
  if(values.some(x=>!Number.isFinite(x)))throw Error('Nonfinite summary value');
  if(!values.length)return {count:0,sumBps:null,meanBps:null,medianBps:null,positive:0,negative:0,zero:0,additiveDrawdownBps:null,maxConsecutiveNegative:0};
  let sum=0,peak=0,dd=0,streak=0,maxStreak=0;for(const x of values){sum+=x;peak=Math.max(peak,sum);dd=Math.max(dd,peak-sum);streak=x<0?streak+1:0;maxStreak=Math.max(maxStreak,streak);}
  const sorted=[...values].sort((a,b)=>a-b),n=sorted.length,m=n>>1;
  return {count:n,sumBps:sum,meanBps:sum/n,medianBps:n%2?sorted[m]:(sorted[m-1]+sorted[m])/2,positive:values.filter(x=>x>0).length,negative:values.filter(x=>x<0).length,zero:values.filter(x=>x===0).length,additiveDrawdownBps:dd,maxConsecutiveNegative:maxStreak};
}
function summarize(report,zones){
  if(JSON.stringify(report.registration?.spec)!==JSON.stringify(Trades.SPEC)||report.asOf!==zones.asOf)throw Error('Protocol/as-of mismatch');
  const originals=new Map(zones.rows.map(r=>[r.forecast.id,r])),seen=new Set(),partitions=new Map();
  for(const row of report.rows){
    if(seen.has(row.id))throw Error('Duplicate primary window');seen.add(row.id);
    const original=originals.get(row.id),c=original?.forecast;if(!c?.primary||JSON.stringify(row.identity)!==JSON.stringify(c.identity))throw Error('Original primary identity mismatch');
    const key=JSON.stringify(row.identity);if(!partitions.has(key))partitions.set(key,{identity:row.identity,rows:[]});
    if(row.eligible){
      const o=original.outcomes.find(o=>o.horizon===Trades.SPEC.horizon);
      if(!row.postRegistration||row.status!=='evaluated'||!o?.nonOverlapping||o.status!=='resolved'||!c.eligibility.eligible||c.from+Trades.SPEC.horizon*900000>report.asOf)throw Error('Invalid eligible window');
      if(row.arms?.length!==2||new Set(row.arms.map(a=>a.arm)).size!==2||row.arms.some(a=>!Trades.SPEC.arms.includes(a.arm)))throw Error('Missing or duplicate paired arm');
      for(const a of row.arms){if(!['closed','no-trigger','cancelled','no-fill'].includes(a.status))throw Error('Unknown arm status');
        if(a.status==='closed'){
          if(![a.entry,a.exit,a.stop,a.target,a.entryAt,a.exitAt,a.grossBps].every(Number.isFinite)||a.entry<=0||a.exit<=0||a.entryAt<c.from||a.exitAt>a.entryAt+Trades.SPEC.horizon*900000||a.exitAt>o.until||a.exitAt<=a.entryAt)throw Error('Invalid closed simulation');
          const expected=(c.zone.direction==='LONG'?1:-1)*(a.exit/a.entry-1)*10000;if(a.grossBps!==expected)throw Error('Gross movement mismatch');
          if(a.costs?.length!==Trades.SPEC.costBps.length||Trades.SPEC.costBps.some(cost=>a.costs.filter(x=>x.costBps===cost&&x.assumedNetBps===expected-cost).length!==1))throw Error('Cost sensitivity mismatch');
        }
      }
    }else if(row.arms)throw Error('Ineligible window must not contain simulated trades');
    partitions.get(key).rows.push({row,c});
  }
  if(seen.size!==zones.rows.filter(r=>r.forecast.primary).length)throw Error('Original primary population dropped');
  return {schema:1,asOf:report.asOf,method:METHOD,accuracyProven:false,partitions:[...partitions.values()].sort((a,b)=>JSON.stringify(a.identity).localeCompare(JSON.stringify(b.identity))).map(({identity,rows})=>{
    rows.sort((a,b)=>a.c.from-b.c.from||a.row.id.localeCompare(b.row.id));const evaluated=rows.filter(x=>x.row.eligible);
    const costs=Trades.SPEC.costBps.map(costBps=>{
      const net=(row,arm)=>{const a=row.arms.find(a=>a.arm===arm);return a.status==='closed'?a.costs.find(c=>c.costBps===costBps).assumedNetBps:0;};
      return {costBps,arms:Trades.SPEC.arms.map(arm=>{
        const closed=evaluated.filter(x=>x.row.arms.find(a=>a.arm===arm).status==='closed');
        return {arm,statusCounts:Object.fromEntries(['closed','no-trigger','cancelled','no-fill'].map(status=>[status,evaluated.filter(x=>x.row.arms.find(a=>a.arm===arm).status===status).length])),perEligibleWindow:stats(evaluated.map(x=>net(x.row,arm))),perExecutedHypotheticalTrade:stats(closed.map(x=>net(x.row,arm)))};
      }),pairedConfirmationMinusTouch:stats(evaluated.map(x=>net(x.row,Trades.SPEC.arms[1])-net(x.row,Trades.SPEC.arms[0])))};
    });
    return {identity,totalPrimary:rows.length,evaluated:evaluated.length,excludedOrPending:rows.length-evaluated.length,statusCounts:Object.fromEntries([...new Set(rows.map(x=>x.row.status))].map(status=>[status,rows.filter(x=>x.row.status===status).length])),costs};
  })};
}
function run(tradeFile,zoneDirectory){
  const files=['research-zone-trade-summary.cjs','research-zone-trades.cjs'],codeHashes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
  const raw=fs.readFileSync(tradeFile),report=JSON.parse(raw),zoneFile=path.join(zoneDirectory,'report.json'),zoneRaw=fs.readFileSync(zoneFile),zones=JSON.parse(zoneRaw);
  if(hash(zoneRaw)!==report.input?.reportSha256)throw Error('Original zone report hash mismatch');
  const replay=Trades.run(zoneDirectory),replayed=JSON.parse(fs.readFileSync(replay.file));
  if(JSON.stringify(replayed)!==JSON.stringify(report))throw Error('Original trade simulation replay differs');
  const result=summarize(report,zones);
  if(hash(fs.readFileSync(tradeFile))!==hash(raw)||hash(fs.readFileSync(zoneFile))!==hash(zoneRaw))throw Error('Input changed during summary');
  for(const [f,h] of Object.entries(codeHashes))if(hash(fs.readFileSync(path.join(__dirname,f)))!==h)throw Error('Summary code changed during replay');
  const output=path.join(__dirname,'.runtime/hourly-observation/research-zone-trade-summaries');fs.mkdirSync(output,{recursive:true});const file=path.join(output,Date.now()+'-'+crypto.randomUUID()+'.json');
  atomicJSON(file,{...result,auditedAt:Date.now(),input:{tradeSha256:hash(raw),zoneSha256:hash(zoneRaw)},codeHashes,replayEvidenceSha256:hash(fs.readFileSync(replay.file)),collectorExecuted:false});
  return {file,replayMatched:true,partitions:result.partitions.map(p=>({identity:p.identity,evaluated:p.evaluated,totalPrimary:p.totalPrimary})),accuracyProven:false};
}
if(require.main===module){try{if(process.argv.length!==4)throw Error('Provide explicit private trade report and original zone directory');console.log(JSON.stringify(run(path.resolve(process.argv[2]),path.resolve(process.argv[3])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={METHOD,stats,summarize,run};
