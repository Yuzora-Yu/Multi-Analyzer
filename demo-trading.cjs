'use strict';

// Forward-only fictional accounts. This module has no network, order or mail API.
const BAR = 15 * 60000;
const PROTOCOL = Object.freeze({version:'demo-v1',initialEquity:10000,riskPct:0.25,
  maxLeverage:3,costBps:7,sensitivityBps:[7,14,21],holdBars:32,minNetRR:1.8,
  sourceMaxAgeMs:120000,publicationLeadMs:60000,cooldownBars:2,
  entry:'future-15m-open',ambiguity:'stop-first',stopManagement:'fixed',
  clockBasis:'worker-wall-clock-exchange-offset-unmeasured',
  drawdownBasis:'observed-confirmed-close-and-exit-equity',
  goldClosure:'exit-at-last-observed-close-before-collection-pause'});
const PERSONAS = Object.freeze([
  {id:'trend',label:'順張り担当'}, {id:'reversion',label:'反発担当'},
  {id:'confirmation',label:'確認担当'}, {id:'baseline',label:'P条件・未来始値'}
]);
const clone = value => JSON.parse(JSON.stringify(value));
const sign = direction => direction==='LONG'?1:-1;
const n = value => Number.isFinite(value);
const eventSide = direction => direction==='LONG'?'bull':'bear';
const validBar = b => b && [b.time,b.open,b.high,b.low,b.close].every(n) && b.time%BAR===0 &&
  b.low>0 && b.low<=Math.min(b.open,b.close) && b.high>=Math.max(b.open,b.close);

function create(asset,registeredAt,engineVersion) {
  if(!['gold','btc'].includes(asset)||!n(registeredAt))throw new Error('DEMO_INVALID_REGISTRATION');
  return {schemaVersion:1,protocol:clone(PROTOCOL),asset,market:asset==='gold'?'futures':'spot',
    symbol:asset==='gold'?'XAUUSDT':'BTCUSDT',engineVersion,registeredAt,updatedAt:registeredAt,
    lastSnapshotId:null,lastClosedAt:null,status:'WAITING',sequence:0,chain:null,
    validationStart:Math.ceil((registeredAt+86400000)/BAR)*BAR,
    validationEnd:Math.ceil((registeredAt+86400000)/BAR)*BAR+84*86400000,
    coverage:{decisions:0,missingBars:0,delayedDecisions:0},
    books:PERSONAS.map(p=>({...p,equity:PROTOCOL.initialEquity,realizedNet:0,grossPnl:0,costs:0,
      netByCost:{7:0,14:0,21:0},closed:0,wins:0,losses:0,profitSum:0,lossSum:0,
      peakEquity:PROTOCOL.initialEquity,maxDrawdown:0,maxDrawdownPct:0,
      markedEquity:PROTOCOL.initialEquity,unrealizedGross:0,skipped:0,unfilled:0,incomplete:0,
      pending:null,position:null,watch:null,halted:false,cooldownUntil:0,lastEvaluatedAt:null,
      recentTrades:[],selectedZones:{},lastDecision:{action:'WAIT',reason:'登録後の新しい確定足を待っています',at:registeredAt}}))};
}

