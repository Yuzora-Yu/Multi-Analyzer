/* Device-local observation checkpoints. No engine, order or notification changes. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerCheckpoint=api;})(globalThis,function(root){
  'use strict';const STEP=900000,KEY='multiAnalyzer.checkpoints.v1';
  const valid=b=>b&&[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.time%STEP===0&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close);
  function create(a,z,{asset,market,symbol,snapshotId,basis,now=Date.now()}={}){
    const tf=a?.m15,last=tf?.candles?.at(-1),pivot=(z?.direction==='SHORT'?tf?.swings?.lows:tf?.swings?.highs)?.at(-1);
    if(!a?.marketMap?.valid||!tf?.ready||tf.quality?.stale||!valid(last)||last.time+STEP>a.generatedAt||!['LONG','SHORT'].includes(z?.direction)||![z.low,z.high,z.invalidationClose,z.protectiveStop,now,a.generatedAt,a.marketMap.price].every(Number.isFinite)||now-a.generatedAt>20*60000||a.generatedAt>now+60000||z.high<z.low||!asset||!market||!symbol)throw Error('新鮮な15分確定足と候補帯が必要です');
    const after=Math.max(now,a.generatedAt,last.time+STEP),inside=a.marketMap.price>=z.low&&a.marketMap.price<=z.high;
    return {schema:1,id:asset+':'+now+':'+z.id,asset,market,symbol,savedAt:now,observeAfter:after,
      source:{snapshotId:snapshotId||null,engineVersion:a.version||null,generatedAt:a.generatedAt,closedAt:last.time+STEP,price:a.marketMap.price},
      zone:structuredClone(z),basis:structuredClone(basis||{enabled:false,offset:0,label:'元市場価格'}),focus:root.MultiAnalyzerZoneFocus?.describe(a,z)||null,
      rule:{minutes:15,pivot:Number.isFinite(pivot?.price)?pivot.price:null,pivotTime:pivot?.time??null,
        text:z.direction==='SHORT'?'帯への接触確認後、後続15分終値が帯の下端と保存時の確定安値をともに下回る':'帯への接触確認後、後続15分終値が帯の上端と保存時の確定高値をともに上回る'},
      observation:{status:inside?'TOUCHED':'WAIT',touched:inside,touchedAt:inside?after:null,touchSource:inside?'保存時の分析価格':'未到達',touchEvidence:inside?{kind:'saved-analysis-price',observedAt:now,sourceClosedAt:last.time+STEP,price:a.marketMap.price}:null,through:after,lastClosedAt:last.time+STEP,stopTouchedAt:null,stopEvidence:null,confirmedAt:null,confirmationEvidence:null,invalidatedAt:null,coverageIncomplete:false,updatedAt:now},
      note:'15分確定足による端末内の観察用記録。ライブ価格の監視・注文・Pサインとは別。元の帯・確定スイング・撤回条件・SL参考を固定します。'};
  }
  function advance(original,a,{now=Date.now(),allowed=true,barExpected=(asset,t)=>root.MultiAnalyzerFeed?.barExpected(asset,t,15)??true}={}){
    const c=structuredClone(original),s=c.observation,tf=a?.m15;
    if(s.invalidatedAt){s.status='INVALIDATED';return c;}
    if(!allowed||!tf?.ready||tf.quality?.stale||!Number.isFinite(a.generatedAt)||a.generatedAt>now+60000||now-a.generatedAt>20*60000||a.version!==c.source.engineVersion){s.paused=true;s.message='更新停止・休場・判定版不一致。保存した条件を維持して確認待ち';return c;}
    s.paused=false;delete s.message;
    const bars=tf.candles.filter(b=>valid(b)&&b.time+STEP<=a.generatedAt&&b.time+STEP>s.through).sort((x,y)=>x.time-y.time);
    if(bars.length>1)s.reconstructed=true;
    for(const b of bars){
      for(let t=Math.floor(s.through/STEP)*STEP;t<b.time;t+=STEP)if(barExpected(c.asset,t))s.coverageIncomplete=true;
      const closeAt=b.time+STEP,short=c.zone.direction==='SHORT';
      const invalid=short?b.close>c.zone.invalidationClose:b.close<c.zone.invalidationClose;
      s.through=closeAt;s.lastClosedAt=closeAt;s.updatedAt=now;
      // A partially pre-save bar's wick cannot prove a post-save touch/stop.
      const full=b.time>=c.observeAfter,closeInside=b.close>=c.zone.low&&b.close<=c.zone.high,touchedBefore=s.touched;
      if(!s.touched&&((full&&b.high>=c.zone.low&&b.low<=c.zone.high)||closeInside)){
        s.touched=true;s.touchedAt=closeAt;s.touchSource='保存後の15分確定足';
        s.touchEvidence={kind:full?'full-bar-range':'post-save-close',observedAt:now,closedAt:closeAt,barOpenAt:b.time,close:b.close,...(full?{high:b.high,low:b.low}:{})};
      }
      if(!s.stopTouchedAt&&((full&&(short?b.high>=c.zone.protectiveStop:b.low<=c.zone.protectiveStop))||(short?b.close>=c.zone.protectiveStop:b.close<=c.zone.protectiveStop))){
        s.stopTouchedAt=closeAt;s.stopEvidence={kind:full?'full-bar-range':'post-save-close',observedAt:now,closedAt:closeAt,barOpenAt:b.time,close:b.close,...(full?{high:b.high,low:b.low}:{})};
      }
      if(invalid){s.status='INVALIDATED';s.invalidatedAt=closeAt;s.invalidationPrice=b.close;break;}
      const reaction=Number.isFinite(c.rule.pivot)&&touchedBefore&&!s.stopTouchedAt&&!s.coverageIncomplete&&(short?b.close<c.zone.low&&b.close<c.rule.pivot:b.close>c.zone.high&&b.close>c.rule.pivot);
      if(reaction&&!s.confirmedAt){s.confirmedAt=closeAt;s.confirmationEvidence={kind:'closed-reaction',observedAt:now,closedAt:closeAt,barOpenAt:b.time,close:b.close};}
      s.status=s.stopTouchedAt?'STOP_REFERENCE_REACHED':s.confirmedAt?'REACTION_CONFIRMED':s.touched?'TOUCHED':'WAIT';
    }
    if(s.coverageIncomplete&&!s.invalidatedAt)s.status='COVERAGE_UNKNOWN';
    return c;
  }
  function read(){try{const list=JSON.parse(root.localStorage?.getItem(KEY)||'[]');return Array.isArray(list)?list.filter(c=>c.schema===1&&c.zone&&c.rule&&c.observation):[];}catch{return[];}}
  function write(list){root.localStorage.setItem(KEY,JSON.stringify(list));}
  function track(a,z,options){const list=read(),c=create(a,z,options);if(list.filter(r=>r.asset===c.asset).length>=4)throw Error('同じ銘柄の追跡は4件まで。不要な記録を解除してください');write([...list,c]);return c;}
  function refresh(a,asset,options){const before=read(),after=before.map(c=>c.asset===asset?advance(c,a,options):c);if(JSON.stringify(before)!==JSON.stringify(after))write(after);return after.filter(c=>c.asset===asset);}
  function remove(id){write(read().filter(c=>c.id!==id));}
  function describe(c){const s=c.observation,z=c.zone,b=c.basis,p=v=>Number.isFinite(v)?(v+(b.enabled?b.offset:0)).toFixed(2)+(b.enabled?'［元 '+v.toFixed(2)+'］':''):'未取得';
    const label={WAIT:'未到達',TOUCHED:'到達・反応待ち',REACTION_CONFIRMED:'反応条件成立（Pと別）',INVALIDATED:'見立て撤回',COVERAGE_UNKNOWN:'足の欠損・経過不明',STOP_REFERENCE_REACHED:'元のSL参考値に到達'};
    const date=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})+' JST';
    const evidence=(name,at,e)=>{
      if(!at)return null;
      const detail=!e?'旧記録は根拠価格を保存していません':e.kind==='saved-analysis-price'?`保存時の分析価格 ${p(e.price)} / 元の足確定 ${date(e.sourceClosedAt)}`:e.kind==='post-save-close'?`保存後の終値 ${p(e.close)}。保存前を含むヒゲは根拠にしません`:e.kind==='closed-reaction'?`終値 ${p(e.close)} / 保存した帯とスイングを通過`:`足の範囲 ${p(e.low)}～${p(e.high)} / 終値 ${p(e.close)}。足内の到達順・時刻は不明`;
      return `${name} ${date(at)}：${detail}。${Number.isFinite(e?.observedAt)?`この端末での確認 ${date(e.observedAt)}。`:''}`;
    };
    return [`保存した${z.direction==='SHORT'?'売り':'買い'}帯 ${p(z.low)}～${p(z.high)} / ${s.paused?'更新待ち':label[s.status]}（15分確定足で確認）`,
      `基準 ${c.symbol} ${c.market} / ${b.label}（保存時の換算）。15分足、保存 ${date(c.savedAt)}。`,
      `${c.rule.text}。固定スイング ${p(c.rule.pivot)}。基準未取得なら成立とは判定しません。`,
      `15分終値 ${p(z.invalidationClose)}${z.direction==='SHORT'?'超':'未満'}で撤回。保護SL参考 ${p(z.protectiveStop)}${s.stopTouchedAt?'：到達を確認':''}。元条件を変更しません。`,
      evidence('初回到達の記録',s.touchedAt,s.touchEvidence),
      evidence('反応条件の確定',s.confirmedAt,s.confirmationEvidence),
      evidence('SL参考値の到達記録',s.stopTouchedAt,s.stopEvidence),
      s.invalidatedAt?`見立て撤回の確定 ${date(s.invalidatedAt)}：終値 ${p(s.invalidationPrice)}。撤回後は同じ記録を復活させません。`:null,
      `判定確定足 ${date(s.lastClosedAt??c.source.closedAt)}${s.reconstructed?' / 複数の過去足をまとめて再確認':''}。${s.paused?s.message+'。':''}${c.note}`].filter(Boolean);
  }
  return {create,advance,read,write,track,refresh,remove,describe};
});
