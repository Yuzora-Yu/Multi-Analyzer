'use strict';

// Read-only audit of the monitor's fictional ledger. No price, order or mail API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const BAR = 900000, DAY = 86400000;
const COSTS = [7, 14, 21];
const BASE = 'https://multi-analyzer-monitor.rikai-829.workers.dev';
const ROOT = path.join(__dirname, '.runtime', 'demo-lab');
const numeric = x => Number.isFinite(x);
const hash = x => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const equal = (a, b) => numeric(a) && numeric(b) && Math.abs(a-b) <= 1e-8*Math.max(1, Math.abs(a), Math.abs(b));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const side = direction => direction === 'LONG' ? 1 : direction === 'SHORT' ? -1 : 0;
const recordHash = record => { const payload = {...record}; delete payload.hash; return hash(payload); };
const sourceAt = (sources, id) => sources instanceof Map ? sources.get(id) : sources?.[id];
const rows = source => (source?.bars?.m15 || []).map(b => Array.isArray(b)
  ? {time:b[0], open:b[1], high:b[2], low:b[3], close:b[4]} : b);

function fixedPlan(a, b) {
  return a && b && ['id','direction','reference','stop','target','snapshotId','decisionBarAt',
    'decisionClosedAt','decisionReceivedAt','entryAfter','protocolVersion','engineVersion']
    .every(key => same(a[key], b[key])) && same(a.evidence, b.evidence) && same(a.entryGuard, b.entryGuard);
}

function stats(trades, initialEquity, marks=[]) {
  const sorted = [...trades].sort((a,b)=>a.closedAt-b.closedAt || a.id.localeCompare(b.id));
  const result = {closed:sorted.length, wins:0, losses:0, breakeven:0, winRate:null,
    expectancyR:null, maximumLossStreak:0, byCost:{}, drawdownBasis:'closed-trade-order',
    markedDrawdownBasis:'observed-confirmed-close-and-exit-equity',
    sampleNote:'Recorded trades are dependent observations; no independence or edge is established.'};
  let streak=0, sumR=0, allR=true;
  for(const t of sorted) {
    if(t.netPnl>0){result.wins++;streak=0;}
    else if(t.netPnl<0){result.losses++;streak++;result.maximumLossStreak=Math.max(result.maximumLossStreak,streak);}
    else {result.breakeven++;streak=0;}
    if(numeric(t.pnlR))sumR+=t.pnlR;else allR=false;
  }
  if(sorted.length){result.winRate=result.wins/sorted.length;result.expectancyR=allR?sumR/sorted.length:null;}
  for(const cost of COSTS) {
    let equity=initialEquity, peak=initialEquity, maxDD=0, maxDDPct=0, profits=0, losses=0, r=0;
    for(const t of sorted) {
      const pnl=t.netByCost[cost];equity+=pnl;peak=Math.max(peak,equity);
      maxDD=Math.max(maxDD,peak-equity);maxDDPct=Math.max(maxDDPct,(peak-equity)/peak*100);
      profits+=Math.max(0,pnl);losses+=Math.max(0,-pnl);r+=pnl/t.riskBudget;
    }
    let markedPeak=initialEquity, markedDD=0, markedDDPct=0;
    for(const m of marks){const e=m.byCost[cost];markedPeak=Math.max(markedPeak,e);
      markedDD=Math.max(markedDD,markedPeak-e);markedDDPct=Math.max(markedDDPct,(markedPeak-e)/markedPeak*100);}
    result.byCost[cost]={assumedNetPnl:equity-initialEquity,endingRealizedEquity:equity,
      expectancyR:sorted.length?r/sorted.length:null,profitFactor:losses>0?profits/losses:null,
      profitFactorState:losses>0?'DEFINED':profits>0?'NO_LOSSES_YET':'NO_RESOLVED_PROFIT',
      realizedMaxDrawdown:maxDD,realizedMaxDrawdownPct:maxDDPct,
      observedMarkedMaxDrawdown:marks.length?markedDD:null,
      observedMarkedMaxDrawdownPct:marks.length?markedDDPct:null};
  }
  return result;
}

