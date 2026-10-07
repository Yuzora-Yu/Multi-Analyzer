/* Offline companion: immutable scorecard replay and subsequent price availability. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Audit=require('./research-audit.cjs'),Score=require('./research-scorecard.cjs');
const Availability=require('./research-zone-availability.cjs'),{SPEC}=require('./research-forward.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const AUDITOR_FILES=['research-scorecard-availability.cjs','research-scorecard.cjs','research-forward.cjs','research-audit.cjs','research-zone-availability.cjs','market-feed.js'];
const loadedCodeHashes=Object.fromEntries(AUDITOR_FILES.map(file=>[file,hash(fs.readFileSync(path.join(__dirname,file)))]));
function audit(report,manifest,read){
  if(!Number.isFinite(report.asOf)||manifest.asOf!==report.asOf||!Array.isArray(manifest.sourceFiles))throw Error('Invalid scorecard audit input');
  const files=new Map(),raws=new Map(),records=[],entries=[],evidence=new Map();
  for(const m of manifest.sourceFiles){if(files.has(m.file)&&files.get(m.file)!==m.sha256)throw Error('Conflicting source manifest');files.set(m.file,m.sha256);}
  const recorded=file=>{if(raws.has(file))return JSON.parse(raws.get(file));const raw=read(file);if(hash(raw)!==files.get(file))throw Error('Manifest source hash mismatch');raws.set(file,raw);return JSON.parse(raw);};
  for(const file of files.keys()){
    if(/[/\\]cohort-v1[/\\]snapshots[/\\][^/\\]+\.json$/.test(file))records.push({...recorded(file),file,sha256:files.get(file)});
    if(path.basename(file)!=='prediction.json')continue;
    const r=recorded(file),receiptFile=path.join(path.dirname(file),'receipt.json');if(!files.has(receiptFile))throw Error('Missing original prediction receipt');
    if(path.basename(path.dirname(file))!==r.id||evidence.has(r.id))throw Error('Prediction source identity mismatch');
    const receipt=recorded(receiptFile);if(receipt.predictionSha256!==files.get(file))throw Error('Prediction receipt mismatch');
    const sequence=Number.isFinite(receipt.persistedAt)&&receipt.persistedAt>=r.generatedAt&&r.generatedAt>=r.transport?.receivedAt&&r.latestInfoEventAt<=r.cutoff;
    const eligible=sequence&&r.specId===SPEC.id&&r.issues.length===0&&r.clockBounds.valid&&receipt.persistedAt+r.clockBounds.upperOffsetMs+SPEC.guardMs<r.entryAt;
    evidence.set(r.id,r);records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file,sha256:files.get(file)});
    if(receipt.persistedAt<=report.asOf)entries.push({r,receipt:{...receipt,prospectiveEligible:eligible}});
  }
  const indexed=Audit.indexSnapshots(records.filter(r=>r.firstObservedAt<=report.asOf)),reserved=new Map();
  const rows=entries.sort((a,b)=>a.r.entryAt-b.r.entryAt||a.r.id.localeCompare(b.r.id)).map(({r,receipt})=>({id:r.id,asset:r.asset,market:r.market,engineVersion:r.engineVersion,prediction:r.prediction,receipt,
    outcomes:SPEC.horizons.map(h=>{const k=[r.asset,r.market,r.symbol].join('/'),o=Audit.linkOutcome({bar:r.entryAt-900000},indexed.markets.get(k),h,report.asOf),key=k+'/'+h,nonOverlapping=r.entryAt>=(reserved.get(key)??-Infinity);if(nonOverlapping)reserved.set(key,o.exitAt);return {...o,prospective:receipt.prospectiveEligible,nonOverlapping};})}));
  const replay=Score.scorecard(rows,evidence,{asOf:report.asOf});
  if(JSON.stringify(replay)!==JSON.stringify(report))throw Error('Original scorecard cannot be reproduced from its manifest');
  const proxy={asOf:report.asOf,rows:rows.map(row=>{const r=evidence.get(row.id);return {forecast:{id:row.id,sourceId:row.id,identity:{asset:r.asset,market:r.market,symbol:r.symbol},primary:true,from:r.entryAt},outcomes:row.outcomes.map(o=>({horizon:o.horizon,from:o.entryAt,until:o.exitAt,status:o.status,eligibleForSummary:row.receipt.prospectiveEligible&&o.nonOverlapping&&o.status==='resolved'&&o.exitAt<=report.asOf}))};})};
  const available=Availability.audit(proxy,{sources:manifest.sourceFiles},read);
  // A price bar can cite thousands of overlapping snapshots. Store its reproducible
  // source digest once per shared source array rather than serializing every copy.
  const summaries=new WeakMap();
  for(const row of available.rows)for(const window of row.windows)for(const slot of window.slots){
    const sources=slot.sources;let summary=summaries.get(sources);
    if(!summary){const receipts=sources.filter(s=>s.proof==='receipted');summary={sourceCount:sources.length,receiptedSourceCount:receipts.length,firstReceiptedAt:receipts.length?Math.min(...receipts.map(s=>s.availableAt)):null,evidenceSha256:hash(JSON.stringify(sources))};summaries.set(sources,summary);}
    delete slot.sources;slot.sourceEvidence=summary;
  }
  const partitions=report.partitions.map(p=>({...p,horizons:Object.fromEntries(Object.entries(p.horizons).map(([h,groups])=>[h,Object.fromEntries(Object.entries(groups).map(([group,g])=>{
    const candidates=rows.filter(row=>{const r=evidence.get(row.id),s=Score.signature(r);return [r.asset,r.market,r.symbol,r.engineVersion,s.codeHash,s.configurationHash].join('/')===p.key&&row.receipt.prospectiveEligible&&Score.inGroup(r.prediction,group)&&row.outcomes.find(o=>o.horizon===Number(h))?.nonOverlapping;});
    const selected=available.rows.filter(row=>candidates.some(c=>c.id===row.id)).map(row=>row.windows.find(w=>w.horizon===Number(h)));
    return [group,{reservedWindows:g.reservedWindows,reportedEvaluable:g.evaluable,verifiedPriceWindows:selected.filter(w=>w.reportedEligible&&w.receiptComplete).length,rejectedPriceWindows:selected.filter(w=>w.reportedEligible&&!w.receiptComplete).length,pendingOrUnverifiedWindows:selected.filter(w=>!w.reportedEligible).length}];
  }))]))}));
  for(const [file,raw] of raws)if(hash(read(file))!==hash(raw))throw Error('Original source changed during companion audit');
  return {schema:1,asOf:report.asOf,replayMatches:true,sourceCounts:available.sourceCounts,issues:available.issues,partitions,rows:available.rows,accuracyProven:false,note:'Independent availability companion, not an amended study. Original benchmark costs, reservations and labels remain unchanged. Complete price receipts do not certify a displayed forecast, executable fill or edge; no recalculated profitability estimates.'};
}
function run(directory,{base=path.join(__dirname,'.runtime/hourly-observation')}={}){
  const reportFile=path.join(directory,'report.json'),manifestFile=path.join(directory,'manifest.json'),raw=fs.readFileSync(reportFile),manifestRaw=fs.readFileSync(manifestFile),manifest=JSON.parse(manifestRaw);
  if(manifest.codeSha256!==loadedCodeHashes['research-scorecard.cjs'])throw Error('Original scorecard implementation changed');
  for(const [file,digest] of Object.entries(loadedCodeHashes))if(hash(fs.readFileSync(path.join(__dirname,file)))!==digest)throw Error('Auditor implementation changed');
  const sources=manifest.sourceFiles.map(m=>({...m,file:path.resolve(base,m.file)}));
  const result=audit(JSON.parse(raw),{...manifest,sourceFiles:sources},file=>fs.readFileSync(file));
  if(hash(fs.readFileSync(reportFile))!==hash(raw)||hash(fs.readFileSync(manifestFile))!==hash(manifestRaw))throw Error('Input report changed during audit');
  for(const [file,digest] of Object.entries(loadedCodeHashes))if(hash(fs.readFileSync(path.join(__dirname,file)))!==digest)throw Error('Auditor implementation changed');
  return {...result,auditedAt:Date.now(),input:{reportSha256:hash(raw),manifestSha256:hash(manifestRaw)},auditorSha256:loadedCodeHashes['research-scorecard-availability.cjs'],auditorCodeHashes:loadedCodeHashes};
}
if(require.main===module){try{if(!process.argv[2])throw Error('Provide an existing private scorecard directory');const result=run(path.resolve(process.argv[2])),dir=path.join(__dirname,'.runtime/hourly-observation/research-scorecard-availability');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,result.auditedAt+'-'+crypto.randomUUID()+'.json');Audit.atomicJSON(file,result);console.log(JSON.stringify({file,replayMatches:result.replayMatches,issues:result.issues.length,partitions:result.partitions.map(p=>({asset:p.asset,version:p.engineVersion,horizon8:p.horizons[8].all}))},null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={audit,run};
