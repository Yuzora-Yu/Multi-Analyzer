const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../review-pack');
test('decision breakdown preserves missing data, stale state and final vetoes',()=>{
 const a={snapshot:{id:'fixture',settings:{now:1000}},signal:{actionable:false,state:'NO_TRADE',vetoes:['コスト条件未成立'],exec:{flow:{latest:{direction:-1,hourlyAligned:false,volumeRatio:null,setup:{continuation:true,touched:true,reclaim:false,intact:true,volume:null,ema13:100,ema21:102}}},values:{adx:25}}}};
 const d=R.decision(a,1000);assert.equal(d.checks.find(c=>c.label==='出来高').status,'不明');assert.equal(d.checks.find(c=>c.label==='EMA13再突破').status,'未成立');assert.match(d.direction,/確定スイング 不明 \/ リボン 不明/);assert.equal(d.verdict,'新規候補の条件待ち（検証中）');assert.deepEqual(d.vetoes,['コスト条件未成立']);assert.match(R.decision(a,1300000).verdict,/古い/);
});
test('setup explanation remains causal when future bars are appended',()=>{
 const Core=require('../strategy-core');
 const c=Array.from({length:700},(_,i)=>{const p=100+Math.sin(i/14)*5+Math.sin(i/43)*8;return{time:Date.UTC(2026,0,1)+i*900000,open:p,close:p+Math.sin(i)*.6,high:p+1,low:p-1,volume:100+i%29};});
 const short=Core.analyzeTimeframe(c.slice(0,600),15,Date.UTC(2026,0,1)+600*900000),long=Core.analyzeTimeframe(c,15,Date.UTC(2026,0,1)+700*900000);
 assert.deepEqual(short.flow.history.at(-1).setup,long.flow.history[599].setup);
});