function audit(view, records, sources, options={}) {
  const now=options.now ?? Date.now(), issues=[], warnings=[];
  const issue=(code, sequence, book) => issues.push({code,...(sequence!=null?{sequence}:{}),...(book?{book}:{})});
  const target=view?.sequence ?? 0;
  const report={schemaVersion:1,generatedAt:now,asset:view?.asset,market:view?.market,symbol:view?.symbol,
    protocolVersion:view?.protocol?.version,codeHash:view?.codeHash,engineVersion:view?.engineVersion,
    cutoffSequence:target,registeredAt:view?.registeredAt,validationStart:view?.validationStart,
    validationEnd:view?.validationEnd,issues,warnings,books:[],sourceCount:0,
    assumptions:{costModel:'quantity * (entry + exit) * assumed bps / 20000',costBps:COSTS,
      actualSpread:'NOT_ACQUIRED',slippage:'NOT_ACQUIRED',funding:'NOT_ACQUIRED',
      exchangeClockOffset:'NOT_MEASURED',economicCalendarCompleteness:'NOT_ESTABLISHED',
      btcShort:'Fictional short exposure on a spot-price series; borrowing/availability is not modeled.'},
    selectionWarning:'Live UI results are visible. Choosing or tuning a persona from them requires a new unused confirmation period; this report does not authorize automatic adoption.'};
  if(!view || !Number.isInteger(target) || target<0){issue('INVALID_VIEW_SEQUENCE');report.valid=false;return report;}
  if(target===0 && view.status==='NOT_STARTED') {report.valid=true;report.state='NOT_STARTED';return report;}
  const p=view.protocol || {}, initial=p.initialEquity;
  const market=view.asset==='gold'?'futures':view.asset==='btc'?'spot':null;
  const symbol=view.asset==='gold'?'XAUUSDT':view.asset==='btc'?'BTCUSDT':null;
  if(!market || view.market!==market || view.symbol!==symbol)issue('INVALID_ASSET_MARKET');
  if(!numeric(initial)||initial<=0||p.costBps!==7||!same(p.sensitivityBps,COSTS) ||
    p.riskPct!==0.25 || p.maxLeverage!==3 || p.publicationLeadMs!==60000)issue('UNSUPPORTED_PROTOCOL');
  if(!numeric(view.registeredAt))issue('MISSING_REGISTRATION');
  const validationStart=Math.ceil((view.registeredAt+DAY)/BAR)*BAR;
  if(view.validationStart!==validationStart || view.validationEnd!==validationStart+84*DAY)
    issue('VALIDATION_PERIOD_CHANGED');
  const withheld=now<view.validationEnd;
  report.validationState=withheld?'WITHHELD_UNTIL_FIXED_END':'FIXED_PERIOD_COMPLETE';
  report.validationRule='Plans received in [validationStart, validationEnd); results withheld until validationEnd. Warmup statistics also exclude trades whose outcome overlaps validationStart.';
  const selected=records.filter(r=>r.sequence<=target);
  if(selected.length!==target)issue('JOURNAL_CUTOFF_INCOMPLETE');
  const ids=new Set(), partitions=new Set(), sourceIds=new Set(), books=new Map();
  for(const b of view.books || []){
    if(books.has(b.id)){issue('DUPLICATE_BOOK');continue;}
    books.set(b.id,{view:b,trades:[],marks:[],proposals:new Map(),published:new Map(),fills:new Map(),
      closedIds:new Set(),pending:null,position:null,unfilled:0,incomplete:0,skipped:0,halted:false,
      cumulative:Object.fromEntries(COSTS.map(c=>[c,0])),lastMarkAt:null});
  }
  let previousHash=null, lastObservationClose=null, observationCount=0, delayedCount=0, previousReceived=null;
  for(let i=0;i<selected.length;i++){
    const record=selected[i], seq=record.sequence;
    if(seq!==i+1 || ids.has(seq))issue('JOURNAL_SEQUENCE_GAP_OR_DUPLICATE',seq);
    ids.add(seq);
    if(record.previousHash!==previousHash)issue('HASH_CHAIN_BREAK',seq);
    if(recordHash(record)!==record.hash)issue('RECORD_HASH_MISMATCH',seq);
    previousHash=record.hash;
    const partition=[record.asset,record.market,record.symbol,record.codeHash,record.protocol?.version,record.engineVersion ?? view.engineVersion].join('|');
    partitions.add(partition);
    if(record.asset!==view.asset||record.market!==view.market||record.symbol!==view.symbol||
      record.codeHash!==view.codeHash||!same(record.protocol,p))issue('LEDGER_PARTITION_CHANGED',seq);
    if(!['OBSERVATION','PUBLICATION'].includes(record.kind))issue('UNKNOWN_RECORD_KIND',seq);
    if(!numeric(record.receivedAt)||record.receivedAt<view.registeredAt||record.receivedAt>now||
      (previousReceived!=null&&record.receivedAt<previousReceived))issue('RECORD_CLOCK_ERROR',seq);
    previousReceived=record.receivedAt;
    const source=sourceAt(sources,record.snapshotId), bars=rows(source);
    if(!source){issue('SOURCE_MISSING',seq);continue;}
    sourceIds.add(record.snapshotId);
    if(hash(source)!==record.sourceHash)issue('SOURCE_HASH_MISMATCH',seq);
    if(source.id!==record.snapshotId || source.asset!==record.asset || source.symbol!==record.symbol ||
      source.version!==view.engineVersion || (source.settings?.market != null && source.settings.market!==record.market))
      issue('SOURCE_IDENTITY_MISMATCH',seq);
    if(!numeric(source.createdAt)||source.createdAt>record.receivedAt)issue('SOURCE_TIME_ERROR',seq);
    if(record.kind==='OBSERVATION'){
      observationCount++;
      if(!record.freshDecision)delayedCount++;
      const latest=bars.at(-1);
      if(!latest || latest.time+BAR!==record.closedAt || record.closedAt>record.receivedAt ||
        (lastObservationClose!=null && record.closedAt<=lastObservationClose))issue('OBSERVATION_BAR_TIME_ERROR',seq);
      if(source.createdAt!==record.sourceCreatedAt)issue('SOURCE_CREATED_AT_CHANGED',seq);
      if(record.engineVersion!==view.engineVersion)issue('ENGINE_VERSION_CHANGED',seq);
      const fresh=record.closedAt>view.registeredAt && source.createdAt>=view.registeredAt &&
        record.receivedAt-record.closedAt<=p.sourceMaxAgeMs;
      if(record.freshDecision!==fresh)issue('FRESHNESS_FLAG_MISMATCH',seq);
      if(bars.some((b,j)=>![b.time,b.open,b.high,b.low,b.close].every(numeric)||b.time%BAR!==0||
        b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||
        b.time+BAR>record.closedAt||(j&&b.time<=bars[j-1].time)))issue('SOURCE_CANDLES_INVALID',seq);
      lastObservationClose=record.closedAt;
    }
    const closeEvents=(record.events||[]).filter(e=>e.type==='CLOSED');
    const fillEvents=(record.events||[]).filter(e=>e.type==='FILLED');
    for(const event of record.events || []){
      const state=books.get(event.book);
      if(!state){issue('UNKNOWN_BOOK',seq,event.book);continue;}
      const b=event.book;
      if(event.type==='PROPOSED'){
        const plan=event.plan;
        if(record.kind!=='OBSERVATION'||!record.freshDecision||!plan||plan.snapshotId!==record.snapshotId||
          plan.decisionReceivedAt!==record.receivedAt||plan.decisionClosedAt!==record.closedAt||
          plan.decisionBarAt+BAR!==record.closedAt||plan.decisionClosedAt<=view.registeredAt ||
          plan.protocolVersion!==p.version||plan.engineVersion!==view.engineVersion||
          !numeric(plan.entryAfter)||plan.entryAfter%BAR!==0||plan.entryAfter<record.receivedAt+p.publicationLeadMs||
          !side(plan.direction)||!(side(plan.direction)*(plan.reference-plan.stop)>0)||
          !(side(plan.direction)*(plan.target-plan.reference)>0)||plan.durableAt!==null)
          issue('INVALID_PROPOSAL',seq,b);
        if(plan){
          if(state.proposals.has(plan.id)||state.pending||state.position)issue('DUPLICATE_OR_OVERLAPPING_PROPOSAL',seq,b);
          state.proposals.set(plan.id,plan);state.pending=plan;
        }
      } else if(event.type==='PUBLISHED'){
        const plan=event.plan, proposed=plan&&state.proposals.get(plan.id);
        if(record.kind!=='PUBLICATION'||!fixedPlan(proposed,plan)||plan?.snapshotId!==record.snapshotId||
          plan?.durableAt!==record.receivedAt||plan.durableAt+p.publicationLeadMs>plan.entryAfter||
          plan.durableAt<plan.decisionReceivedAt)issue('PUBLICATION_NOT_CAUSAL_OR_PLAN_CHANGED',seq,b);
        if(plan){
          if(state.published.has(plan.id))issue('DUPLICATE_PUBLICATION',seq,b);
          state.published.set(plan.id,plan);state.pending=plan;
        }
      } else if(event.type==='FILLED'){
        const fill=event.position, published=fill&&state.published.get(fill.id);
        const entryBar=fill&&bars.find(x=>x.time===fill.openedAt);
        if(record.kind!=='OBSERVATION'||!fixedPlan(published,fill)||published?.durableAt!==fill?.durableAt ||
          fill?.openedAt!==fill?.entryAfter||!entryBar||fill.entry!==entryBar.open||
          fill.openedAt<view.registeredAt||fill.fillObservedAt!==record.receivedAt||fill.openedAt+BAR>record.receivedAt)
          issue('FILL_NOT_CAUSAL_OR_PLAN_CHANGED',seq,b);
        if(fill){
          if(state.fills.has(fill.id)||state.position||!state.pending)issue('DUPLICATE_OR_UNPLANNED_FILL',seq,b);
          const riskEquity=Math.min(...COSTS.map(c=>initial+state.cumulative[c]));
          const riskBudget=riskEquity*p.riskPct/100;
          const risk=side(fill.direction)*(fill.entry-fill.stop), worstCost=(fill.entry+fill.stop)*21/20000;
          const quantity=Math.min(riskBudget/(risk+worstCost),riskEquity*p.maxLeverage/fill.entry);
          if(!(risk>0)||!equal(fill.quantity,quantity)||!equal(fill.riskBudget,riskBudget)||
            !equal(fill.riskEquity,riskEquity))issue('FILL_RISK_SIZING_MISMATCH',seq,b);
          state.fills.set(fill.id,fill);state.pending=null;state.position=fill;
        }
      } else if(event.type==='CLOSED'){
        const trade=event.trade, filled=trade&&state.fills.get(trade.id);
        if(!trade){issue('CLOSED_TRADE_MISSING',seq,b);continue;}
        if(record.kind!=='OBSERVATION'||!fixedPlan(filled,trade)||filled?.durableAt!==trade.durableAt||
          !equal(filled?.quantity,trade.quantity)||!equal(filled?.entry,trade.entry)||
          !equal(filled?.riskBudget,trade.riskBudget)||trade.openedAt!==filled?.openedAt)
          issue('CLOSED_WITHOUT_FIXED_FILL',seq,b);
        if(state.closedIds.has(trade.id))issue('DUPLICATE_CLOSED_TRADE',seq,b);
        state.closedIds.add(trade.id);
        const exitBar=bars.find(x=>x.time===trade.outcomeBarAt);
        if(!exitBar||trade.outcomeBarAt+BAR!==trade.closedAt||trade.closedAt>record.receivedAt||
          trade.closedAt<=trade.openedAt||trade.outcomeReceivedAt!==record.receivedAt||
          !numeric(trade.exit)||trade.exit<=0)issue('EXIT_PRICE_EVIDENCE_MISSING',seq,b);
        if(exitBar){
          const s=side(trade.direction), stopGap=(exitBar.open-trade.stop)*s<=0,
            targetGap=(exitBar.open-trade.target)*s>=0,
            stopHit=s>0?exitBar.low<=trade.stop:exitBar.high>=trade.stop,
            targetHit=s>0?exitBar.high>=trade.target:exitBar.low<=trade.target;
          const expected=stopGap?exitBar.open:targetGap?trade.target:stopHit?trade.stop:targetHit?trade.target:exitBar.close;
          if(!equal(trade.exit,expected))issue('EXIT_CONSERVATIVE_PRICE_MISMATCH',seq,b);
        }
        const gross=(trade.exit-trade.entry)*side(trade.direction)*trade.quantity;
        const cost=trade.quantity*(trade.entry+trade.exit)*7/20000;
        if(!equal(trade.grossPnl,gross)||!equal(trade.costs,cost)||!equal(trade.netPnl,gross-cost)||
          !equal(trade.pnlR,(gross-cost)/trade.riskBudget))issue('TRADE_PNL_MATH_MISMATCH',seq,b);
        for(const c of COSTS){
          const net=gross-trade.quantity*(trade.entry+trade.exit)*c/20000;
          if(!equal(trade.netByCost?.[c],net))issue('COST_SENSITIVITY_MISMATCH',seq,b);
          state.cumulative[c]+=net;
        }
        state.trades.push(trade);state.position=null;
      } else if(event.type==='NO_FILL'){
        if(!fixedPlan(state.proposals.get(event.plan?.id),event.plan))issue('NO_FILL_WITHOUT_PLAN',seq,b);
        state.unfilled++;state.pending=null;
      } else if(event.type==='INCOMPLETE'){
        if(!event.unresolved?.pending&&!event.unresolved?.position)issue('INCOMPLETE_WITHOUT_EXPOSURE',seq,b);
        if(event.unresolved?.pending&&!fixedPlan(state.pending,event.unresolved.pending))issue('INCOMPLETE_PLAN_CHANGED',seq,b);
        if(event.unresolved?.position&&!fixedPlan(state.position,event.unresolved.position))issue('INCOMPLETE_POSITION_CHANGED',seq,b);
        state.incomplete++;state.halted=true;state.pending=null;state.position=null;
      } else if(event.type==='WATCH_PUBLISHED'){
        if(record.kind!=='PUBLICATION'||event.watch?.referenceDurableAt!==record.receivedAt)
          issue('WATCH_PUBLICATION_TIME_ERROR',seq,b);
      } else issue('UNKNOWN_EVENT_TYPE',seq,b);
    }
    // Reconstruct observed close/exit equity without using the monitor's DD totals.
    if(record.kind==='OBSERVATION')for(const [book,state] of books){
      if(state.halted)continue;
      const filled=fillEvents.find(e=>e.book===book)?.position;
      const closed=closeEvents.filter(e=>e.book===book).map(e=>e.trade).filter(Boolean);
      const active=closed.length?closed[0]:state.position||filled;
      const affected=active?bars.filter(x=>x.time>=active.openedAt &&
        (state.lastMarkAt==null||x.time>state.lastMarkAt)&&x.time+BAR<=record.closedAt):[];
      const netClosedThis=Object.fromEntries(COSTS.map(c=>[c,closed.reduce((sum,t)=>sum+(t.netByCost?.[c]||0),0)]));
      for(const bar of affected){
        const exit=closed.find(t=>t.outcomeBarAt===bar.time);
        const before=Object.fromEntries(COSTS.map(c=>[c,initial+state.cumulative[c]-netClosedThis[c]]));
        const byCost=Object.fromEntries(COSTS.map(c=>[c,exit?before[c]+exit.netByCost[c]:
          before[c]+(bar.close-active.entry)*side(active.direction)*active.quantity-
          active.quantity*(active.entry+bar.close)*c/20000]));
        state.marks.push({at:bar.time+BAR,byCost});state.lastMarkAt=bar.time;
        if(exit)break;
      }
      if(!affected.length && !active){state.marks.push({at:record.closedAt,
        byCost:Object.fromEntries(COSTS.map(c=>[c,initial+state.cumulative[c]]))});state.lastMarkAt=record.closedAt-BAR;}
      const decision=(record.decisions||[]).find(d=>d.book===book);
      if(decision?.action==='WAIT')state.skipped++;
    }
  }
  if(partitions.size>1)issue('MIXED_PARTITIONS');
  report.partitions=[...partitions];report.sourceCount=sourceIds.size;
  if(view.coverage?.decisions!==observationCount || view.coverage?.delayedDecisions!==delayedCount)
    issue('COVERAGE_TOTAL_MISMATCH');
  report.coverage={observations:observationCount,delayedDecisions:delayedCount,
    freshDecisions:observationCount-delayedCount,reportedMissingBars:view.coverage?.missingBars ?? null,
    missingBarsNote:'Policy-attributed missing decision count from monitor; source gaps remain separately audited.'};
  for(const [id,state] of books){
    const b=state.view, trades=state.trades, gross=trades.reduce((sum,t)=>sum+t.grossPnl,0),
      costs=trades.reduce((sum,t)=>sum+t.costs,0), net=trades.reduce((sum,t)=>sum+t.netPnl,0),
      wins=trades.filter(t=>t.netPnl>0).length, losses=trades.filter(t=>t.netPnl<0).length,
      profitSum=trades.reduce((sum,t)=>sum+Math.max(t.netPnl,0),0), lossSum=trades.reduce((sum,t)=>sum+Math.max(-t.netPnl,0),0);
    if(b.closed!==trades.length||b.wins!==wins||b.losses!==losses||!equal(b.grossPnl,gross)||
      !equal(b.costs,costs)||!equal(b.realizedNet,net)||!equal(b.equity,initial+net)||
      !equal(b.profitSum,profitSum)||!equal(b.lossSum,lossSum)||b.unfilled!==state.unfilled||
      b.incomplete!==state.incomplete||b.skipped!==state.skipped||b.halted!==state.halted)
      issue('BOOK_TOTAL_MISMATCH',null,id);
    for(const c of COSTS)if(!equal(b.netByCost?.[c],state.cumulative[c]))issue('BOOK_COST_TOTAL_MISMATCH',null,id);
    if((b.pending?.id??null)!==(state.pending?.id??null)||(b.position?.id??null)!==(state.position?.id??null))
      issue('BOOK_EXPOSURE_MISMATCH',null,id);
    if(b.pending&&!fixedPlan(state.pending,b.pending))issue('BOOK_PENDING_PLAN_CHANGED',null,id);
    if(b.position&&!fixedPlan(state.position,b.position))issue('BOOK_POSITION_PLAN_CHANGED',null,id);
    if(b.halted && (b.markedEquity!==null||b.unrealizedGross!==null))issue('INCOMPLETE_EQUITY_SHOWN_AS_KNOWN',null,id);
    const primary=trades.filter(t=>t.decisionReceivedAt>=view.validationStart&&t.decisionReceivedAt<view.validationEnd);
    const warmup=trades.filter(t=>t.decisionReceivedAt<view.validationStart&&t.closedAt<view.validationStart);
    const later=trades.filter(t=>t.decisionReceivedAt>=view.validationEnd);
    const pendingPrimary=[b.position,b.pending,b.unresolved?.position,b.unresolved?.pending]
      .filter(t=>t&&t.decisionReceivedAt>=view.validationStart&&t.decisionReceivedAt<view.validationEnd).length;
    const lifetime=stats(trades,initial,state.marks), finalMark=state.marks.at(-1)?.byCost?.[7];
    if(!b.halted && (!equal(b.markedEquity,finalMark)||!equal(b.maxDrawdown,lifetime.byCost[7].observedMarkedMaxDrawdown)||
      !equal(b.maxDrawdownPct,lifetime.byCost[7].observedMarkedMaxDrawdownPct)))issue('BOOK_MARKED_EQUITY_OR_DD_MISMATCH',null,id);
    const denominator=trades.length+state.incomplete+(b.pending?1:0)+(b.position?1:0);
    const summary={id,label:b.label,counts:{closed:trades.length,unfilled:state.unfilled,incomplete:state.incomplete,
      skipped:state.skipped,pending:b.pending?1:0,open:b.position?1:0},status:b.halted?'INCOMPLETE_LOCKED':b.position?'HOLD':b.pending?'PENDING':'WAIT',
      evaluationCoverage:{resolved:trades.length,unresolved:denominator-trades.length,
        ratio:denominator?trades.length/denominator:null,
        note:'Closed / (closed + incomplete + open + pending); unfilled intents and skipped bars are separate counts.'},
      lastAction:b.lastDecision?.action,lastReason:b.lastDecision?.reason,validation:{state:report.validationState,
        closed:primary.length,unresolvedOrPending:pendingPrimary,statistics:null},warmup:null,postValidation:null,
      lifetime:null,unresolvedAreExcluded:true};
    if(withheld){
      summary.warmup=stats(warmup,initial);
      summary.lifetimeState='WITHHELD: lifetime totals include the fixed validation period';
    }else{
      summary.validation.statistics=stats(primary,initial);
      summary.warmup=stats(warmup,initial);summary.postValidation=stats(later,initial);
      summary.lifetime=lifetime;
    }
    report.books.push(summary);
    if(state.incomplete)warnings.push({code:'INCOMPLETE_EXPOSURE_IS_EXCLUDED_NOT_ZERO',book:id});
  }
  if(!selected.length)warnings.push({code:'NO_OBSERVATIONS_YET'});
  if(report.books.every(b=>b.counts.closed<100))warnings.push({code:'SMALL_SAMPLE_NO_ADOPTION'});
  warnings.push({code:'MULTIPLE_PERSONAS_REQUIRE_UNUSED_CONFIRMATION_AND_MULTIPLE_TRIAL_ACCOUNTING'});
  report.valid=issues.length===0;
  if(!report.valid)for(const b of report.books){b.warmup=null;b.postValidation=null;b.lifetime=null;b.validation.statistics=null;b.statisticsState='UNTRUSTED_LEDGER';}
  return report;
}

