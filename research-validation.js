// Reproducible, chronological comparison. No parameter search, no credentials.
const fs=require('node:fs');
const Core=require('./strategy-core');
const Feed=require('./market-feed');
async function history(asset,minutes,pages){
 const path=`.runtime/research-${asset}-${minutes}.json`;
 if(fs.existsSync(path))return JSON.parse(fs.readFileSync(path));
 let rows=[],end;
 for(let i=0;i<pages;i++){
  const r=await fetch(Feed.url(asset,minutes,1000,end));if(!r.ok)throw new Error('History HTTP '+r.status);
  const data=Feed.parse(await r.json());if(!data.length)break;rows.push(...data);end=data[0].time-1;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 rows=Core.normalizeCandles(rows);fs.writeFileSync(path,JSON.stringify(rows));return rows;
}
async function run(){
 fs.mkdirSync('.runtime',{recursive:true});const report={generatedAt:new Date().toISOString(),version:Core.VERSION,source:'Bybit',method:'Prespecified baseline vs ribbon and pullback filters; chronological first 60%, final 40%; same-bar stop-first; next-open execution; fixed costs; no parameter fitting.',assets:{}};
 for(const asset of ['gold','btc']){
  const exec=await history(asset,15,6),h1=await history(asset,60,3),h4=await history(asset,240,1);
  const models=Object.fromEntries(['baseline','ribbon','pullback','independentPullback'].map(k=>[k,{trades:[],until:0,lossStreak:0,days:{}}]));
  const settings={...Core.DEFAULTS,entryModel:'baseline',market:Feed.instruments[asset].market};
  let candidates=0;
  for(let i=300;i<exec.length-49;i++){
   const cutoff=exec[i].time+900001,day=new Date(exec[i].time).toISOString().slice(0,10);
   const a=Core.analyzeMarket({exec:exec.slice(i-298,i+1),m15:exec.slice(i-298,i+1),h1:h1.filter(b=>b.time+3600000<=cutoff).slice(-299),h4:h4.filter(b=>b.time+14400000<=cutoff).slice(-299)},{...settings,now:cutoff});
   if(a.actionable&&a.plan)candidates++;
   const f=a.exec.flow.latest,dir=a.direction==='LONG'?1:-1;
   for(const [name,m] of Object.entries(models)){
    if(i<m.until || (m.days[day]||0)<=-settings.dailyLossLimitR)continue;
    if(name!=='independentPullback'&&!a.actionable)continue;
    let plan=a.plan;
    if(name==='independentPullback'){
      if(!f.pullbackConfirmed||!a.h1.ready||a.exec.quality.stale||a.h1.quality.stale||a.exec.quality.gaps>3||a.exec.values.adx<20)continue;
      plan=Core._internal.buildTradePlan(f.direction>0?'LONG':'SHORT',a.exec,settings);
      if(plan.costs.costRiskRatio>.22||plan.netRR<settings.minNetRR)continue;
    }
    if(name==='ribbon'&&!(f.direction===dir&&f.hourlyAligned))continue;
    if(name==='pullback'&&!(f.pullbackConfirmed&&f.direction===dir))continue;
    const trade=Core._internal.simulateTrade(exec,i,plan,settings);if(!trade)continue;
    trade.signalTime=exec[i].time;m.trades.push(trade);
    const exitDay=new Date(exec[trade.exitIndex].time).toISOString().slice(0,10);
    m.days[exitDay]=(m.days[exitDay]||0)+trade.r;
    m.lossStreak=trade.r<=0?m.lossStreak+1:0;
    m.until=trade.exitIndex+(m.lossStreak>=2?settings.lossStreakCooldownBars:settings.cooldownBars);
   }
   if(i%1000===0)console.log(asset,i);
  }
  const split=exec[Math.floor(exec.length*.6)].time;
  report.assets[asset]={bars:exec.length,start:new Date(exec[300].time).toISOString(),end:new Date(exec.at(-50).time).toISOString(),split:new Date(split).toISOString(),rawCandidates:candidates,models:Object.fromEntries(Object.entries(models).map(([k,m])=>[k,{all:Core.summarizeTrades(m.trades),development:Core.summarizeTrades(m.trades.filter(t=>exec[t.exitIndex].time<split)),holdout:Core.summarizeTrades(m.trades.filter(t=>t.signalTime>=split))}]))};
  console.log(JSON.stringify(report.assets[asset]));fs.writeFileSync('.runtime/research-validation-pullback.json',JSON.stringify(report,null,2));
 }
}
run().catch(e=>{console.error(e.message);process.exitCode=1;});