function decision(book,action,reason,at,snapshotId,details) {
  book.lastDecision={action,reason,at,snapshotId,...(details||{})};
}
function mark(book,price) {
  if(book.halted){book.markedEquity=null;book.unrealizedGross=null;return;}
  const p=book.position;
  book.unrealizedGross=p?(price-p.entry)*sign(p.direction)*p.quantity:0;
  const assumedCost=p?p.quantity*(p.entry+price)*PROTOCOL.costBps/20000:0;
  book.markedEquity=book.equity+book.unrealizedGross-assumedCost;
  book.peakEquity=Math.max(book.peakEquity,book.markedEquity);
  const dd=book.peakEquity-book.markedEquity;
  book.maxDrawdown=Math.max(book.maxDrawdown,dd);
  book.maxDrawdownPct=Math.max(book.maxDrawdownPct,dd/book.peakEquity*100);
}
function close(book,price,bar,reason,receivedAt,events) {
  const p=book.position;
  const grossPnl=(price-p.entry)*sign(p.direction)*p.quantity;
  const turnover=p.quantity*(p.entry+price);
  const costs=turnover*PROTOCOL.costBps/20000;
  const netPnl=grossPnl-costs;
  const netByCost=Object.fromEntries(PROTOCOL.sensitivityBps.map(b=>[b,grossPnl-turnover*b/20000]));
  const trade={...p,exit:price,closedAt:bar.time+BAR,outcomeBarAt:bar.time,
    outcomeReceivedAt:receivedAt,reason,status:'CLOSED',grossPnl,costs,netPnl,netByCost,
    pnlR:netPnl/p.riskBudget,timePrecision:'exit-within-15m-bar',
    costModel:'assumed-per-side-on-entry-and-exit-notional'};
  book.grossPnl+=grossPnl;book.costs+=costs;book.realizedNet+=netPnl;book.equity+=netPnl;
  for(const b of PROTOCOL.sensitivityBps)book.netByCost[b]+=netByCost[b];
  book.closed++;if(netPnl>0){book.wins++;book.profitSum+=netPnl;}else if(netPnl<0){book.losses++;book.lossSum-=netPnl;}
  book.recentTrades.unshift(trade);book.recentTrades=book.recentTrades.slice(0,12);
  book.position=null;book.watch=null;book.cooldownUntil=bar.time+BAR*(1+PROTOCOL.cooldownBars);
  decision(book,'CLOSED',reason,receivedAt,p.snapshotId);events.push({book:book.id,type:'CLOSED',trade});
  mark(book,price);
}
function noFill(book,reason,now,events) {
  const plan=book.pending;book.pending=null;book.unfilled++;
  decision(book,'NO_FILL',reason,now,plan?.snapshotId);
  events.push({book:book.id,type:'NO_FILL',reason,plan,receivedAt:now});
}
function incomplete(book,reason,now,events) {
  const unresolved={pending:book.pending,position:book.position};
  book.unresolved=unresolved;book.pending=null;book.position=null;book.watch=null;
  book.halted=true;book.incomplete++;mark(book,0);
  decision(book,'INCOMPLETE',reason,now,unresolved.pending?.snapshotId||unresolved.position?.snapshotId);
  events.push({book:book.id,type:'INCOMPLETE',reason,unresolved,receivedAt:now});
}
function fill(book,bar,now,events) {
  const plan=book.pending;
  if(!n(plan.durableAt)||plan.durableAt+PROTOCOL.publicationLeadMs>plan.entryAfter){
    noFill(book,'入口前の永続保存が確認できないため未約定',now,events);return;
  }
  const s=sign(plan.direction),risk=(bar.open-plan.stop)*s,reward=(plan.target-bar.open)*s;
  const riskCosts=(bar.open+plan.stop)*PROTOCOL.costBps/20000;
  const rewardCosts=(bar.open+plan.target)*PROTOCOL.costBps/20000;
  const guard=plan.entryGuard;
  const guardFail=guard&&(Math.abs(bar.open-plan.reference)>guard.maxGapAtr*guard.atr||
    (n(guard.bbLow)&&bar.open<guard.bbLow)||(n(guard.bbHigh)&&bar.open>guard.bbHigh)||
    (guard.rrBps&&(reward-(bar.open+plan.target)*guard.rrBps/20000)/(risk+(bar.open+plan.stop)*guard.rrBps/20000)<PROTOCOL.minNetRR));
  if(guardFail||risk<=0||reward<=0||(reward-rewardCosts)/(risk+riskCosts)<PROTOCOL.minNetRR){
    noFill(book,'未来始値が固定SL・TPまたは費用込みRR条件を満たさないため未約定',now,events);return;
  }
  const riskEquity=Math.min(...PROTOCOL.sensitivityBps.map(b=>PROTOCOL.initialEquity+book.netByCost[b]));
  const riskBudget=riskEquity*PROTOCOL.riskPct/100;
  const worstCost=(bar.open+plan.stop)*21/20000;
  const quantity=Math.min(riskBudget/(risk+worstCost),riskEquity*PROTOCOL.maxLeverage/bar.open);
  if(!(quantity>0)){noFill(book,'仮想資金不足のため未約定',now,events);return;}
  book.position={...plan,entry:bar.open,quantity,riskBudget,openedAt:bar.time,fillObservedAt:now,
    hypothetical:true,heldBars:0,riskEquity};book.pending=null;
  events.push({book:book.id,type:'FILLED',position:clone(book.position),receivedAt:now});
}
function outcomes(lab,bars,now,allowed,events) {
  for(const book of lab.books) {
    if(book.halted)continue;
    if(!book.pending&&!book.position){book.lastEvaluatedAt=bars.at(-1).time;continue;}
    let expected=book.position?book.lastEvaluatedAt+BAR:book.pending.entryAfter;
    for(const bar of bars.filter(b=>b.time>=expected)) {
      if(bar.time!==expected){incomplete(book,'価格足が欠けているため約定・損益を確定できません',now,events);break;}
      if(!allowed(bar.time+1)||!allowed(bar.time+BAR-1)) {
        incomplete(book,'収集休止を跨いだため保有結果は未評価です',now,events);break;
      }
      if(book.pending)fill(book,bar,now,events);
      if(book.position) {
        const p=book.position,s=sign(p.direction);
        const stopGap=(bar.open-p.stop)*s<=0,targetGap=(bar.open-p.target)*s>=0;
        const stopHit=p.direction==='LONG'?bar.low<=p.stop:bar.high>=p.stop;
        const targetHit=p.direction==='LONG'?bar.high>=p.target:bar.low<=p.target;
        p.heldBars++;
        if(stopGap)close(book,bar.open,bar,'SL・不利な始値ギャップ',now,events);
        else if(targetGap)close(book,p.target,bar,'固定TP・有利なギャップは上乗せしません',now,events);
        else if(stopHit)close(book,p.stop,bar,targetHit?'SL・同一足の両側到達はSL先':'固定SL',now,events);
        else if(targetHit)close(book,p.target,bar,'固定TP',now,events);
        else if(p.heldBars>=PROTOCOL.holdBars)close(book,bar.close,bar,'32本の保有期限',now,events);
        else if(!allowed(bar.time+BAR*2+1))close(book,bar.close,bar,'既知の収集休止前に退出',now,events);
        else {mark(book,bar.close);decision(book,'HOLD','固定SL・TPを維持して保有中',now,p.snapshotId);}
      }
      book.lastEvaluatedAt=bar.time;expected=bar.time+BAR;
      if(!book.pending&&!book.position)break;
    }
  }
}

