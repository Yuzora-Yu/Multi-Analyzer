const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../strategy-core');
test('missing volume never fabricates VWAP or volume score',()=>{
 const now=Date.UTC(2026,8,8,6);
 const bars=Array.from({length:300},(_,i)=>({time:now-(300-i)*900000,open:100+i*.1,high:101+i*.1,low:99+i*.1,close:100+i*.1,volume:0}));
 assert.ok(Core.rollingVWAP(bars).every(v=>v===null));
 assert.ok(Core.anchoredVWAP(bars).every(v=>v===null));
 const a=Core.analyzeMarket({exec:bars,m15:bars,h1:bars,h4:bars},{now});
 assert.ok(!a.components.some(c=>c.id==='VOLUME'||c.key==='VOLUME'));
 assert.ok(a.warnings.some(w=>w.includes('出来高未提供')));
});
test('cached forming HTF candle is never reused after its close',async()=>{
 const {canReuse}=await import('../cloudflare/logic.mjs');
 const start=Date.UTC(2026,8,8,6),cached={rows:[{time:start}],fetchedAt:start+1800000};
 assert.equal(canReuse(cached,'1h',start+3599999,3600000),true);
 assert.equal(canReuse(cached,'1h',start+3600000,3600000),false);
 assert.equal(canReuse(cached,'15min',start+1,900000),false);
});
