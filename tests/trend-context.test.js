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
