const test=require('node:test'),assert=require('node:assert/strict');
const Demo=require('../demo-trading.cjs');
const D=Demo.BAR,T=Date.UTC(2026,9,9,0,0),VERSION='4.3.4';
const bar=(time,patch={})=>({time,open:100,high:102,low:98,close:100,volume:10,...patch});
function fixture(closedAt=T,patch={}){
  const bars=[bar(closedAt-2*D),bar(closedAt-D,patch)];
  const tf=(minutes)=>({ready:true,intervalMinutes:minutes,quality:{stale:false,gaps:0},
    candles:[bar(Math.floor((closedAt-minutes*60000)/(minutes*60000))*minutes*60000)],
    values:{adx:15,emaSlope:0},trend:'range',structure:{trend:'range'},smc:{zones:[]},swings:{highs:[],lows:[]}});
  const exec={...tf(15),candles:bars,values:{close:bars.at(-1).close,atr:2,adx:21,atrRank:.5,
    ema20:99,ema50:99,bbUpper:110,bbLower:90},series:{bb:{mid:[100,100],lower:[90,90],upper:[110,110]}},
    flow:{latest:{time:closedAt-D,direction:0,ribbon:0,setup:{ready:true}},lines:{13:[99,99],21:[98,98]}},smc:{zones:[],events:[]}};
  const analysis={version:VERSION,exec,h1:tf(60),h4:tf(240),marketMap:{valid:true,candidates:[],eventRisk:{blocked:false}},
    htfBias:'neutral',actionable:true,direction:'LONG',state:'READY_LONG',plan:{stop:95,tp2:115,orderType:'LIMIT_RETEST'}};
  const snapshot={id:'btc-'+(closedAt-D)+'-'+VERSION,asset:'btc',symbol:'BTCUSDT',version:VERSION,createdAt:closedAt+10000};
  return {analysis,snapshot};
}
function seed(){const lab=Demo.create('btc',T-D,VERSION);lab.lastSnapshotId='seed';lab.lastClosedAt=T-D;return lab;}
function planned(){const f=fixture();let r=Demo.advance(seed(),f.snapshot,f.analysis,T+20000);r=Demo.acknowledge(r.lab,f.snapshot.id,T+21000);return r.lab;}

