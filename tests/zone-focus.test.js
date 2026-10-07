const test=require('node:test'),assert=require('node:assert/strict');
const Focus=require('../zone-focus');
function fixture(){
 const tf={ready:true,quality:{stale:false,gaps:0},intervalMinutes:15,candles:[{time:0}],values:{atr:5,close:100,ema20:100,ema50:120,bbUpper:140,bbLower:90},series:{bb:{mid:[100.5]}}};
 return {generatedAt:900001,marketMap:{valid:true},exec:tf,m15:tf,h1:null,h4:null};
}
test('wide background OB has separate local intersections and unchanged invalidation',()=>{
 const a=fixture(),z={low:80,high:150,invalidationClose:80,protectiveStop:79};
 const before=JSON.stringify({a,z}),r=Focus.describe(a,z);
 assert.equal(r.radius,1);assert.equal(r.windows[0].low,99.5);assert.equal(r.windows[0].high,101);
 assert.deepEqual(r.windows[0].families,['MA','BB']);
 assert.ok(r.windows.every(w=>w.high-w.low<=2));assert.equal(JSON.stringify({a,z}),before);
 assert.match(r.note,/勝率ではありません/);
});
test('a chain of pairwise overlaps cannot turn into one broad confluence window',()=>{
 const a=fixture();a.m15.values={...a.m15.values,ema20:100,ema50:101.5,bbUpper:103,bbLower:null};a.m15.series.bb.mid=[null];
 const r=Focus.describe(a,{low:95,high:110});
 assert.ok(r.windows.every(w=>w.labels.length<3));assert.ok(r.windows.every(w=>w.high-w.low<=2));
});
test('missing, stale and post-cutoff references never become confluence',()=>{
 const a=fixture();a.h4={...a.m15,intervalMinutes:240,values:{atr:200,ema20:100},candles:[{time:0}]};
 assert.ok(Focus.describe(a,{low:99,high:101}).references.every(r=>r.frame==='15m'));
 a.m15.quality.stale=true;assert.equal(Focus.describe(a,{low:99,high:101}).windows.length,0);
 a.marketMap.valid=false;assert.equal(Focus.describe(a,{low:99,high:101}).available,false);
});
test('SMC bounds clip local windows; forming future append does not move saved references',()=>{
 const a=fixture(),r=Focus.describe(a,{low:100,high:100.8});
 assert.ok(r.windows.every(w=>w.low>=100&&w.high<=100.8));
 a.h1={...a.m15,intervalMinutes:60,candles:[{time:3600000}]};
 assert.deepEqual(Focus.describe(a,{low:100,high:100.8}),r);
});
