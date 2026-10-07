const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../research-zone-trades.cjs'),STEP=900000;
const candidate=()=>({from:STEP,zone:{direction:'LONG',low:100,high:102,protectiveStop:98,invalidationClose:99,targets:[112,120]},pivot:104});
function bars(overrides={}){return Array.from({length:16},(_,i)=>({time:(i+1)*STEP,open:101,high:103,low:100,close:101,...overrides[i]}));}
test('touch and confirmed reaction remain paired but have distinct entry times',()=>{
 const c=candidate(),b=bars({1:{open:102,high:106,low:101,close:105},2:{open:105,high:106,low:104,close:105},3:{open:106,high:113,low:105,close:112}});
 const touch=T.simulate(c,b,T.SPEC.arms[0]),reaction=T.simulate(c,b,T.SPEC.arms[1]);
 assert.equal(touch.entryAt,STEP*2);assert.equal(touch.reason,'fixed-target');
 // Confirmation gets a worse actual open: fixed target is only 1R away, so no fill.
 assert.equal(reaction.status,'no-fill');assert.equal(reaction.reason,'gap-or-target-or-RR');
});
test('no same-bar touch/confirmation, last-bar trigger cannot invent a fill',()=>{
 const b=bars(Object.fromEntries(Array.from({length:15},(_,i)=>[i,{open:106,high:107,low:105,close:106}])));b[15]={time:STEP*16,open:101,high:107,low:100,close:106};
 assert.equal(T.simulate(candidate(),b,T.SPEC.arms[1]).status,'no-trigger');
 assert.equal(T.simulate(candidate(),b,T.SPEC.arms[0]).reason,'no-next-bar-within-window');
});
test('ambiguous stop and target candle takes stop, adverse later gap uses open',()=>{
 const both=T.simulate(candidate(),bars({1:{open:101,high:113,low:97,close:105}}),T.SPEC.arms[0]);assert.equal(both.exit,98);assert.equal(both.sameBarAmbiguity,true);
 const gap=T.simulate(candidate(),bars({2:{open:95,high:97,low:94,close:96}}),T.SPEC.arms[0]);assert.equal(gap.exit,95);assert.equal(gap.reason,'fixed-stop');
});
test('target is frozen before entry; crossing it at next open is no fill',()=>{
 const a=T.simulate(candidate(),bars({1:{open:114,high:115,low:113,close:114}}),T.SPEC.arms[0]);assert.equal(a.status,'no-fill');
 const b=T.simulate(candidate(),bars({2:{open:114,high:115,low:113,close:114}}),T.SPEC.arms[0]);assert.equal(b.exit,112);assert.equal(b.reason,'fixed-target');
});
test('pre-entry stop cancels; closed invalidation and expiry are distinct exits',()=>{
 assert.equal(T.simulate(candidate(),bars({0:{low:97}}),T.SPEC.arms[0]).reason,'pre-entry-stop');
 assert.equal(T.simulate(candidate(),bars({2:{low:98.5,close:98.8}}),T.SPEC.arms[0]).reason,'closed-invalidation');
 const expiry=T.simulate(candidate(),bars(),T.SPEC.arms[0]);assert.equal(expiry.reason,'window-expiry');assert.equal(expiry.costs[0].assumedNetBps,-7);
});
test('mirrored short simulation is symmetric and never mutates source',()=>{
 const c=candidate(),b=bars({3:{high:113,close:112}}),before=JSON.stringify({c,b}),long=T.simulate(c,b,T.SPEC.arms[0]);
 const s={from:STEP,pivot:96,zone:{direction:'SHORT',low:98,high:100,protectiveStop:102,invalidationClose:101,targets:[88,80]}},sb=b.map(x=>({...x,open:200-x.open,high:200-x.low,low:200-x.high,close:200-x.close}));
 const short=T.simulate(s,sb,T.SPEC.arms[0]);assert.equal(short.reason,long.reason);assert.equal(short.exit,200-long.exit);assert.equal(JSON.stringify({c,b}),before);
 assert.throws(()=>T.simulate(c,b.slice(1),T.SPEC.arms[0]),/Complete ordered/);
});
