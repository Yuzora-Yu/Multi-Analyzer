const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Demo=require('../demo-trading.cjs'),Review=require('../demo-review.cjs');
const D=Demo.BAR,T=Date.UTC(2026,9,9),CODE='a'.repeat(64),VERSION='4.3.4';
const copy=x=>JSON.parse(JSON.stringify(x));
const bar=(time,patch={})=>({time,open:100,high:102,low:98,close:100,volume:10,...patch});
function fixture(closedAt,patch={}){
  const tf=minutes=>({ready:true,intervalMinutes:minutes,quality:{stale:false,gaps:0},
    candles:[bar(Math.floor((closedAt-minutes*60000)/(minutes*60000))*minutes*60000)],
    values:{adx:15,emaSlope:0},trend:'range',structure:{trend:'range'},smc:{zones:[]},swings:{highs:[],lows:[]}});
  const exec={...tf(15),candles:[bar(closedAt-2*D),bar(closedAt-D,patch)],
    values:{close:patch.close??100,atr:2,adx:21,atrRank:.5,ema20:99,ema50:99,bbUpper:110,bbLower:90},
    series:{bb:{mid:[100,100],lower:[90,90],upper:[110,110]}},
    flow:{latest:{direction:0,ribbon:0,setup:{ready:true}},lines:{13:[99,99],21:[98,98]}},smc:{zones:[],events:[]}};
  const analysis={version:VERSION,exec,h1:tf(60),h4:tf(240),marketMap:{valid:true,candidates:[],eventRisk:{blocked:false}},
    htfBias:'neutral',actionable:true,direction:'LONG',state:'READY_LONG',plan:{stop:95,tp2:115,orderType:'LIMIT_RETEST'}};
  const pack=rows=>rows.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume]);
  const snapshot={id:'btc-'+(closedAt-D)+'-'+VERSION,asset:'btc',symbol:'BTCUSDT',version:VERSION,
    createdAt:closedAt+10000,settings:{market:'spot'},bars:{m15:pack(exec.candles),h1:pack(analysis.h1.candles),h4:pack(analysis.h4.candles)}};
  return {analysis,snapshot};
}
function ledger(options={}){
  let lab=null;const records=[],sources=new Map();
  function persist(result,snapshot){
    lab=result.lab;if(!result.record)return;
    const payload={...result.record,sequence:lab.sequence+1,previousHash:lab.chain,codeHash:CODE,
      protocol:copy(lab.protocol),asset:lab.asset,market:lab.market,symbol:lab.symbol,sourceHash:Review.hash(snapshot)};
    const hash=Review.hash(payload);lab.sequence=payload.sequence;lab.chain=hash;lab.codeHash=CODE;
    records.push({...payload,hash});sources.set(snapshot.id,copy(snapshot));
  }
  function step(at,patch={},delay=20000){const f=fixture(at,patch);
    persist(Demo.advance(lab,f.snapshot,f.analysis,at+delay),f.snapshot);
    persist(Demo.acknowledge(lab,f.snapshot.id,at+delay+1000),f.snapshot);
  }
  step(options.firstClosedAt??T-D);step(T);
  if(options.outcome!==false)step(T+2*D,options.patch??{open:100,high:116,low:94,close:108});
  if(options.hold)step(T+3*D,options.hold);
  return {lab,records,sources,view:Demo.publicView(lab,T+3*D),step};
}
function rehash(records){let previous=null;for(const r of records){r.previousHash=previous;r.hash=Review.recordHash(r);previous=r.hash;}}
function codes(report){return report.issues.map(x=>x.code);}

