/* Companion diagnostics only; registered selection and simulations are unchanged. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Trades=require('./research-zone-trades.cjs'),Availability=require('./research-zone-availability.cjs');
const {atomicJSON}=require('./research-audit.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function diagnose(trades,zones,availability){
  if(trades.asOf!==zones.asOf||availability.asOf!==zones.asOf||JSON.stringify(trades.registration?.spec)!==JSON.stringify(Trades.SPEC))throw Error('Protocol/as-of mismatch');
  const primaries=zones.rows.filter(r=>r.forecast.primary),seen=new Set(),partitions=new Map();
  const rows=trades.rows.map(t=>{
    if(seen.has(t.id))throw Error('Duplicate primary');seen.add(t.id);
    const originals=primaries.filter(r=>r.forecast.id===t.id),coverages=availability.rows.filter(r=>r.id===t.id);
    if(originals.length!==1||coverages.length!==1)throw Error('Original primary/coverage missing or duplicated');
    const {forecast:c,outcomes}=originals[0],coverage=coverages[0];
    if(JSON.stringify(t.identity)!==JSON.stringify(c.identity)||!coverage.primary||coverage.sourceId!==c.sourceId||coverage.physical!==[c.identity.asset,c.identity.market,c.identity.symbol].join('/'))throw Error('Original identity mismatch');
    const outcome=outcomes.find(o=>o.horizon===Trades.SPEC.horizon),windows=coverage.windows.filter(w=>w.horizon===Trades.SPEC.horizon);
    if(!outcome||windows.length!==1||outcome.from!==c.from||outcome.until!==c.from+Trades.SPEC.horizon*900000||windows[0].from!==outcome.from||windows[0].until!==outcome.until||windows[0].reportedStatus!==outcome.status)throw Error('Window mismatch');
    const w=windows[0],counts=w.classified,classes=['not-closed','missing','conflicting','receipted','declared-only'];
    if(classes.some(k=>!Number.isInteger(counts?.[k])||counts[k]<0)||classes.reduce((sum,k)=>sum+counts[k],0)!==Trades.SPEC.horizon||w.receiptComplete!==(counts.receipted===Trades.SPEC.horizon))throw Error('Invalid coverage counts');
    if((outcome.status==='resolved'||w.receiptComplete)&&outcome.until>zones.asOf)throw Error('Future window cannot be complete');
    if(typeof t.postRegistration!=='boolean'||typeof c.eligibility?.eligible!=='boolean'||typeof outcome.nonOverlapping!=='boolean')throw Error('Missing gate evidence');
    const gates={postRegistration:t.postRegistration,sourceEligible:c.eligibility.eligible,nonOverlapping:outcome.nonOverlapping,priceOutcomeResolved:outcome.status==='resolved',receiptComplete:w.receiptComplete};
    const eligible=Object.values(gates).every(Boolean);
    if(t.eligible!==eligible||t.status!==(!t.postRegistration?'excluded-before-registration':eligible?'evaluated':'pending-or-ineligible')||(eligible&&w.summaryGate!=='availability-only-verified'))throw Error('Trade eligibility differs from original gates');
    const blockers=Object.keys(gates).filter(k=>!gates[k]);
    const row={id:t.id,sourceId:c.sourceId,identity:c.identity,from:c.from,until:outcome.until,gates,blockers,eligible,sourceIssues:c.eligibility.issues||[],priceStatus:outcome.status,coverage:{...counts},nextScheduledClose:w.nextScheduledClose,
      registrationExcludedPermanently:!t.postRegistration,canBecomeEligibleWithPricesOnly:t.postRegistration&&c.eligibility.eligible&&outcome.nonOverlapping&&!eligible};
    const key=JSON.stringify(c.identity);if(!partitions.has(key))partitions.set(key,{identity:c.identity,totalPrimary:0,eligible:0,blockerCounts:Object.fromEntries(Object.keys(gates).map(k=>[k,0]))});
    const p=partitions.get(key);p.totalPrimary++;p.eligible+=Number(eligible);for(const k of blockers)p.blockerCounts[k]++;
    return row;
  });
  if(seen.size!==primaries.length)throw Error('Original primary population dropped');
  return {schema:1,asOf:zones.asOf,rows,partitions:[...partitions.values()],accuracyProven:false,
    interpretation:'Audit of original exclusion gates, not new selection or performance. Blockers overlap; their counts are not independent samples. Earlier registration exclusions never become eligible merely because later prices arrive. Scheduled close is not evidence of receipt.'};
}
function run(directory){
  const reportFile=path.join(directory,'report.json'),manifestFile=path.join(directory,'manifest.json'),raw=fs.readFileSync(reportFile),manifest=fs.readFileSync(manifestFile);
  const tradeOutput=Trades.run(directory),tradeRaw=fs.readFileSync(tradeOutput.file),trades=JSON.parse(tradeRaw),availability=Availability.run(directory);
  if(trades.input.reportSha256!==hash(raw)||trades.input.manifestSha256!==hash(manifest)||availability.input.reportSha256!==hash(raw)||availability.input.manifestSha256!==hash(manifest))throw Error('Replay source mismatch');
  const result=diagnose(trades,JSON.parse(raw),availability);
  if(hash(fs.readFileSync(reportFile))!==hash(raw)||hash(fs.readFileSync(manifestFile))!==hash(manifest)||hash(fs.readFileSync(tradeOutput.file))!==hash(tradeRaw))throw Error('Input changed during diagnostics');
  const root=path.join(__dirname,'.runtime/hourly-observation/research-zone-gates');fs.mkdirSync(root,{recursive:true});const file=path.join(root,Date.now()+'-'+crypto.randomUUID()+'.json');
  atomicJSON(file,{...result,auditedAt:Date.now(),input:{reportSha256:hash(raw),manifestSha256:hash(manifest),tradeSha256:hash(tradeRaw)},tradeReport:tradeOutput.file,auditorSha256:hash(fs.readFileSync(__filename)),collectorExecuted:false});
  return {file,partitions:result.partitions,accuracyProven:false};
}
if(require.main===module){try{if(!process.argv[2])throw Error('Provide original private zone report directory');console.log(JSON.stringify(run(path.resolve(process.argv[2])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={diagnose,run};
