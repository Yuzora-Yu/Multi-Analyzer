'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Review=require('../review-pack'),Core=require('../strategy-core'),Feed=require('../market-feed');
const url=(symbol='XAUUSDT',end='1791424800000')=>'https://api.bybit.com/v5/market/kline?category=linear&symbol='+symbol+'&interval=60&limit=1000&end='+end;
const payload=()=>({retCode:0,time:1791424800123,result:{category:'linear',symbol:'XAUUSDT',list:[['1791421200000','100','102','99','101','50']]}});

test('capture-local pages retain their original receipt and are isolated from caller mutation and later captures',async()=>{
 let calls=0,wall=1000;const fetcher=async()=>{calls++;return{ok:true,status:200,json:async()=>payload()};};
 const a=Review.captureTransport({fetcher,now:()=>wall++});
 const first=await a.get(url(),{asset:'gold',tf:'1h'});first.result.list[0][4]='999';
 const second=await a.get(url(),{asset:'gold',tf:'4h'});assert.equal(second.result.list[0][4],'101');
 assert.equal(calls,1);assert.equal(a.trace.uses[1].reused,true);
 assert.equal(a.trace.uses[1].originalReceivedAt,a.trace.requests[0].receivedAt);
 assert.ok(a.trace.uses[1].usedAt>a.trace.uses[1].originalReceivedAt);
 assert.equal(a.trace.uses[1].requestId,a.trace.uses[0].requestId);
 await Review.captureTransport({fetcher}).get(url());assert.equal(calls,2);
});

test('different end, symbol and snapshot requests never share an earlier page',async()=>{
 let calls=0;const t=Review.captureTransport({fetcher:async u=>{calls++;const data=payload();data.result.symbol=new URL(u).searchParams.get('symbol')||'XAUUSDT';return{ok:true,status:200,json:async()=>data};}});
 await t.get(url());await t.get(url('XAUUSDT','1791424800001'));await t.get(url('BTCUSDT'));
 await t.get('https://multi-analyzer-monitor.rikai-829.workers.dev/api/snapshot?asset=gold');
 await t.get('https://multi-analyzer-monitor.rikai-829.workers.dev/api/snapshot?asset=gold');
 assert.equal(calls,5);assert.equal(t.trace.uses.filter(x=>x.reused).length,0);
});

test('HTTP failures, Bybit errors and malformed candles are not retained as successful pages',async()=>{
 for(const kind of ['http','bybit','malformed']){
  let calls=0;const t=Review.captureTransport({fetcher:async()=>{calls++;const data=payload();if(calls===1){if(kind==='http')return{ok:false,status:503};if(kind==='bybit')data.retCode=10006;else data.result.list[0][3]='bad';}return{ok:true,status:200,json:async()=>data};}});
  if(kind==='http')await assert.rejects(t.get(url()),/HTTP 503/);else await t.get(url());
  await t.get(url());await t.get(url());assert.equal(calls,2);
  assert.notEqual(t.trace.requests[0].shareable,true);
 }
});

test('cancellation applies even when the requested page is already shared',async()=>{
 const controller=new AbortController();let calls=0;
 const t=Review.captureTransport({signal:controller.signal,fetcher:async()=>{calls++;return{ok:true,status:200,json:async()=>payload()};}});
 await t.get(url());controller.abort(new Error('capture cancelled'));
 await assert.rejects(t.get(url()),/capture cancelled/);assert.equal(calls,1);
});

test('request durations use monotonic time when the local wall clock reverses',async()=>{
 let wall=1000,tick=0;const t=Review.captureTransport({now:()=>wall-=100,monotonic:()=>tick+=7,fetcher:async()=>({ok:true,status:200,json:async()=>payload()})});
 await t.get(url());assert.equal(t.trace.requests[0].durationMs,7);
 assert.ok(t.trace.requests[0].receivedAt<t.trace.requests[0].requestedAt);
});

test('Gold closure checks still stop paginated loads before any shared page is used',async(t)=>{
 let calls=0;const transport=Review.captureTransport({fetcher:async()=>{calls++;return{ok:true,status:200,json:async()=>payload()};}});
 await transport.get(url());t.mock.method(Date,'now',()=>Date.UTC(2026,9,10,3));
 await assert.rejects(Feed.load('gold',60,1,u=>transport.get(u),1791424800000),/GOLD_MARKET_CLOSED/);
 assert.equal(calls,1);assert.equal(transport.trace.uses.length,1);
});

test('session-filtered Gold H1/H4/daily share identical pages with unchanged closed bars and canonical decisions',async(t)=>{
 const cutoff=Date.UTC(2026,9,8,2),canonical=m=>Array.from({length:300},(_,i)=>({time:cutoff-(300-i)*m*60000,open:100,high:102,low:99,close:101,volume:50}));
 const snapshot={id:'gold-pages',asset:'gold',version:Core.VERSION,settings:{...Core.DEFAULTS,now:cutoff,executionMinutes:15,market:'futures'},bars:{m15:Feed.pack(canonical(15)),h1:Feed.pack(canonical(60)),h4:Feed.pack(canonical(240))}};
 global.MultiAnalyzerCore=Core;global.MultiAnalyzerFeed=Feed;t.mock.method(Date,'now',()=>cutoff);
 let calls=0;t.mock.method(global,'fetch',async u=>{
  calls++;if(u.includes('/api/snapshot'))return{ok:true,status:200,json:async()=>structuredClone(snapshot)};
  const q=new URL(u).searchParams,m=Number(q.get('interval')),last=Math.floor(Number(q.get('end'))/(m*60000))*m*60000;
  const data={retCode:0,time:cutoff,result:{category:q.get('category'),symbol:q.get('symbol'),list:Array.from({length:1000},(_,i)=>[String(last-i*m*60000),'100','102','99','101','50'])}};
  return{ok:true,status:200,json:async()=>data};
 });
 const before=JSON.stringify(snapshot),baseline=await Review.collect(['gold'],{archivedId:snapshot.id,sharePages:false}),baselineCalls=calls;calls=0;
 const shared=await Review.collect(['gold'],{archivedId:snapshot.id}),sharedCalls=calls;
 const semantic=p=>p.records.map(({asset,tf,minutes,rows,analysis,signal,cutoff,decisionCutoff,timeBasis,snapshotId})=>({asset,tf,minutes,rows,analysis,signal,cutoff,decisionCutoff,timeBasis,snapshotId}));
 assert.deepEqual(semantic(shared),semantic(baseline));assert.deepEqual(shared.errors,baseline.errors);assert.equal(shared.records.length,6);
 assert.ok(sharedCalls<baselineCalls);assert.equal(baselineCalls-sharedCalls,shared.acquisition.uses.filter(x=>x.reused).length);
 t.diagnostic(`Offline fixture only: ${baselineCalls} requests without sharing; ${sharedCalls} with sharing; ${baselineCalls-sharedCalls} duplicate page requests avoided.`);
 assert.ok(shared.acquisition.uses.some(x=>x.reused&&x.tf==='4h'));assert.ok(shared.acquisition.uses.some(x=>x.reused&&x.tf==='1d'));
 assert.equal(shared.records.find(x=>x.tf==='15m').acquisitionUseIds.length,0);
 for(const r of shared.records)assert.ok(r.rows.every(b=>b.time+r.minutes*60000<=r.cutoff));
 assert.equal(JSON.stringify(snapshot),before);
 assert.equal(shared.acquisition.frames.length,6);
 for(const request of shared.acquisition.requests)assert.ok(Number.isFinite(request.durationMs)&&request.durationMs>=0);
});
