const test=require('node:test');
const assert=require('node:assert/strict');
const R=require('../review-pack');
const Core=require('../strategy-core');
const Feed=require('../market-feed');

test('ZIP central directory locates binary and Japanese text entries with valid CRC',async()=>{
  const files=[{name:'chart.png',data:new Uint8Array([137,80,78,71,0,255])},{name:'consult-ai.txt',data:'確定足だけで評価'}];
  const bytes=new Uint8Array(await R.zip(files).arrayBuffer()),v=new DataView(bytes.buffer),end=bytes.length-22;
  assert.equal(v.getUint32(end,true),0x06054b50);assert.equal(v.getUint16(end+10,true),2);
  let p=v.getUint32(end+16,true);
  for(const f of files){assert.equal(v.getUint32(p,true),0x02014b50);const n=v.getUint16(p+28,true),local=v.getUint32(p+42,true),size=v.getUint32(p+24,true);assert.equal(v.getUint32(local,true),0x04034b50);const start=local+30+v.getUint16(local+26,true),data=bytes.slice(start,start+size);assert.equal(R.crc32(data),v.getUint32(p+16,true));assert.equal(new TextDecoder().decode(bytes.slice(p+46,p+46+n)),f.name);assert.deepEqual(data,typeof f.data==='string'?new TextEncoder().encode(f.data):f.data);p+=46+n;}
  assert.equal(p,end);assert.equal(R.crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  assert.throws(()=>R.zip([{name:'../unsafe',data:'x'}]),/Unsafe/);
});

test('review uses exact canonical 15m input, excludes forming bars, and records partial failures',async(t)=>{
  const cutoff=Date.UTC(2026,8,14,12),rows=(m)=>Array.from({length:301},(_,i)=>({time:cutoff+(i-300)*m*60000,open:100+i*.1,high:102+i*.1,low:99+i*.1,close:101+i*.1,volume:50}));
  const s={id:'gold-test',asset:'gold',version:Core.VERSION,settings:{...Core.DEFAULTS,executionMinutes:15,now:cutoff,market:'futures'},bars:{m15:Feed.pack(rows(15).slice(0,300)),h1:Feed.pack(rows(60).slice(0,300)),h4:Feed.pack(rows(240).slice(0,300))}};
  global.MultiAnalyzerCore=Core;global.MultiAnalyzerFeed=Feed;
  const urls=[];t.mock.method(global,'fetch',async url=>{urls.push(url);if(url.includes('/api/snapshot'))return{ok:true,json:async()=>s};const u=new URL(url),interval=u.searchParams.get('interval');if(interval==='240')return{ok:false,status:503};const m=interval==='D'?1440:+interval;return{ok:true,json:async()=>({retCode:0,result:{list:Feed.pack(rows(m)).reverse()}})};});
  const p=await R.collect(['gold']);assert.equal(p.records.length,5);assert.deepEqual(p.errors,[{asset:'gold',tf:'4h',error:'HTTP 503'}]);
  const canonical=p.records.find(r=>r.tf==='15m');assert.deepEqual(canonical.rows,Feed.input(s).exec);assert.deepEqual(canonical.signal,Core.analyzeMarket(Feed.input(s),s.settings));
  for(const r of p.records)assert.ok(r.rows.every(b=>b.time+r.minutes*60000<=cutoff));
  for(const url of urls.filter(u=>u.includes('/kline')))assert.equal(new URL(url).searchParams.get('end'),String(cutoff-1));
  assert.equal(p.records.find(r=>r.tf==='1m').signal,null);
  assert.match(R.prompt(p),/EXIT/);
});

test('cancelled capture makes no network request',async(t)=>{t.mock.method(global,'fetch',()=>{throw Error('unexpected network');});const c=new AbortController();c.abort();await assert.rejects(R.collect(['gold'],{signal:c.signal}),{name:'AbortError'});});
test('overview marks stale signals and missing timeframes without manufacturing alignment',()=>{
 const pack={assets:[{asset:'gold',snapshot:{id:'x',settings:{now:1000}},signal:{state:'READY_LONG',actionable:true,vetoes:[],plan:{netRR:2}}}],records:[]};
 const current=R.overview(pack,1000)[0],old=R.overview(pack,1000+21*60000)[0];
 assert.equal(current.actionable,true);assert.equal(old.actionable,false);assert.equal(old.stale,true);assert.equal(old.frames.length,6);assert.ok(old.frames.every(f=>f.missing&&f.structure===null&&f.volume===null));assert.equal(pack.assets[0].signal.actionable,true);
});
