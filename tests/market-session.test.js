const test=require('node:test');
const assert=require('node:assert/strict');
const Feed=require('../market-feed');
const Core=require('../strategy-core');
const at=s=>Date.parse(s);
test('GOLD collection stops all JST weekends and follows NY reopening through DST',()=>{
  for(const [iso,allowed] of [
    ['2026-10-02T23:59:59+09:00',true],['2026-10-03T00:00:00+09:00',false],
    ['2026-10-05T06:59:59+09:00',false],['2026-10-05T07:00:00+09:00',true],
    ['2026-11-02T07:59:59+09:00',false],['2026-11-02T08:00:00+09:00',true],
    ['2026-10-06T06:00:00+09:00',false],['2026-10-06T07:00:00+09:00',true]]){
    assert.equal(Feed.collectionPolicy('gold',at(iso)).allowed,allowed,iso);
    assert.equal(Feed.collectionPolicy('btc',at(iso)).allowed,true);
  }
  assert.equal(Feed.marketOpen('gold',at('2026-10-03T05:00:00+09:00')),true,'Friday NY trading remains valid history');
  assert.equal(Feed.marketOpen('gold',at('2026-10-03T06:00:00+09:00')),false);
});
test('closed GOLD load never invokes transport',async()=>{
  let requests=0;
  await assert.rejects(Feed.load('gold',15,300,async()=>{requests++;},undefined,at('2026-10-04T12:00:00+09:00')),/GOLD_MARKET_CLOSED/);
  assert.equal(requests,0);
});
test('GOLD rebuilds partial H4 from valid hours and excludes closed-hour price/volume',async()=>{
  const start=at('2026-09-28T00:00:00Z');
  const source=Array.from({length:178},(_,i)=>{const time=start+i*3600000,open=Feed.marketOpen('gold',time);return {time,open:open?100:9000,high:open?102:9999,low:open?99:8000,close:open?101:9500,volume:open?2:5000};});
  let requests=0;
  const rows=await Feed.load('gold',240,100,async url=>{
    requests++;const u=new URL(url);assert.equal(u.searchParams.get('interval'),'60');
    const end=Number(u.searchParams.get('end')||Infinity);
    return {retCode:0,result:{list:Feed.pack(source.filter(b=>b.time<=end)).reverse()}};
  });
  assert.ok(requests<=3);assert.ok(rows.length>10);
  assert.ok(rows.every(b=>b.high===102&&b.low===99&&b.close===101&&b.volume<=8));
  const reopening=rows.find(b=>b.time===at('2026-10-05T05:00:00+09:00'));
  assert.equal(reopening.volume,4,'07 and 08 JST valid hours retained in partial native H4 bucket');
  assert.equal(Core.bollinger(rows.map(b=>b.close)).mid.at(-1),101);
});
test('scheduled market gaps do not mask genuine missing GOLD trading bars',()=>{
  const bar=time=>({time,open:100,high:102,low:99,close:101,volume:2});
  const friday=at('2026-10-03T05:00:00+09:00'),monday=at('2026-10-05T07:00:00+09:00');
  assert.equal(Core.dataQuality([bar(friday),bar(monday)],60,monday+3600000,'gold').gaps,0);
  assert.equal(Core.dataQuality([bar(friday),bar(monday+3600000)],60,monday+7200000,'gold').gaps,1);
  assert.ok(Core.dataQuality([bar(friday),bar(monday)],60,monday+3600000,'btc').gaps>40);
});
test('BTC retains native kline data and a single API request',async()=>{
  let requests=0;const packed=[[at('2026-10-04T12:00:00Z'),100,102,99,101,5]];
  const rows=await Feed.load('btc',240,300,async url=>{requests++;assert.equal(new URL(url).searchParams.get('interval'),'240');return {retCode:0,result:{list:packed}};});
  assert.deepEqual(Feed.pack(rows),packed);assert.equal(requests,1);
});
test('GOLD daily session starts at NY reopening rather than making a Sunday two-hour daily candle',async()=>{
  const start=at('2026-10-04T22:00:00Z');
  const source=Array.from({length:24},(_,i)=>({time:start+i*3600000,open:100,high:102,low:99,close:101,volume:2}));
  const rows=await Feed.load('gold',1440,1,async()=>({retCode:0,result:{list:Feed.pack(source).reverse()}}));
  assert.equal(rows.length,1);assert.equal(rows[0].time,start);assert.equal(rows[0].volume,46);
});
