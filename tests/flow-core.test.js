const test=require('node:test');
const assert=require('node:assert/strict');
const Flow=require('../flow-core');
const Core=require('../strategy-core');
const start=Date.UTC(2026,0,1);
function bars(n){return Array.from({length:n},(_,i)=>{const p=100+i*.1+Math.sin(i/8)*2;return {time:start+i*900000,open:p,high:p+1,low:p-1,close:p+.2,volume:100+i%17,takerBuyVolume:60};});}
test('profile conserves volume, includes POC in contiguous 70% value area',()=>{
 const p=Flow.profile(bars(120));
 assert.ok(Math.abs(p.total-bars(120).slice(-96).reduce((s,b)=>s+b.volume,0))<1e-6);
 assert.ok(p.val<=p.poc&&p.vah>=p.poc);
 assert.ok(p.bins.filter(b=>b.valueArea).reduce((s,b)=>s+b.volume,0)>=p.total*.7);
 assert.equal(Flow.profile(bars(20).map(b=>({...b,volume:0}))),null);
});
test('ribbon states do not change when future candles are appended',()=>{
 const c=bars(350),prefix=Core.analyzeTimeframe(c.slice(0,300),15,start+300*900000);
 const full=Core.analyzeTimeframe(c,15,start+350*900000);
 assert.deepEqual(full.flow.history.slice(0,300),prefix.flow.history);
 assert.equal(full.flow.lines[144][142],null);
});
test('hourly alignment uses close time, never the forming hour',()=>{
 const exec={flow:{history:[{time:start+30*60000,direction:1,badge:'V',pullback:1},{time:start+45*60000,direction:1,badge:'V',pullback:1}]}};
 const h1={flow:{history:[{time:start,direction:1}]}};
 Flow.align(exec,h1,15);
 assert.equal(exec.flow.history[0].rank,'A');
 assert.equal(exec.flow.history[0].pullbackConfirmed,false);
 assert.equal(exec.flow.history[1].rank,'S');
 assert.equal(exec.flow.history[1].pullbackConfirmed,true);
});
test('aggressor delta requires actual taker volume and rejects invalid quantities',()=>{
 const c=bars(250);c.at(-1).takerBuyVolume=99999;
 const a=Core.analyzeTimeframe(c,15,start+250*900000);
 assert.equal(a.flow.latest.delta,null);
 assert.equal(a.flow.history[0].delta,20);
 assert.equal(Core.normalizeCandles([{...c[0],takerBuyVolume:null}])[0].takerBuyVolume,undefined);
});
test('P requires a prior EMA21 pullback, close reclaim and real volume',()=>{
 const c=Array.from({length:170},(_,i)=>({time:start+i*900000,open:103,close:104,low:102.5,high:105,volume:100}));
 c[168]={...c[168],open:103,close:102.5,low:101.9};
 c[169]={...c[169],open:102.5,close:103.5,low:102.4,volume:120};
 const levels={5:104,8:103.8,13:103,21:102,34:101.5,55:101,89:100.5,144:100};
 const swings={highs:[{index:10,confirmIndex:13,price:105},{index:20,confirmIndex:23,price:106}],lows:[{index:15,confirmIndex:18,price:99},{index:25,confirmIndex:28,price:100}]};
 const analyze=()=>Flow.analyze(c,(_,period)=>Array(170).fill(levels[period]),Array(170).fill(1),Array(170).fill(25),swings);
 assert.equal(analyze().latest.pullback,1);
 c[169].volume=0;assert.equal(analyze().latest.pullback,0);
 c[169].volume=120;c[169].close=102.9;assert.equal(analyze().latest.pullback,0);
});
test('snapshot encoding round trips the exact OHLCV decision input',()=>{
 const Feed=require('../market-feed');
 const c=Core.normalizeCandles(bars(300).map(({takerBuyVolume,...b})=>b));
 const snapshot={bars:{m15:Feed.pack(c),h1:Feed.pack(c),h4:Feed.pack(c)}};
 assert.deepEqual(Feed.input(snapshot).exec,c);
 assert.equal(Feed.input(snapshot).exec.length,300);
});