function immutable(file,payload) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)){
    const cached=JSON.parse(fs.readFileSync(file,'utf8'));
    if(cached.payloadHash!==hash(cached.original)||!same(cached.original,payload))throw new Error('DEMO_IMMUTABLE_CACHE_CONFLICT');
    return cached.original;
  }
  const envelope={firstRetrievedAt:Date.now(),payloadHash:hash(payload),original:payload};
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temp,JSON.stringify(envelope),{flag:'wx'});fs.linkSync(temp,file);}
  catch(e){if(e.code==='EEXIST')return immutable(file,payload);throw e;}
  finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return payload;
}
function readImmutable(file) {
  const cached=JSON.parse(fs.readFileSync(file,'utf8'));
  if(cached.payloadHash!==hash(cached.original))throw new Error('DEMO_CACHE_HASH_MISMATCH');
  return cached.original;
}
function atomicLatest(file,payload) {
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(payload,null,2),{flag:'wx'});fs.renameSync(temp,file);
}
async function request(route,fetcher=fetch) {
  const response=await fetcher(BASE+route,{signal:AbortSignal.timeout(15000),headers:{Accept:'application/json'},cache:'no-store'});
  if(!response.ok)throw new Error('DEMO_API_HTTP_'+response.status);
  return response.json();
}
async function readLedger(asset,options={}) {
  if(!['gold','btc'].includes(asset))throw new Error('DEMO_INVALID_ASSET');
  const fetcher=options.fetcher??fetch, root=options.root??ROOT;
  const view=await request('/api/demo?asset='+asset,fetcher), cutoff=view.sequence??0;
  if(!Number.isInteger(cutoff)||cutoff<0)throw new Error('DEMO_INVALID_SEQUENCE');
  if(view.asset!==asset||!/^demo-[a-zA-Z0-9.-]+$/.test(view.protocol?.version||''))throw new Error('DEMO_INVALID_PARTITION');
  const folder=path.join(root,'ledger-cache',asset,view.protocol.version), journal=path.join(folder,'journal'), sourceFolder=path.join(folder,'sources');
  fs.mkdirSync(journal,{recursive:true});fs.mkdirSync(sourceFolder,{recursive:true});
  immutable(path.join(folder,'views',String(cutoff).padStart(10,'0')+'-'+hash(view)+'.json'),view);
  const records=new Map();
  for(const name of fs.readdirSync(journal).filter(n=>/^\d{10}\.json$/.test(n))){
    const r=readImmutable(path.join(journal,name));
    if(r.sequence!==Number(name.slice(0,10)))throw new Error('DEMO_CACHE_SEQUENCE_MISMATCH');
    if(r.sequence<=cutoff)records.set(r.sequence,r);
  }
  let cursor=0;
  while(records.has(cursor+1))cursor++;
  while(cursor<cutoff){
    const page=await request('/api/demo/journal?asset='+asset+'&cursor='+cursor+'&limit=200',fetcher);
    if(page.protocolVersion!==view.protocol.version||!Array.isArray(page.records)||!page.records.length)
      throw new Error('DEMO_JOURNAL_CUTOFF_UNAVAILABLE');
    let progressed=false;
    for(const r of page.records){
      if(r.sequence>cutoff)break;
      if(r.sequence!==cursor+1)throw new Error('DEMO_JOURNAL_PAGE_GAP');
      immutable(path.join(journal,String(r.sequence).padStart(10,'0')+'.json'),r);
      records.set(r.sequence,r);cursor=r.sequence;progressed=true;
    }
    if(!progressed)throw new Error('DEMO_JOURNAL_NO_PROGRESS');
  }
  const sources=new Map();
  for(const r of records.values()){
    if(sources.has(r.snapshotId))continue;
    const file=path.join(sourceFolder,hash(r.snapshotId)+'.json');
    const source=fs.existsSync(file)?readImmutable(file):await request('/api/demo/source?asset='+asset+'&id='+encodeURIComponent(r.snapshotId),fetcher);
    if(source?.id!==r.snapshotId||hash(source)!==r.sourceHash)throw new Error('DEMO_SOURCE_CACHE_IDENTITY_OR_HASH');
    immutable(file,source);sources.set(r.snapshotId,source);
  }
  return {view,records:[...records.values()].sort((a,b)=>a.sequence-b.sequence),sources};
}
function markdown(report) {
  const lines=['# Demo ledger review','',`Generated: ${new Date(report.generatedAt).toISOString()}`,
    '', 'Fictional forward experiment. No real executions, actual spreads or proven trading edge.', '',
    'The frozen validation period is withheld until its fixed end. Live UI selection requires a new unused confirmation period.', ''];
  for(const asset of report.assets){
    lines.push(`## ${asset.asset || 'unknown'}`,'',`Audit: ${asset.valid?'PASS':'FAIL'}; cutoff sequence: ${asset.cutoffSequence ?? 'unavailable'}; validation: ${asset.validationState || asset.state || 'unavailable'}.`,'');
    for(const b of asset.books||[]){
      lines.push(`- ${b.label || b.id}: ${b.status}; closed ${b.counts.closed}, unfilled ${b.counts.unfilled}, incomplete ${b.counts.incomplete}, skipped ${b.counts.skipped}.`);
      if(b.lifetime)lines.push(`  Assumed net P&L at 7/14/21 bps: ${COSTS.map(c=>b.lifetime.byCost[c].assumedNetPnl.toFixed(2)).join(' / ')}; expectancy R: ${b.lifetime.expectancyR?.toFixed(3) ?? 'unresolved'}; realized max DD: ${b.lifetime.byCost[7].realizedMaxDrawdown.toFixed(2)}; observed close/exit DD: ${b.lifetime.byCost[7].observedMarkedMaxDrawdown?.toFixed(2) ?? 'unavailable'}.`);
    }
    if(asset.issues?.length)lines.push('', 'Audit issues:', ...asset.issues.map(i=>`- ${i.code}${i.sequence!=null?' at sequence '+i.sequence:''}${i.book?' ('+i.book+')':''}`));
    if(asset.error)lines.push('',`- Read failure: ${asset.error}`);
    lines.push('');
  }
  return lines.join('\n')+'\n';
}
async function run(options={}) {
  const root=options.root??ROOT, captureStartedAt=options.now??Date.now(), assets=[];
  for(const asset of ['gold','btc']){
    try{const input=await readLedger(asset,options);assets.push(audit(input.view,input.records,input.sources,{now:options.now??Date.now()}));}
    catch(e){assets.push({asset,valid:false,error:String(e.message).slice(0,160),books:[],issues:[{code:'READ_FAILED'}]});}
  }
  const generatedAt=options.now??Date.now();
  const report={schemaVersion:1,captureStartedAt,generatedAt,assets,valid:assets.every(a=>a.valid),
    action:'ANALYSIS_ONLY_NO_AUTOMATIC_ADOPTION',source:'saved-monitor-demo-endpoints-only'};
  const reviews=path.join(root,'reviews');fs.mkdirSync(reviews,{recursive:true});
  const name=String(generatedAt)+'-'+crypto.randomUUID(), temp=path.join(reviews,'.'+name+'.tmp'), dest=path.join(reviews,name);
  fs.mkdirSync(temp);
  fs.writeFileSync(path.join(temp,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
  fs.writeFileSync(path.join(temp,'review.md'),markdown(report),{flag:'wx'});
  fs.renameSync(temp,dest);
  const latest={...report,reportDirectory:name};atomicLatest(path.join(reviews,'LATEST.json'),latest);
  return latest;
}
if(require.main===module)run().then(r=>{console.log(JSON.stringify({valid:r.valid,reportDirectory:r.reportDirectory,
  assets:r.assets.map(a=>({asset:a.asset,valid:a.valid,sequence:a.cutoffSequence,validation:a.validationState,issues:a.issues?.length,error:a.error}))}));
  if(!r.valid)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={BAR,COSTS,hash,recordHash,fixedPlan,stats,audit,immutable,readImmutable,readLedger,markdown,run};
