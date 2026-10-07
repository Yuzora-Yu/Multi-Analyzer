/* Read-only internal consistency audit; not independent timestamp certification. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),F=require('./research-forward.cjs'),Feed=require('./market-feed'),A=require('./research-audit.cjs');
const STEP=900000,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function inspect(r,receipt){
 const issues=[],check=(ok,kind)=>{if(!ok)issues.push(kind);},s=r.snapshot,cfg=Feed.instruments[r.asset];
 check(Boolean(cfg&&s&&r.asset===s.asset&&r.market===cfg.market&&r.symbol===cfg.symbol&&s.settings?.market===r.market&&s.symbol===r.symbol&&r.engineVersion===s.version&&r.id===s.id&&r.specId===F.SPEC.id),'identity');
 check(r.settingsSha256===hash(JSON.stringify(s?.settings??null)),'settings-hash');
 let latest=-Infinity;
 for(const [name,m]of [['m15',15],['h1',60],['h4',240]]){const rows=s?.bars?.[name];if(!Array.isArray(rows)||!rows.length){issues.push('missing-'+name);continue;}let prior=-Infinity;
  for(const b of rows){const valid=Array.isArray(b)&&b.length>=6&&b.slice(0,6).every(Number.isFinite)&&b[0]%(m*60000)===0&&b[0]>prior&&b.slice(1,5).every(x=>x>0)&&b[2]>=Math.max(b[1],b[4])&&b[3]<=Math.min(b[1],b[4])&&b[2]>=b[3]&&b[5]>=0&&b[0]+m*60000<=r.cutoff;check(valid,'invalid-or-unclosed-'+name);prior=b?.[0];if(Number.isFinite(b?.[0]))latest=Math.max(latest,b[0]+m*60000);}
 }
 const last=s?.bars?.m15?.at(-1)?.[0];check(Number.isFinite(last)&&r.id===`${r.asset}-${last}-${r.engineVersion}`&&r.targetBarOpenAt===last&&r.targetBarClosedAt===last+STEP&&r.cutoff===s.settings.now&&r.cutoff>=last+STEP&&r.cutoff<last+2*STEP,'target-boundary');
 check(r.latestInfoEventAt===latest&&latest<=r.cutoff,'information-event-boundary');
 check([r.transport?.requestedAt,r.transport?.receivedAt,r.generatedAt,receipt?.persistedAt].every(Number.isFinite)&&r.transport.requestedAt<=r.transport.receivedAt&&r.transport.receivedAt<=r.generatedAt&&r.generatedAt<=receipt.persistedAt&&r.informationReceivedAt===r.transport.receivedAt&&r.sourceCreatedAt===s?.createdAt,'receipt-chronology');
 const clock=F.clockBounds(r.clockMeasurement);check(require('node:util').isDeepStrictEqual(clock,r.clockBounds),'clock-bounds');
 const upper=clock.valid?clock.upperOffsetMs:0;check(Number.isFinite(s?.createdAt)&&s.createdAt>=r.cutoff&&s.createdAt<=r.transport?.receivedAt+upper,'source-event-chronology');check(r.entryAt===Math.ceil((Math.max(r.generatedAt,r.generatedAt+upper)+F.SPEC.guardMs)/STEP)*STEP,'prospective-entry-boundary');
 check(r.observationDelayLocalMs===r.transport?.receivedAt-r.targetBarClosedAt,'local-observation-delay');
 const b=r.prediction;check(Boolean(b&&b.noSign===(!b.pullbackConfirmed&&!b.exitLong&&!b.exitShort)),'sign-flags');
 check(['strategy-core.js','flow-core.js','smc-core.js','market-feed.js','research-forward.cjs'].every(f=>/^[a-f0-9]{64}$/.test(r.codeHashes?.[f]||'')),'causal-hash-metadata');
 return {id:r.id,asset:r.asset,engineVersion:r.engineVersion,consistent:issues.length===0,issues:[...new Set(issues)],originalIssues:Array.isArray(r.issues)?[...r.issues]:null,entryAt:r.entryAt,sourceClosedAt:r.targetBarClosedAt,informationReceivedAt:r.informationReceivedAt,persistedAt:receipt?.persistedAt,clockBounded:clock.valid,engineReplayed:false};
}
function run(base=path.join(__dirname,'.runtime/hourly-observation')){
 const dir=path.join(base,'research-forward/predictions'),inventory=()=>fs.readdirSync(dir).filter(n=>!n.startsWith('.')).sort(),names=inventory(),captured=new Map(),files=['research-freeze-integrity.cjs','research-forward.cjs','market-feed.js','research-audit.cjs'],codes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(__dirname,f)))])),rows=[];
 for(const name of names){const file=path.join(dir,name,'prediction.json'),rf=path.join(dir,name,'receipt.json'),raw=fs.readFileSync(file),rb=fs.readFileSync(rf),receipt=JSON.parse(rb);captured.set(file,raw);captured.set(rf,rb);assert.equal(hash(raw),receipt.predictionSha256,'Original receipt hash mismatch');const r=JSON.parse(raw);assert.equal(name,r.id,'Original directory identity mismatch');rows.push(inspect(r,receipt));}
 for(const [f,b]of captured)assert.equal(hash(fs.readFileSync(f)),hash(b),'Original source changed');assert.deepEqual(inventory(),names,'Original inventory changed');for(const [f,h]of Object.entries(codes))assert.equal(hash(fs.readFileSync(path.join(__dirname,f))),h,'Audit code changed');
 const out=path.join(base,'research-freeze-integrity-reports');fs.mkdirSync(out,{recursive:true});const file=path.join(out,Date.now()+'-'+crypto.randomUUID()+'.json');A.atomicJSON(file,{schema:1,at:Date.now(),rows,codeHashes:codes,manifest:[...captured].map(([file,b])=>({file,sha256:hash(b)})),collectorExecuted:false,productionChanged:false,accuracyProven:false,note:'Frozen record internal consistency only. Hash metadata is not a replay or verification of historical engine code. Local receipts are not independent timestamps. Original eligibility, exclusions and prospective/strict study definitions are not changed.'});return {file,records:rows.length,inconsistent:rows.filter(r=>!r.consistent).length,accuracyProven:false};
}
if(require.main===module){try{console.log(JSON.stringify(run(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={inspect,run};
