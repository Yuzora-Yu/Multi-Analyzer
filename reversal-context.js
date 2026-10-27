/* Current, read-only SMC reaction hypotheses. Never an entry or a frozen-engine input. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./market-feed'):root.MultiAnalyzerFeed,typeof module==='object'&&module.exports?require('./trend-context'):root.MultiAnalyzerTrendContext,typeof module==='object'&&module.exports?require('./zone-importance'):root.MultiAnalyzerZoneImportance);if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerReversal=api;})(globalThis,function(Feed,Trend,Importance){
  'use strict';
  const VERSION='smc-reaction-context-v3-importance',STEP=900000;
  const FRAMES=[['15m','m15',15,32],['1H','h1',60,24],['4H','h4',240,12]];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const price=v=>Number.isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'未取得';
  const date=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' JST';
  const side=s=>s==='bull'?'LONG':s==='bear'?'SHORT':null;
  function frame(tf,minutes,at){
    if(!Trend?.known(tf,at)||tf.intervalMinutes!==minutes||tf.quality?.gaps!==0)return null;
    let prev=-Infinity;const step=minutes*60000;
    for(const b of tf.candles||[]){
      if(![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.time%step||b.time<=prev||b.time+step>at||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))return null;
      prev=b.time;
    }
    return tf;
  }
  function swing(tf,p,kind,beforeIndex=tf.candles.length){
    const b=tf.candles[p?.index],confirmation=tf.candles[p?.confirmIndex];
    return Number.isInteger(p?.index)&&Number.isInteger(p?.confirmIndex)&&p.confirmIndex>=p.index+3&&p.confirmIndex<beforeIndex&&b&&confirmation&&b.time===p.time&&b[kind]===p.price;
  }
  function completePath(tf,index){
    const times=new Set(tf.candles.slice(index).map(b=>b.time)),step=tf.intervalMinutes*60000;
    for(let t=tf.candles[index].time;t<=tf.candles.at(-1).time;t+=step)if(Feed.barExpected('gold',t,tf.intervalMinutes)&&!times.has(t))return false;
    return true;
  }
  function lifecycle(tf,index,c){
    const after=tf.candles.slice(index+1),short=c.direction==='SHORT';
    const broken=after.find(b=>short?b.close>c.high:b.close<c.low);
    if(broken)return {withdrawnAt:broken.time+tf.intervalMinutes*60000,withdrawnClose:broken.close};
    // A full wick fill consumes an FVG even when the close recovers. No resurrection.
    const filled=c.kind==='FVG'?after.find(b=>short?b.high>=c.high:b.low<=c.low):null;
    if(filled)return {filledAt:filled.time+tf.intervalMinutes*60000};
    let visits=0,inside=false,firstVisit=null;
    for(const b of after){const touch=b.low<=c.high&&b.high>=c.low;if(touch&&!inside){visits++;firstVisit??=b.time+tf.intervalMinutes*60000;}inside=touch;}
    const displacement=after.slice(0,6).find(b=>{const i=tf.candles.indexOf(b),atr=tf.series?.atr14?.[i-1];return atr>0&&(short?b.open-b.close:b.close-b.open)>=atr*.8&&(short?b.close<c.low:b.close>c.high);});
    // This is an observed source-frame event, not an M1/M5 entry confirmation.
    const structure=(tf.smc?.events||[]).find(e=>{
      if(!['BOS','CHoCH'].includes(e.type)||side(e.side)!==c.direction||firstVisit==null||e.time<firstVisit||!Number.isFinite(e.price))return false;
      const i=tf.candles.findIndex(b=>b.time===e.time),b=tf.candles[i],prev=tf.candles[i-1],kind=short?'low':'high';
      return b&&prev&&(tf.swings?.[short?'lows':'highs']||[]).some(p=>p.price===e.price&&swing(tf,p,kind,i))&&(short?prev.close>=e.price&&b.close<e.price:prev.close<=e.price&&b.close>e.price);
    });
    return {visits,firstVisit,displacementAt:displacement?displacement.time+tf.intervalMinutes*60000:null,structureAt:structure?structure.time+tf.intervalMinutes*60000:null,structureType:structure?.type??null};
  }
  function describe(a,{asset='gold',now=Date.now(),mode='live',health=null,snapshotId=null}={}){
    const out={version:VERSION,scope:'CURRENT_REVERSAL_CONTEXT',observedAt:now,sourceGeneratedAt:a?.generatedAt??null,sourceId:snapshotId,available:false,actionable:false,candidates:[],retired:[],references:[]};
    const stop=reason=>({...out,reason});
    if(asset!=='gold'||mode!=='live')return stop('保存記録・CSVには現在の反転候補を追加しません。');
    if(!Number.isFinite(now)||!Feed.collectionPolicy('gold',now).allowed)return stop('GOLD休場・新しい反転候補の表示を停止しています。');
    if(health?.blocked||!Number.isFinite(a?.generatedAt)||a.generatedAt>now||now-a.generatedAt>20*60000)return stop('確定足の鮮度・判定IDの整合を確認できないため保留です。');
    const m15=frame(a.m15,15,a.generatedAt),atr=m15?.values?.atr,bar=m15?.candles.at(-1);
    if(!m15||!(atr>0)||!bar)return stop('欠損・未確定足があるため反転候補を推定しません。');
    const candidates=[],retired=[],micro=a.exec?.intervalMinutes;
    const frames=[...(micro>0&&![15,60,240].includes(micro)?[[micro===1440?'日足':micro+'m','exec',micro,micro===1?480:micro===5?96:12]]:[]),...FRAMES];
    for(const [name,key,minutes,lookback] of frames){
      const tf=frame(a[key],minutes,a.generatedAt);if(!tf)continue;
      const step=minutes*60000,prepared=Importance.prepare(tf.candles,minutes);
      function add(c,index){
        if(index<0||![c.low,c.high].every(Number.isFinite)||c.low<=0||c.high<=c.low||!completePath(tf,index))return;
        const distance=Math.max(c.low-bar.close,bar.close-c.high,0);if(distance>atr*8)return;
        const path=lifecycle(tf,index,c),expired=tf.candles.length-1-index>lookback;
        const item={...c,frame:name,minutes,formedAt:tf.candles[index].time+step,originAt:tf.candles[index].time,withdrawalPrice:c.direction==='SHORT'?c.high:c.low,withdrawalMinutes:minutes,distance,...path,
          importance:Importance.evaluate(prepared,c,index,{observedAt:a.generatedAt})};
        if(path.withdrawnAt||path.filledAt||expired){retired.push({...item,expired});return;}
        item.phase=bar.close>=c.low&&bar.close<=c.high?'帯内・反転未確認':path.visits?'再訪履歴あり・反応待ち':'接近待ち';
        item.role=frame(a.h4,240,a.generatedAt)?Trend.zoneRole(a,item).label:'4Hの方向未確認';item.matches=[];
        for(const [label,k,n] of FRAMES){const t=frame(a[k],n,a.generatedAt);if(!t)continue;
          for(const [what,p] of [['EMA20',t.values?.ema20],['EMA50',t.values?.ema50],['BB中央',t.series?.bb?.mid?.at(-1)],['BB上限',t.values?.bbUpper],['BB下限',t.values?.bbLower],['POC近似',t.smc?.poc]])
            if(Number.isFinite(p)&&p+atr*.2>=c.low&&p-atr*.2<=c.high)item.matches.push({label:label+' '+what,price:p,closedAt:t.candles.at(-1).time+n*60000});
        }
        candidates.push(item);
      }
      for(const z of tf.smc?.zones||[]){
        const direction=side(z.side),i=z.index,b=tf.candles[i];
        if(!direction||z.status!=='active'||!['OB','FVG'].includes(z.type)||!Number.isInteger(i)||!b||b.time!==z.time)continue;
        const origin=tf.candles.find(b=>b.time===z.originTime);
        if(z.type==='OB'&&(!origin||origin.time>=b.time||origin.low!==z.low||origin.high!==z.high||(direction==='LONG'?origin.close>=origin.open:origin.close<=origin.open)))continue;
        if(z.type==='FVG'){const before=tf.candles[i-2];if(!before||(direction==='LONG'?(before.high!==z.low||b.low!==z.high):(b.high!==z.low||before.low!==z.high)))continue;}
        add({id:`${name}:${z.type}:${z.side}:${z.time}:${z.low}:${z.high}`,kind:z.type,direction,low:z.low,high:z.high,evidence:`${name}の有効な${z.type}。元の帯幅を維持。`,sourceLevel:null},i);
      }
      for(const e of tf.smc?.events||[]){
        if(e.type!=='SWEEP'||!Number.isFinite(e.price))continue;
        const direction=side(e.side),i=tf.candles.findIndex(b=>b.time===e.time),b=tf.candles[i],kind=direction==='SHORT'?'high':'low';
        if(!direction||!b||!(tf.swings?.[kind==='high'?'highs':'lows']||[]).some(p=>p.price===e.price&&swing(tf,p,kind,i)))continue;
        if(direction==='SHORT'?!(b.high>e.price&&b.close<e.price):!(b.low<e.price&&b.close>e.price))continue;
        const low=direction==='SHORT'?e.price:b.low,high=direction==='SHORT'?b.high:e.price;
        const extremeAt=m15.candles.find(x=>x.time>=b.time&&x.time<b.time+step&&x[kind]===(direction==='SHORT'?high:low))?.time??b.time;
        add({id:`${name}:SWEEP:${e.side}:${e.time}:${e.price}`,kind:'SWEEP',direction,low,high,extremeAt,sourceLevel:e.price,evidence:`${name}で確認済み${direction==='SHORT'?'高値を上へ':'安値を下へ'}掃い、終値が元水準の内側へ復帰。有効OBとは別の反転観察帯。`},i);
      }
    }
    // Same extreme observed on multiple frames is one event, not independent votes.
    const grouped=[];
    for(const c of candidates.sort((x,y)=>x.formedAt-y.formedAt||(x.high-x.low)-(y.high-y.low))){
      const same=c.kind==='SWEEP'?grouped.find(x=>x.kind==='SWEEP'&&x.direction===c.direction&&x.extremeAt===c.extremeAt&&(c.direction==='SHORT'?x.high===c.high:x.low===c.low)):null;
      const reference=z=>({frame:z.frame,formedAt:z.formedAt,sourceLevel:z.sourceLevel,low:z.low,high:z.high,withdrawalPrice:z.withdrawalPrice,withdrawalMinutes:z.withdrawalMinutes});
      if(same){
        // Represent one extreme with its highest confirmed source, preserving every original range.
        if(c.minutes>same.minutes){c.related=[...(same.related||[]),reference(same)];grouped[grouped.indexOf(same)]=c;}
        else {same.related??=[];same.related.push(reference(c));}
      }else grouped.push(c);
    }
    const overlapping=[];
    const selected=['LONG','SHORT'].flatMap(direction=>{
      const own=grouped.filter(c=>c.direction===direction),sweeps=[];
      for(const c of own.filter(c=>c.kind==='SWEEP').sort((x,y)=>y.formedAt-x.formedAt)){
        if(sweeps.some(z=>c.low<=z.high&&c.high>=z.low))overlapping.push(c);else sweeps.push(c);
      }
      // Parent context first; retain a nearby distinct source for timing coverage.
      // Priority is a declared observation heuristic, never a win probability.
      const zones=own.filter(c=>c.kind!=='SWEEP').sort(Importance.compare),primary=zones[0];
      const other=zones.filter(c=>primary&&c.minutes!==primary.minutes&&(c.high<primary.low||c.low>primary.high)).sort((x,y)=>x.distance-y.distance)[0];
      return [...(primary?[primary]:[]),...(other?[other]:[]),...sweeps.sort(Importance.compare)].slice(0,3);
    });
    const references=[];
    for(const [name,key,n] of FRAMES){const tf=frame(a[key],n,a.generatedAt);if(!tf)continue;
      for(const [kind,list] of [['high',tf.swings?.highs],['low',tf.swings?.lows]])for(const p of (list||[]).slice(-3))if(swing(tf,p,kind)&&Math.abs(p.price-bar.close)<=atr*8)references.push({label:name+' 確認済み'+(kind==='high'?'高値':'安値'),price:p.price,confirmedAt:tf.candles[p.confirmIndex].time+n*60000});
    }
    return {...out,available:true,reason:null,price:bar.close,priceClosedAt:bar.time+STEP,candidates:selected,overlapping,retired:retired.sort((x,y)=>y.formedAt-x.formedAt).slice(0,6),references:references.filter((r,i,all)=>all.findIndex(x=>x.price===r.price)===i).sort((x,y)=>Math.abs(x.price-bar.close)-Math.abs(y.price-bar.close)).slice(0,6),
      note:'価格パターンからの反転仮説です。実際の機関注文・反転確率・入場成立を示しません。根拠の重複を独立した賛成票に数えません。元のP/EXIT・通知・固定デモは変更しません。',
      importanceVersion:Importance.VERSION,
      historyNote:'大局→波→短期の役割と重要度で優先表示し、近い別時間足の帯も保持。各方向最大3帯。確率順には並べません。重なる古い掃いは履歴へ分離。1分480本・5分96本・15分32本・1H24本・4H12本まで。保存履歴の外や形成前の反応は未評価。'};
  }
  const title=c=>c.kind==='SWEEP'?'掃い・復帰の反転候補':`有効${c.kind}の反応候補`;
  function lines(c){
    if(!c?.available)return ['反転候補：'+(c?.reason||'確認中')];
    return [`反転候補の確認 ${date(c.observedAt)} / 基準15分 ${date(c.priceClosedAt)} / Bybit ${price(c.price)}`,...c.candidates.flatMap(z=>[
      `${z.direction==='LONG'?'買い':'売り'}反転候補 ${price(z.low)}～${price(z.high)} / ${title(z)} / ${z.frame} / ${z.phase}`,
      `形成確認 ${date(z.formedAt)} / ${z.evidence} ${z.role}。後続の再訪${z.visits||0}回（連続接触は1回）。`,
      ...Importance.lines(z.importance),
      `撤回：${z.minutes}分終値が ${price(z.withdrawalPrice)}${z.direction==='SHORT'?'超':'未満'}。保護SLは再訪時の高安の外側で別途確認。`,
      z.structureAt?`${z.frame}の後続${z.structureType}を観測 ${date(z.structureAt)}。1分・5分の入場確認とは別です。`:'反転成立は未確認。帯での拒否・回復→1分・5分の構造転換→初戻りを別途確認。',
      ...(z.matches.length?['現在の近接水準（帯幅は変更しない）：'+z.matches.slice(0,4).map(x=>x.label+' '+price(x.price)).join(' / ')]:[])
    ]),...(c.overlapping||[]).map(z=>`重複する以前の掃い ${z.frame} ${price(z.low)}～${price(z.high)} / 確認 ${date(z.formedAt)}。元の幅を保持して履歴へ分離。`),...c.references.map(r=>`流動性の参照点 ${r.label} ${price(r.price)} / 確認 ${date(r.confirmedAt)}。単独水準は反転帯・注文の証拠ではありません。`),c.historyNote,c.note];
  }
  function html(c,{formatPrice=price,expanded=false,expandedImportance=[]}={}){
    const p=t=>'<p>'+esc(t)+'</p>';
    if(!c?.available)return '<h3>反転が起きるか観察する帯</h3>'+p(c?.reason||'確認中');
    const cards=c.candidates.map(z=>`<section class="reversal-card ${z.direction==='SHORT'?'zone-short':'zone-long'}"><h4>${z.direction==='SHORT'?'売り':'買い'}反転候補 ${esc(formatPrice(z.low))}～${esc(formatPrice(z.high))}</h4>`+
      Importance.html(z.importance,{id:z.id,expanded:expandedImportance.includes(z.id)})+p(`${title(z)} / ${z.frame} / ${z.phase}`)+p(z.evidence)+p(`形成確認 ${date(z.formedAt)} / ${z.role} / 再訪${z.visits||0}回`)+
      p(`撤回：${z.minutes}分終値 ${formatPrice(z.withdrawalPrice)}${z.direction==='SHORT'?'超':'未満'}。SLは再訪高安の外側で別管理。`)+
      (z.displacementAt?p(`形成後の強い実体を観測 ${date(z.displacementAt)}。反転・入場の保証ではありません。`):'')+
      p(z.structureAt?`${z.frame}の後続${z.structureType}を観測 ${date(z.structureAt)}。短期の入場確認とは別です。`:'反転成立は未確認。拒否・回復→1分・5分の構造転換→初戻りを別途確認。')+
      (z.related?.length?p('同じ極値を'+z.related.map(r=>r.frame+'（確認 '+date(r.formedAt)+'）').join(' / ')+'でも観測。独立した根拠数には数えません。'):'')+
      (z.matches.length?p('現在の近接水準：'+z.matches.slice(0,4).map(x=>x.label+' '+formatPrice(x.price)).join(' / ')+'。近接で帯や撤回境界を広げません。'):'')+'</section>').join('');
    return '<h3>反転が起きるか観察する帯</h3>'+p(`確認 ${date(c.observedAt)} / 15分基準 ${date(c.priceClosedAt)}。チャート上部の「反転帯」で表示を切替。`)+cards+(cards?'':p('現在の確定足から有効な反転観察帯を確認できません。'))+
      `<details data-reversal-history ${expanded?'open':''}><summary>流動性の参照点・撤回履歴</summary>`+c.references.map(r=>p(r.label+' '+formatPrice(r.price)+' / 確認 '+date(r.confirmedAt))).join('')+
      (c.overlapping||[]).map(z=>p(`重複する以前の掃い ${z.frame} ${formatPrice(z.low)}～${formatPrice(z.high)} / 確認 ${date(z.formedAt)}。元の幅を保持して履歴へ分離。`)).join('')+
      c.retired.map(z=>p(`${z.frame} ${title(z)} ${formatPrice(z.low)}～${formatPrice(z.high)}：${z.withdrawnAt?'終値で撤回 '+date(z.withdrawnAt):z.filledAt?'FVG全充足 '+date(z.filledAt):'観察期限終了'}。再開・拡張しません。`)).join('')+p(c.historyNote)+'</details><small>'+esc(c.note)+'</small>';
  }
  return {VERSION,describe,lines,html};
});
