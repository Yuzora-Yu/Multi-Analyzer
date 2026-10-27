/* Observation-only zone priority. No signal, probability or frozen-engine input. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerZoneImportance=api;})(globalThis,function(){
  'use strict';
  const VERSION='zone-importance-v1',BASELINE=21;
  const NOTE='大局→波→短期の順。同じ役割では重要度を比較。重要度は観察の優先度で、反発確率・P・売買成立ではありません。相対量は直前21本比、時間帯補正なし。';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function role(minutes){return minutes>=60?{order:3,label:'大局'}:minutes>=15?{order:2,label:'波'}:{order:1,label:'短期'};}
  function timeframePoints(m){return m>=1440?46:m>=240?38:m>=60?28:m>=15?18:m>=5?10:4;}
  function points(minutes,ratio,bodyATR,structure,visits){
    const volume=ratio==null?0:ratio>=1.8?8:ratio>=1.3?5:ratio>=1?2:0;
    const displacement=bodyATR==null?0:bodyATR>=1.5?5:bodyATR>=1?3:bodyATR>=.8?1:0;
    const freshness=visits==null?0:visits===0?6:visits===1?3:-Math.min(visits-1,4)*3;
    const parts={timeframe:timeframePoints(minutes),volume,displacement,structure:structure?8:0,freshness};
    const score=Math.max(0,Object.values(parts).reduce((s,x)=>s+x,0));
    return {score,parts,grade:score>=34?'high':score>=18?'medium':'support',label:score>=34?'高':score>=18?'中':'補助'};
  }
  function prepare(candles,minutes,{volumeBasis='約定出来高'}={}){
    const step=minutes*60000,n=candles?.length||0,atr=[],breaks=[];let sum=0,hi=-1,lo=-1,usedHi=-1,usedLo=-1;
    if(!(step>0)||!n)return null;
    for(let i=0;i<n;i++){
      const b=candles[i],prev=candles[i-1];
      if(![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||(prev&&b.time<=prev.time))return null;
      const tr=Math.max(b.high-b.low,Math.abs(b.high-(prev?.close??b.close)),Math.abs(b.low-(prev?.close??b.close)));
      if(i<14){sum+=tr;atr[i]=i===13?sum/14:null;}else atr[i]=(atr[i-1]*13+tr)/14;
      breaks[i]=0;
      if(prev&&hi>=0&&usedHi!==hi&&prev.close<=candles[hi].high&&b.close>candles[hi].high){breaks[i]=1;usedHi=hi;}
      if(prev&&lo>=0&&usedLo!==lo&&prev.close>=candles[lo].low&&b.close<candles[lo].low){breaks[i]=-1;usedLo=lo;}
      // A pivot confirmed at this close may only be broken on a later candle.
      const p=i-3;
      if(p>=3){let high=true,low=true;for(let j=p-3;j<=p+3;j++)if(j!==p){if(candles[j].high>=candles[p].high)high=false;if(candles[j].low<=candles[p].low)low=false;}if(high)hi=p;if(low)lo=p;}
    }
    return {candles,minutes,step,atr,breaks,volumeBasis};
  }
  function evaluate(prepared,zone,index,{observedAt=Infinity}={}){
    const unavailable=reason=>({version:VERSION,available:false,reason,role:role(prepared?.minutes||0),note:NOTE});
    if(!prepared||!Number.isInteger(index)||index<0)return unavailable('形成足未確認');
    const {candles:c,minutes,step,atr,breaks,volumeBasis}=prepared,b=c[index];
    if(!b||b.time+step>observedAt)return unavailable('形成足未確定');
    const kind=zone.kind||zone.type,side=zone.direction==='LONG'||zone.side==='bull'||zone.side===1?1:zone.direction==='SHORT'||zone.side==='bear'||zone.side===-1?-1:0;
    if(!side)return unavailable('帯の方向未確認');
    if(!['FVG','OB','SWEEP'].includes(kind)||!(zone.high>zone.low)||(kind==='FVG'&&index<2))return unavailable('帯の種類・範囲未確認');
    const middle=kind==='FVG'?index-1:index;
    if(middle<0)return unavailable('形成履歴不足');
    const displacement=c[middle],prior=middle>=BASELINE?c.slice(middle-BASELINE,middle):[];
    const volumeAvailable=prior.length===BASELINE&&[displacement,...prior].every(x=>Number.isFinite(x.volume)&&x.volume>0);
    const mean=volumeAvailable?prior.reduce((s,x)=>s+x.volume,0)/BASELINE:null;
    const ratio=mean>0?displacement.volume/mean:null;
    const bodyATR=atr[middle-1]>0?Math.abs(displacement.close-displacement.open)/atr[middle-1]:null;
    const structure=breaks[index]===side||(kind==='FVG'&&breaks[middle]===side);
    let visits=0,inside=false,retired=false,lastIndex=index;
    for(let j=index+1;j<c.length&&c[j].time+step<=observedAt;j++){
      const x=c[j];lastIndex=j;
      if(side>0?x.close<zone.low:x.close>zone.high)retired=true;
      if(kind==='FVG'&&(side>0?x.low<=zone.low:x.high>=zone.high))retired=true;
      if(retired)break;
      const touch=x.low<=zone.high&&x.high>=zone.low;if(touch&&!inside)visits++;inside=touch;
    }
    const grade=points(minutes,ratio,bodyATR,structure,visits);
    return {version:VERSION,available:true,role:role(minutes),...grade,partial:ratio==null||bodyATR==null,retired,
      formation:{confirmedAt:b.time+step,displacementClosedAt:displacement.time+step,relativeVolume:ratio,volumeBasis,baselinePeriod:BASELINE,baselineBars:volumeAvailable?BASELINE:prior.length,baseline:'直前21確定足・形成変位足を除く・時間帯補正なし',bodyATR,structureBreak:structure,structureWindow:kind==='FVG'?'中央足と確認足':'確認足'},
      current:{observedThrough:c[lastIndex].time+step,visits,contiguousTouchCountsAsOne:true},note:NOTE};
  }
  function compare(a,b){const x=a.importance,y=b.importance;return (y?.role?.order||0)-(x?.role?.order||0)||(y?.score??-1)-(x?.score??-1)||(b.minutes||0)-(a.minutes||0)||(a.distance||0)-(b.distance||0);}
  function forZone(a,z){
    const keys={'1m':'exec','M1':'exec','5m':'exec','M5':'exec','15m':'m15','M15':'m15','1H':'h1','H1':'h1','4H':'h4','H4':'h4','D1':'d1'};
    const tf=a?.[keys[z.frame]],index=tf?.candles?.findIndex(b=>b.time===(z.originAt??z.time));
    if(!tf||index<0)return null;
    return evaluate(prepare(tf.candles,tf.intervalMinutes),z,index,{observedAt:a.generatedAt});
  }
  function forFrame(tf,observedAt){
    if(!tf?.ready||tf.quality?.stale||tf.quality?.gaps!==0)return null;
    const prepared=prepare(tf.candles,tf.intervalMinutes);if(!prepared)return null;
    return {version:VERSION,observedAt,sourceMinutes:tf.intervalMinutes,note:NOTE,zones:(tf.smc?.zones||[]).filter(z=>z.status==='active').map(z=>({kind:z.type,side:z.side,low:z.low,high:z.high,time:z.time,importance:evaluate(prepared,z,z.index,{observedAt})}))};
  }
  function summary(q){if(!q?.available)return '重要度 未評価';const v=q.formation.relativeVolume;return `${q.role.label}・重要度 ${q.label}${q.partial?'（一部未評価）':''} / 形成量 ${v==null?'未取得':v.toFixed(2)+'倍'} / 形成時突破 ${q.formation.structureBreak?'あり':'未確認'} / 再訪 ${q.current.visits}回`;}
  function lines(q){return !q?.available?[summary(q)]:[summary(q),`形成量の基準：${q.formation.volumeBasis} / ${q.formation.baseline}。変位実体 ${q.formation.bodyATR==null?'未評価':q.formation.bodyATR.toFixed(2)+' ATR'}。形成時点と、その後の再訪評価を区別。`,NOTE];}
  function html(q,{id=null,expanded=false}={}){
    if(!q?.available)return '<span class="zone-importance unavailable">重要度 未評価</span>';
    return `<span class="zone-importance ${q.grade}">${esc(q.role.label)}・重要度 ${esc(q.label)}${q.partial?' *':''}</span><details class="zone-importance-details"${id!=null?' data-importance-zone="'+esc(id)+'"':''}${expanded?' open':''}><summary>重要度の根拠${q.partial?'・一部未評価':''}</summary>${lines(q).map(s=>'<p>'+esc(s)+'</p>').join('')}</details>`;
  }
  return {VERSION,NOTE,BASELINE,role,points,prepare,evaluate,compare,forZone,forFrame,summary,lines,html};
});
