/* Presentation-only local price intersections. Never changes the engine or alerts. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MultiAnalyzerZoneFocus=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='local-confluence-v1';
  const round=x=>Math.round(x*100)/100;
  function describe(a,zone){
    const atr=a?.exec?.values?.atr,price=a?.exec?.values?.close,asOf=a?.generatedAt;
    if(!a?.marketMap?.valid||!zone||![atr,price,asOf,zone.low,zone.high].every(Number.isFinite)||atr<=0||zone.high<zone.low)
      return {version:VERSION,available:false,windows:[],references:[]};
    // A fixed fraction of execution ATR limits local proximity. A large H4 ATR
    // must not cause widely separated indicators to become one execution zone.
    const radius=atr*.2,references=[];
    for(const [frame,tf] of [['4H',a.h4],['1H',a.h1],['15m',a.m15]]){
      const closedAt=tf?.candles?.at(-1)?.time+tf?.intervalMinutes*60000;
      if(!tf?.ready||tf.quality?.stale||tf.quality?.gaps>3||!Number.isFinite(closedAt)||closedAt>asOf)continue;
      const v=tf.values||{};
      for(const [name,value,family] of [['EMA20',v.ema20,'MA'],['EMA50',v.ema50,'MA'],
        ['BB上限',v.bbUpper,'BB'],['BB下限',v.bbLower,'BB'],['BB中央',tf.series?.bb?.mid?.at(-1),'BB']]){
        if(!Number.isFinite(value)||value+radius<zone.low||value-radius>zone.high)continue;
        references.push({id:frame+'/'+name,frame,name,family,price:value,
          low:Math.max(zone.low,value-radius),high:Math.min(zone.high,value+radius),closedAt});
      }
    }
    const points=[...new Set(references.flatMap(r=>[r.low,r.high]))].sort((x,y)=>x-y);
    const windows=[];
    for(let i=0;i<points.length;i++){
      const low=points[i],high=points[i+1]??low,mid=(low+high)/2;
      const members=references.filter(r=>r.low<=mid&&r.high>=mid);
      if(!members.length)continue;
      const ids=members.map(r=>r.id).sort(),key=ids.join('|'),prior=windows.at(-1);
      if(prior?.key===key&&prior.high===low){prior.high=high;continue;}
      windows.push({key,low,high,ids,members});
    }
    // Show maximal co-location sets, not a transitive union that bridges distant
    // levels. Indicator counts are correlated descriptions, never probability.
    const maximal=windows.filter(w=>!windows.some(other=>other!==w&&other.ids.length>w.ids.length&&w.ids.every(id=>other.ids.includes(id))));
    const result=maximal.map(w=>({low:round(w.low),high:round(w.high),
      distance:Math.max(w.low-price,price-w.high,0),inside:price>=w.low&&price<=w.high,
      labels:w.members.map(r=>`${r.frame} ${r.name}`),families:[...new Set(w.members.map(r=>r.family))],
      levels:w.members.map(r=>({label:`${r.frame} ${r.name}`,price:round(r.price),closedAt:r.closedAt}))}))
      .sort((x,y)=>x.distance-y.distance||y.labels.length-x.labels.length||x.low-y.low).slice(0,3);
    return {version:VERSION,available:true,radius:round(radius),windows:result,references,
      note:'MA・BBは相関する観察値です。重合数は勝率ではありません。局所帯は観察用で、背景SMC帯の無効化・保護SLを変更しません。'};
  }
  return {VERSION,describe};
});