test('registration never backfills a previously closed winning trade',()=>{
  const f=fixture(),r=Demo.advance(null,f.snapshot,f.analysis,T+20000);
  assert.equal(r.lab.registeredAt,T+20000);assert.equal(r.lab.status,'WAITING');
  assert.ok(r.lab.books.every(b=>b.closed===0&&!b.pending&&!b.position));
  assert.deepEqual(f,fixture());
});
test('frozen future entry requires a completed persistence acknowledgement',()=>{
  const f=fixture(),r=Demo.advance(seed(),f.snapshot,f.analysis,T+20000),p=r.lab.books[3].pending;
  assert.equal(p.entryAfter,T+D);assert.equal(p.durableAt,null);assert.equal(p.stop,95);assert.equal(p.target,115);
  const next=fixture(T+2*D);const failed=Demo.advance(r.lab,next.snapshot,next.analysis,T+2*D+20000);
  assert.equal(failed.lab.books[3].unfilled,1);assert.equal(failed.lab.books[3].closed,0);
  const late=Demo.acknowledge(r.lab,f.snapshot.id,T+D-59999);
  assert.equal(late.lab.books[3].pending,null);assert.equal(late.lab.books[3].unfilled,1);
});
test('repeated snapshot is idempotent and does not count a second decision',()=>{
  const lab=planned(),f=fixture();const r=Demo.advance(lab,f.snapshot,f.analysis,T+60000);
  assert.equal(r.record,null);assert.deepEqual(r.lab,lab);
});
test('same-bar SL and TP is a loss, with identical quantities across cost cases',()=>{
  const lab=planned(),f=fixture(T+2*D,{open:100,high:116,low:94,close:108});
  const r=Demo.advance(lab,f.snapshot,f.analysis,T+2*D+20000),b=r.lab.books[3],trade=b.recentTrades[0];
  assert.equal(trade.exit,95);assert.match(trade.reason,/SL先/);assert.equal(b.closed,1);assert.equal(b.losses,1);
  assert.ok(trade.netByCost[7]>trade.netByCost[14]&&trade.netByCost[14]>trade.netByCost[21]);
  assert.ok(trade.quantity*(5+(100+95)*21/20000)<=25+1e-10);
  assert.ok(b.maxDrawdown>0);assert.equal(b.pending,null);
  assert.equal(r.lab.books[0].closed,0);
});
test('a held adverse gap is charged at the worse open, without clipping risk',()=>{
  let lab=planned(),f=fixture(T+2*D,{open:100,high:104,low:96,close:103});
  lab=Demo.advance(lab,f.snapshot,f.analysis,T+2*D+20000).lab;
  assert.equal(lab.books[3].position.entry,100);
  f=fixture(T+3*D,{open:90,high:94,low:88,close:93});
  const b=Demo.advance(lab,f.snapshot,f.analysis,T+3*D+20000).lab.books[3];
  assert.equal(b.recentTrades[0].exit,90);assert.ok(-b.recentTrades[0].netPnl>25);
});
test('an entry gap past the frozen target is unfilled, never credited as profit',()=>{
  const f=fixture(T+2*D,{open:116,high:118,low:110,close:117});
  const b=Demo.advance(planned(),f.snapshot,f.analysis,T+2*D+20000).lab.books[3];
  assert.equal(b.closed,0);assert.equal(b.unfilled,1);assert.equal(b.equity,10000);
});
test('price gap in evidence locks an uncertain account instead of assuming zero',()=>{
  const lab=planned(),f=fixture(T+4*D);f.analysis.exec.candles=[bar(T+3*D)];
  const r=Demo.advance(lab,f.snapshot,f.analysis,T+4*D+20000),b=r.lab.books[3];
  assert.equal(b.halted,true);assert.equal(b.incomplete,1);assert.equal(b.markedEquity,null);
  assert.equal(b.closed,0);assert.equal(b.unresolved.pending.entryAfter,T+D);
});
test('delayed data can settle a saved future intent but cannot originate a new trade',()=>{
  const f=fixture(T+2*D,{high:116});
  const r=Demo.advance(planned(),f.snapshot,f.analysis,T+2*D+180000);
  assert.equal(r.lab.books[3].closed,1);assert.equal(r.record.freshDecision,false);
  assert.equal(r.lab.books[3].pending,null);
  assert.match(r.lab.books[0].lastDecision.reason,/120秒/);
});
test('known GOLD pause has no new entry and exits a holding at a real prior close',()=>{
  const f=fixture();f.snapshot.asset='gold';f.snapshot.symbol='XAUUSDT';
  const initial=Demo.create('gold',T-D,VERSION);initial.lastSnapshotId='gold-seed';initial.lastClosedAt=T-D;
  const blocked=Demo.advance(initial,f.snapshot,f.analysis,T+20000,t=>t<T+D);
  assert.equal(blocked.lab.books[3].pending,null);
  let r=Demo.advance(initial,f.snapshot,f.analysis,T+20000,()=>true);
  let lab=Demo.acknowledge(r.lab,f.snapshot.id,T+21000).lab;
  const next=fixture(T+2*D,{high:104,low:96,close:103});next.snapshot.asset='gold';
  r=Demo.advance(lab,next.snapshot,next.analysis,T+2*D+20000,t=>t<T+3*D);
  assert.equal(r.lab.books[3].recentTrades[0].exit,103);
  assert.match(r.lab.books[3].recentTrades[0].reason,/休止前/);
});
test('future feature frames, blackout and a new code partition cannot bypass gates',()=>{
  const f=fixture();f.analysis.h4.candles[0].time=T;
  const r=Demo.advance(seed(),f.snapshot,f.analysis,T+20000);assert.equal(r.lab.books[3].pending,null);
  const g=fixture();g.analysis.marketMap.eventRisk.blocked=true;
  assert.equal(Demo.advance(seed(),g.snapshot,g.analysis,T+20000).lab.books[3].pending,null);
  const h=fixture();h.snapshot.version='9';assert.throws(()=>Demo.advance(seed(),h.snapshot,h.analysis,T+20000),/IDENTITY/);
});
test('EXIT by itself never seeds a reversal and missing decisions cancel a saved watch',()=>{
  const f=fixture();f.analysis.actionable=false;f.analysis.exec.flow.latest.exitLong=true;
  const lab=seed();lab.books[1].watch={kind:'sweep',direction:'LONG',stop:90,expiresAt:T+4*D};
  const later=fixture(T+3*D);later.analysis.actionable=false;
  const r=Demo.advance(lab,later.snapshot,later.analysis,T+3*D+20000);
  assert.ok(r.lab.books.every(b=>!b.pending&&!b.position));assert.equal(r.lab.books[1].watch,null);
});
test('confirmation counts two full departure bars and saves each reference before the next trigger',()=>{
  let lab=seed();const w={kind:'zone',zone:{low:94,high:95,type:'OB'},direction:'LONG',stop:93,target:125,
    atr:2,armBarAt:T-4*D,expiresAt:T+16*D,durableAt:T-3*D,referenceDurableAt:T-3*D,
    stage:'TOUCH1_WAIT',touches:0,departureCount:0};lab.books[2].watch=w;
  function step(closedAt,patch){const f=fixture(closedAt,patch);f.analysis.actionable=false;f.analysis.htfBias='bull';
    f.analysis.exec.flow.latest.ribbon=1;
    const r=Demo.advance(lab,f.snapshot,f.analysis,closedAt+20000);lab=Demo.acknowledge(r.lab,f.snapshot.id,closedAt+21000).lab;return lab.books[2];}
  let b=step(T,{open:95,low:94.5,high:97,close:96});assert.equal(b.watch.stage,'DEPARTURE_WAIT');
  b=step(T+D,{open:97,low:96,high:99,close:98});assert.equal(b.watch.departureCount,0); // bar opened before T1 save
  b=step(T+2*D,{open:97,low:96,high:99,close:98});assert.equal(b.watch.departureCount,1);
  b=step(T+3*D,{open:97,low:96,high:99,close:98});assert.equal(b.watch.stage,'TOUCH2_WAIT');
  b=step(T+4*D,{open:95,low:94.5,high:97,close:96});assert.equal(b.watch.touches,1); // departure was not saved before this open
  b=step(T+5*D,{open:95,low:94.5,high:97,close:96});assert.equal(b.watch.stage,'CONFIRM_WAIT');assert.equal(b.watch.touches,2);
  b=step(T+6*D,{open:97,low:96,high:101,close:100});assert.equal(b.pending,null);
  b=step(T+7*D,{open:97,low:96,high:101,close:100});assert.equal(b.pending.direction,'LONG');
});

