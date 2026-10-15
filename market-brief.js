/* Read-only, current-context overlay. No new market requests or trade decisions. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./market-knowledge'):root.MultiAnalyzerMarketKnowledge,typeof module==='object'&&module.exports?require('./market-feed'):root.MultiAnalyzerFeed,typeof module==='object'&&module.exports?require('./trend-context'):root.MultiAnalyzerTrendContext);if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerMarketBrief=api;})(globalThis,function(K,Feed,Trend){
  'use strict';
  const VERSION='gold-session-brief-v1',STEP=900000,MINUTE=60000;
  const finiteTime=t=>Number.isSafeInteger(t)&&t>0&&Number.isFinite(new Date(t).getTime());
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const price=v=>Number.isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'未取得';
  const jst=t=>finiteTime(t)?new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' JST':'未確認';
  function localParts(t,zone){return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(t).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
  function localTime(t,zone,hour,minute=0,days=0){
    const p=localParts(t,zone),desired=Date.UTC(p.year,p.month-1,p.day+days,hour,minute),localDate=new Date(desired);
    let utc=desired;
    for(let i=0;i<3;i++){const q=localParts(utc,zone),seen=Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute,q.second);utc+=desired-seen;}
    return {time:utc,businessDay:localDate.getUTCDay()>0&&localDate.getUTCDay()<6};
  }
  function session(now){
    const london=localParts(now,'Europe/London'),ny=localParts(now,'America/New_York'),shanghai=localParts(now,'Asia/Shanghai');
    const inWindow=(p,start,end)=>p.hour+p.minute/60>=start&&p.hour+p.minute/60<end;
    const ld=inWindow(london,8,17),us=inWindow(ny,8,17),asia=inWindow(shanghai,8,16);
    const id=ld&&us?'OVERLAP':us?'NEW_YORK':ld?'LONDON':asia?'ASIA':'TRANSITION';
    return {id,label:({OVERLAP:'欧州・米国の参加時間',NEW_YORK:'米国の参加時間',LONDON:'欧州の参加時間',ASIA:'アジアの参加時間',TRANSITION:'セッション切替・夜間'})[id],
      note:'参加時間は分析用の区分。OTC金の一斉開場や売買方向を意味しません。各市場の休日特例は未照合。'};
  }
  function clockPoints(now){
    const definitions=[['sge-open','上海の日中取引開始','Asia/Shanghai',9,0,'sge-clock','制度時刻'],['london-watch','欧州参加の観察開始','Europe/London',8,0,'wgc-2026','分析上の観察時刻'],['lbma-am','LBMA AM値決め','Europe/London',10,30,'lbma-clock','制度時刻'],['ny-watch','米国参加の観察開始','America/New_York',8,0,'frb-news','分析上の観察時刻'],['lbma-pm','LBMA PM値決め','Europe/London',15,0,'lbma-clock','制度時刻']];
    return definitions.flatMap(([id,name,zone,h,m,source,kind])=>[0,1,2,3].map(days=>({...localTime(now,zone,h,m,days),id,name,zone,source,kind})).filter(x=>x.businessDay&&x.time>now)).sort((a,b)=>a.time-b.time).slice(0,4);
  }
  function eventStage(e,now){
    const minutes=(now-e.time)/MINUTE;
    if(minutes<0)return 'BEFORE';if(minutes<5)return 'IMPULSE';if(minutes<60)return 'FIRST_HOUR';if(minutes<240)return 'ASSIMILATION';
    // A JST date change inside the same US session is not the next session.
    let reopening=localTime(e.time,'America/New_York',18).time;
    if(reopening<=e.time)reopening=localTime(e.time,'America/New_York',18,0,1).time;
    return minutes<=36*60&&now>=reopening?'NEXT_SESSION':minutes<=24*60?'FOLLOW_THROUGH':'OLDER';
  }
  function eventAnchors(a,event,now){
    const tf=a?.m15;if(!Trend?.known(tf,a?.generatedAt)||tf.intervalMinutes!==15||!finiteTime(event?.time)||event.time%STEP!==0)return null;
    const bars=new Map(),conflicts=new Set();
    for(const b of tf.candles||[]){
      if(![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.time%STEP!==0||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.time+STEP>Math.min(now,a.generatedAt))continue;
      if(bars.has(b.time)&&['open','high','low','close'].some(k=>bars.get(b.time)[k]!==b[k]))conflicts.add(b.time);else bars.set(b.time,b);
    }
    const before=bars.get(event.time-STEP),hour=Array.from({length:4},(_,i)=>bars.get(event.time+i*STEP));
    if(!before||hour.some(b=>!b)||[before,...hour].some(b=>conflicts.has(b.time)))return null;
    return {eventId:event.id,basis:'Bybit XAUUSDT無期限・保存された15分確定足からの後日観察',availableAt:event.time+4*STEP,preClose:before.close,
      first15:{high:hour[0].high,low:hour[0].low,close:hour[0].close},firstHour:{high:Math.max(...hour.map(b=>b.high)),low:Math.min(...hour.map(b=>b.low)),close:hour[3].close},
      direction:hour[3].close>before.close?'UP':hour[3].close<before.close?'DOWN':'FLAT',note:'初動の観察水準。予測・約定・翌日の方向保証ではありません。'};
  }
  function asiaRange(a,now){
    const tf=a?.m15;if(!Trend?.known(tf,a?.generatedAt)||tf.intervalMinutes!==15)return null;
    const start=localTime(now,'Asia/Shanghai',9),end=localTime(now,'Asia/Shanghai',15,30).time;
    const through=Math.min(Math.floor(Math.min(now,a.generatedAt)/STEP)*STEP,end);
    if(!start.businessDay||through<=start.time)return null;
    const rows=new Map(),conflicts=new Set();
    for(const b of tf.candles||[]){
      if(![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.time%STEP||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||b.time<start.time||b.time+STEP>through)continue;
      if(rows.has(b.time)&&['open','high','low','close'].some(k=>rows.get(b.time)[k]!==b[k]))conflicts.add(b.time);else rows.set(b.time,b);
    }
    const bars=[];for(let t=start.time;t<through;t+=STEP){if(!rows.has(t)||conflicts.has(t))return null;bars.push(rows.get(t));}
    return {name:'上海日中の観察レンジ',source:'Bybit XAUUSDTの確定15分足。SGEの価格・出来高ではありません。',startAt:start.time,through,endAt:end,complete:through===end,
      high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),count:bars.length};
  }
  function describe(a,{asset,now=Date.now(),mode='live',health=null,snapshotId=null,zoneReviews=null,knowledge=K}={}){
    const base={version:VERSION,knowledgeVersion:knowledge?.version??null,observedAt:now,sourceId:snapshotId,available:false,actionable:false,scope:'CURRENT_CONTEXT_OVERLAY',plans:[],knowledge:knowledge?.principles||[],sources:knowledge?.sources||[]};
    if(asset!=='gold')return {...base,reason:'この背景モデルはGOLD用です。BTCへ金の時間帯仮説を流用しません。',knowledge:[],sources:[]};
    if(mode!=='live')return {...base,reason:'保存記録・CSVには当時の背景保存がないため、現在の知識・予定を当時の判断へ混ぜません。',knowledge:[],sources:[]};
    if(!finiteTime(now)||!knowledge||knowledge.reviewedAt>now)return {...base,reason:'この時点で確認済みの背景資料がありません。',knowledge:[],sources:[]};
    if(!Feed.collectionPolicy('gold',now).allowed)return {...base,reason:'GOLD休場・新しい背景付き候補の提示を停止しています。'};
    const m15=a?.m15,bar=m15?.candles?.at(-1),closedAt=bar?.time+STEP;
    if(health?.blocked||!Trend.known(m15,a?.generatedAt)||m15.intervalMinutes!==15||!finiteTime(a?.generatedAt)||a.generatedAt>now||now-a.generatedAt>20*MINUTE||!Number.isFinite(bar?.close)||bar.close<=0||bar.time%STEP!==0||!a.marketMap?.valid)
      return {...base,reason:'確定足・鮮度・共通判定の整合を確認できないため、新しい事前シナリオは保留です。'};
    const cal=knowledge.calendar,calendarFresh=finiteTime(cal?.verifiedAt)&&cal.verifiedAt<=now&&finiteTime(cal?.expiresAt)&&now<=cal.expiresAt;
    const events=calendarFresh?(cal.events||[]).filter(e=>finiteTime(e.time)&&finiteTime(e.knownAt)&&e.knownAt<=now).map(e=>({...e,result:e.time<=now&&e.result?.knownAt<=now?e.result:null,stage:eventStage(e,now)})):[];
    const upcoming=events.filter(e=>e.time>=now).sort((x,y)=>x.time-y.time)[0]||null;
    const previous=events.filter(e=>e.time<=now&&e.stage!=='OLDER').sort((x,y)=>y.time-x.time)[0]||null;
    const anchors=previous?eventAnchors(a,previous,now):null,range=asiaRange(a,now);
    const h4=Trend.known(a.h4,a.generatedAt)?a.h4:null,h1=Trend.known(a.h1,a.generatedAt)?a.h1:null;
    const upper=h4?.trend==='bear'&&h1?.structure?.trend==='bear'?'SHORT':h4?.trend==='bull'&&h1?.structure?.trend==='bull'?'LONG':null;
    const counter=upper==='SHORT'&&m15.trend==='bull'||upper==='LONG'&&m15.trend==='bear';
    const shockRecovered=Boolean(anchors&&(anchors.direction==='DOWN'?bar.close>=anchors.preClose:anchors.direction==='UP'?bar.close<=anchors.preClose:false));
    const eventOpposes=Boolean(shockRecovered&&previous?.stage==='NEXT_SESSION'&&((upper==='SHORT'&&anchors.direction==='DOWN')||(upper==='LONG'&&anchors.direction==='UP')));
    const preferred=eventOpposes?null:upper;
    const stance=eventOpposes?'指標初動の全戻し・上下を再評価':preferred==='SHORT'?'戻り売りを先に観察':preferred==='LONG'?'押し目買いを先に観察':'上下の候補を分けて観察';
    const references=[...(anchors?[{label:'指標前15分終値',price:anchors.preClose},{label:'初動15分高値',price:anchors.first15.high},{label:'初動15分安値',price:anchors.first15.low},{label:'初動1時間高値',price:anchors.firstHour.high},{label:'初動1時間安値',price:anchors.firstHour.low}]:[]),...(range?[{label:'上海日中の観察高値',price:range.high},{label:'上海日中の観察安値',price:range.low}]:[])];
    const plans=Array.isArray(zoneReviews)?['SHORT','LONG'].flatMap(direction=>{
      const candidates=zoneReviews.filter(r=>!r.withdrawal&&r.zone?.direction===direction&&[r.zone.low,r.zone.high,r.zone.invalidationClose,r.zone.protectiveStop].every(Number.isFinite)&&r.zone.low>0&&r.zone.high>=r.zone.low);
      candidates.sort((x,y)=>Math.max(x.zone.low-bar.close,bar.close-x.zone.high,0)-Math.max(y.zone.low-bar.close,bar.close-y.zone.high,0));
      const r=candidates[0];if(!r)return [];
      const radius=Number.isFinite(m15.values?.atr)&&m15.values.atr>0?m15.values.atr*.2:0;
      return [{direction,priority:preferred===direction?'主シナリオ':preferred?'反対シナリオ':'並列シナリオ',zone:structuredClone(r.zone),focus:structuredClone(r.focus??null),
        contextMatches:references.filter(x=>x.price+radius>=r.zone.low&&x.price-radius<=r.zone.high),
        context:upper===direction?'4H MAと1H構造を背景にした観察候補。':upper?'上位背景に対する短期反発・反対シナリオとして確認。':'上下の候補を並列に観察。',
        timing:'帯での拒否・回復と、1分/5分の直近高安の突破・再訪を確認。現在の短期足を未取得なら成立を主張しません。',
        note:'元の帯・確認条件・15分撤回境界・SL参考を引き継ぐ条件付きシナリオ。新規P成立や約定ではありません。'}];
    }):[];
    plans.sort((x,y)=>(x.priority==='主シナリオ'?-1:0)-(y.priority==='主シナリオ'?-1:0));
    const nearEvent=upcoming&&upcoming.time-now<=15*MINUTE||previous&&now-previous.time<=15*MINUTE;
    return {...base,available:true,reason:null,price:bar.close,priceClosedAt:closedAt,session:session(now),clocks:clockPoints(now),stance,preferredSide:preferred,
      technicalReason:upper?'4H MA '+(h4.trend==='bear'?'下向き':'上向き')+' / 1H構造 '+(h1.structure.trend==='bear'?'下向き':'上向き')+(counter?'。15分は反対方向で、帯での転換確認が必要。':'。同方向の帯を先に観察。'):'4H MAと1H構造に一方向の一致を確認できません。',
      calendar:{fresh:calendarFresh,verifiedAt:cal?.verifiedAt??null,expiresAt:cal?.expiresAt??null,coverage:'partial',note:calendarFresh?cal.note:'予定の確認期限切れ。掲載なしを指標なしと判断せず、最新予定を再照合。'},
      upcoming,previous,anchors,asiaRange:range,eventOpposes,shockRead:anchors?`初動1時間は${anchors.direction==='DOWN'?'下落':anchors.direction==='UP'?'上昇':'横ばい'}。現在の15分確定価格は発表前終値を${shockRecovered?'全戻し・通過':'全戻ししていない'}。これは値動きの観察で、原因や翌日の必然性は示しません。`:null,nearEvent:Boolean(nearEvent),plans,missing:knowledge.missing||[],
      macroConclusion:'金利・ドル・地政学の最新入力が揃っていないため、マクロによる方向の追認は保留。上の優先方向はテクニカルによる仮説です。',
      note:'背景確認時刻と15分判定時刻は別です。一般知識を出発点にした現在の事前シナリオで、元のP/EXIT・通知・デモ条件は変更しません。'};
  }
  const stageLabel=s=>({BEFORE:'発表前',IMPULSE:'発表直後',FIRST_HOUR:'初動1時間',ASSIMILATION:'初動後の消化',NEXT_SESSION:'翌セッションの再評価',FOLLOW_THROUGH:'発表後の継続・反転確認'})[s]||'過去の材料';
  function lines(b){
    if(!b)return [];if(!b.available)return ['時間帯・材料の事前シナリオ：'+b.reason];
    return [`時間帯・材料の事前シナリオ：${b.stance} / ${b.session.label}`,`背景確認 ${jst(b.observedAt)} / 15分確定 ${jst(b.priceClosedAt)} / Bybit ${price(b.price)}`,
      b.technicalReason,b.macroConclusion,b.upcoming?`次の掲載指標 ${jst(b.upcoming.time)} ${b.upcoming.name}（掲載予定は一部）`:'次の指標はこの背景記録では確認できません。',
      ...(b.previous?[`${b.previous.name} ${jst(b.previous.time)} / ${stageLabel(b.previous.stage)}`,b.previous.result?.text||'発表結果・予想差は背景記録に未収録。']:[]),
      ...(b.anchors?[`指標前15分終値 ${price(b.anchors.preClose)} / 初動15分 ${price(b.anchors.first15.low)}～${price(b.anchors.first15.high)} / 初動1時間 ${price(b.anchors.firstHour.low)}～${price(b.anchors.firstHour.high)}。${b.anchors.note}`]:[]),
      ...(b.shockRead?[b.shockRead]:[]),...(b.asiaRange?[`${b.asiaRange.name} ${price(b.asiaRange.low)}～${price(b.asiaRange.high)} / ${jst(b.asiaRange.startAt)}～${jst(b.asiaRange.through)} / ${b.asiaRange.complete?'区間完了':'進行中の確定部分'}。${b.asiaRange.source}`]:[]),
      ...b.plans.map(p=>`${p.priority} ${p.direction} ${price(p.zone.low)}～${price(p.zone.high)} / ${p.zone.condition} / 15分終値 ${price(p.zone.invalidationClose)}${p.direction==='SHORT'?'超':'未満'}で撤回 / SL参考 ${price(p.zone.protectiveStop)} / 元の反応候補 ${(p.zone.targets||[]).map(price).join(' / ')}`),
      ...b.plans.filter(p=>p.contextMatches?.length).map(p=>`${p.direction}帯と近接する時間帯・指標の参照水準：${p.contextMatches.map(r=>r.label+' '+price(r.price)).join(' / ')}。近接は入場条件や勝率ではありません。`),
      ...b.clocks.map(c=>`${jst(c.time)} ${c.name}（${c.kind}・現地休日の特例未照合）`),`予定確認 ${jst(b.calendar.verifiedAt)} / 期限 ${jst(b.calendar.expiresAt)} / ${b.calendar.note}`,
      `未取得・未照合：${b.missing.join(' / ')}`,b.note];
  }
  function html(b,{formatPrice=price,expanded=false}={}){
    const p=t=>`<p>${esc(t)}</p>`;if(!b?.available)return '<h3>時間帯・材料の事前シナリオ</h3>'+p(b?.reason||'背景を確認中');
    const source=id=>b.sources.find(s=>s.id===id),link=s=>s&&/^https:\/\//.test(s.url)?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`:'';
    const cards=b.plans.map(x=>{
      const levels=[...new Map((x.focus?.windows||[]).slice(0,2).flatMap(w=>w.levels||[]).map(r=>[r.label,r])).values()];
      return `<section class="brief-plan ${x.direction==='SHORT'?'zone-short':'zone-long'}"><h4>${esc(x.priority)}・${x.direction==='SHORT'?'戻り売り':'押し目・反発買い'} ${esc(formatPrice(x.zone.low))}～${esc(formatPrice(x.zone.high))}</h4>${p(x.zone.condition)}${levels.length?p('MA・BBの参照：'+levels.map(r=>r.label+' '+formatPrice(r.price)).join(' / ')):''}${x.contextMatches?.length?p('時間帯・指標の参照水準：'+x.contextMatches.map(r=>r.label+' '+formatPrice(r.price)).join(' / ')):''}${p(`撤回：15分終値 ${formatPrice(x.zone.invalidationClose)}${x.direction==='SHORT'?'超':'未満'} / SL参考 ${formatPrice(x.zone.protectiveStop)}`)}${p(`反応候補 ${(x.zone.targets||[]).map(formatPrice).join(' / ')||'未取得'}`)}<small>${esc(x.timing)}</small></section>`;
    }).join('');
    return '<h3>時間帯・材料の事前シナリオ</h3>'+`<p class="brief-stance"><strong>${esc(b.stance)}</strong><span>${esc(b.session.label)} / 条件付き仮説</span></p>`+
      p(`背景確認 ${jst(b.observedAt)} / 15分確定 ${jst(b.priceClosedAt)}。価格は候補帯と同じ基準。`)+p(b.technicalReason)+
      (b.nearEvent?p('指標直前・初動の観察時間。発表前の仮説をそのまま持ち越さず、結果・実スプレッド・短期足を再確認。'):'')+
      p(b.upcoming?`次の掲載指標 ${jst(b.upcoming.time)} ${b.upcoming.name}（一部予定）`:'次の指標はこの背景記録では未確認。')+
      (b.previous?p(`${b.previous.name}後：${stageLabel(b.previous.stage)}。指標前・初動の水準に対する拒否/回復を確認。`):'')+
      cards+(cards?'':p('撤回を除外した有効な元候補を確認できません。新しい価格帯は推定しません。'))+
      `<details ${expanded?'open':''}><summary>時間帯・指標後の水準・根拠を見る</summary>`+
      b.clocks.map(c=>p(`${jst(c.time)} ${c.name} / ${c.kind}`)).join('')+p(b.session.note)+
      (b.previous?.result?p(b.previous.result.text):'')+
      (b.shockRead?p(b.shockRead):'')+(b.asiaRange?p(`${b.asiaRange.name} ${formatPrice(b.asiaRange.low)}～${formatPrice(b.asiaRange.high)} / ${jst(b.asiaRange.startAt)}～${jst(b.asiaRange.through)} / ${b.asiaRange.complete?'区間完了':'進行中の確定部分'}。${b.asiaRange.source}`):'')+
      (b.anchors?p(`指標前 ${formatPrice(b.anchors.preClose)} / 初動15分 ${formatPrice(b.anchors.first15.low)}～${formatPrice(b.anchors.first15.high)} / 初動1時間 ${formatPrice(b.anchors.firstHour.low)}～${formatPrice(b.anchors.firstHour.high)}。${b.anchors.note}`):p('指標の初動1時間を覆う確定足を確認できません。初動高安を推定しません。'))+
      p(b.macroConclusion)+p(`未取得・未照合：${b.missing.join(' / ')}`)+p(`予定確認 ${jst(b.calendar.verifiedAt)} / 期限 ${jst(b.calendar.expiresAt)}。${b.calendar.note}`)+
      b.knowledge.map(k=>`<section class="brief-knowledge"><h4>${esc(k.title)} <small>${esc(k.evidence)}</small></h4>${p(k.finding)}${p(k.use)}${p(k.limit)}${k.sources.map(id=>link(source(id))).join(' / ')}</section>`).join('')+
      '</details><small>'+esc(b.note)+'</small>';
  }
  return {VERSION,localTime,session,clockPoints,eventStage,eventAnchors,asiaRange,describe,lines,html};
});
