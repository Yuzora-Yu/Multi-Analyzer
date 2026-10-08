/* Offline explanation of frozen execution results. No new rule, order or alert. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const T=require('./research-zone-trades.cjs'),S=require('./research-zone-window-summary.cjs');
const {indexSnapshots,atomicJSON}=require('./research-audit.cjs');
const STEP=900000,MIN_RR=1.8,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const LABELS={
 'stop-side-gap':'次の足の始値が元の保護ストップの外側',
 'no-forward-target-at-trigger':'確認足の終値より利益側に元の目標がない',
 'target-passed-at-next-open':'次の足の始値が固定済みの目標に到達・通過',
 'gross-rr-below-required':'次の足の始値では元の最低RR 1.8を満たさない'
};
function explain(c,bars,arm,expected){
 assert.deepEqual(T.simulate(c,bars,arm),expected,'Frozen execution replay differs');
 const z=c.zone,sign=z.direction==='LONG'?1:-1,stopHit=b=>sign===1?b.low<=z.protectiveStop:b.high>=z.protectiveStop;
 const invalid=b=>sign===1?b.close<z.invalidationClose:b.close>z.invalidationClose;
 const d={status:expected.status,originalReason:expected.reason??null,executedHypothetically:expected.status==='closed',
  interpretation:'Later causal reconstruction of the same frozen case; candle boundaries are not receipt or actual fill times.'};
 let touched=false,touch=null,trigger=null;
 for(let i=0;i<bars.length;i++){
  const b=bars[i];
  if(stopHit(b)||invalid(b)){
   if(expected.status==='cancelled'){
    const reason=stopHit(b)?'pre-entry-stop':'pre-entry-invalidation';assert.equal(reason,expected.reason,'Cancellation reason differs');
    return {...d,firstTouch:touch,cancellation:{barOpenAt:b.time,barClosedAt:b.time+STEP,reason,
     protectiveStop:z.protectiveStop,invalidationClose:z.invalidationClose,
     observedHigh:b.high,observedLow:b.low,observedClose:b.close},messageJa:reason==='pre-entry-stop'?'入場前に元の保護ストップへ到達し、仮説を取消':'入場前の確定足で元の無効化条件を満たし、仮説を取消'};
   }
   throw Error('Unexplained pre-entry cancellation');
  }
  const overlap=b.high>=z.low&&b.low<=z.high;
  const reaction=touched&&Number.isFinite(c.pivot)&&(sign===1?b.close>z.high&&b.close>c.pivot:b.close<z.low&&b.close<c.pivot);
  if(overlap&&!touch)touch={barOpenAt:b.time,barClosedAt:b.time+STEP};
  if((arm===T.SPEC.arms[0]&&overlap)||(arm===T.SPEC.arms[1]&&reaction)){
   trigger={index:i,barOpenAt:b.time,barClosedAt:b.time+STEP,close:b.close};break;
  }
  touched=touched||overlap;
 }
 d.firstTouch=touch;
 if(!trigger){assert.equal(expected.status,'no-trigger','Trigger missing');return {...d,messageJa:'元の評価期間内に入場の確認条件が成立しなかった'};}
 const {index,...triggerInfo}=trigger;
 d.trigger={...triggerInfo,kind:arm===T.SPEC.arms[0]?'first-touch-close':'later-source-swing-close',originalPivot:Number.isFinite(c.pivot)?c.pivot:null};
 if(index===bars.length-1){
  assert.equal(expected.reason,'no-next-bar-within-window');return {...d,messageJa:'最終足で条件成立したが、元の評価期間内に次の始値がない'};
 }
 const next=bars[index+1],target=(z.targets||[]).filter(t=>Number.isFinite(t)&&sign*(t-trigger.close)>0).sort((a,b)=>sign*(a-b))[0];
 const risk=sign*(next.open-z.protectiveStop),remaining=Number.isFinite(target)?sign*(target-next.open):null;
 const rr=risk>0&&remaining!==null?remaining/risk:null,blockers=[];
 if(risk<=0)blockers.push('stop-side-gap');
 if(!Number.isFinite(target))blockers.push('no-forward-target-at-trigger');
 else if(remaining<=0)blockers.push('target-passed-at-next-open');
 if(risk>0&&remaining>0&&rr<MIN_RR)blockers.push('gross-rr-below-required');
 d.entryCheck={plannedEntryAt:next.time,nextOpen:next.open,protectiveStop:z.protectiveStop,
  targetFixedAt:trigger.barClosedAt,fixedTarget:Number.isFinite(target)?target:null,
  signedRiskDistance:risk,signedRewardDistance:remaining,grossRR:rr,originalMinimumGrossRR:MIN_RR,
  blockers:blockers.map(code=>({code,messageJa:LABELS[code]}))};
 if(expected.status==='no-fill'){
  assert.equal(expected.reason,'gap-or-target-or-RR');assert.equal(next.time,expected.plannedEntryAt);assert.ok(blockers.length,'No supported no-fill cause');
  d.messageJa='条件を満たさず仮想約定なし：'+blockers.map(code=>LABELS[code]).join('／');
 }else{
  assert.equal(expected.status,'closed');assert.equal(blockers.length,0,'Filled entry has blocker');
  assert.equal(next.time,expected.entryAt);assert.equal(target,expected.target);assert.equal(rr,expected.grossRR);
  d.messageJa='元の条件で仮想入場・決済。実際の注文や損益ではない';
 }
 return d;
}
function describe(report,index){
 S.summarize(report); // Preserve original cohort eligibility and paired-arm population.
 return report.rows.filter(r=>r.forecast.primary).map(r=>{
  const c=r.forecast,row={id:c.id,identity:structuredClone(c.identity),flags:structuredClone(c.flags),
   repeatedZoneKey:r.repeatedZoneKey,eligible:r.eligible,sourceEligibility:structuredClone(c.eligibility),
   outcomeStatus:r.outcomes[0].status,nonOverlapping:r.outcomes[0].nonOverlapping,coverage:structuredClone(r.coverage)};
  if(!r.eligible)return {...row,status:'pending-or-ineligible',messageJa:'未完了・欠損・対象外の評価窓。約定やゼロ損益を付与しない'};
  const market=index.markets.get([c.identity.asset,c.identity.market,c.identity.symbol].join('/'));
  const observed=Array.from({length:T.SPEC.horizon},(_,i)=>market?.get(c.from+i*STEP));
  if(observed.some(x=>!x||x.conflict||!Number.isFinite(x.source?.firstObservedAt)||x.source.firstObservedAt>report.asOf))throw Error('Missing, conflicting or future outcome receipt');
  row.status='evaluated';row.outcomeEvidence=observed.map(x=>({barOpenAt:x.bar.time,barClosedAt:x.bar.time+STEP,source:structuredClone(x.source)}));
  row.arms=r.arms.map(a=>({original:structuredClone(a),diagnostic:explain(c,observed.map(x=>x.bar),a.arm,a)}));return row;
 });
}
function run(directory,outputRoot=path.join(__dirname,'.runtime/hourly-observation/research-zone-entry-diagnostics')){
 const files=['report.json','manifest.json'].map(f=>path.join(directory,f)),raw=files.map(f=>fs.readFileSync(f)),report=JSON.parse(raw[0]),manifest=JSON.parse(raw[1]);
 const names=[...new Set(['research-zone-entry-diagnostics.cjs','research-zone-window-summary.cjs','research-zone-trade-summary.cjs',...Object.keys(report.registration?.codeHashes||{})])];
 const analysisHashes=Object.fromEntries(names.map(f=>{if(path.basename(f)!==f)throw Error('Invalid code path');return [f,hash(fs.readFileSync(path.join(__dirname,f)))];}));
 const evidence=S.replay(report,manifest,f=>fs.readFileSync(f)),records=[],sourceHashes=new Map();
 for(const m of manifest.sources){
  const bytes=fs.readFileSync(m.file);if(hash(bytes)!==m.sha256)throw Error('Original source changed after replay');sourceHashes.set(m.file,m.sha256);
  if(path.basename(m.file)==='prediction.json'){const r=JSON.parse(bytes);records.push({snapshot:r.snapshot,firstObservedAt:r.transport.receivedAt,file:m.file,sha256:m.sha256});}
 }
 const rows=describe(report,indexSnapshots(records.filter(r=>r.firstObservedAt<=report.asOf)));
 files.forEach((f,i)=>{if(hash(fs.readFileSync(f))!==hash(raw[i]))throw Error('Original input changed during diagnostics');});
 for(const [file,h] of sourceHashes)if(hash(fs.readFileSync(file))!==h)throw Error('Original source changed during diagnostics');
 for(const [file,h] of Object.entries(analysisHashes))if(hash(fs.readFileSync(path.join(__dirname,file)))!==h)throw Error('Analysis code changed during diagnostics');
 const result={schema:1,createdAt:Date.now(),asOf:report.asOf,input:{reportSha256:hash(raw[0]),manifestSha256:hash(raw[1])},
  evidence,analysisHashes,sourceControls:structuredClone(report.controls),rows,accuracyProven:false,collectorExecuted:false,productionChanged:false,
  note:'Additive explanations only. Original entry/stop/target rules and exclusions remain unchanged. Unexecuted cases are not wins. Costs and executable market permissions remain unmeasured.'};
 fs.mkdirSync(outputRoot,{recursive:true});const file=path.join(outputRoot,Date.now()+'-'+crypto.randomUUID()+'.json');atomicJSON(file,result);
 return {file,primary:rows.length,evaluated:rows.filter(r=>r.eligible).length,...evidence,accuracyProven:false};
}
if(require.main===module){try{if(!process.argv[2])throw Error('Provide original private cohort report directory');console.log(JSON.stringify(run(path.resolve(process.argv[2])),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={explain,describe,run};
