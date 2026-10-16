const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(asset='btc') {
  const {scopeMonitor,scopedFetch}=await import('../cloudflare/gold-only-policy.mjs');
  const data=new Map([['asset',asset],['state',{paperPosition:{direction:'LONG'},delivered:{old:1}}],['demo:original',{version:'demo-v1',sequence:10}],['status',{snapshotId:'original',updatedAt:123,state:'NO_TRADE'}]]);
  let alarm=456;const calls=[];
  const storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),getAlarm:async()=>alarm,deleteAlarm:async()=>{alarm=null;}};
  class Fixed {
    constructor(){this.ctx={storage};}
    async start(...args){calls.push(['start',...args]);return 'gold-start';}
    async tick(...args){calls.push(['tick',...args]);return 'gold-tick';}
    async perform(...args){calls.push(['perform',...args]);return 'gold-perform';}
    async alarm(){calls.push(['alarm']);return 'gold-alarm';}
    async status(){calls.push(['status']);return data.get('status');}
  }
  return {object:new (scopeMonitor(Fixed))(),data,calls,scopedFetch};
}
test('all BTC execution paths clear the alarm without executing the fixed engine or altering archives',async()=>{
  const f=await fixture(),state=structuredClone(f.data.get('state')),demo=structuredClone(f.data.get('demo:original'));
  const first=await f.object.stopBtc();assert.equal(first.nextRunAt,null);assert.equal(first.emailEnabled,false);assert.equal(first.demoEvaluationEnabled,false);
  for(const method of ['start','tick','perform'])assert.equal((await f.object[method]('btc',false)).state,'USER_STOPPED');
  assert.equal((await f.object.alarm()).stoppedAt,first.stoppedAt);
  assert.equal((await f.object.status()).nextRunAt,null);assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.data.get('state'),state);assert.deepEqual(f.data.get('demo:original'),demo);
  assert.deepEqual(f.data.get('status'),{snapshotId:'original',updatedAt:123,state:'NO_TRADE'});
  assert.equal(f.data.size,5);
});
test('Gold methods delegate unchanged and its partition cannot be stopped by the BTC operation',async()=>{
  const f=await fixture('gold');await assert.rejects(f.object.stopBtc(),/STOP_PARTITION_MISMATCH/);
  assert.equal(await f.object.start('gold'),'gold-start');assert.equal(await f.object.tick('gold',true),'gold-tick');
  assert.equal(await f.object.perform('gold',false),'gold-perform');assert.equal(await f.object.alarm(),'gold-alarm');
  assert.deepEqual(await f.object.status(),f.data.get('status'));
  assert.deepEqual(f.calls,[['start','gold'],['tick','gold',true],['perform','gold',false],['alarm'],['status']]);
  assert.equal(f.data.has('operation:btc-stopped'),false);
});
test('public monitoring reads only Gold while BTC routes never reach old collection or notification code',async()=>{
  const f=await fixture('gold'),selected=[],env={ALERTS_ENABLED:'true',MONITOR:{getByName:a=>{selected.push(a);return f.object;}}};
  const fixed={fetch(){throw Error('Unexpected legacy request');}};
  const monitor=await f.scopedFetch(new Request('https://monitor.test/api/monitor'),env,{},fixed),json=await monitor.json();
  assert.deepEqual(Object.keys(json.assets),['gold']);assert.deepEqual(selected,['gold']);assert.equal(monitor.headers.get('cache-control'),'no-store');
  for(const path of ['/api/snapshot?asset=btc','/api/demo?asset=btc','/api/demo/journal?asset=btc','/run?asset=btc','/start?asset=btc','/api/snapshot?asset=gold&id=btc-123-4.3.4']){
    const response=await f.scopedFetch(new Request('https://monitor.test'+path),env,{},fixed);assert.equal(response.status,410);
  }
  assert.deepEqual(selected,['gold']);
});
test('stopping an existing BTC partition requires authenticated POST and preserves history',async()=>{
  const f=await fixture(),env={ADMIN_TOKEN:'test-only',MONITOR:{getByName:a=>{assert.equal(a,'btc');return f.object;}}};
  const req=(method,token)=>new Request('https://monitor.test/ops/stop-btc',{method,headers:token?{Authorization:'Bearer '+token}:{}});
  assert.equal((await f.scopedFetch(req('POST','wrong'),env,{},{})).status,404);
  assert.equal((await f.scopedFetch(req('GET','test-only'),env,{},{})).status,405);
  assert.equal(f.data.has('operation:btc-stopped'),false);
  const response=await f.scopedFetch(req('POST','test-only'),env,{},{});assert.equal(response.status,200);
  assert.equal((await response.json()).nextRunAt,null);assert.deepEqual(f.calls,[]);
});
test('Gold snapshot and admin routes retain the original request, bindings and behavior',async()=>{
  const {scopedFetch}=await fixture(),request=new Request('https://monitor.test/api/snapshot?asset=gold'),env={},ctx={};
  const response=await scopedFetch(request,env,ctx,{fetch(r,e,c){assert.equal(r,request);assert.equal(e,env);assert.equal(c,ctx);return new Response('fixed');}});
  assert.equal(await response.text(),'fixed');
});
