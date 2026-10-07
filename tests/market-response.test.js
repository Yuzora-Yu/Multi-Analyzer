const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../cloudflare/market-response.mjs');
const context={asset:'gold',interval:15};
async function rejected(get,kind,fields={}){
  const {fetchBybitCandles,responseDiagnostic}=await modulePromise;let calls=0;
  await assert.rejects(fetchBybitCandles('https://example.invalid/?apikey=private-secret',async u=>{calls++;return get(u);},context),e=>{
    assert.equal(e.message,kind);const d=responseDiagnostic(e);assert.equal(d.kind,kind);assert.equal(d.asset,'gold');assert.equal(d.interval,15);assert.ok(d.finishedAt>=d.startedAt);
    for(const [k,v]of Object.entries(fields))assert.equal(d[k],v);
    assert.ok(!JSON.stringify({message:e.message,diagnostic:d}).includes('private-secret'));return true;
  });assert.equal(calls,1);
}
test('valid response preserves the original candle envelope and Feed result',async()=>{
  const {fetchBybitCandles}=await modulePromise,Feed=require('../market-feed');const raw={retCode:0,retMsg:'OK',result:{list:[['1','2','3','1','2','5']]},time:2};
  const result=await fetchBybitCandles('unused',async()=>Response.json(raw),context);assert.deepEqual(result,raw);assert.deepEqual(Feed.parse(result),Feed.parse(raw));
});
test('HTTP, Bybit numeric code and malformed envelope remain distinct without echoing payload',async()=>{
  await rejected(()=>new Response('private-secret',{status:429}),'HTTP_ERROR',{httpStatus:429});
  await rejected(()=>Response.json({retCode:10006,retMsg:'private-secret',result:{}}),'BYBIT_RET_CODE',{httpStatus:200,bybitCode:10006});
  await rejected(()=>Response.json({retCode:0,retMsg:'private-secret',result:{}}),'MISSING_CANDLE_LIST',{bybitCode:0});
  await rejected(()=>Response.json({retCode:'0',secret:'private-secret'}),'INVALID_ENVELOPE');
  await rejected(()=>new Response('private-secret'),'INVALID_JSON');
});
test('oversized and interrupted streams release readers without retaining bodies',async()=>{
  let cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array(500001));},cancel(){cancelled=true;}});
  await rejected(()=>new Response(stream),'BODY_TOO_LARGE');assert.equal(cancelled,true);assert.equal(stream.locked,false);
  const broken=new ReadableStream({start(c){c.error(new Error('private-secret'));}});
  await rejected(()=>new Response(broken),'BODY_READ_ERROR');assert.equal(broken.locked,false);
});
test('network and timeout errors redact arbitrary messages and never retry',async()=>{
  await rejected(()=>{throw new Error('private-secret');},'NETWORK_ERROR');
  await rejected(()=>{throw new DOMException('private-secret','TimeoutError');},'TIMEOUT');
  const {responseDiagnostic}=await modulePromise;assert.equal(responseDiagnostic(new Error('anything')),null);
});