function proposal(book,analysis,now,snapshotId,reason,stop,target,direction,evidence) {
  const reference=analysis.exec.values.close;
  const s=sign(direction),risk=(reference-stop)*s,reward=(target-reference)*s;
  if(![reference,stop,target].every(n)||stop<=0||target<=0||risk<=0||reward<=0||
    (reward-(reference+target)*7/20000)/(risk+(reference+stop)*7/20000)<PROTOCOL.minNetRR)return null;
  const entryAfter=Math.ceil((now+PROTOCOL.publicationLeadMs)/BAR)*BAR;
  return {id:snapshotId+':'+book.id,direction,reference,stop,target,reason,evidence,
    snapshotId,decisionBarAt:analysis.exec.candles.at(-1).time,
    decisionClosedAt:analysis.exec.candles.at(-1).time+BAR,decisionReceivedAt:now,
    entryAfter,durableAt:null,protocolVersion:PROTOCOL.version,engineVersion:analysis.version};
}

function advance(previous,snapshot,analysis,now,allowed=()=>true) {
  let lab=previous?clone(previous):create(snapshot.asset,now,snapshot.version);
  if(lab.protocol.version!==PROTOCOL.version||lab.asset!==snapshot.asset||lab.engineVersion!==snapshot.version)
    throw new Error('DEMO_IDENTITY_MISMATCH');
  if(lab.lastSnapshotId===snapshot.id)return {lab,record:null};
  const bars=analysis.exec.candles;
  if(!bars.length||!bars.every(validBar)||bars.some((b,i)=>i&&b.time<=bars[i-1].time))throw new Error('DEMO_INVALID_BARS');
  const last=bars.at(-1),closedAt=last.time+BAR;
  if(closedAt>now||snapshot.createdAt>now||analysis.version!==snapshot.version)throw new Error('DEMO_FUTURE_SOURCE');
  if(lab.lastClosedAt&&closedAt<=lab.lastClosedAt)throw new Error('DEMO_NON_MONOTONIC_SOURCE');
  const events=[];
  const first=!lab.lastSnapshotId;
  const missing=lab.lastClosedAt?Math.max(0,(closedAt-lab.lastClosedAt)/BAR-1):0;
  if(missing) {
    let expectedMissing=0;
    for(let t=lab.lastClosedAt;t<last.time;t+=BAR)if(allowed(t+1)&&allowed(t+BAR-1))expectedMissing++;
    lab.coverage.missingBars+=expectedMissing;
    for(const book of lab.books)book.watch=null; // Missing decisions cannot complete a multi-step setup.
  }
  if(!first)outcomes(lab,bars,now,allowed,events);
  const fresh=closedAt>lab.registeredAt && snapshot.createdAt>=lab.registeredAt &&
    now-closedAt<=PROTOCOL.sourceMaxAgeMs && now>=snapshot.createdAt;
  if(!fresh)lab.coverage.delayedDecisions++;
  const quality=analysis.marketMap?.valid && analysis.exec.intervalMinutes===15 &&
    [analysis.exec,analysis.h1,analysis.h4].every(tf=>tf?.ready&&!tf.quality?.stale&&tf.quality?.gaps===0&&
      tf.candles.at(-1).time+tf.intervalMinutes*60000<=closedAt);
  for(const book of lab.books) {
    if(book.halted||book.position||book.pending)continue;
    let reason;
    if(!fresh)reason=first?'登録前の足は成績に含めず、次の新しい確定足を待機':'確定から120秒超の新規判断は見送り';
    else if(!quality)reason='確定足または上位足のデータ品質不足';
    else if(analysis.marketMap.eventRisk?.blocked)reason='確認済みの指標警戒時間のため見送り';
    else if(!allowed(now)||!allowed(Math.ceil((now+60000)/BAR)*BAR+BAR+1))reason='収集休止を跨ぐ新規入口は見送り';
    else if(last.time<book.cooldownUntil)reason='退出後2本は新規入場を待機';
    else if(!(book.equity>0))reason='仮想資金不足のため停止';
    if(reason) {book.skipped++;book.watch=null;decision(book,'WAIT',reason,now,snapshot.id);continue;}
    const result=strategy(book,analysis,now,snapshot.id);
    if(result.plan) {
      book.pending=result.plan;book.watch=null;
      decision(book,'PENDING',result.plan.reason,now,snapshot.id);
      events.push({book:book.id,type:'PROPOSED',plan:clone(result.plan)});
    }else {book.skipped++;decision(book,'WAIT',result.reason,now,snapshot.id);}
  }
  lab.coverage.decisions++;lab.updatedAt=now;lab.lastSnapshotId=snapshot.id;lab.lastClosedAt=closedAt;
  lab.status=closedAt<=lab.registeredAt?'WAITING':'ACTIVE';
  return {lab,record:{kind:'OBSERVATION',snapshotId:snapshot.id,engineVersion:snapshot.version,
    protocolVersion:PROTOCOL.version,sourceCreatedAt:snapshot.createdAt,closedAt,receivedAt:now,
    freshDecision:fresh,events,decisions:lab.books.map(b=>({book:b.id,...clone(b.lastDecision),watch:clone(b.watch)}))}};
}