class MemoryStorage {
  constructor(){this.data=new Map();this.fail=false;}
  async get(k){return this.data.has(k)?structuredClone(this.data.get(k)):undefined;}
  async put(obj){for(const [k,v] of Object.entries(obj))this.data.set(k,structuredClone(v));}
  async sync(){}
  async transaction(fn){const copy=new MemoryStorage();copy.data=structuredClone(this.data);await fn(copy);
    if(this.fail)throw new Error('WRITE_FAILURE');this.data=copy.data;}
  async list({prefix,startAfter,limit}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort().slice(0,limit));}
}
test('journal transaction rolls back and repeated observation is not appended again',async()=>{
  const {observeDemo,demoJournal,demoView}=await import('../cloudflare/demo-store.mjs');
  const n=Date.now(),closed=Math.floor(n/D)*D,g=fixture(closed);g.snapshot.createdAt=n;
  const initial=Demo.create('btc',n-2*D,VERSION);initial.lastClosedAt=closed-D;initial.lastSnapshotId='seed';
  const storage=new MemoryStorage();
  await storage.put({'demo:demo-v1':initial});storage.fail=true;
  await assert.rejects(observeDemo(storage,g.snapshot,g.analysis,n,()=>true),/WRITE_FAILURE/);
  assert.equal(storage.data.size,1);storage.fail=false;
  // Register-only fixture uses present wall time; no real feed or order is contacted.
  await observeDemo(storage,g.snapshot,g.analysis,n,()=>true);
  const first=await demoJournal(storage);const count=first.records.length;
  await observeDemo(storage,g.snapshot,g.analysis,n+1000,()=>true);
  assert.equal((await demoJournal(storage)).records.length,count);
  assert.ok(first.records[0].hash);assert.ok(first.records[0].sourceHash);
  const view=await demoView(storage,'btc',n,'MARKET_CLOSED');assert.equal(view.status,'MARKET_CLOSED');assert.equal(view.chain,undefined);
});

