/* Separate preregistered, offline hypothesis. No production trigger changes. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const T=require('./research-zone-trades.cjs'),S=require('./research-zone-window-summary.cjs'),{indexSnapshots,atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const SPEC={id:'touch-bar-confirmation-v1',horizon:16,arms:['confirmed-reaction-next-open','touch-bar-extreme-next-open'],costBps:[7,14,21],
 question:'Does a fixed first-touch-bar extreme provide better cost-sensitive hypothetical outcomes than the original source swing confirmation, on the same prospective primary windows?',
 designOrigin:'One new trigger selected after exploratory inspection of prior confirmation geometry. Existing cases cannot validate this choice; market evaluation begins only with later original source closes.',
 trigger:'Freeze the high (LONG) or low (SHORT) of the first future full M15 bar overlapping the original zone, only at that bar close. Require a later M15 close beyond BOTH that fixed extreme and the original zone. No same-bar confirmation, moving reference, early wick entry or extra body/MA threshold. Cancel on original stop/close invalidation before entry.',
 population:'Subset of unchanged registered decision-window reservations. Original source close must be strictly after this new registration plus conservative nonnegative exchange upper clock offset. Preserve rank zero, all original source/freshness/guard/receipt gates and cross-version reservations. Never rehabilitate older, excluded or secondary zones. All original controls remain visible.',
 execution:T.SPEC.execution,
 coverage:'All 16 original price bars require receipts by the original report as-of. Costs are assumed 7/14/21bps; measured spread, funding, borrowing and account execution remain unavailable. BTC spot shorts are hypothetical benchmarks, not verified borrow-backed orders.',
 adoption:'Research only. At least 100 eligible nonoverlapping windows per physical market is necessary, not sufficient; repeated zones and serial correlation must remain visible. Separately preregister untouched validation BEFORE its observations, measure paired cost-adjusted expectation and drawdown with uncertainty, and do not promote on win rate or exploratory results. No probability or profit claim.'};
const FILES=['research-touch-confirmation.cjs','research-zone-window-summary.cjs','research-zone-trade-summary.cjs','research-zone-windows.cjs','research-zones.cjs','research-zone-trades.cjs','research-zone-availability.cjs','research-audit.cjs','zone-focus.js','strategy-core.js','flow-core.js','smc-core.js','market-feed.js','research-forward.cjs','research-scorecard.cjs'];
const hashes=()=>Object.fromEntries(FILES.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))]));
function register(root,now=Date.now()){
 if(!Number.isFinite(now))throw Error('Invalid registration time');const file=path.join(root,'registration.json'),fixed={spec:SPEC,codeHashes:hashes()};
 if(fs.existsSync(file)){const r=JSON.parse(fs.readFileSync(file)),{registeredAt,...prior}=r;if(!Number.isFinite(registeredAt)||JSON.stringify(prior)!==JSON.stringify(fixed))throw Error('Changed hypothesis requires new registration');return r;}
 fs.mkdirSync(root,{recursive:true});const r={registeredAt:now,...fixed};fs.writeFileSync(file,JSON.stringify(r,null,2),{flag:'wx'});return r;
}
function simulate(c,bars){
 // Validate through the unchanged execution engine before reading the touch reference.
 T.simulate(c,bars,T.SPEC.arms[1]);
 const z=c.zone,long=z.direction==='LONG';let touch=null;
 for(const b of bars){
  if((long?b.low<=z.protectiveStop:b.high>=z.protectiveStop)||(long?b.close<z.invalidationClose:b.close>z.invalidationClose))break;
  if(b.high>=z.low&&b.low<=z.high){touch=b;break;}
 }
 const pivot=touch?(long?touch.high:touch.low):null;
 const result=T.simulate({...c,pivot},bars,T.SPEC.arms[1]);
 return {...result,arm:SPEC.arms[1],confirmationReference:touch?{price:pivot,barOpenAt:touch.time,knownAt:touch.time+STEP,kind:'first-touch-bar-extreme'}:null};
}
function eligibleAfter(c,source,registration){return Number.isFinite(source.clockBounds?.upperOffsetMs)&&c.originClosedAt>registration.registeredAt+Math.max(0,source.clockBounds.upperOffsetMs);}
function run(directory,root=path.join(__dirname,'.runtime/hourly-observation/research-touch-confirmation-v1')){
 if(!fs.existsSync(path.join(root,'registration.json')))throw Error('Explicit preregistration required');const registration=register(root),bytes=new Map(),read=file=>{const b=fs.readFileSync(file);bytes.set(file,b);return b;};
 const registrationRaw=read(path.join(root,'registration.json')),raw=read(path.join(directory,'report.json')),manifestRaw=read(path.join(directory,'manifest.json')),report=JSON.parse(raw),manifest=JSON.parse(manifestRaw);
 if(!Number.isFinite(report.asOf))throw Error('Invalid report as-of');
 const evidence=S.replay(report,manifest,read),records=[],sources=new Map();
 for(const m of manifest.sources){const r=JSON.parse(read(m.file));if(path.basename(m.file)==='prediction.json'){if(sources.has(r.id))throw Error('Duplicate original source');sources.set(r.id,r);records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file:m.file,sha256:m.sha256});}}
 const index=indexSnapshots(records.filter(r=>r.firstObservedAt<=report.asOf)),rows=[];
 for(const r of report.rows.filter(r=>r.forecast.primary)){
  const c=r.forecast,source=sources.get(c.sourceId);if(!source)throw Error('Missing original source');
  const postRegistration=eligibleAfter(c,source,registration),eligible=postRegistration&&r.eligible;
  const row={id:c.id,identity:c.identity,repeatedZoneKey:r.repeatedZoneKey,postRegistration,originalEligible:r.eligible,originalSourceEligibility:c.eligibility,nonOverlapping:r.outcomes[0].nonOverlapping,coverage:r.coverage.classified,eligible,status:!postRegistration?'excluded-before-registration':!eligible?'pending-or-ineligible':'evaluated'};
  if(eligible){const market=index.markets.get([c.identity.asset,c.identity.market,c.identity.symbol].join('/')),bars=Array.from({length:16},(_,i)=>market.get(c.from+i*STEP).bar),strict=T.simulate(c,bars,T.SPEC.arms[1]);assert.deepEqual(strict,r.arms.find(a=>a.arm===T.SPEC.arms[1]),'Original baseline changed');row.arms=[strict,simulate(c,bars)];}
  rows.push(row);
 }
 for(const [file,b] of bytes)if(hash(fs.readFileSync(file))!==hash(b))throw Error('Original source/registration/report changed');
 if(JSON.stringify(hashes())!==JSON.stringify(registration.codeHashes))throw Error('Registered hypothesis code changed');
 const result={asOf:report.asOf,registration,input:{reportSha256:hash(raw),manifestSha256:hash(manifestRaw),registrationSha256:hash(registrationRaw)},evidence,controls:report.controls,rows,accuracyProven:false,collectorExecuted:false,productionChanged:false};
 const output=path.join(path.dirname(root),'research-touch-confirmation-reports');fs.mkdirSync(output,{recursive:true});const file=path.join(output,Date.now()+'-'+crypto.randomUUID()+'.json');atomicJSON(file,result);return {file,primary:rows.length,postRegistration:rows.filter(r=>r.postRegistration).length,evaluated:rows.filter(r=>r.eligible).length,accuracyProven:false};
}
if(require.main===module){try{const root=path.join(__dirname,'.runtime/hourly-observation/research-touch-confirmation-v1');console.log(JSON.stringify(process.argv[2]==='register'?register(root):run(path.resolve(process.argv[2]||'')),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={SPEC,register,simulate,eligibleAfter,run};