function acknowledge(previous,snapshotId,durableAt) {
  const lab=clone(previous),events=[];
  if(!n(durableAt)||durableAt<lab.updatedAt)throw new Error('DEMO_CLOCK_REVERSAL');
  for(const book of lab.books)if(book.pending?.snapshotId===snapshotId&&book.pending.durableAt==null) {
    if(durableAt+PROTOCOL.publicationLeadMs>book.pending.entryAfter)noFill(book,'保存完了が未来入口に間に合わず未約定',durableAt,events);
    else {book.pending.durableAt=durableAt;events.push({book:book.id,type:'PUBLISHED',plan:clone(book.pending)});}
  }
  for(const book of lab.books)if(book.watch?.publicationSnapshotId===snapshotId&&book.watch.referenceDurableAt==null){
    if(book.watch.durableAt==null)book.watch.durableAt=durableAt;
    book.watch.referenceDurableAt=durableAt;events.push({book:book.id,type:'WATCH_PUBLISHED',watch:clone(book.watch)});
  }
  if(!events.length)return {lab,record:null};
  lab.updatedAt=Math.max(lab.updatedAt,durableAt);
  return {lab,record:{kind:'PUBLICATION',snapshotId,receivedAt:durableAt,events}};
}

// Strategy implementations consume only the current confirmed analysis and previously saved watch state.
function strategy(book,a,now,id) {
  if(book.id==='baseline')return a.actionable&&a.plan?
    {plan:proposal(book,a,now,id,'既存P条件成立・未来始値を待機',a.plan.stop,a.plan.tp2,a.direction,{pState:a.state,orderType:a.plan.orderType})}:
    {reason:'既存Pの確定入場条件を待っています'};
  const b=a.exec.candles.at(-1),v=a.exec.values,f=a.exec.flow?.latest,
    mid=a.exec.series?.bb?.mid?.at(-1),atr=v.atr;
  if(!n(atr)||atr<=0||!n(mid)||!f?.setup?.ready)return {reason:'MA・BB・リボンの確定値不足'};
  if(book.id==='trend')return trendStrategy(book,a,now,id);
  if(book.id==='reversion')return reversionStrategy(book,a,now,id);
  if(book.id==='confirmation')return confirmationStrategy(book,a,now,id);
  return {reason:'登録された担当条件がありません'};
}

