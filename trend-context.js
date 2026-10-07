/* Closed-feature context only. Does not alter SMC/P/EXIT, zones or stops. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerTrendContext=api;})(globalThis,function(){
  'use strict';
  const label=v=>({bull:'上向き',bear:'下向き',range:'中立',neutral:'中立'})[v]||'未確認';
  function known(tf,now){const last=tf?.candles?.at(-1),closedAt=last?.time+tf?.intervalMinutes*60000;return tf?.ready&&!tf.quality?.stale&&!(tf.quality?.gaps>3)&&Number.isFinite(closedAt)&&closedAt<=now;}
  function leg(tf,now,price){
    if(!known(tf,now)||!Number.isFinite(price))return null;
    const points=[];
    for(const [kind,list] of [['high',tf.swings?.highs],['low',tf.swings?.lows]])for(const p of list||[]){
      const bar=tf.candles[p.index],confirmation=tf.candles[p.confirmIndex];
      if(!Number.isInteger(p.index)||!Number.isInteger(p.confirmIndex)||p.confirmIndex<p.index+3||!bar||!confirmation||bar.time!==p.time||bar[kind]!==p.price||!Number.isFinite(p.price)||confirmation.time+tf.intervalMinutes*60000>now)continue;
      points.push({...p,kind,confirmedAt:confirmation.time+tf.intervalMinutes*60000});
    }
    points.sort((a,b)=>b.time-a.time);
    if(!points.length||points[1]?.time===points[0].time)return null;
    const end=points[0],start=points.find(p=>p.time<end.time&&p.kind!==end.kind&&(end.kind==='low'?p.price>end.price:p.price<end.price));
    if(!start)return null;
    const down=end.kind==='low',span=Math.abs(start.price-end.price),ratio=(down?price-end.price:end.price-price)/span*100;
    return {direction:down?'下落脚':'上昇脚',start,end,span,ratio,levels:[.382,.5,.618].map(r=>({percent:r*100,price:end.price+(down?1:-1)*span*r})),
      location:ratio<0?'終点を越えて元の脚が延伸':ratio>100?'起点を越えた位置':'確認済み脚の範囲内',note:'確認済みの直近の脚から算出。値幅の割合であり、反転確率・入場条件ではありません。'};
  }
  function describe(a){
    const now=a?.generatedAt,m15=a?.m15,price=known(m15,now)&&Number.isFinite(m15.values?.close)?m15.values.close:null;
    const frames=[['4H',a?.h4],['1H',a?.h1],['15m',m15]].map(([name,tf])=>{
      if(!known(tf,now))return {name,available:false,structure:'未確認',ma:'未確認',levels:[],leg:null};
      const levels=[['EMA20',tf.values?.ema20],['EMA50',tf.values?.ema50],['BB中央',tf.series?.bb?.mid?.at(-1)]].filter(([,p])=>Number.isFinite(p)).map(([label,p])=>({label,price:p,position:Number.isFinite(price)?price>p?'上':price<p?'下':'同値':'未確認'}));
      return {name,available:true,closedAt:tf.candles.at(-1).time+tf.intervalMinutes*60000,structure:label(tf.structure?.trend),ma:label(tf.trend),levels,leg:leg(tf,now,price)};
    });
    return {price,priceClosedAt:Number.isFinite(price)?m15.candles.at(-1).time+900000:null,frames,
      note:'15分の確定価格と、各時間足の最新確定水準を比較。上位足の構造・複合MA条件・現在の価格位置を分けて表示します。SMC帯、P条件、撤回条件、SLは変更しません。日足は「時間足比較・AI保存」で確認できます。'};
  }
  return {known,leg,describe};
});