test('SHORT uses mirrored price rules and freezes its original SL and TP',()=>{
  const f=fixture();f.analysis.direction='SHORT';f.analysis.plan={stop:105,tp2:85};
  let lab=Demo.advance(seed(),f.snapshot,f.analysis,T+20000).lab;
  lab=Demo.acknowledge(lab,f.snapshot.id,T+21000).lab;
  const next=fixture(T+2*D,{open:100,high:106,low:84,close:90});
  const b=Demo.advance(lab,next.snapshot,next.analysis,T+2*D+20000).lab.books[3];
  assert.equal(b.recentTrades[0].exit,105);assert.equal(b.recentTrades[0].direction,'SHORT');
  assert.equal(b.recentTrades[0].stop,105);assert.equal(b.recentTrades[0].target,85);assert.ok(b.realizedNet<0);
});
test('the 32-bar expiry includes the entry candle and never trails the stop',()=>{
  let lab=planned();
  for(let i=2;i<=33;i++){
    const f=fixture(T+i*D,{open:100,low:96,high:104,close:101});f.analysis.actionable=false;
    lab=Demo.advance(lab,f.snapshot,f.analysis,T+i*D+20000).lab;
    if(i<33){assert.equal(lab.books[3].position.stop,95);assert.equal(lab.books[3].position.target,115);}
  }
  assert.equal(lab.books[3].recentTrades[0].heldBars,32);
  assert.equal(lab.books[3].recentTrades[0].exit,101);assert.equal(lab.books[3].closed,1);
});
test('BB-return alone cannot confirm a reversal; fixed target stays at the sweep-time mean',()=>{
  let lab=seed();const f=fixture();f.analysis.actionable=false;
  f.analysis.exec.candles[0].close=85;f.analysis.exec.candles[0].low=84;f.analysis.exec.candles[0].open=86;
  Object.assign(f.analysis.exec.candles[1],{open:94,high:96,low:89,close:94});
  Object.assign(f.analysis.exec.values,{close:94,ema20:110,ema50:111,bbLower:90,bbUpper:120});
  f.analysis.exec.series.bb.mid=[112,112];f.analysis.exec.smc.events=[{type:'SWEEP',side:'bull',time:T-D,price:92}];
  lab=Demo.advance(lab,f.snapshot,f.analysis,T+20000).lab;
  assert.equal(lab.books[1].watch.target,110);
  lab=Demo.acknowledge(lab,f.snapshot.id,T+21000).lab;
  const middle=fixture(T+D,{open:95,low:94,high:97,close:96});middle.analysis.actionable=false;
  Object.assign(middle.analysis.exec.values,{close:96,ema20:112,ema50:114,bbLower:90,bbUpper:120});middle.analysis.exec.series.bb.mid=[115,115];
  lab=Demo.advance(lab,middle.snapshot,middle.analysis,T+D+20000).lab;
  const next=fixture(T+2*D,{open:95,low:94,high:97,close:96});next.analysis.actionable=false;
  Object.assign(next.analysis.exec.values,{close:96,ema20:112,ema50:114,bbLower:90,bbUpper:120});next.analysis.exec.series.bb.mid=[115,115];
  const r=Demo.advance(lab,next.snapshot,next.analysis,T+2*D+20000);
  assert.equal(r.lab.books[1].pending,null);assert.equal(r.lab.books[1].watch.target,110);
  next.analysis.exec.smc.events=[{type:'BOS',side:'bull',time:T+D,price:95}];
  const q=Demo.advance(lab,next.snapshot,next.analysis,T+2*D+20000);
  assert.equal(q.lab.books[1].pending.target,110);assert.equal(q.lab.books[1].pending.stop,88.7);
});
test('clock reversal cannot acknowledge a candidate before its observation',()=>{
  const f=fixture(),lab=Demo.advance(seed(),f.snapshot,f.analysis,T+20000).lab;
  assert.throws(()=>Demo.acknowledge(lab,f.snapshot.id,T+19999),/CLOCK_REVERSAL/);
});

test('public demo endpoints expose fictional records only and keep all writes authenticated',async()=>{
  const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
  const file=path.resolve(__dirname,'../cloudflare/monitor.mjs');
  let source=fs.readFileSync(file,'utf8').replace("'cloudflare:workers'",JSON.stringify('data:text/javascript,export class DurableObject {}'));
  source=source.replace(/from '([.][^']+)'/g,(_,name)=>'from '+JSON.stringify(pathToFileURL(path.resolve(path.dirname(file),name)).href));
  const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
  let reads=0;const env={MONITOR:{getByName:()=>({demo:async()=>{reads++;return {books:[]};},demoHistory:async()=>({records:[]}),demoOriginal:async()=>null})},ADMIN_TOKEN:'test-secret',ALERTS_ENABLED:'true'};
  const response=await worker.fetch(new Request('https://example.test/api/demo?asset=btc'),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(reads,1);
  assert.equal((await worker.fetch(new Request('https://example.test/api/demo?asset=bad'),env)).status,400);
  assert.equal((await worker.fetch(new Request('https://example.test/api/demo/journal?asset=btc&limit=201'),env)).status,400);
  assert.equal((await worker.fetch(new Request('https://example.test/api/demo/source?asset=btc&id=gold-1-4.3.4'),env)).status,400);
  assert.equal((await worker.fetch(new Request('https://example.test/api/demo?asset=btc',{method:'POST'}),env)).status,404);
  assert.equal((await worker.fetch(new Request('https://example.test/run?asset=btc',{method:'POST'}),env)).status,404);
  assert.equal(reads,1);
});
