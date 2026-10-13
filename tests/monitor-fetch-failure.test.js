const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url'),H=require('../snapshot-health');
const NOW=Date.parse('2026-10-13T17:02:32+09:00'),D=900000;

// Exercise the unchanged Worker with isolated storage and simulated public responses.
// No market requests, demo observations or email deliveries leave this process.
async function fixture(t,failedInterval){
  const original={id:'btc-1791876600000-4.3.4',asset:'btc',version:'4.3.4',createdAt:1791877509521,
    bars:{m15:[[1791876600000,1,2,1,2,1]],h1:[],h4:[]}};
  const state={feed:'bybit-v1',baseline:true,delivered:{previous:NOW-D},cache:{},
    day:new Date(NOW).toISOString().slice(0,10),count:0,archives:[original.id],
    paperPosition:{direction:'LONG',entry:100,stop:99,referenceOnly:true}};
  const saved=new Map([['asset','btc'],['state',state],['snapshot',original],['snapshot:'+original.id,original]]);
  const writes=[],alarms=[],requests=[],sent=[];
  const storage={get:async k=>structuredClone(saved.get(k)),put:async(k,v)=>{
    const entries=typeof k==='string'?[[k,v]]:Object.entries(k);
    for(const [key,value] of entries){writes.push(key);saved.set(key,structuredClone(value));}
  },delete:async k=>saved.delete(k),setAlarm:async at=>alarms.push(at),getAlarm:async()=>alarms.at(-1)};
  t.mock.method(Date,'now',()=>NOW);
  t.mock.method(globalThis,'fetch',async url=>{
    const minutes=Number(new URL(url).searchParams.get('interval'));requests.push(minutes);
    if(minutes===failedInterval)return new Response('not-retained-response-body',{status:403});
    const duration=minutes*60000,last=Math.floor(NOW/duration)*duration;
    return Response.json({retCode:0,result:{list:Array.from({length:300},(_,i)=>[String(last-i*duration),'100','101','99','100','1'])}});
  });
  const file=path.resolve(__dirname,'../cloudflare/monitor.mjs');
  let source=fs.readFileSync(file,'utf8').replace("'cloudflare:workers'",JSON.stringify('data:text/javascript,export class DurableObject { constructor(ctx,env){ this.ctx=ctx;this.env=env; } }'));
  source=source.replace(/from '([.][^']+)'/g,(_,name)=>'from '+JSON.stringify(pathToFileURL(path.resolve(path.dirname(file),name)).href));
  const worker=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const env={ALERTS_ENABLED:'true',EMAIL_TO:'test@example.invalid',EMAIL:{send:async m=>sent.push(m)}};
  const monitor=new worker.MarketMonitor({storage},env);
  env.MONITOR={getByName:()=>monitor};
  return{original,state,saved,writes,alarms,requests,sent,monitor,env,worker};
}

for(const interval of [15,60,240])test(`HTTP403 during ${interval}m acquisition preserves old snapshot, stops publication and keeps alarm`,async t=>{
  const f=await fixture(t,interval),before=JSON.stringify(f.original);
  await f.monitor.alarm();
  const status=f.saved.get('status');
  assert.equal(status.state,'DATA_ERROR');assert.equal(status.error,'HTTP_ERROR');
  assert.equal(status.dataError.httpStatus,403);assert.equal(status.dataError.interval,interval);
  assert.equal(status.lastDataError.recoveredAt,null);assert.equal(status.snapshotId,undefined);
  assert.deepEqual(f.requests,[15,60,240].slice(0,[15,60,240].indexOf(interval)+1));
  assert.deepEqual(f.alarms,[NOW+60000]);assert.equal(f.sent.length,0);
  assert.equal(JSON.stringify(f.saved.get('snapshot')),before);
  assert.deepEqual(f.saved.get('state').delivered,f.state.delivered);
  assert.deepEqual(f.saved.get('state').paperPosition,f.state.paperPosition);
  assert.deepEqual(f.writes.sort(),['state','status']);
  assert.ok(![...f.saved.keys()].some(k=>k.startsWith('demo:')||k.startsWith('alert:')));
  assert.ok(!JSON.stringify(status).includes('not-retained-response-body'));
  // A 200 response means that a stored record is available, not that it is current.
  const response=await f.worker.default.fetch(new Request('https://example.invalid/api/snapshot?asset=btc'),f.env);
  assert.equal(response.status,200);const snapshot=await response.json();assert.equal(snapshot.id,f.original.id);
  const health=H.assess({snapshot,monitor:status,monitorReceivedAt:NOW,now:NOW});
  assert.equal(health.kind,'DATA_ERROR');assert.equal(health.blocked,true);
  assert.equal(H.assess({snapshot,monitor:{...status,state:'NO_TRADE',error:null,snapshotId:snapshot.id},monitorReceivedAt:NOW,now:NOW}).kind,'NEXT_CANDLE_PENDING');
});