function sameHTF(a,direction) {
  const side=eventSide(direction);
  return [a.h1.trend,a.h4.trend,a.h1.structure?.trend,a.h4.structure?.trend].every(t=>t===side);
}
function pickZone(book,a,frame,direction,untouched=true) {
  const tf=frame==='1H'?a.h1:a.exec,s=sign(direction),price=a.exec.values.close;
  const candidates=(tf.smc?.zones||[]).filter(z=>z.status==='active'&&['OB','FVG'].includes(z.type)&&
    z.side===eventSide(direction)&&[z.low,z.high,z.time].every(n)&&z.low>0&&z.low<z.high&&
    (!untouched||z.touchedAt==null)&&z.time+tf.intervalMinutes*60000<=a.exec.candles.at(-1).time+BAR&&
    (s>0?z.high<price:z.low>price)&&z.time>(book.selectedZones[frame+z.type+z.side]??-Infinity));
  candidates.sort((x,y)=>Math.abs(price-(s>0?x.high:x.low))-Math.abs(price-(s>0?y.high:y.low))||y.time-x.time||x.type.localeCompare(y.type));
  const zone=candidates[0];if(!zone)return null;
  book.selectedZones[frame+zone.type+zone.side]=zone.time;
  return {...zone,frame,direction};
}
function armZone(book,a,now,id,zone,ttl) {
  const atr=a.exec.values.atr;
  book.watch={kind:'zone',zone:clone(zone),direction:zone.direction,atr,
    stop:zone.direction==='LONG'?zone.low-atr*.25:zone.high+atr*.25,
    armBarAt:a.exec.candles.at(-1).time,expiresAt:a.exec.candles.at(-1).time+BAR*ttl,
    snapshotId:id,durableAt:null,publicationSnapshotId:id,referenceDurableAt:null,
    touch:null,touches:0,separated:true,departureCount:0};
}
function watchInvalid(book,b,now) {
  const w=book.watch;if(!w)return false;
  const s=sign(w.direction),z=w.zone;
  const stopHit=s>0?b.low<=w.stop:b.high>=w.stop;
  const zoneBreak=z&&(s>0?b.close<z.low:b.close>z.high);
  const filled=z?.type==='FVG'&&(s>0?b.low<=z.low:b.high>=z.high);
  if(b.time>w.expiresAt||stopHit||zoneBreak||filled){book.watch=null;return true;}
  return false;
}
function fullFuture(w,b){return n(w.referenceDurableAt)&&b.time>=w.referenceDurableAt&&b.time>w.armBarAt;}
function transition(w,id){w.publicationSnapshotId=id;w.referenceDurableAt=null;}
function obstacleBefore(a,direction,price,target) {
  const s=sign(direction);
  const levels=[a.h1,a.h4].flatMap(tf=>[
    ...(s>0?(tf.swings?.highs||[]):(tf.swings?.lows||[])).map(x=>x.price),
    ...(tf.smc?.zones||[]).filter(z=>z.status==='active'&&z.side!==eventSide(direction)).map(z=>s>0?z.low:z.high)
  ]).filter(n);
  return levels.some(p=>(p-price)*s>0&&(target-p)*s>=0);
}
function trendStrategy(book,a,now,id) {
  const b=a.exec.candles.at(-1),f=a.exec.flow.latest,v=a.exec.values;
  const direction=sameHTF(a,'LONG')?'LONG':sameHTF(a,'SHORT')?'SHORT':null;
  if(!direction||v.adx<20||v.atrRank>.96||f.direction!==sign(direction)||f.ribbon!==sign(direction)||!f.setup.intact){
    book.watch=null;return {reason:'4H・1Hの構造とMA、M15リボンの方向一致を待っています'};
  }
  if(!book.watch){
    const z=pickZone(book,a,'1H',direction);
    if(!z)return {reason:'同方向の未再訪H1 OB・FVGを待っています'};
    armZone(book,a,now,id,z,8);return {reason:'H1の帯とSLを固定し、保存後の新しい再訪を待機'};
  }
  const w=book.watch;
  if(w.direction!==direction){book.watch=null;return {reason:'固定帯の上位足方向が崩れたため撤回'};}
  if(watchInvalid(book,b,now))return {reason:'固定帯の無効化・SL訪問・期限切れで撤回'};
  if(!fullFuture(w,b))return {reason:'帯の保存後に始まる完全な未来足を待機'};
  const z=w.zone,s=sign(direction),touch=b.low<=z.high&&b.high>=z.low;
  if(touch&&!w.touch){w.touch={time:b.time,high:b.high,low:b.low};transition(w,id);return {reason:'初回再訪を確認・後続のEMA回復を待機'};}
  if(!w.touch)return {reason:'固定したH1帯への再訪待ち'};
  if(b.time>w.touch.time+BAR*4){book.watch=null;return {reason:'再訪後4本で回復せず撤回'};}
  const previous=a.exec.candles.at(-2),lines=a.exec.flow.lines,rows=a.exec.candles;
  const qualifying=rows.slice(-5,-1).some((row,j)=>{
    const i=rows.length-5+j,e13=lines?.[13]?.[i],e21=lines?.[21]?.[i];
    return row.time>=w.touch.time&&row.low<=z.high&&row.high>=z.low&&e21>=z.low&&e21<=z.high&&
      (s>0?row.low<=e21&&row.close<e13:row.high>=e21&&row.close>e13);
  });
  const mid=a.exec.series.bb.mid.at(-1),reclaimed=s>0?
    previous.close<=lines[13].at(-2)&&b.close>f.setup.ema13&&b.close>z.high&&b.close>b.open&&b.close>=mid&&b.close<v.bbUpper:
    previous.close>=lines[13].at(-2)&&b.close<f.setup.ema13&&b.close<z.low&&b.close<b.open&&b.close<=mid&&b.close>v.bbLower;
  if(b.time<=w.touch.time||!qualifying||!reclaimed||!f.aligned||f.switched||!f.setup.continuation||!f.setup.touched||!f.setup.reclaim)
    return {reason:'再訪後のEMA13回復・リボン・BB位置の確認待ち'};
  const target=b.close+s*Math.abs(b.close-w.stop)*2;
  if(obstacleBefore(a,direction,b.close,target)){book.watch=null;return {reason:'固定TPまでに上位足の障害があるため見送り'};}
  const plan=proposal(book,a,now,id,'上位足順張り・H1帯再訪後のEMA回復',w.stop,target,direction,{zone:z,touch:w.touch,bbMid:mid});
  if(plan)plan.entryGuard={maxGapAtr:.25,atr:v.atr,bbLow:s>0?mid:v.bbLower,bbHigh:s>0?v.bbUpper:mid};
  return {plan,reason:'固定SL・TPの条件不足'};
}

