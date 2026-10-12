const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../trend-context');
function fixture(){
 const step=240*60000,candles=Array.from({length:10},(_,i)=>({time:i*step,open:100,close:100,high:i===1?130:120,low:i===5?70:80}));
 const h4={ready:true,intervalMinutes:240,quality:{stale:false,gaps:0},candles,values:{close:100,ema20:110,ema50:120},series:{bb:{mid:[115]}},structure:{trend:'bull'},trend:'bear',swings:{highs:[{time:step,index:1,confirmIndex:4,price:130}],lows:[{time:step*5,index:5,confirmIndex:8,price:70}]}};
 const now=step*10,m15={...h4,intervalMinutes:15,candles:[{time:now-900000,close:100}],swings:{highs:[],lows:[]}};
 return {generatedAt:now,h4,h1:null,m15};
}
test('upper structure, MA condition and current price position remain separate',()=>{
 const a=fixture(),before=JSON.stringify(a),t=T.describe(a),h=t.frames[0];assert.equal(h.structure,'上向き');assert.equal(h.ma,'下向き');assert.ok(h.levels.every(l=>l.position==='下'));assert.equal(t.price,100);assert.equal(t.frames[1].available,false);assert.equal(t.frames[1].ma,'未確認');assert.equal(JSON.stringify(a),before);
});

test('neutral MA or conflicting upper structure cannot label a candidate as upper-trend aligned',()=>{
 const a=fixture(),z={direction:'SHORT',role:'上位足に沿う候補',low:100,high:101,invalidationClose:101,protectiveStop:102};
 a.h4.trend='range';const before=JSON.stringify({a,z});
 assert.equal(T.zoneRole(a,z).label,'4H MA中立・方向一致は未確認');
 assert.equal(T.zoneRole(a,z).originalRole,z.role);assert.equal(JSON.stringify({a,z}),before);
 a.h4.trend='bear';assert.equal(T.zoneRole(a,z).label,'4Hの構造とMAが不一致');
 a.h4.trend='bull';assert.equal(T.zoneRole(a,z).label,'4Hの構造・MAに逆行');
 assert.equal(T.zoneRole(a,{...z,direction:'LONG'}).label,'4Hの構造・MAと同方向');
 a.h4.structure.trend='range';assert.equal(T.zoneRole(a,z).label,'4H MAに逆行・構造は中立');
});

test('missing, stale, gapped or unfinished H4 cannot supply an alignment claim',()=>{
 const z={direction:'LONG',role:'上位足に沿う候補'};
 for(const change of [a=>a.h4=null,a=>a.h4.quality.stale=true,a=>a.h4.quality.gaps=4,a=>a.h4.candles.push({time:a.generatedAt})]){
  const a=fixture();change(a);const result=T.zoneRole(a,z);
  assert.equal(result.label,'4Hの方向未確認');assert.equal(result.h4.available,false);assert.equal(result.h4.closedAt,null);
 }
 assert.equal(T.zoneRole(fixture(),{direction:'invalid'}).label,'候補方向未確認');
});
test('retracement anchors require both original confirmation and price identity',()=>{
 const a=fixture(),r=T.leg(a.h4,a.generatedAt,100);assert.equal(r.direction,'下落脚');assert.equal(r.ratio,50);assert.equal(r.levels[1].price,100);assert.equal(r.end.confirmedAt,9*240*60000);
 a.h4.swings.lows[0].confirmIndex=10;assert.equal(T.leg(a.h4,a.generatedAt,100),null);
 a.h4.swings.lows[0].confirmIndex=8;a.h4.swings.lows[0].price=69;assert.equal(T.leg(a.h4,a.generatedAt,100),null);
});
test('forming, stale and missing frames cannot manufacture context or a leg',()=>{
 const a=fixture();a.h4.candles.push({time:a.generatedAt,close:100});assert.equal(T.describe(a).frames[0].available,false);
 const b=fixture();b.h4.quality.stale=true;assert.equal(T.describe(b).frames[0].leg,null);b.m15.quality.stale=true;assert.equal(T.describe(b).price,null);
});
test('retracement beyond endpoints is not clamped to a plausible percentage',()=>{
 const a=fixture();assert.equal(T.leg(a.h4,a.generatedAt,60).location,'終点を越えて元の脚が延伸');assert.ok(T.leg(a.h4,a.generatedAt,140).ratio>100);
 const h=a.h4;h.candles[1].low=60;h.candles[5].high=140;h.swings={lows:[{time:h.candles[1].time,index:1,confirmIndex:4,price:60}],highs:[{time:h.candles[5].time,index:5,confirmIndex:8,price:140}]};const r=T.leg(h,a.generatedAt,100);assert.equal(r.direction,'上昇脚');assert.equal(r.ratio,50);assert.equal(r.levels[1].price,100);
});

function goldReopening(now='2026-10-12T08:00:00+09:00',lastOpen='2026-10-10T05:00:00+09:00'){
 const a=fixture();a.generatedAt=Date.parse(now)+1;
 a.h4.candles=[{time:Date.parse(lastOpen),open:100,close:100,high:110,low:90}];a.h4.quality={stale:true,gaps:0};
 a.m15.candles=[{time:a.generatedAt-1-900000,close:100}];return a;
}
test('Gold first H4 wait explains scheduled closure without providing a direction, levels or canonical eligibility',()=>{
 const a=goldReopening(),before=JSON.stringify(a),h=T.describe(a,{asset:'gold'}).frames[0];
 assert.equal(h.available,false);assert.equal(h.structure,'未確認');assert.equal(h.ma,'未確認');assert.equal(h.leg,null);assert.deepEqual(h.levels,[]);
 assert.equal(h.sessionWait.closedAt,Date.parse('2026-10-10T09:00:00+09:00'));
 assert.equal(h.sessionWait.nextClosedAt,Date.parse('2026-10-12T09:00:00+09:00'));
 assert.equal(a.h4.quality.stale,true);assert.equal(JSON.stringify(a),before);
 // The due H4 must be received; explanation expires even if the old frame persists.
 assert.equal(T.describe(goldReopening('2026-10-12T09:00:00+09:00'),{asset:'gold'}).frames[0].sessionWait,null);
});
test('a missed expected pre-pause H4, incomplete evidence, closed market and BTC never become a Gold wait',()=>{
 assert.equal(T.describe(goldReopening(undefined,'2026-10-10T01:00:00+09:00'),{asset:'gold'}).frames[0].sessionWait,null);
 for(const change of [a=>a.h4.quality.gaps=1,a=>a.h4.ready=false,a=>a.h4.candles[0].time++,a=>a.m15.quality.stale=true]){
  const a=goldReopening();change(a);assert.equal(T.describe(a,{asset:'gold'}).frames[0].sessionWait,null);
 }
 assert.equal(T.describe(goldReopening(),{asset:'btc'}).frames[0].sessionWait,null);
 assert.equal(T.describe(goldReopening()).frames[0].sessionWait,null);
 assert.equal(T.describe(goldReopening('2026-10-11T08:00:00+09:00'),{asset:'gold'}).frames[0].sessionWait,null);
});
test('winter New York reopening retains the UTC H4 grid and original stale gate',()=>{
 const a=goldReopening('2026-11-09T08:15:00+09:00','2026-11-07T05:00:00+09:00'),r=T.describe(a,{asset:'gold'}).frames[0];
 assert.equal(r.sessionWait.nextClosedAt,Date.parse('2026-11-09T09:00:00+09:00'));assert.equal(r.available,false);
});
