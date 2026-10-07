/* Offline reservation diagnosis; never changes original cohorts or outcomes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const Score=require('./research-scorecard.cjs'),Availability=require('./research-scorecard-availability.cjs'),Audit=require('./research-audit.cjs'),{SPEC}=require('./research-forward.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),STEP=900000,GROUPS=['all','P','EXIT_LONG','EXIT_SHORT','no-sign'];
function trace(entries,asOf){
 if(!Number.isFinite(asOf))throw Error('Invalid audit time');
 const reservations=new Map(),ids=new Set(),rows=[];
 for(const {record:r,eligible}of [...entries].sort((a,b)=>a.record.entryAt-b.record.entryAt||a.record.id.localeCompare(b.record.id))){
  if(ids.has(r.id)||!Number.isFinite(r.entryAt)||typeof eligible!=='boolean')throw Error('Invalid or duplicate reservation source');ids.add(r.id);
  const sig=Score.signature(r);if(!sig.codeComplete)throw Error('Missing causal hashes');
  const physical=[r.asset,r.market,r.symbol].join('/'),partition=[physical,r.engineVersion,sig.codeHash,sig.configurationHash].join('/');
  for(const horizon of SPEC.horizons){const key=physical+'/'+horizon,owner=reservations.get(key),until=r.entryAt+horizon*STEP,selected=!owner||r.entryAt>=owner.until;
   rows.push({id:r.id,partition,physical,horizon,from:r.entryAt,until,prospectiveEligible:eligible,selected,pending:until>asOf,groups:GROUPS.filter(g=>Score.inGroup(r.prediction,g)),blocker:selected?null:{id:owner.id,from:owner.from,until:owner.until,engineVersion:owner.engineVersion,prospectiveEligible:owner.eligible,noSign:owner.noSign},crossVersion:!selected&&owner.engineVersion!==r.engineVersion});
   if(selected)reservations.set(key,{id:r.id,from:r.entryAt,until,engineVersion:r.engineVersion,eligible,noSign:Score.inGroup(r.prediction,'no-sign')});
  }
 }
 return rows;
}
function summarize(rows,report){return report.partitions.map(p=>({key:p.key,asset:p.asset,engineVersion:p.engineVersion,horizons:Object.fromEntries(SPEC.horizons.map(h=>[h,Object.fromEntries(GROUPS.map(group=>{const all=rows.filter(r=>r.partition===p.key&&r.horizon===h&&r.groups.includes(group)),eligible=all.filter(r=>r.prospectiveEligible),selected=eligible.filter(r=>r.selected),original=p.horizons[h][group];assert.equal(eligible.length,original.eligible,'Original eligibility mismatch');assert.equal(selected.length,original.reservedWindows,'Original reservation mismatch');return [group,{eligible:eligible.length,reserved:selected.length,overlapExcluded:eligible.length-selected.length,blockedByNoSign:eligible.filter(r=>!r.selected&&r.blocker.noSign).length,blockedByIneligibleSource:eligible.filter(r=>!r.selected&&!r.blocker.prospectiveEligible).length,crossVersionBlockers:eligible.filter(r=>r.crossVersion).length,pendingSelected:selected.filter(r=>r.pending).length}];}))]))}));}
function run(directory,base=path.join(__dirname,'.runtime/hourly-observation')){
 const files=['research-signal-coverage.cjs','research-scorecard-availability.cjs','research-scorecard.cjs','research-forward.cjs','research-audit.cjs','research-zone-availability.cjs','market-feed.js'],codes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])),captured=new Map();
 const read=file=>{const b=fs.readFileSync(file);if(!captured.has(file))captured.set(file,b);else assert.equal(hash(b),hash(captured.get(file)),'Original changed during diagnosis');return b;};
 const report=JSON.parse(read(path.join(directory,'report.json'))),manifest=JSON.parse(read(path.join(directory,'manifest.json')));assert.equal(manifest.codeSha256,codes['research-scorecard.cjs'],'Original scorecard code changed');
 const sources=manifest.sourceFiles.map(m=>({...m,file:path.resolve(base,m.file)})),proof=Availability.audit(report,{...manifest,sourceFiles:sources},read),entries=[];
 for(const m of sources){if(path.basename(m.file)!=='prediction.json')continue;const r=JSON.parse(read(m.file)),receipt=JSON.parse(read(path.join(path.dirname(m.file),'receipt.json')));if(receipt.persistedAt>report.asOf)continue;
  const sequence=Number.isFinite(receipt.persistedAt)&&receipt.persistedAt>=r.generatedAt&&r.generatedAt>=r.transport?.receivedAt&&r.latestInfoEventAt<=r.cutoff,eligible=sequence&&r.specId===SPEC.id&&r.issues.length===0&&r.clockBounds.valid&&receipt.persistedAt+r.clockBounds.upperOffsetMs+SPEC.guardMs<r.entryAt;
  entries.push({record:r,eligible});
 }
 const rows=trace(entries,report.asOf),partitions=summarize(rows,report);
 for(const [f,b]of captured)assert.equal(hash(fs.readFileSync(f)),hash(b),'Original input changed');for(const [f,h]of Object.entries(codes))assert.equal(hash(fs.readFileSync(path.join(__dirname,f))),h,'Diagnostic code changed');
 const result={schema:1,asOf:report.asOf,originalReplayMatched:proof.replayMatches,partitions,rows,manifest:[...captured].map(([file,b])=>({file,sha256:hash(b)})),codeHashes:codes,collectorExecuted:false,productionChanged:false,accuracyProven:false,note:'Exact original reservations across all signs and versions. Ineligible and pending owners remain reserved. Blocker labels overlap; do not add their counts. Excluded signs are not promoted or replaced. No returns, probabilities or alternative event cohort. Nonoverlap is not independence.'};
 const out=path.join(base,'research-signal-coverage-reports');fs.mkdirSync(out,{recursive:true});const file=path.join(out,Date.now()+'-'+crypto.randomUUID()+'.json');Audit.atomicJSON(file,result);return {file,originalReplayMatched:result.originalReplayMatched,entries:entries.length,partitions:partitions.length,accuracyProven:false};
}
if(require.main===module){try{console.log(JSON.stringify(run(path.resolve(process.argv[2]||'')),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={trace,summarize,run};
