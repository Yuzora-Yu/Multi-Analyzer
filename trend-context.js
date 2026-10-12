/* Closed-feature context only. Does not alter SMC/P/EXIT, zones or stops. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./market-feed.js'):root.MultiAnalyzerFeed);if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerTrendContext=api;})(globalThis,function(Feed){
  'use strict';
  const label=v=>({bull:'上向き',bear:'下向き',range:'中立',neutral:'中立'})[v]||'未確認';
  function known(tf,now){const last=tf?.candles?.at(-1),closedAt=last?.time+tf?.intervalMinutes*60000;return tf?.ready&&!tf.quality?.stale&&!(tf.quality?.gaps>3)&&Number.isFinite(closedAt)&&closedAt<=now;}
  function sessionWait(tf,now,asset){
    const duration=240*60000,openedAt=tf?.candles?.at(-1)?.time,closedAt=openedAt+duration;
    if(!Feed||asset!=='gold'||tf?.intervalMinutes!==240||tf.ready!==true||tf.quality?.stale!==true||
      tf.quality.gaps!==0||!Number.isFinite(openedAt)||openedAt%duration!==0||!Number.isFinite(now)||
      now<closedAt||now-closedAt>4*86400000||!Feed.collectionPolicy('gold',now).allowed||
      !Feed.barExpected('gold',openedAt,240))return null;
    const currentOpen=Math.floor(now/duration)*duration;let paused=0;
    // Every fully closed intervening H4 must be excluded by the unchanged
    // market-session policy. A missed expected H4 cannot be explained as a wait.
    for(let at=closedAt;at+duration<=now;at+=duration){
      if(Feed.barExpected('gold',at,240))return null;
      paused++;
    }
    if(!paused||!Feed.barExpected('gold',currentOpen,240))return null;
    return {kind:'SESSION_H4_PENDING',closedAt,nextClosedAt:currentOpen+duration,
      sessionVersion:Feed.SESSION_VERSION,scope:'確定待ちの説明のみ。現行エンジンのstale判定・方向保留・候補条件を維持。'};
  }
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
  function describe(a,{asset}={}){
    const now=a?.generatedAt,m15=a?.m15,price=known(m15,now)&&Number.isFinite(m15.values?.close)?m15.values.close:null;
    const frames=[['4H',a?.h4],['1H',a?.h1],['15m',m15]].map(([name,tf])=>{
      if(!known(tf,now))return {name,available:false,structure:'未確認',ma:'未確認',levels:[],leg:null,
        sessionWait:Number.isFinite(price)?sessionWait(tf,now,asset):null};
      const levels=[['EMA20',tf.values?.ema20],['EMA50',tf.values?.ema50],['BB中央',tf.series?.bb?.mid?.at(-1)]].filter(([,p])=>Number.isFinite(p)).map(([label,p])=>({label,price:p,position:Number.isFinite(price)?price>p?'上':price<p?'下':'同値':'未確認'}));
      return {name,available:true,closedAt:tf.candles.at(-1).time+tf.intervalMinutes*60000,structure:label(tf.structure?.trend),ma:label(tf.trend),levels,leg:leg(tf,now,price)};
    });
    return {price,priceClosedAt:Number.isFinite(price)?m15.candles.at(-1).time+900000:null,frames,
      note:'15分の確定価格と、各時間足の最新確定水準を比較。上位足の構造・複合MA条件・現在の価格位置を分けて表示します。SMC帯、P条件、撤回条件、SLは変更しません。日足は「時間足比較・AI保存」で確認できます。'};
  }
  function zoneRole(a,z){
    const tf=a?.h4,available=Boolean(known(tf,a?.generatedAt)),ma=available?label(tf.trend):'未確認',
      structure=available?label(tf.structure?.trend):'未確認';
    const direction=z?.direction==='LONG'?'上向き':z?.direction==='SHORT'?'下向き':null;
    const directional=v=>v==='上向き'||v==='下向き';
    let text='4Hの方向未確認';
    if(!direction)text='候補方向未確認';
    else if(available&&ma==='中立')text='4H MA中立・方向一致は未確認';
    else if(available&&directional(ma)&&directional(structure)&&ma!==structure)text='4Hの構造とMAが不一致';
    else if(available&&directional(ma)&&ma===structure)text=ma===direction?'4Hの構造・MAと同方向':'4Hの構造・MAに逆行';
    else if(available&&directional(ma))text=`4H MA${ma===direction?'と同方向':'に逆行'}・構造は${structure}`;
    return {label:text,originalRole:z?.role??null,h4:{available,ma,structure,
      closedAt:available?tf.candles.at(-1).time+tf.intervalMinutes*60000:null},
      note:'表示用の4H背景。元判定・入場条件・帯・SLは変更しません。'};
  }
  return {known,leg,describe,sessionWait,zoneRole};
});
