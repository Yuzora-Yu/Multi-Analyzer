const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Events = require('../alert-event');
const Feed = require('../market-feed');
const time = value => Date.parse(value);
const setup = now => ({actionable:true,state:'READY_LONG',direction:'LONG',generatedAt:now,
  exec:{candles:[{time:now-900000}]},plan:{entry:100,stop:99,tp1:101,tp2:102,tp3:103}});

test('GOLD notification schedule uses JST midnight boundaries; BTC remains 24/7', () => {
  for (const [iso,allowed] of [
    ['2026-10-09T23:59:59.999+09:00',true],
    ['2026-10-10T00:00:00+09:00',false],
    ['2026-10-11T23:59:59.999+09:00',false],
    ['2026-10-12T00:00:00+09:00',true]]) {
    assert.equal(Events.alertPolicy('gold',time(iso)).allowed,allowed,iso);
    assert.equal(Events.alertPolicy('btc',time(iso)).allowed,true,iso);
  }
});

test('both entry and exit events are muted on weekends, including delayed weekend candles', () => {
  const saturday=time('2026-10-10T12:00:00+09:00');
  const monday=time('2026-10-12T00:00:00+09:00');
  const a=setup(saturday);
  assert.equal(Events.eventFor(a,'gold',null,{now:saturday}),null);
  assert.ok(Events.eventFor(a,'btc',null,{now:saturday}));
  a.positionDecision={action:'EXIT_LONG',reasons:['stop']};
  assert.equal(Events.eventFor(a,'gold',{entry:100,stop:99},{now:saturday}),null);
  assert.equal(Events.eventFor(a,'gold',{entry:100,stop:99},{now:monday}),null);
  assert.ok(Events.eventFor(setup(monday+1800000),'gold',null,{now:monday+1800000}));
});

// Run the actual delivery path with storage and market I/O isolated; never send real mail.
function monitorHarness(now, asset, exit=false, sendNow=now, map=null) {
  const bars=Array.from({length:220},(_,i)=>({time:now-(220-i)*900000,close:100,volume:1}));
  const a=setup(now); a.exec.candles=bars;
  if(map)a.marketMap=map;
  if(exit)a.positionDecision={action:'EXIT_LONG',reasons:['stop']};
  const saved=new Map([['state',{feed:'bybit-v1',baseline:true,delivered:{},cache:{},day:new Date(now).toISOString().slice(0,10),count:0,archives:[],paperPosition:exit?{entry:100,stop:99,direction:'LONG'}:null}]]);
  const sent=[]; let clock=now,requests=0;
  const storage={get:async key=>saved.get(key),delete:async key=>saved.delete(key),put:async (key,value)=>{
    if(typeof key==='string')saved.set(key,value);else for(const [k,v] of Object.entries(key))saved.set(k,v);
    if(typeof key==='string' && key.startsWith('alert:'))clock=sendNow;
  }};
  class DO {constructor(){this.ctx={storage};this.env={ALERTS_ENABLED:'true',EMAIL_TO:'test@example.invalid',EMAIL:{send:async mail=>sent.push(mail)}};}}
  class Clock extends Date {static now(){return clock;}}
  const core={VERSION:'4.3.2',DEFAULTS:{},normalizeCandles:x=>x,filterClosedCandles:x=>x,analyzeMarket:()=>a};
  const feed={...Feed,collectionPolicy:(asset,t)=>Feed.collectionPolicy(asset,t??clock),load:async(asset,minutes,limit,get)=>get('https://example.invalid/market'),pack:x=>x,input:x=>x};
  const source=fs.readFileSync(require.resolve('../cloudflare/monitor.mjs'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export class MarketMonitor','class MarketMonitor').split('const authorized=')[0]+'\nMarketMonitor';
  const Type=vm.runInNewContext(source,{DurableObject:DO,Core:core,Feed:feed,Events,canReuse:()=>false,Date:Clock,fetch:async()=>{requests++;return new Response(JSON.stringify(bars));},Response,AbortSignal,Uint8Array,TextDecoder,console:{log(){}}});
  return {run:()=>new Type().perform(asset,false),sent,saved,get requests(){return requests;}};
}

test('cloud pauses weekend GOLD without any market I/O or position changes; BTC continues',async()=>{
  const now=time('2026-10-10T12:00:00+09:00');
  for(const exit of [false,true]){
    const h=monitorHarness(now,'gold',exit);const status=await h.run();
    assert.equal(status.error,null); assert.equal(status.emailEnabled,false);
    assert.equal(status.alertSchedule.reason,'GOLD_WEEKEND_JST');
    assert.equal(h.sent.length,0);assert.equal(h.requests,0);assert.equal(status.state,'MARKET_CLOSED');
    assert.equal(Boolean(h.saved.get('state').paperPosition),exit);
  }
  const btc=monitorHarness(now,'btc');await btc.run();assert.equal(btc.sent.length,1);
});

test('cloud zone briefing does not manufacture a virtual holding or require a P entry',async()=>{
  const now=time('2026-10-06T12:45:00+09:00');
  const map={valid:true,price:100,bias:'下向き',entryState:'条件待ち',trends:[],
    candidates:[{id:'15m:OB:bear:1',direction:'SHORT',low:101,high:103,phase:'APPROACH',distance:1,
      evidence:['15m OB','15m EMA20'],condition:'反落確認',invalidationClose:103,protectiveStop:104,targets:[98],role:'上位足に沿う候補'}],
    eventRisk:{blocked:false,events:[],message:'予定確認'},note:'接触だけでは入らない'};
  const h=monitorHarness(now,'gold',false,now,map);await h.run();
  assert.equal(h.sent.length,1);assert.match(h.sent[0].subject,/候補 101～103/);
  assert.equal(h.saved.get('state').paperPosition,null);
  const status=h.saved.get('status');assert.equal(status.notificationMode,'ZONE_ANALYSIS');
});

test('cloud checks delivery time again when storage crosses Saturday midnight',async()=>{
  const friday=time('2026-10-09T23:59:59+09:00'),saturday=time('2026-10-10T00:00:00+09:00');
  const h=monitorHarness(friday,'gold',false,saturday);const status=await h.run();
  assert.equal(h.sent.length,0);assert.equal(status.alertSchedule.allowed,false);
  const weekday=monitorHarness(time('2026-10-12T12:00:00+09:00'),'gold');await weekday.run();assert.equal(weekday.sent.length,1);
});
