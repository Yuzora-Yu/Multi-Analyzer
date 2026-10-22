'use strict';
// Compares ACTUAL MQL results to the unchanged JS implementation on identical
// input bars. Broker wall-clock integers are preserved; this is not UTC conversion.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Core=require('../../strategy-core'),Flow=require('../../flow-core');
function load(file){const [head,...lines]=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/);const keys=head.split(',');return lines.map(l=>Object.fromEntries(l.split(',').map((v,i)=>[keys[i],v==='null'?null:Number(v)])));}
function frame(rows){const seconds=rows[0].seconds,candles=rows.map(r=>({time:r.time*1000,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume}));return Core.analyzeTimeframe(candles,seconds/60,(rows.at(-1).time+seconds)*1000+1);}
function verify(directory){
 const result=JSON.parse(fs.readFileSync(path.join(directory,'result.json')));assert.equal(result.selfTests,true);assert.equal(result.success,true);
 const files=fs.readdirSync(directory).filter(n=>n.endsWith('.csv')),data=new Map(files.map(n=>[n,load(path.join(directory,n))]));
 const counts={cases:0,rows:0,exitLong:0,exitShort:0,turns:0,pCandidates:0,pLong:0,pShort:0,missingVolumeRows:0};let scalarChecks=0,maxNumericError=0;
 for(const [name,rows] of data){const a=frame(rows),h=frame(name.startsWith('synthetic-')?rows:data.get('XM-H1-base.csv'));Flow.align(a,h,rows[0].seconds/60);
  for(let i=0;i<rows.length;i++) {const actual=rows[i],r=a.flow.history[i];const at=`${name}:${i}`;
   for(const key of ['direction','structure','ribbon','votes','pullback'])assert.equal(actual[key],r[key],at+':'+key);
   for(const key of ['switched','aligned','intact','touched','reclaim','hourlyAligned','pullbackConfirmed','exitLong','exitShort'])assert.equal(Boolean(actual[key]),Boolean(key==='intact'?r.setup.intact:key==='touched'?r.setup.touched:key==='reclaim'?r.setup.reclaim:r[key]),at+':'+key);
   assert.equal(actual.badge,r.badge==='VR'?2:r.badge==='V'?1:0,at+':badge');assert.equal(actual.rank,r.rank==='S'?2:r.rank==='A'?1:0,at+':rank');
   for(const [key,expected] of [...Flow.PERIODS.map(p=>['e'+p,a.flow.lines[p][i]]),['atr',a.series.atr14[i]??0],['adx',a.series.dmi.adx[i]??0]]) {
    const value=actual[key];assert.equal(value===null,expected===null,at+':'+key+' null');if(value!=null){const error=Math.abs(value-expected);maxNumericError=Math.max(maxNumericError,error);assert(error<=1e-8,at+':'+key+' '+error);}scalarChecks++;
   }
   const lastSwingLow=a.swings.lows.filter(s=>s.confirmIndex<=i).at(-1),lastSwingHigh=a.swings.highs.filter(s=>s.confirmIndex<=i).at(-1);
   assert.equal(actual.lastLow,lastSwingLow?.price??0,at+':swingLow');assert.equal(actual.lastHigh,lastSwingHigh?.price??0,at+':swingHigh');
   const signal={values:{atr:a.series.atr14[i]},candles:a.candles.slice(0,i+1),structure:{lastSwingLow,lastSwingHigh}};
   let expectedP=false;if(r.setup.ready){const plan=Core._internal.buildTradePlan(r.direction>0?'LONG':'SHORT',signal,Core.DEFAULTS);for(const key of ['stop','tp2','netRR'])assert(Math.abs(actual[key]-plan[key])<=1e-8,at+':plan '+key);assert(Math.abs(actual.costRiskRatio-plan.costs.costRiskRatio)<=1e-8,at+':cost');expectedP=i+1>=220&&rows[0].seconds>=900&&r.pullbackConfirmed&&a.series.dmi.adx[i]>=20&&plan.costs.costRiskRatio<=.22&&plan.netRR>=1.8;}
   assert.equal(Boolean(actual.pCandidate),expectedP,at+':P');counts.rows++;counts.exitLong+=+r.exitLong;counts.exitShort+=+r.exitShort;counts.turns+=+r.switched;counts.pCandidates+=+expectedP;if(expectedP)counts[r.direction>0?'pLong':'pShort']++;if(r.volumeRatio==null)counts.missingVolumeRows++;
  }
  if(rows.every(r=>r.volume===0)){
   assert(rows.some(r=>r.exitLong)&&rows.some(r=>r.exitShort),name+':price EXIT survives missing volume');
   assert(rows.every(r=>!r.pCandidate),name+':P withheld when volume unavailable');
  }
  // Appending later candles must not change historical EXIT or flow state.
  const end=Math.min(470,rows.length),prefix=frame(rows.slice(0,end));for(let i=0;i<end;i++)for(const key of ['exitLong','exitShort','direction','switched','pullback'])assert.equal(prefix.flow.history[i][key],a.flow.history[i][key],`${name}:causal:${i}:${key}`);
  counts.cases++;
 }
 const profiles=fs.readFileSync(path.join(directory,'profiles.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);assert.equal(profiles.length,data.size);
 for(const p of profiles){const profile=Flow.profile(frame(data.get(p.case+'.csv')).candles);assert.equal(p.available,profile!==null,p.case+':profile availability');for(const key of ['poc','val','vah'])if(profile)assert(Math.abs(p[key]-profile[key])<1e-8,p.case+':profile '+key);}
 assert(counts.exitLong>0&&counts.exitShort>0&&counts.turns>0&&counts.pLong>0&&counts.pShort>0,'positive/negative signal coverage required');
 return {verified:true,...counts,scalarChecks,maxNumericError,profileCases:profiles.length,syntheticAndActualXmBars:true,sameInputOnly:true,causalityChecked:true,predictiveAccuracyEstablished:false,native:result};
}
module.exports={verify};if(require.main===module){if(!process.argv[2])throw Error('Exact local native audit directory required');console.log(JSON.stringify(verify(path.resolve(process.argv[2])),null,2));}
