/* Offline explanation of unchanged price availability around the configured Gold session policy. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const Feed=require('./market-feed.js'),W=require('./research-zone-windows.cjs'),A=require('./research-zone-availability.cjs'),{atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function slot(asset,s,asOf){
 if(!['gold','btc'].includes(asset)||!Number.isFinite(asOf)||!Number.isSafeInteger(s.barAt)||s.barAt%STEP||s.closedAt!==s.barAt+STEP||!['not-closed','missing','conflicting','receipted','declared-only'].includes(s.status)||(s.status==='not-closed')!==(s.closedAt>asOf))throw Error('Invalid original availability slot');
 const sessionIncluded=Feed.marketOpen(asset,s.barAt),collectionAtOpen=Feed.collectionPolicy(asset,s.barAt).allowed,collectionAtClose=Feed.collectionPolicy(asset,s.closedAt).allowed;
 const explanation=s.status!=='missing'?s.status:!sessionIncluded?'session-filter-excluded':!collectionAtOpen||!collectionAtClose?'collection-policy-paused':'expected-trading-slot-unrecorded';
 return {barAt:s.barAt,closedAt:s.closedAt,originalStatus:s.status,sessionIncluded,collectionAtOpen,collectionAtClose,explanation};
}
function summarize(rows){
 const groups=new Map();for(const r of rows.filter(r=>r.primary)){const key=JSON.stringify(r.identity);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 return [...groups.values()].map(g=>{const counts=reserved=>{const unique=new Map();for(const r of g.filter(r=>!reserved||r.reserved))for(const s of r.slots){const prior=unique.get(s.barAt);if(prior)assert.deepEqual(prior,s,'Conflicting original slot explanations');else unique.set(s.barAt,s);}const slots=[...unique.values()];return {uniqueSlots:slots.length,byExplanation:Object.fromEntries(['not-closed','session-filter-excluded','collection-policy-paused','expected-trading-slot-unrecorded','conflicting','receipted','declared-only'].map(k=>[k,slots.filter(s=>s.explanation===k).length]))};};return {identity:g[0].identity,primaryWindows:g.length,reservedWindows:g.filter(r=>r.reserved).length,allPrimaryUniqueSlots:counts(false),reservedPrimaryUniqueSlots:counts(true)};});
}
function annotate(report,availability){
 if(JSON.stringify(report.registration?.spec)!==JSON.stringify(W.SPEC)||availability.asOf!==report.asOf||availability.rows.length!==report.rows.length)throw Error('Original cohort/availability mismatch');
 const rows=report.rows.map((r,i)=>{const a=availability.rows[i],c=r.forecast;if(a.id!==c.id||a.primary!==c.primary||a.windows.length!==1)throw Error('Original population mismatch');assert.deepEqual(a.windows[0],r.coverage,'Original coverage changed');return {id:c.id,identity:c.identity,primary:c.primary,reserved:r.outcomes[0].nonOverlapping,originalEligible:r.eligible,originalReceiptComplete:r.coverage.receiptComplete,slots:a.windows[0].slots.map(s=>slot(c.identity.asset,s,report.asOf))};});
 return {schema:1,asOf:report.asOf,rows,partitions:summarize(rows),accuracyProven:false,productionChanged:false,collectorExecuted:false,note:'Configured session/collection policy explanation only, not proof Bybit perpetual exchange closed. Original missing slots remain missing, future slots stay pending, and every full wall-clock window, reservation and eligibility gate is unchanged. No price imputation, source rescue or return calculation. Counts deduplicate physical slot timestamps within each original market/code partition; they are not trade sample counts. A collection-paused close does not prove a technical outage or actual failed request.'};
}
function run(directory){
 const captured=new Map(),read=f=>{const b=fs.readFileSync(f);captured.set(f,b);return b;},raw=read(path.join(directory,'report.json')),manifestRaw=read(path.join(directory,'manifest.json')),report=JSON.parse(raw),manifest=JSON.parse(manifestRaw);
 const codeFiles=['research-session-availability.cjs','research-zone-availability.cjs','market-feed.js','research-zone-windows.cjs','research-audit.cjs'],codes=Object.fromEntries(codeFiles.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
 for(const [f,h]of Object.entries(report.registration.codeHashes))assert.equal(hash(fs.readFileSync(path.join(__dirname,f))),h,'Original registered code changed');
 const availability=A.audit(report,manifest,read),result=annotate(report,availability);
 for(const [f,b]of captured)assert.equal(hash(fs.readFileSync(f)),hash(b),'Original source changed');for(const [f,h]of Object.entries(codes))assert.equal(hash(fs.readFileSync(path.join(__dirname,f))),h,'Diagnostic code changed');
 const root=path.join(__dirname,'.runtime/hourly-observation/research-session-availability-reports');fs.mkdirSync(root,{recursive:true});const file=path.join(root,Date.now()+'-'+crypto.randomUUID()+'.json');atomicJSON(file,{...result,input:{reportSha256:hash(raw),manifestSha256:hash(manifestRaw)},availabilityIssues:availability.issues,codeHashes:codes});return {file,partitions:result.partitions,issues:availability.issues.length,accuracyProven:false};
}
if(require.main===module){try{if(!process.argv[2])throw Error('Provide original private decision-window directory');console.log(JSON.stringify(run(path.resolve(process.argv[2])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={slot,summarize,annotate,run};
