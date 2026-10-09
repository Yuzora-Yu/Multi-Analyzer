'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Review=require('../review-pack.js'),Feed=require('../market-feed.js');
const {multiframeErrorEvidence}=require('../research-observer.cjs');
async function failedPack({httpStatus=200,retCode=10006,list=null}={}){
  let wall=1000,calls=0;
  const transport=Review.captureTransport({now:()=>wall++,fetcher:async()=>{
    calls++;return {ok:httpStatus>=200&&httpStatus<300,status:httpStatus,
      json:async()=>({retCode,result:{list},retMsg:'must-not-copy'})};
  }});
  const pack={errors:[],records:[],acquisition:transport.trace};
  for(const [tf,minutes] of [['5m',5],['1h',60]]){
    const frame={asset:'gold',tf,startedAt:wall++,status:'pending'};transport.trace.frames.push(frame);
    try{Feed.parse(await transport.get(Feed.url('gold',minutes),{asset:'gold',tf}));}
    catch(e){frame.status='failed';frame.error=e.message;pack.errors.push({asset:'gold',tf,error:e.message});}
    finally{frame.completedAt=wall++;}
  }
  return {pack,calls};
}
test('saved HTTP200 error codes survive generic candle errors without fetching or altering the original capture',async t=>{
  const {pack,calls}=await failedPack(),before=JSON.stringify(pack);
  t.mock.method(global,'fetch',()=>{throw Error('No new fetch allowed');});
  const rows=multiframeErrorEvidence(pack);assert.equal(calls,2);assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>[r.tf,r.httpStatus,r.bybitCode,r.kind]),
    [['5m',200,10006,'BYBIT_RET_CODE'],['1h',200,10006,'BYBIT_RET_CODE']]);
  for(const row of rows){const request=pack.acquisition.requests[row.requestId];
    assert.equal(row.requestedAt,request.requestedAt);assert.equal(row.receivedAt,request.receivedAt);
    assert.equal(row.completedAt,request.completedAt);assert.equal(row.evidenceStatus,'RECORDED');
  }
  assert.equal(JSON.stringify(pack),before);assert.equal(pack.records.length,0);
});
test('HTTP failures retain status and completion separately without inventing a response receipt or exposing raw fields',async()=>{
  const {pack}=await failedPack({httpStatus:503});
  for(const r of pack.acquisition.requests){r.url+='&signature=must-not-copy';r.error='must-not-copy';r.headers={'x-secret':'must-not-copy'};}
  const rows=multiframeErrorEvidence(pack);
  for(const r of rows){assert.equal(r.kind,'HTTP_STATUS');assert.equal(r.httpStatus,503);assert.equal(r.receivedAt,null);assert.equal(r.bybitCode,null);}
  assert.equal(JSON.stringify(rows).includes('must-not-copy'),false);
  assert.equal(JSON.stringify(rows).includes('url'),false);
});
test('a generic shape or analysis failure does not become a rate-limit diagnosis',async()=>{
  for(const retCode of [0,null,10006.5]){
    const {pack}=await failedPack({retCode}),rows=multiframeErrorEvidence(pack);
    assert.ok(rows.every(r=>r.kind==='UNCLASSIFIED_FRAME_FAILURE'));
    assert.ok(rows.every(r=>r.bybitCode===(retCode===0?0:null)));
  }
  assert.deepEqual(multiframeErrorEvidence({errors:[],acquisition:{}}),[]);
  assert.equal(multiframeErrorEvidence({errors:[{asset:'gold',tf:'all',error:'closed'}]})[0].evidenceStatus,'UNAVAILABLE');
});
test('inconsistent timestamps, duplicate identities, wrong markets and ambiguous frames cannot provide causal error evidence',async()=>{
  const {pack}=await failedPack();
  const mutate=[
    p=>p.acquisition.requests[0].requestedAt=p.acquisition.frames[0].startedAt-1,
    p=>p.acquisition.requests[0].receivedAt=p.acquisition.requests[0].completedAt+1,
    p=>p.acquisition.requests[0].completedAt=p.acquisition.frames[0].completedAt+1,
    p=>p.acquisition.requests[0].status='pending',
    p=>p.acquisition.requests.push(structuredClone(p.acquisition.requests[0])),
    p=>p.acquisition.frames.push(structuredClone(p.acquisition.frames[0])),
    p=>p.acquisition.requests[0].url=Feed.url('btc',5),
    p=>p.acquisition.requests[0].url='https://example.com/v5/market/kline',
    p=>p.acquisition.frames[0].completedAt=p.acquisition.frames[0].startedAt-1
  ];
  for(const change of mutate){const p=structuredClone(pack);change(p);const row=multiframeErrorEvidence(p)[0];
    assert.equal(row.evidenceStatus,'UNAVAILABLE');assert.equal(row.bybitCode,undefined);
  }
  const p=structuredClone(pack);p.acquisition.requests.unshift({id:20,asset:'btc',tf:'5m',bybitCode:10006});
  assert.equal(multiframeErrorEvidence(p)[0].evidenceStatus,'RECORDED');
});