function reversionStrategy(book,a,now,id) {
  const b=a.exec.candles.at(-1),v=a.exec.values,mid=a.exec.series.bb.mid.at(-1);
  const events=(a.exec.smc?.events||[]).filter(e=>e.time===b.time);
  const opposed=direction=>[a.h1,a.h4].some(tf=>tf.trend===eventSide(direction==='LONG'?'SHORT':'LONG')&&
    tf.values.adx>=25&&(direction==='LONG'?tf.values.emaSlope<=-.18:tf.values.emaSlope>=.18));
  const insideOpposite=direction=>[a.exec,a.h1,a.h4].some(tf=>(tf.smc?.zones||[]).some(z=>
    z.status==='active'&&z.side!==eventSide(direction)&&b.close>=z.low&&b.close<=z.high));
  if(v.atrRank>=.92){book.watch=null;return {reason:'極端なボラティリティで反発狙いを見送り'};}
  if(!book.watch){
    const sweeps=events.filter(e=>e.type==='SWEEP'&&n(e.price));
    if(new Set(sweeps.map(e=>e.side)).size>1)return {reason:'両方向のスイープが同時に出たため見送り'};
    const prev=a.exec.candles.at(-2),bb=a.exec.series.bb;
    const sweep=sweeps.find(e=>b.close>=v.bbLower&&b.close<=v.bbUpper&&(e.side==='bull'?
      prev.close<bb.lower.at(-2)&&b.low<e.price&&b.close>e.price&&b.close<Math.min(v.ema20,v.ema50,mid):
      prev.close>bb.upper.at(-2)&&b.high>e.price&&b.close<e.price&&b.close>Math.max(v.ema20,v.ema50,mid)));
    if(!sweep)return {reason:'流動性スイープとBB外帯からの復帰待ち'};
    const direction=sweep.side==='bull'?'LONG':'SHORT',s=sign(direction);
    if(opposed(direction)||insideOpposite(direction))return {reason:'強い対向トレンドまたは反対SMC帯内のため見送り'};
    const mean=s>0?Math.min(v.ema20,v.ema50,mid):Math.max(v.ema20,v.ema50,mid);
    const obstacles=[a.exec,a.h1,a.h4].flatMap(tf=>(tf.smc?.zones||[]).filter(z=>
      z.status==='active'&&z.side!==sweep.side&&(s>0?z.low>b.close:z.high<b.close)).map(z=>s>0?z.low:z.high));
    const target=s>0?Math.min(mean,...obstacles):Math.max(mean,...obstacles);
    book.watch={kind:'sweep',direction,stop:s>0?b.low-v.atr*.15:b.high+v.atr*.15,target,
      sweep:clone(sweep),sweepHigh:b.high,sweepLow:b.low,sweepClose:b.close,armBarAt:b.time,expiresAt:b.time+BAR*4,
      snapshotId:id,durableAt:null,publicationSnapshotId:id,referenceDurableAt:null};
    return {reason:'スイープとSLを固定・後続M15構造確認待ち'};
  }
  const w=book.watch,s=sign(w.direction);
  if(watchInvalid(book,b,now))return {reason:'スイープのSL訪問・期限切れで撤回'};
  if((s>0?b.high>=w.target||b.close<=w.sweep.price||b.close<v.bbLower:
    b.low<=w.target||b.close>=w.sweep.price||b.close>v.bbUpper)||opposed(w.direction)||insideOpposite(w.direction)){
    book.watch=null;return {reason:'固定目標到達・スイープ無効化・対向圧力で反発待機を撤回'};
  }
  if(!fullFuture(w,b))return {reason:'スイープ保存後に始まる未来足を待機'};
  const structure=events.find(e=>['BOS','CHoCH'].includes(e.type)&&e.side===eventSide(w.direction));
  const confirmed=s>0?b.close>w.sweepClose&&b.close>w.sweep.price&&b.close>=v.bbLower&&b.close<Math.min(v.ema20,v.ema50,mid):
    b.close<w.sweepClose&&b.close<w.sweep.price&&b.close<=v.bbUpper&&b.close>Math.max(v.ema20,v.ema50,mid);
  if(!structure||!confirmed)return {reason:'後続M15構造ブレイクとMA回復、BB中央までの余地を待機'};
  const plan=proposal(book,a,now,id,'スイープ後の構造確認・先に固定したMA目標への反発',w.stop,w.target,w.direction,{sweep:w.sweep,structure});
  if(plan)plan.entryGuard={maxGapAtr:.25,atr:v.atr};else book.watch=null;
  return {plan,reason:'反発幅と固定SLの費用込みRR不足で見送り'};
}

