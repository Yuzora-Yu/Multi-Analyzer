/* Descriptive paired statistics, independently replayed through the frozen hypothesis. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const H=require('./research-touch-confirmation.cjs'),{stats}=require('./research-zone-trade-summary.cjs'),{atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function summarize(report,cohort){
 if(JSON.stringify(report.registration?.spec)!==JSON.stringify(H.SPEC)||!Number.isFinite(report.registration.registeredAt)||report.asOf!==cohort.asOf)throw Error('Hypothesis or as-of mismatch');
 assert.deepEqual(report.controls,cohort.controls,'Original controls changed');
 const originals=new Map(cohort.rows.filter(r=>r.forecast.primary).map(r=>[r.forecast.id,r])),seen=new Set(),partitions=new Map();
 if(report.rows.length!==originals.size)throw Error('Original primary population changed');
 for(const r of report.rows){
  const o=originals.get(r.id),c=o?.forecast;if(!c||seen.has(r.id))throw Error('Duplicate or missing original primary');seen.add(r.id);
  assert.deepEqual(r.identity,c.identity,'Original market identity changed');assert.deepEqual(r.coverage,o.coverage.classified,'Original coverage changed');
  if(r.originalEligible!==o.eligible||r.nonOverlapping!==o.outcomes[0].nonOverlapping||r.repeatedZoneKey!==o.repeatedZoneKey||r.eligible!==(r.postRegistration&&o.eligible))throw Error('Original eligibility changed');
  if(r.status!==(!r.postRegistration?'excluded-before-registration':!r.eligible?'pending-or-ineligible':'evaluated'))throw Error('Status gate changed');
  if(r.eligible){
   if(o.outcomes[0].until>report.asOf||!o.coverage.receiptComplete||!r.nonOverlapping)throw Error('Incomplete original window');
   if(r.arms?.length!==2||new Set(r.arms.map(a=>a.arm)).size!==2||r.arms.some(a=>!H.SPEC.arms.includes(a.arm)))throw Error('Missing paired arms');
   assert.deepEqual(r.arms.find(a=>a.arm===H.SPEC.arms[0]),o.arms.find(a=>a.arm===H.SPEC.arms[0]),'Original baseline changed');
   for(const a of r.arms){
    if(!['closed','no-trigger','cancelled','no-fill'].includes(a.status))throw Error('Unknown execution status');
    if(a.status==='closed'){
     if(![a.entry,a.exit,a.entryAt,a.exitAt,a.grossBps].every(Number.isFinite)||a.entry<=0||a.exit<=0||a.entryAt<c.from||a.exitAt<=a.entryAt||a.exitAt>o.outcomes[0].until)throw Error('Invalid execution bounds');
     const gross=(c.zone.direction==='LONG'?1:-1)*(a.exit/a.entry-1)*10000;
     if(a.grossBps!==gross||a.costs?.length!==3||H.SPEC.costBps.some(cost=>a.costs.filter(x=>x.costBps===cost&&x.assumedNetBps===gross-cost).length!==1))throw Error('Invalid execution costs');
     if(a.arm===H.SPEC.arms[1]){const ref=a.confirmationReference;if(!ref||!Number.isFinite(ref.price)||ref.price<=0||ref.barOpenAt<c.from||ref.knownAt!==ref.barOpenAt+STEP||a.entryAt<ref.knownAt+STEP)throw Error('Future or missing touch reference');}
    }
   }
  }else if(r.arms)throw Error('Excluded or pending window has arms');
  const key=JSON.stringify(c.identity);if(!partitions.has(key))partitions.set(key,{identity:c.identity,rows:[]});partitions.get(key).rows.push({r,c});
 }
 return {schema:1,asOf:report.asOf,sourceControls:report.controls.length,accuracyProven:false,
  unit:'Additive equal-notional hypothetical net bps, not compounded account equity, measured cost or real PnL.',
  partitions:[...partitions.values()].map(({identity,rows})=>{
   const evaluated=rows.filter(x=>x.r.eligible).sort((a,b)=>a.c.from-b.c.from||a.r.id.localeCompare(b.r.id)),keys=evaluated.map(x=>x.r.repeatedZoneKey);
   return {identity,primaryWindows:rows.length,excludedBeforeRegistration:rows.filter(x=>!x.r.postRegistration).length,pendingOrIneligible:rows.filter(x=>x.r.postRegistration&&!x.r.eligible).length,evaluated:evaluated.length,uniqueEvaluatedZoneKeys:new Set(keys).size,repeatedEvaluatedWindows:keys.length-new Set(keys).size,
    flags:{P:evaluated.filter(x=>x.c.flags?.P).length,EXIT:evaluated.filter(x=>x.c.flags?.EXIT_LONG||x.c.flags?.EXIT_SHORT).length,noSign:evaluated.filter(x=>x.c.flags?.noSign).length},
    costs:H.SPEC.costBps.map(costBps=>{
     const net=(x,arm)=>{const a=x.r.arms.find(a=>a.arm===arm);return a.status==='closed'?a.costs.find(c=>c.costBps===costBps).assumedNetBps:0;};
     return {costBps,arms:H.SPEC.arms.map(arm=>({arm,statusCounts:Object.fromEntries(['closed','no-trigger','cancelled','no-fill'].map(s=>[s,evaluated.filter(x=>x.r.arms.find(a=>a.arm===arm).status===s).length])),perEligibleWindow:stats(evaluated.map(x=>net(x,arm))),perExecutedHypotheticalTrade:stats(evaluated.filter(x=>x.r.arms.find(a=>a.arm===arm).status==='closed').map(x=>net(x,arm)))})),pairedTouchExtremeMinusSourceSwing:stats(evaluated.map(x=>net(x,H.SPEC.arms[1])-net(x,H.SPEC.arms[0])))};
    })};
  }),note:'Zero applies only to unexecuted arms in complete eligible windows. Missing, excluded and pending cases remain absent. Repeated zones, serial correlation and overlapping P/EXIT flags do not prove independence. Descriptive comparison, not untouched validation, probability or adoption.'};
}
function run(file,directory,root=path.join(__dirname,'.runtime/hourly-observation/research-touch-confirmation-v1')){
 const codeFiles=['research-touch-confirmation-summary.cjs','research-zone-trade-summary.cjs'],analysisHashes=Object.fromEntries(codeFiles.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
 const raw=fs.readFileSync(file),cohortRaw=fs.readFileSync(path.join(directory,'report.json')),report=JSON.parse(raw),cohort=JSON.parse(cohortRaw);
 const replay=H.run(directory,root),replayed=JSON.parse(fs.readFileSync(replay.file));assert.deepEqual(replayed,report,'Original registered hypothesis replay changed');
 const result=summarize(report,cohort);
 if(hash(fs.readFileSync(file))!==hash(raw)||hash(fs.readFileSync(path.join(directory,'report.json')))!==hash(cohortRaw))throw Error('Original report changed during summary');
 for(const [f,h] of Object.entries(analysisHashes))if(hash(fs.readFileSync(path.join(__dirname,f)))!==h)throw Error('Summary code changed');
 const output=path.join(path.dirname(root),'research-touch-confirmation-summaries');fs.mkdirSync(output,{recursive:true});const target=path.join(output,Date.now()+'-'+crypto.randomUUID()+'.json');
 atomicJSON(target,{...result,input:{hypothesisReportSha256:hash(raw),cohortReportSha256:hash(cohortRaw)},evidence:{registeredReplayMatched:true,replayCopy:replay.file,note:'Replay copy is verification of the same original cases, not additional observations.'},analysisHashes,collectorExecuted:false,productionChanged:false});return {file:target,registeredReplayMatched:true,partitions:result.partitions.length,accuracyProven:false};
}
if(require.main===module){try{if(!process.argv[2]||!process.argv[3])throw Error('Provide original hypothesis report and original cohort directory');console.log(JSON.stringify(run(path.resolve(process.argv[2]),path.resolve(process.argv[3])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={summarize,run};
