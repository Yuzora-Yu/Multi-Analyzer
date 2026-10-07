/* Offline descriptive scorecard. No collector, alerts, model fitting or adoption. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluate,SPEC}=require('./research-forward.cjs');
const {atomicJSON}=require('./research-audit.cjs');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const HORIZONS=[1,4,8,16],COSTS=[7,14,21];
const GROUPS=['all','P','EXIT_LONG','EXIT_SHORT','no-sign'];
const method={id:'forward-descriptive-scorecard-v1',horizons:HORIZONS,costBps:COSTS,
  purpose:'Diagnostic hypothetical fixed-hold benchmark, not executable trade P&L or validated predictive edge.',
  partition:'Separate asset, market, symbol, engine version, causal engine-file hashes and static configuration. Never pool versions.',
  overlap:'Use the existing full-horizon reservations across every group/version. Missing and pending windows remain reserved. Nonoverlap does not establish independence.',
  selection:'Only hash-verified frozen receipts with a prospective entry boundary; keep incomplete window counts beside resolved summaries.',
  groups:'P, EXIT_LONG and EXIT_SHORT are overlapping descriptive flags, not trades. No-sign means none of these flags. Do not add group counts together.',
  direction:'Stored shared-engine direction; EXIT does not invert this direction or create an entry.',
  validation:'Exploratory description of already observed outcomes, never an untouched holdout. Trial count and future validation protocol are required for adoption.',
  drawdown:'Maximum drop of an additive benchmark-bps path within each resolved group; not an account-equity or strategy drawdown. Missing returns are not zero.',
  probability:'No win probability or win-rate optimization.'};
function signature(record){
  const settings=Object.fromEntries(Object.entries(record.snapshot.settings).filter(([k])=>!['now','position','feedStale','livePrice'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
  const code=Object.fromEntries(['strategy-core.js','flow-core.js','smc-core.js','market-feed.js'].map(k=>[k,record.codeHashes?.[k]??'unknown']));
  return {configurationHash:hash(JSON.stringify(settings)),codeHash:hash(JSON.stringify(code)),codeComplete:Object.values(code).every(x=>x!=='unknown')};
}
function stats(values){
  if(!values.length)return {count:0,meanBps:null,medianBps:null,worstBps:null,additivePathDrawdownBps:null};
  const sorted=[...values].sort((a,b)=>a-b);let sum=0,peak=0,dd=0;
  for(const x of values){sum+=x;peak=Math.max(peak,sum);dd=Math.max(dd,peak-sum);}
  const middle=Math.floor(values.length/2);
  return {count:values.length,meanBps:sum/values.length,medianBps:values.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2,worstBps:sorted[0],additivePathDrawdownBps:dd};
}
function inGroup(p,group){
  if(group==='all')return true;
  if(group==='P')return p.pullbackConfirmed===true;
  if(group==='EXIT_LONG')return p.exitLong===true;
  if(group==='EXIT_SHORT')return p.exitShort===true;
  return p.pullbackConfirmed===false&&p.exitLong===false&&p.exitShort===false;
}
function scorecard(rows,evidence,{asOf=Date.now()}={}){
  const partitions=new Map(),issues=[];
  for(const row of [...rows].sort((a,b)=>a.entryAt-b.entryAt||a.id.localeCompare(b.id))){
    const record=evidence.get(row.id);
    if(!record){issues.push({id:row.id,reason:'missing-frozen-evidence'});continue;}
    if(row.engineVersion!==record.engineVersion||row.asset!==record.asset||row.market!==record.market||row.id!==record.id||record.specId!==SPEC.id){issues.push({id:row.id,reason:'evidence-identity-mismatch'});continue;}
    const sig=signature(record);
    if(!sig.codeComplete){issues.push({id:row.id,reason:'missing-causal-code-hashes'});continue;}
    const key=[record.asset,record.market,record.symbol,record.engineVersion,sig.codeHash,sig.configurationHash].join('/');
    if(!partitions.has(key))partitions.set(key,{key,asset:record.asset,market:record.market,symbol:record.symbol,engineVersion:record.engineVersion,...sig,rows:[]});
    partitions.get(key).rows.push({...row,entryAt:record.entryAt,prediction:record.prediction});
  }
  return {schema:1,asOf,method,issues,partitions:[...partitions.values()].map(({rows,...partition})=>{
    rows.sort((a,b)=>a.entryAt-b.entryAt||a.id.localeCompare(b.id));
    const eligible=rows.filter(r=>r.receipt.prospectiveEligible===true),starts=eligible.map(r=>r.entryAt);
    return {...partition,totalFrozen:rows.length,prospectiveEligible:eligible.length,rejected:rows.length-eligible.length,
      firstEntryAt:starts.length?Math.min(...starts):null,lastEntryAt:starts.length?Math.max(...starts):null,
      horizons:Object.fromEntries(HORIZONS.map(h=>[h,Object.fromEntries(GROUPS.map(group=>{
        const groupRows=eligible.filter(r=>inGroup(r.prediction,group)),selected=groupRows.filter(r=>r.outcomes.find(o=>o.horizon===h)?.nonOverlapping===true);
        const statusCounts=Object.fromEntries(['resolved','pending','missing','conflicting-price'].map(status=>[status,selected.filter(r=>r.outcomes.find(o=>o.horizon===h)?.status===status).length]));
        const resolved=selected.filter(r=>{const o=r.outcomes.find(o=>o.horizon===h);return o?.status==='resolved'&&o.prospective===true&&Number.isFinite(o.returnBps)&&o.exitAt<=asOf;});
        const costs=COSTS.map(costBps=>{const moves=resolved.map(r=>r.outcomes.find(o=>o.horizon===h).returnBps);
          const directional=resolved.filter(r=>['LONG','SHORT'].includes(r.prediction.direction)).map(r=>r.outcomes.find(o=>o.horizon===h).returnBps*(r.prediction.direction==='LONG'?1:-1)-costBps);
          return {costBps,longBenchmark:stats(moves.map(x=>x-costBps)),shortBenchmark:stats(moves.map(x=>-x-costBps)),storedDirectionBenchmark:stats(directional)};
        });
        return [group,{eligible:groupRows.length,reservedWindows:selected.length,overlapExcluded:groupRows.length-selected.length,statusCounts,evaluable:resolved.length,costs}];
      }))]))};
  })};
}
function run({root=path.join(__dirname,'.runtime','hourly-observation')}={}){
  const forward=path.join(root,'research-forward'),records=[],evidence=new Map(),manifest=[];
  const read=file=>{const raw=fs.readFileSync(file);manifest.push({file:path.relative(root,file),sha256:hash(raw),bytes:raw.length});return raw;};
  const snapshots=path.join(root,'cohort-v1','snapshots');
  for(const file of fs.readdirSync(snapshots).filter(n=>n.endsWith('.json')).sort()){
    const full=path.join(snapshots,file),raw=read(full);records.push({...JSON.parse(raw),file:path.relative(root,full),sha256:hash(raw)});
  }
  for(const id of fs.readdirSync(path.join(forward,'predictions')).filter(n=>!n.startsWith('.')).sort()){
    const full=path.join(forward,'predictions',id,'prediction.json'),raw=read(full),record=JSON.parse(raw),receipt=JSON.parse(read(path.join(forward,'predictions',id,'receipt.json')));
    if(hash(raw)!==receipt.predictionSha256)throw Error('Frozen prediction hash mismatch: '+id);
    evidence.set(id,record);records.push({snapshot:record.snapshot,firstObservedAt:record.transport.receivedAt,file:path.relative(root,full),sha256:hash(raw)});
  }
  const asOf=Date.now(),rows=evaluate(forward,records,asOf),result=scorecard(rows,evidence,{asOf});
  for(const x of manifest)if(hash(fs.readFileSync(path.join(root,x.file)))!==x.sha256)throw Error('Source changed during offline scorecard: '+x.file);
  const output=path.join(root,'research-scorecard');fs.mkdirSync(output,{recursive:true});const staging=fs.mkdtempSync(path.join(output,'.staging-'));
  atomicJSON(path.join(staging,'report.json'),result);atomicJSON(path.join(staging,'manifest.json'),{asOf,completedAt:Date.now(),sourceFiles:manifest,codeSha256:hash(fs.readFileSync(__filename)),collectorExecuted:false,sourceMutation:false});
  const final=path.join(output,asOf+'-'+crypto.randomUUID());fs.renameSync(staging,final);
  return {directory:final,issues:result.issues.length,partitions:result.partitions.map(p=>({asset:p.asset,market:p.market,engineVersion:p.engineVersion,codeHash:p.codeHash,configurationHash:p.configurationHash,totalFrozen:p.totalFrozen,prospectiveEligible:p.prospectiveEligible,nonoverlap2h:p.horizons[8].all.reservedWindows,evaluable2h:p.horizons[8].all.evaluable}))};
}
if(require.main===module){try{console.log(JSON.stringify(run(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={method,signature,stats,inGroup,scorecard,run};