function confirmationStrategy(book,a,now,id) {
  const b=a.exec.candles.at(-1),v=a.exec.values,f=a.exec.flow.latest;
  if(!book.watch){
    const direction=a.htfBias==='bull'?'LONG':a.htfBias==='bear'?'SHORT':null;
    if(!direction||[a.h1,a.h4].some(tf=>!tf.structure?.trend||tf.structure.trend===eventSide(direction==='LONG'?'SHORT':'LONG')))
      return {reason:'1H・4HのMA一致と構造の確認待ち'};
    const zone=(a.marketMap.candidates||[]).find(z=>['1H','4H'].includes(z.frame)&&z.type==='OB'&&z.direction===direction&&
      [z.low,z.high,z.time,z.protectiveStop,z.targets?.[0]].every(n)&&z.time>(book.selectedZones[z.frame+z.type+eventSide(direction)]??-Infinity));
    if(!zone)return {reason:'固定目標のある上位足OBを待っています'};
    book.selectedZones[zone.frame+zone.type+eventSide(direction)]=zone.time;
    armZone(book,a,now,id,zone,16);book.watch.stop=zone.protectiveStop;book.watch.target=zone.targets[0];
    book.watch.stage='TOUCH1_WAIT';return {reason:'上位足OB・SL・最初の目標を固定し二度の再訪を待機'};
  }
  const w=book.watch,s=sign(w.direction),z=w.zone;
  if(watchInvalid(book,b,now))return {reason:'固定帯の終値無効化・SL訪問・期限切れで撤回'};
  if(a.htfBias!==eventSide(w.direction)||(s>0?b.high>=w.target:b.low<=w.target)){
    book.watch=null;return {reason:'上位MAの方向変化または固定目標到達で待機を撤回'};
  }
  if(!fullFuture(w,b))return {reason:'帯の保存後に始まる未来足を待機'};
  const touch=b.low<=z.high&&b.high>=z.low;
  if(w.stage==='TOUCH1_WAIT'&&touch){
    w.touches=1;w.touch1={time:b.time,high:b.high,low:b.low};w.stage='DEPARTURE_WAIT';transition(w,id);
    return {reason:'初回再訪を保存・帯から完全に離れた2本を待機'};
  }
  if(w.stage==='DEPARTURE_WAIT'){
    const departed=s>0?b.low>z.high+w.atr*.25:b.high<z.low-w.atr*.25;
    w.departureCount=departed&&(w.departureBarAt==null||b.time===w.departureBarAt+BAR)?w.departureCount+1:departed?1:0;
    w.departureBarAt=b.time;
    if(w.departureCount>=2){w.stage='TOUCH2_WAIT';transition(w,id);return {reason:'2本の完全な離脱を保存・二度目の再訪待ち'};}
    return {reason:'帯の外側0.25ATR以上へ完全に離れた2本を待機'};
  }
  if(w.stage==='TOUCH2_WAIT'&&touch){
    w.touches=2;w.touch={time:b.time,high:b.high,low:b.low};w.stage='CONFIRM_WAIT';
    w.pivot=s>0?Math.max(z.high,w.touch1.high,b.high):Math.min(z.low,w.touch1.low,b.low);transition(w,id);
    return {reason:'二度目の再訪と反応高安を保存・後続の突破待ち'};
  }
  if(w.stage!=='CONFIRM_WAIT')return {reason:'完全な離脱後の二度目の再訪待ち'};
  const confirmed=b.time>w.touch.time&&(s>0?
    b.close>w.pivot&&b.close>b.open&&b.close>v.ema20:
    b.close<w.pivot&&b.close<b.open&&b.close<v.ema20)&&f.ribbon===s;
  if(!confirmed)return {reason:'二度目の再訪後、反応高安の突破・EMA20・リボン確認待ち'};
  const plan=proposal(book,a,now,id,'二度目の独立再訪後の壁・MA確認',w.stop,w.target,w.direction,{zone:z,touches:w.touches,touch:w.touch});
  if(plan)plan.entryGuard={maxGapAtr:.25,atr:w.atr,rrBps:21};
  return {plan,reason:'確認後の固定SL・TP条件不足'};
}

function publicView(lab,now,status='ACTIVE') {
  if(!lab)return {schemaVersion:1,protocol:clone(PROTOCOL),status:'NOT_STARTED',books:[]};
  const result=clone(lab);delete result.chain;
  result.status=['MARKET_CLOSED','DATA_ERROR'].includes(status)?status:lab.status;
  result.servedAt=now;
  for(const book of result.books){delete book.watch;delete book.peakEquity;delete book.cooldownUntil;delete book.selectedZones;}
  return result;
}
module.exports={BAR,PROTOCOL,PERSONAS,create,advance,acknowledge,publicView,proposal};