test('genuine forward ledger passes independent source, risk, P&L and account audits',()=>{
  const x=ledger(),r=Review.audit(x.view,x.records,x.sources,{now:T+4*D});
  assert.deepEqual(r.issues,[]);assert.equal(r.valid,true);assert.equal(r.sourceCount,3);
  const b=r.books.find(x=>x.id==='baseline');assert.equal(b.counts.closed,1);assert.equal(b.warmup.losses,1);
  assert.ok(b.warmup.byCost[7].assumedNetPnl>b.warmup.byCost[21].assumedNetPnl);
  assert.equal(b.lifetime,null);assert.equal(b.validation.statistics,null);
});
test('source and chain corruption remain failures even when summary totals look plausible',()=>{
  const x=ledger();x.sources.get(x.records[0].snapshotId).bars.m15[0][2]=103;
  assert.ok(codes(Review.audit(x.view,x.records,x.sources,{now:T+4*D})).includes('SOURCE_HASH_MISMATCH'));
  const y=ledger();y.records[1].previousHash='b'.repeat(64);
  const result=Review.audit(y.view,y.records,y.sources,{now:T+4*D});
  assert.ok(codes(result).includes('HASH_CHAIN_BREAK'));assert.equal(result.books[3].warmup,null);
});
test('future entry needs the actually completed publication and frozen SL/TP',()=>{
  const x=ledger();const publication=x.records.find(r=>r.kind==='PUBLICATION');
  publication.receivedAt=T+D-59000;publication.events[0].plan.durableAt=publication.receivedAt;
  rehash(x.records);
  assert.ok(codes(Review.audit(x.view,x.records,x.sources,{now:T+4*D})).includes('PUBLICATION_NOT_CAUSAL_OR_PLAN_CHANGED'));
  const y=ledger();y.records.find(r=>r.kind==='PUBLICATION').events[0].plan.stop=94;rehash(y.records);
  assert.ok(codes(Review.audit(y.view,y.records,y.sources,{now:T+4*D})).includes('PUBLICATION_NOT_CAUSAL_OR_PLAN_CHANGED'));
});
test('duplicate exits, cost mutations, summary drift and mixed code/market are detected',()=>{
  const x=ledger();const last=x.records.at(-1),exit=last.events.find(e=>e.type==='CLOSED');
  last.events.push(copy(exit));rehash(x.records);
  assert.ok(codes(Review.audit(x.view,x.records,x.sources,{now:T+4*D})).includes('DUPLICATE_CLOSED_TRADE'));
  const y=ledger();y.records.at(-1).events.find(e=>e.type==='CLOSED').trade.netByCost[21]+=1;rehash(y.records);
  assert.ok(codes(Review.audit(y.view,y.records,y.sources,{now:T+4*D})).includes('COST_SENSITIVITY_MISMATCH'));
  const z=ledger();z.view.books[3].equity+=1;z.records[1].codeHash='c'.repeat(64);z.records[2].market='futures';rehash(z.records);
  const c=codes(Review.audit(z.view,z.records,z.sources,{now:T+4*D}));
  assert.ok(c.includes('BOOK_TOTAL_MISMATCH'));assert.ok(c.includes('MIXED_PARTITIONS'));assert.ok(c.includes('LEDGER_PARTITION_CHANGED'));
});
test('ambiguous same-bar price collision and adverse gaps use conservative outcomes',()=>{
  const x=ledger();x.records.at(-1).events.find(e=>e.type==='CLOSED').trade.exit=115;rehash(x.records);
  assert.ok(codes(Review.audit(x.view,x.records,x.sources,{now:T+4*D})).includes('EXIT_CONSERVATIVE_PRICE_MISMATCH'));
  const y=ledger({patch:{open:100,high:104,low:96,close:103},hold:{open:90,high:94,low:88,close:93}});
  const report=Review.audit(y.view,y.records,y.sources,{now:T+5*D});
  assert.deepEqual(report.issues,[]);assert.ok(report.books[3].warmup.byCost[7].assumedNetPnl < -25);
});
test('unfilled and incomplete exposures are not wins or zero-return trades',()=>{
  const x=ledger({patch:{open:116,high:118,low:110,close:117}});
  const r=Review.audit(x.view,x.records,x.sources,{now:T+4*D});
  assert.deepEqual(r.issues,[]);assert.equal(r.books[3].counts.unfilled,1);assert.equal(r.books[3].warmup.closed,0);
  const y=ledger({outcome:false});const f=fixture(T+4*D);f.analysis.exec.candles=[bar(T+3*D)];
  f.snapshot.bars.m15=f.analysis.exec.candles.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume]);
  const result=Demo.advance(y.lab,f.snapshot,f.analysis,T+4*D+20000);
  const payload={...result.record,sequence:y.lab.sequence+1,previousHash:y.lab.chain,codeHash:CODE,
    protocol:copy(y.lab.protocol),asset:'btc',market:'spot',symbol:'BTCUSDT',sourceHash:Review.hash(f.snapshot)};
  const h=Review.hash(payload);result.lab.sequence=payload.sequence;result.lab.codeHash=CODE;
  y.records.push({...payload,hash:h});y.sources.set(f.snapshot.id,f.snapshot);
  const a=Review.audit(Demo.publicView(result.lab,T+5*D),y.records,y.sources,{now:T+5*D});
  assert.deepEqual(a.issues,[]);assert.equal(a.books[3].status,'INCOMPLETE_LOCKED');assert.equal(a.books[3].counts.closed,0);
});
test('fixed validation statistics stay withheld until the exact frozen end',()=>{
  const x=ledger();const trade=x.records.at(-1).events.find(e=>e.type==='CLOSED').trade;
  const r=Review.audit(x.view,x.records,x.sources,{now:x.view.validationEnd-1});
  assert.equal(r.validationState,'WITHHELD_UNTIL_FIXED_END');assert.equal(r.books[3].validation.statistics,null);
  const done=Review.audit(x.view,x.records,x.sources,{now:x.view.validationEnd});
  assert.equal(done.valid,true);assert.equal(done.books[3].lifetime.closed,1);
  assert.equal(done.books[3].lifetime.maximumLossStreak,1);
  assert.ok(Math.abs(done.books[3].lifetime.byCost[7].observedMarkedMaxDrawdown+trade.netPnl)<1e-8);
  const changed=copy(x.view);changed.validationEnd-=D;
  assert.ok(codes(Review.audit(changed,x.records,x.sources,{now:T+4*D})).includes('VALIDATION_PERIOD_CHANGED'));
});
test('validation trades cannot leak through warmup or lifetime aggregates',()=>{
  const x=ledger({firstClosedAt:T-25*3600000});
  const r=Review.audit(x.view,x.records,x.sources,{now:T+4*D});
  assert.deepEqual(r.issues,[]);const b=r.books[3];
  assert.equal(b.validation.closed,1);assert.equal(b.validation.statistics,null);
  assert.equal(b.warmup.closed,0);assert.equal(b.lifetime,null);
  assert.equal(b.evaluationCoverage.ratio,1);
  assert.equal(Review.audit(x.view,x.records,x.sources,{now:x.view.validationEnd}).books[3].validation.statistics.closed,1);
});
test('independent statistics include cost EV, defined PF, DD, and loss streak without false infinity',()=>{
  const trades=[10,-20,-10,30].map((p,i)=>({id:String(i),closedAt:i,riskBudget:10,netPnl:p,pnlR:p/10,netByCost:{7:p,14:p-1,21:p-2}}));
  const r=Review.stats(trades,1000);assert.equal(r.expectancyR,.25);assert.equal(r.maximumLossStreak,2);
  assert.equal(r.byCost[7].profitFactor,40/30);assert.equal(r.byCost[7].realizedMaxDrawdown,30);
  assert.equal(r.byCost[21].assumedNetPnl,2);
  assert.equal(Review.stats([trades[0]],1000).byCost[7].profitFactor,null);
});
test('immutable cache is atomically first-written and rejects changed originals',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'demo-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'original.json'),original={id:'first',data:[1,2]};
  Review.immutable(file,original);const before=fs.readFileSync(file,'utf8');Review.immutable(file,original);
  assert.equal(fs.readFileSync(file,'utf8'),before);assert.throws(()=>Review.immutable(file,{...original,data:[3]}),/CACHE_CONFLICT/);
  const damaged=JSON.parse(before);damaged.original.data[0]=7;fs.writeFileSync(file,JSON.stringify(damaged));
  assert.throws(()=>Review.readImmutable(file),/CACHE_HASH_MISMATCH/);
});
test('API reader freezes the view sequence, ignores newer rows and reuses validated source cache',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'demo-reader-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const x=ledger(),calls=[];
  async function fetcher(url){calls.push(url);const u=new URL(url);let data;
    if(u.pathname==='/api/demo')data=x.view;
    else if(u.pathname==='/api/demo/journal')data={protocolVersion:'demo-v1',records:[...x.records,{sequence:x.view.sequence+1}],nextCursor:null};
    else if(u.pathname==='/api/demo/source')data=x.sources.get(u.searchParams.get('id'));
    else throw Error('unexpected endpoint');
    return {ok:true,json:async()=>copy(data)};
  }
  const first=await Review.readLedger('btc',{root:dir,fetcher});assert.equal(first.records.length,x.view.sequence);
  assert.equal(calls.filter(s=>s.includes('/api/demo/source')).length,3);
  const originals=fs.readdirSync(path.join(dir,'ledger-cache','btc','demo-v1','journal'));
  assert.equal(originals.length,x.view.sequence);calls.length=0;
  const second=await Review.readLedger('btc',{root:dir,fetcher});assert.equal(second.sources.size,3);
  assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/api/demo?asset=btc'));
});
test('runner retains a complete report on endpoint failure and atomically updates only LATEST',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'demo-run-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const fetcher=async()=>({ok:false,status:503});
  const first=await Review.run({root:dir,fetcher,now:T});assert.equal(first.valid,false);
  const saved=fs.readFileSync(path.join(dir,'reviews',first.reportDirectory,'report.json'),'utf8');
  const second=await Review.run({root:dir,fetcher,now:T+D});
  assert.equal(fs.readFileSync(path.join(dir,'reviews',first.reportDirectory,'report.json'),'utf8'),saved);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'reviews','LATEST.json'),'utf8')).reportDirectory,second.reportDirectory);
  assert.ok(fs.existsSync(path.join(dir,'reviews',second.reportDirectory,'review.md')));
});
