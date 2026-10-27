const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../reversal-context'),Chart=require('../reversal-chart');
const STEP=900000,NOW=Date.parse('2026-10-22T04:00:00Z');
function fixture(){
 const candles=Array.from({length:20},(_,i)=>({time:NOW-(20-i)*STEP,open:109,high:109.5,low:108.5,close:109,volume:10}));
 candles[1].high=110;Object.assign(candles[8],{open:109.5,high:112,low:108.5,close:109.5});
 const tf={ready:true,intervalMinutes:15,quality:{stale:false,gaps:0},candles,trend:'range',structure:{trend:'range'},values:{close:109,atr:1,ema20:110.2},series:{atr14:candles.map(()=>1),bb:{mid:candles.map(()=>109)}},swings:{highs:[{index:1,confirmIndex:4,time:candles[1].time,price:110}],lows:[]},smc:{zones:[],events:[{type:'SWEEP',side:'bear',time:candles[8].time,price:110}]}};
 return {a:{generatedAt:NOW+1,m15:tf},now:NOW+1000};
}
const describe=(f,opts={})=>R.describe(f.a,{now:f.now,snapshotId:'synthetic-gold',...opts});

test('a confirmed sweep makes a bounded reaction hypothesis, with later knowledge and no trade action',()=>{
 const f=fixture(),before=JSON.stringify(f.a),r=describe(f),z=r.candidates[0];assert.equal(r.available,true);assert.equal(r.actionable,false);assert.equal(z.kind,'SWEEP');assert.equal(z.direction,'SHORT');assert.equal(z.low,110);assert.equal(z.high,112);assert.equal(z.formedAt,f.a.m15.candles[8].time+STEP);assert(r.observedAt>z.formedAt);assert.equal(z.sourceLevel,110);assert.equal(z.withdrawalMinutes,15);assert.equal(z.withdrawalPrice,112);assert.equal(z.visits,0);assert.equal(JSON.stringify(f.a),before);assert.match(R.lines(r).join('\n'),/反転成立は未確認/);assert.match(R.html(r),/有効OBとは別/);
});
test('a low sweep is symmetric and a wick alone without close recovery is rejected',()=>{
 const f=fixture(),t=f.a.m15;for(const b of t.candles){const old={...b};Object.assign(b,{open:220-old.open,close:220-old.close,high:220-old.low,low:220-old.high});}t.swings.lows=t.swings.highs;t.swings.highs=[];t.smc.events[0].side='bull';const r=describe(f);assert.equal(r.candidates[0].direction,'LONG');assert.equal(r.candidates[0].low,108);assert.equal(r.candidates[0].high,110);t.candles[8].close=109;assert.equal(describe(f).candidates.length,0);
});
test('later prices never widen a sweep and a breached close cannot be resurrected',()=>{
 const f=fixture(),t=f.a.m15;Object.assign(t.candles[12],{high:113,close:109});let r=describe(f);assert.equal(r.candidates[0].high,112);Object.assign(t.candles[12],{open:111,high:114,close:113});r=describe(f);assert.equal(r.candidates.length,0);assert.equal(r.retired[0].withdrawnClose,113);assert.equal(r.retired[0].high,112);assert.match(R.html(r),/再開・拡張しません/);
});
test('equal boundary close stays observed; separate later touches count as visits, not entries',()=>{
 const f=fixture(),t=f.a.m15;Object.assign(t.candles[10],{open:111,high:112.5,low:110,close:112});Object.assign(t.candles[11],{high:111,close:109});Object.assign(t.candles[13],{high:111,close:109});const z=describe(f).candidates[0];assert.equal(z.high,112);assert.equal(z.visits,2);assert.equal(z.structureAt,null);assert.match(R.lines(describe(f)).join(' '),/入場成立を示しません/);
});
test('future or not-yet-confirmed swing evidence cannot create a sweep candidate',()=>{
 for(const mutate of [f=>f.a.m15.swings.highs[0].confirmIndex=8,f=>f.a.m15.swings.highs[0].price=111,f=>f.a.m15.smc.events[0].time=NOW+STEP,f=>f.a.m15.smc.events[0].price=NaN]){const f=fixture();mutate(f);assert.equal(describe(f).candidates.length,0);}
});
test('the sweep becomes observable at its close, not its candle open',()=>{
 const f=fixture(),t=f.a.m15,end=t.candles[8].time+STEP,source=structuredClone(t.candles);f.a.generatedAt=end-1;f.now=end-1;t.candles=source.slice(0,8);assert.equal(describe(f).candidates.length,0);f.a.generatedAt=end;f.now=end;t.candles=source.slice(0,9);assert.equal(describe(f).candidates[0].formedAt,end);
});
test('the latest overlapping sweep is shown without widening it or deleting older evidence',()=>{
 const f=fixture(),t=f.a.m15;Object.assign(t.candles[12],{high:113,close:109});t.smc.events.push({type:'SWEEP',side:'bear',time:t.candles[12].time,price:110});const r=describe(f);assert.equal(r.candidates.length,1);assert.deepEqual([r.candidates[0].low,r.candidates[0].high],[110,113]);assert.equal(r.overlapping.length,1);assert.deepEqual([r.overlapping[0].low,r.overlapping[0].high],[110,112]);assert.match(R.html(r),/重複する以前の掃い/);
});
test('source structure observations need a later break of a previously confirmed swing',()=>{
 const f=fixture(),t=f.a.m15;Object.assign(t.candles[3],{low:107});t.swings.lows=[{index:3,confirmIndex:6,time:t.candles[3].time,price:107}];t.candles[10].high=110.5;Object.assign(t.candles[12],{open:109,high:109,low:105,close:106});t.smc.events.push({type:'CHoCH',side:'bear',time:t.candles[12].time,price:107});const r=describe(f);assert.equal(r.candidates[0].structureType,'CHoCH');assert.equal(r.candidates[0].structureAt,t.candles[12].time+STEP);t.swings.lows[0].confirmIndex=12;assert.equal(describe(f).candidates[0].structureAt,null);
});
test('missing path, contradictory duplicate bars and off-grid bars never imply a held zone',()=>{
 const f=fixture();f.a.m15.candles.splice(11,1);assert.equal(describe(f).candidates.length,0);
 for(const mutate of [f=>f.a.m15.candles.push({...f.a.m15.candles.at(-1),close:108}),f=>f.a.m15.candles[11].time++,f=>f.a.m15.quality.gaps=1,f=>f.a.m15.candles[9].high=100]){const g=fixture();mutate(g);assert.equal(describe(g).available,false);}
});
test('future, stale, blocked, closed-market, archive, CSV and other-asset inputs suppress all new hypotheses',()=>{
 for(const opts of [{mode:'archive'},{mode:'csv'},{asset:'btc'},{health:{blocked:true}},{now:Date.parse('2026-10-24T03:00:00Z')}]){const r=describe(fixture(),opts);assert.equal(r.available,false);assert.deepEqual(r.candidates,[]);assert.deepEqual(r.references,[]);}
 for(const mutate of [f=>f.a.generatedAt=f.now+1,f=>f.a.generatedAt=f.now-21*60000,f=>f.a.m15.quality.stale=true]){const f=fixture();mutate(f);assert.equal(describe(f).available,false);}
});
function fvgFixture(){const f=fixture(),t=f.a.m15;t.smc.events=[];t.candles[6].high=109;Object.assign(t.candles[7],{open:108,high:111,low:107.5,close:110.5});Object.assign(t.candles[8],{open:111,high:112,low:110,close:111});for(const b of t.candles.slice(9))Object.assign(b,{open:111,high:111.5,low:110.5,close:111});t.values.close=111;t.smc.zones=[{type:'FVG',side:'bull',index:8,time:t.candles[8].time,low:109,high:110,status:'active'}];return f;}
test('active FVG preserves exact source bounds and a full fill remains consumed after recovery',()=>{
 const f=fvgFixture(),before=JSON.stringify(f.a),r=describe(f);assert.equal(r.candidates.length,1);assert.deepEqual([r.candidates[0].low,r.candidates[0].high],[109,110]);assert.equal(r.candidates[0].kind,'FVG');assert.equal(JSON.stringify(f.a),before);f.a.m15.candles[13].low=109;const q=describe(f);assert.equal(q.candidates.length,0);assert(q.retired[0].filledAt);f.a.m15.candles[13].low=109.5;f.a.m15.smc.zones[0].status='filled';assert.equal(describe(f).candidates.length,0);
});
test('wrong source geometry and missing OB origin cannot manufacture active zones',()=>{
 const f=fvgFixture();f.a.m15.smc.zones[0].low=108.8;assert.equal(describe(f).candidates.length,0);f.a.m15.smc.zones[0]={type:'OB',side:'bull',index:8,time:f.a.m15.candles[8].time,low:109,high:110,status:'active',originTime:NOW};assert.equal(describe(f).candidates.length,0);
});
test('selected M5 source zones supplement M15 candidates without changing their M15 price basis',()=>{
 const f=fvgFixture(),t=structuredClone(f.a.m15),n=t.candles.length;
 t.intervalMinutes=5;t.candles.forEach((b,i)=>b.time=f.now-(n-i)*300000);
 Object.assign(t.candles[6],{open:104,high:105,low:103,close:104});Object.assign(t.candles[7],{open:104,high:107,low:103.5,close:106.5});Object.assign(t.candles[8],{open:107,high:108,low:106,close:107});
 for(const b of t.candles.slice(9))Object.assign(b,{open:107,high:107.5,low:106.5,close:107});
 // Use an exact aligned source grid and a source event with its own geometry.
 t.candles.forEach((b,i)=>b.time=Math.floor(f.now/300000)*300000-(n-i)*300000);
 t.smc.zones=[{type:'FVG',side:'bull',index:8,time:t.candles[8].time,low:105,high:106,status:'active'}];t.smc.events=[];t.values.close=107;f.a.exec=t;
 const r=describe(f);assert.equal(r.price,111);assert(r.candidates.some(c=>c.frame==='5m'&&c.low===105&&c.high===106));assert(r.candidates.some(c=>c.frame==='15m'&&c.low===109&&c.high===110));
});
test('the same extreme on two frames is one reaction area with separate confirmation clocks',()=>{
 const f=fixture(),m=f.a.m15,eventTime=m.candles[8].time;const candles=Array.from({length:20},(_,i)=>({time:NOW-(20-i)*3600000,open:109,high:109.5,low:108.5,close:109,volume:10}));const i=candles.findIndex(b=>b.time===eventTime);assert(i>5);candles[1].high=110;Object.assign(candles[i],{open:109.5,high:112,low:108.5,close:109.5});f.a.h1={...m,intervalMinutes:60,candles,series:{atr14:candles.map(()=>1)},swings:{highs:[{index:1,confirmIndex:4,time:candles[1].time,price:110}],lows:[]},smc:{zones:[],events:[{type:'SWEEP',side:'bear',time:eventTime,price:110}]}};const r=describe(f);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].frame,'1H');assert.equal(r.candidates[0].related[0].frame,'15m');assert(r.candidates[0].formedAt>r.candidates[0].related[0].formedAt);assert.equal(r.candidates[0].withdrawalMinutes,60);assert.deepEqual([r.candidates[0].related[0].low,r.candidates[0].related[0].high],[110,112]);assert.match(R.html(r),/独立した根拠数には数えません/);
});
test('observation expiry and distant zones do not become permanent candidate bands',()=>{
 const f=fixture(),t=f.a.m15;for(let n=0;n<24;n++)t.candles.push({...t.candles.at(-1),time:t.candles.at(-1).time+STEP});f.a.generatedAt=t.candles.at(-1).time+STEP;f.now=f.a.generatedAt+1;assert.equal(describe(f).candidates.length,0);assert(describe(f).retired[0].expired);const g=fixture();g.a.m15.values.atr=.01;assert.equal(describe(g).candidates.length,0);
});
test('formation geometry survives current confluence changes and source HTML is escaped',()=>{
 const f=fixture(),r=describe(f);assert(r.candidates[0].matches.length);f.a.m15.values.atr=2;f.a.m15.values.ema20=111;const q=describe(f);assert.deepEqual([q.candidates[0].low,q.candidates[0].high],[110,112]);q.candidates[0].evidence='<script>unsafe</script>';assert(!R.html(q).includes('<script>'));assert.match(R.html(q),/&lt;script&gt;/);
});
function drawFixture(){const writes=[],ctx=new Proxy({measureText:t=>({width:t.length*4})},{get(o,k){return o[k]??((...args)=>writes.push([k,...args]));},set(o,k,v){o[k]=v;return true;}}),canvas={parentElement:{clientWidth:390,clientHeight:300},style:{},getContext:()=>ctx};const chart={timeScale:()=>({timeToCoordinate:t=>t/1000})},series={priceToCoordinate:p=>200-p};return {writes,canvas,chart,series};}
test('one overlay toggle clears bands without altering the chart or painting before confirmation',()=>{
 const d=drawFixture(),c={available:true,candidates:[{kind:'SWEEP',frame:'15m',direction:'SHORT',low:110,high:112,formedAt:200000}]},bars=[{time:100000},{time:200000},{time:300000}],before=JSON.stringify(c);Chart.draw(d.canvas,d.chart,d.series,bars,c,true);const fill=d.writes.find(x=>x[0]==='fillRect');assert.equal(fill[1],.2);assert(d.writes.some(x=>x[0]==='fillText'));d.writes.length=0;Chart.draw(d.canvas,d.chart,d.series,bars,c,false);assert(d.writes.some(x=>x[0]==='clearRect'));assert(!d.writes.some(x=>x[0]==='fillRect'));assert.equal(JSON.stringify(c),before);assert.equal(d.canvas.style.width,'390px');
});
test('suppressed contexts and unconfirmed future bands have no drawable overlays',()=>{
 assert.deepEqual(Chart.visibleBands({available:false,candidates:[{}]}),[]);const d=drawFixture();Chart.draw(d.canvas,d.chart,d.series,[{time:100000}],{available:true,candidates:[{direction:'LONG',low:90,high:92,formedAt:200000}]});assert(!d.writes.some(x=>x[0]==='fillRect'));
});
test('a recent right-edge band keeps a readable annotation inside the phone chart',()=>{
 const d=drawFixture(),c={available:true,candidates:[{kind:'SWEEP',frame:'15m',direction:'SHORT',low:110,high:112,formedAt:300000000}]};Chart.draw(d.canvas,d.chart,d.series,[{time:300000000}],c,true);const rect=d.writes.find(x=>x[0]==='fillRect'),text=d.writes.find(x=>x[0]==='fillText');assert.equal(rect[1],300);assert(text[2]<300);assert(text[4]>=text[1].length*4);assert(text[2]+text[4]<=316);
});
test('chart teardown removes the added canvas and clears its old snapshot context',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../app.js'),'utf8'),block=source.slice(source.indexOf('  function destroyChart()'),source.indexOf('  function startClock()'));let removed=0;const state={chartResizeObserver:null,chartResizeFrame:0,redrawFlow:null,flowCanvas:{remove:()=>removed++},reversalCanvas:{remove:()=>removed++},reversalContext:{sourceId:'old'},chart:{remove:()=>removed++}};vm.runInNewContext(block+';destroyChart();',{state,cancelAnimationFrame:()=>{},renderMarkerDetails:()=>{}});assert.equal(removed,3);assert.equal(state.reversalCanvas,null);assert.equal(state.reversalContext,null);
});
test('AI review includes new context with its capture clock, but archives never acquire its bands',t=>{
 const Review=require('../review-pack');global.MultiAnalyzerReversal=R;t.after(()=>delete global.MultiAnalyzerReversal);const f=fixture(),original=JSON.stringify(f.a),asset={asset:'gold',signal:f.a,snapshot:{id:'synthetic-gold'}};
 const q=Review.consultation(asset,f.now);assert(q.reversalContext.available);assert.equal(q.reversalContext.observedAt,f.now);const text=Review.decisionText({verdict:'WAIT',direction:'SHORT',consultation:q,levels:{},checks:[],vetoes:[]}).join('\n');assert.match(text,/掃い・復帰の反転候補/);assert.match(text,/固定デモは変更しません/);const old=Review.consultation(asset,f.now,{archived:true});assert.equal(old.reversalContext.available,false);assert.deepEqual(old.reversalContext.candidates,[]);assert.equal(JSON.stringify(f.a),original);
});
