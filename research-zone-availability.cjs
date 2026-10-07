/* Independent offline availability check. Never rewrites a registered study. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const MARKETS={gold:['futures','XAUUSDT'],btc:['spot','BTCUSDT']};
function valid(row){return Array.isArray(row)&&Number.isFinite(row[0])&&row[0]%STEP===0&&row.slice(1,5).length===4&&row.slice(1,5).every(x=>Number.isFinite(x)&&x>0)&&row[2]>=Math.max(row[1],row[4])&&row[3]<=Math.min(row[1],row[4])&&row[2]>=row[3];}
function audit(report,manifest,read){
  if(!Number.isFinite(report.asOf)||!Array.isArray(report.rows)||!Array.isArray(manifest.sources))throw Error('Invalid audit input');
  const entries=new Map(),cache=new Map(),issues=[],index=new Map(),counts={receipted:0,declaredOnly:0,futurePersistence:0};
  for(const m of manifest.sources){if(entries.has(m.file)&&entries.get(m.file)!==m.sha256)throw Error('Conflicting manifest entry');entries.set(m.file,m.sha256);}
  function recorded(file){if(cache.has(file))return cache.get(file);const raw=read(file);if(hash(raw)!==entries.get(file))throw Error('Manifest source hash mismatch: '+path.basename(file));const value=JSON.parse(raw);cache.set(file,value);return value;}
  for(const file of entries.keys()){
    if(!['prediction.json'].includes(path.basename(file))&&!/[/\\]cohort-v1[/\\]snapshots[/\\][^/\\]+\.json$/.test(file))continue;
    const r=recorded(file),s=r.snapshot,cfg=MARKETS[s?.asset],rows=s?.bars?.m15,last=rows?.at(-1);
    if(!cfg||s.symbol!==cfg[1]||s.settings?.market!==cfg[0]||!valid(last)||s.id!==`${s.asset}-${last[0]}-${s.version}`||!Number.isFinite(s.settings.now)||last[0]+STEP>s.settings.now||s.settings.now>=last[0]+2*STEP){issues.push({file,kind:'invalid-source-identity'});continue;}
    let availableAt,proof;
    if(path.basename(file)==='prediction.json'){
      const receiptFile=path.join(path.dirname(file),'receipt.json');
      if(!entries.has(receiptFile)){issues.push({file,kind:'missing-persistence-receipt'});continue;}
      const receipt=recorded(receiptFile);
      if(receipt.predictionSha256!==entries.get(file)||!Number.isFinite(receipt.persistedAt)||!Number.isFinite(r.transport?.receivedAt)||!Number.isFinite(r.generatedAt)||r.transport.receivedAt>r.generatedAt||r.generatedAt>receipt.persistedAt){issues.push({file,kind:'invalid-persistence-sequence'});continue;}
      availableAt=receipt.persistedAt;proof='receipted';
    }else{availableAt=r.firstObservedAt;proof='declaredOnly';}
    if(!Number.isFinite(availableAt)){issues.push({file,kind:'missing-availability-time'});continue;}
    if(availableAt>report.asOf){counts.futurePersistence++;continue;}
    counts[proof]++;
    const physical=[s.asset,...cfg].join('/');if(!index.has(physical))index.set(physical,new Map());const market=index.get(physical);
    for(const row of rows){
      if(!valid(row)||row[0]+STEP>s.settings.now||row[0]+STEP>report.asOf){issues.push({file,kind:'invalid-or-unclosed-price',barAt:row?.[0]});continue;}
      const signature=JSON.stringify(row.slice(1,5)),source={file,sha256:entries.get(file),snapshotId:s.id,availableAt,proof};
      if(!market.has(row[0]))market.set(row[0],{signatures:new Set(),sources:[]});const b=market.get(row[0]);b.signatures.add(signature);b.sources.push(source);
    }
  }
  const rows=report.rows.map(({forecast:c,outcomes})=>{
    const physical=[c.identity.asset,c.identity.market,c.identity.symbol].join('/'),market=index.get(physical);
    if(!Number.isFinite(c.from)||c.from%STEP)throw Error('Invalid forecast boundary');
    return {id:c.id,sourceId:c.sourceId,physical,primary:c.primary,windows:outcomes.map(o=>{
      if(!Number.isInteger(o.horizon)||o.horizon<=0||o.horizon>16||o.from!==c.from||o.until!==c.from+o.horizon*STEP)throw Error('Invalid reported window');
      const slots=[];for(let t=c.from;t<o.until;t+=STEP){const b=market?.get(t),receipted=b?.sources.filter(s=>s.proof==='receipted')||[];
        slots.push({barAt:t,closedAt:t+STEP,status:t+STEP>report.asOf?'not-closed':!b?'missing':b.signatures.size>1?'conflicting':receipted.length?'receipted':'declared-only',sources:b?.sources||[]});}
      const classified=Object.fromEntries(['not-closed','missing','conflicting','receipted','declared-only'].map(k=>[k,slots.filter(s=>s.status===k).length]));
      const receiptComplete=classified.receipted===o.horizon;
      return {horizon:o.horizon,from:c.from,until:o.until,reportedStatus:o.status,reportedEligible:o.eligibleForSummary===true,receiptComplete,classified,
        nextScheduledClose:slots.find(s=>s.status==='not-closed')?.closedAt||null,
        summaryGate:o.eligibleForSummary===true&&!receiptComplete?'reject-unverified-price-availability':receiptComplete?'availability-only-verified':'pending-or-unverified',slots};
    })};
  });
  // Recheck bytes after indexing: a concurrently replaced source cannot silently pass.
  for(const [file] of cache)if(hash(read(file))!==entries.get(file))throw Error('Source changed during availability audit');
  return {schema:1,asOf:report.asOf,sourceCounts:counts,issues,rows,accuracyProven:false,
    note:'Companion audit, not a study amendment or outcome score. Persistence receipts are local evidence, not independent timestamp certification. Declared legacy firstObservedAt is weaker evidence. Future slots remain pending; full wall-clock windows and original study labels are unchanged.'};
}
function run(directory){
  const reportPath=path.join(directory,'report.json'),manifestPath=path.join(directory,'manifest.json'),reportRaw=fs.readFileSync(reportPath),manifestRaw=fs.readFileSync(manifestPath);
  const result=audit(JSON.parse(reportRaw),JSON.parse(manifestRaw),file=>fs.readFileSync(file));
  if(hash(fs.readFileSync(reportPath))!==hash(reportRaw)||hash(fs.readFileSync(manifestPath))!==hash(manifestRaw))throw Error('Report or manifest changed during audit');
  return {...result,input:{reportSha256:hash(reportRaw),manifestSha256:hash(manifestRaw)},auditorSha256:hash(fs.readFileSync(__filename)),auditedAt:Date.now()};
}
if(require.main===module){try{if(!process.argv[2])throw Error('Provide a private zone report directory');const result=run(path.resolve(process.argv[2])),base=path.join(__dirname,'.runtime/hourly-observation/research-zone-availability');fs.mkdirSync(base,{recursive:true});const file=path.join(base,result.auditedAt+'-'+crypto.randomUUID()+'.json');fs.writeFileSync(file+'.tmp',JSON.stringify(result,null,2),{flag:'wx'});fs.renameSync(file+'.tmp',file);console.log(JSON.stringify({file,sourceCounts:result.sourceCounts,issues:result.issues.length,primary:result.rows.filter(r=>r.primary).map(r=>({id:r.id,windows:r.windows.map(w=>({horizon:w.horizon,classified:w.classified,nextScheduledClose:w.nextScheduledClose,summaryGate:w.summaryGate}))}))},null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={audit,run};
