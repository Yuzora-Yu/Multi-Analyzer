/* Fixed prospective calendar partition. Never an automatic adoption decision. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const H=require('./research-touch-confirmation.cjs'),S=require('./research-touch-confirmation-summary.cjs'),{atomicJSON}=require('./research-audit.cjs');
const STEP=900000,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const SPEC=Object.freeze({id:'touch-calendar-holdout-v3',start:Date.parse('2026-10-12T00:00:00Z'),end:Date.parse('2026-11-09T00:00:00Z'),embargoMs:86400000,horizon:16,
 population:'Original primary decision-window reservations only; no resetting reservation history at the split. Original eligibility, complete receipts, conservative exchange clock and code/market partitions remain required.',
 selection:'Fixed calendar chosen before observations. A validation source must close strictly after start plus nonnegative exchange upper clock offset; its full 16-bar outcome window must be inside the fixed interval. Development windows must end before the 24-hour embargo begins. Classify the original guarded entry boundary even when delayed beyond the next M15 interval; preserve original eligibility and reservations without rescuing excluded records.',
 release:'No validation outcome statistics before calendar end. Counts only. No early stopping, extension for small samples or tuning on holdout outcomes. A modified hypothesis requires a new future registration and validation period.',
 interpretation:'Prospective fixed-parameter validation, not blinded market observation or proof of independence. Repeated zones, serial correlation, missing cases and assumed costs remain visible. At least 100 eligible windows per market/code partition is necessary, not sufficient; inference and adoption remain separate reviews. Never auto-adopt.'});
function fixed(hypothesisRoot){if(!fs.existsSync(path.join(hypothesisRoot,'registration.json')))throw Error('Existing hypothesis registration required');const h=H.register(hypothesisRoot);return {spec:SPEC,hypothesisRegistrationSha256:hash(fs.readFileSync(path.join(hypothesisRoot,'registration.json'))),codeHashes:{...h.codeHashes,'research-touch-confirmation-summary.cjs':hash(fs.readFileSync(path.join(__dirname,'research-touch-confirmation-summary.cjs'))),'research-touch-holdout-v3.cjs':hash(fs.readFileSync(__filename))}};}
function register(root,hypothesisRoot,now=Date.now()){
 const file=path.join(root,'registration.json'),f=fixed(hypothesisRoot);
 if(fs.existsSync(file)){const r=JSON.parse(fs.readFileSync(file));if(!Number.isFinite(r.registeredAt)||r.registeredAt>=SPEC.start-SPEC.embargoMs)throw Error('Invalid holdout registration');assert.deepEqual({...r,registeredAt:undefined},{...f,registeredAt:undefined},'Changed holdout requires new future registration');return r;}
 if(!Number.isFinite(now)||now>=SPEC.start-SPEC.embargoMs)throw Error('Register before embargo begins');
 fs.mkdirSync(root,{recursive:true});const r={registeredAt:now,...f};fs.writeFileSync(file,JSON.stringify(r,null,2),{flag:'wx'});return r;
}
function classify(c,upperOffsetMs,registration){
 if(![c.originClosedAt,c.from,upperOffsetMs,registration.registeredAt].every(Number.isFinite)||!Number.isSafeInteger(c.originClosedAt)||c.originClosedAt%STEP||!Number.isSafeInteger(c.from)||c.from%STEP||c.from<c.originClosedAt+STEP)throw Error('Invalid original time or clock');
 const until=c.from+SPEC.horizon*STEP,offset=Math.max(0,upperOffsetMs);
 if(c.originClosedAt<=registration.registeredAt+offset)return 'before-registration';
 if(until<=SPEC.start-SPEC.embargoMs)return 'development';
 if(c.originClosedAt<=SPEC.start+offset)return 'embargo-or-start-boundary';
 if(c.originClosedAt>=SPEC.end)return 'after-holdout';
 if(c.from<SPEC.start||until>SPEC.end)return 'end-boundary';
 return 'validation';
}
function partition(report,cohort,sources,registration){
 S.summarize(report,cohort); // Validate the whole original population before subsetting.
 const selections=cohort.rows.filter(r=>r.forecast.primary).map(o=>{const source=sources.get(o.forecast.sourceId);if(!source)throw Error('Missing original clock source');return {id:o.forecast.id,partition:classify(o.forecast,source.clockBounds?.upperOffsetMs,registration)};});
 const validationIds=new Set(selections.filter(r=>r.partition==='validation').map(r=>r.id));
 const subsetReport={...report,rows:report.rows.filter(r=>validationIds.has(r.id))},subsetCohort={...cohort,rows:cohort.rows.filter(r=>r.forecast.primary&&validationIds.has(r.forecast.id))};
 const released=report.asOf>=SPEC.end;
 const result={schema:1,asOf:report.asOf,registration,selections,released,validationPrimary:validationIds.size,validationEvaluated:subsetReport.rows.filter(r=>r.eligible).length,statistics:released?S.summarize(subsetReport,subsetCohort):null,accuracyProven:false,adoptionApproved:false};
 if(released)result.sampleReviews=result.statistics.partitions.map(p=>({identity:p.identity,evaluated:p.evaluated,uniqueZoneKeys:p.uniqueEvaluatedZoneKeys,repeatedWindows:p.repeatedEvaluatedWindows,minimumCountMet:p.evaluated>=100,adoptionApproved:false}));
 return result;
}
function run(file,directory,root,hypothesisRoot){
 if(!fs.existsSync(path.join(root,'registration.json'))||!fs.existsSync(path.join(hypothesisRoot,'registration.json')))throw Error('Explicit existing preregistrations required');
 const registration=register(root,hypothesisRoot),captured=new Map(),read=f=>{const b=fs.readFileSync(f);captured.set(f,b);return b;};
 read(path.join(root,'registration.json'));const report=JSON.parse(read(file)),cohort=JSON.parse(read(path.join(directory,'report.json'))),manifest=JSON.parse(read(path.join(directory,'manifest.json')));
 const replay=H.run(directory,hypothesisRoot),replayed=JSON.parse(fs.readFileSync(replay.file)),sources=new Map();assert.deepEqual(replayed,report,'Original registered hypothesis replay changed');
 for(const m of manifest.sources.filter(m=>path.basename(m.file)==='prediction.json')){const b=read(m.file);if(hash(b)!==m.sha256)throw Error('Original clock source changed');const s=JSON.parse(b);if(sources.has(s.id))throw Error('Duplicate source');sources.set(s.id,s);}
 const result=partition(report,cohort,sources,registration);
 for(const [f,b]of captured)if(hash(fs.readFileSync(f))!==hash(b))throw Error('Original holdout input changed');
 register(root,hypothesisRoot);
 const output=path.join(path.dirname(root),'research-touch-holdout-v3-reports');fs.mkdirSync(output,{recursive:true});const target=path.join(output,Date.now()+'-'+crypto.randomUUID()+'.json');
 atomicJSON(target,{...result,evidence:{pairedHypothesisReplay:replay.file,note:'Raw original-arm replay, not interim aggregate validation statistics or new observations.',hypothesisReportSha256:hash(captured.get(file)),cohortReportSha256:hash(captured.get(path.join(directory,'report.json')))},collectorExecuted:false,productionChanged:false});return {file:target,released:result.released,validationPrimary:result.validationPrimary,validationEvaluated:result.validationEvaluated,accuracyProven:false};
}
if(require.main===module){try{const base=path.join(__dirname,'.runtime/hourly-observation'),root=path.join(base,'research-touch-holdout-v3'),hypothesisRoot=path.join(base,'research-touch-confirmation-v1');console.log(JSON.stringify(process.argv[2]==='register'?register(root,hypothesisRoot):run(path.resolve(process.argv[2]||''),path.resolve(process.argv[3]||''),root,hypothesisRoot),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={SPEC,register,classify,partition,run};
