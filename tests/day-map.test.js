const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const D=require('../day-map'),Feed=require('../market-feed');
const STEP=900000,AT=Date.UTC(2026,9,28,8);
function fixture(){
 const cutoff=D.sessionStart(AT),past=[];for(let t=cutoff-STEP;past.length<220;t-=STEP)if(Feed.barExpected('gold',t,15))past.unshift({time:t,open:100,high:101,low:99,close:100,volume:100});
 Object.assign(past[200],{open:100,high:107,low:99,close:106,volume:250});for(const b of past.slice(201))Object.assign(b,{open:106,high:107,low:105,close:106});
 const c=[...past];for(let t=cutoff;t+STEP<=AT;t+=STEP)if(Feed.barExpected('gold',t,15))c.push({time:t,open:106,high:107,low:105.5,close:106,volume:100});
 const m15={intervalMinutes:15,candles:c};return {generatedAt:AT,m15,exec:m15};
}
test('map freezes prior high/low/midpoint and actual pre-cutoff zones; later bars and volume cannot improve it',()=>{
 const a=fixture(),input=JSON.stringify(a),m=D.build(a,{now:AT});assert(m.available);assert(m.entries.length);assert.deepEqual(m.previous.high,107);assert.equal(m.previous.low,99);assert.equal(m.previous.midpoint,103);assert(m.entries.every(z=>z.formedAt<=m.cutoff));assert.equal(JSON.stringify(a),input);
 for(const b of a.m15.candles.filter(b=>b.time>=m.cutoff))Object.assign(b,{open:10,high:10000,low:1,close:9000,volume:1e10});assert.deepEqual(D.build(a,{now:AT}),m);
 a.m15.candles.push({time:AT+STEP,open:NaN});assert.deepEqual(D.build(a,{now:AT}),m);
});
test('retirement uses original source frame and bounds and never restores an old FVG after a rebound',()=>{
 const a=fixture(),map=D.build(a,{now:AT}),z=map.entries.find(z=>z.kind==='FVG');assert(z);const start=map.cutoff;
 Object.assign(a.m15.candles.find(b=>b.time===start),{low:z.low,close:106});
 const observed=D.observe(map,a,AT),retired=observed.entries.find(x=>x.id===z.id);assert.equal(retired.current.status,'解消');assert.equal(retired.current.changedAt,start+STEP);assert.equal(retired.low,z.low);assert.equal(retired.high,z.high);assert(!('current' in z));assert.deepEqual(D.build(a,{now:AT}),map);
});
test('missing prior expected bar blocks the range, but a scheduled daily closure does not',()=>{
 const a=fixture(),m=D.build(a,{now:AT});assert(m.available);a.m15.candles.splice(a.m15.candles.findIndex(b=>b.time===m.previous.startAt+STEP),1);assert.equal(D.build(a,{now:AT}).available,false);
});
test('missing post-cutoff observations cannot claim a hold, while witnessed retirement remains definite',()=>{
 const a=fixture(),m=D.build(a,{now:AT});a.m15.candles.splice(a.m15.candles.findIndex(b=>b.time===m.cutoff+STEP),1);assert(D.observe(m,a,AT).entries.every(z=>z.current.status==='追跡不足'));
 const z=m.entries[0];Object.assign(a.m15.candles.at(-1),{low:z.low-1,close:106});assert.equal(D.observe(m,a,AT).entries.find(x=>x.id===z.id).current.status,'解消');
});
test('archive, CSV, wrong asset and blocked health never acquire the live map',()=>{
 for(const options of [{mode:'archive'},{mode:'csv'},{asset:'btc'},{health:{blocked:true}}])assert.equal(D.build(fixture(),{now:AT,...options}).available,false);
});
test('session follows the existing NY18 Gold day across DST and skips closed weekend days',()=>{
 assert.equal(D.sessionStart(Date.UTC(2026,9,28,8)),Date.UTC(2026,9,27,22));assert.equal(D.sessionStart(Date.UTC(2026,10,4,8)),Date.UTC(2026,10,3,23));
 const c=[];const cutoff=D.sessionStart(Date.UTC(2026,9,26,8));for(let t=cutoff-4*86400000;t<cutoff;t+=STEP)if(Feed.barExpected('gold',t,15))c.push({time:t,open:100,high:101,low:99,close:100,volume:100});
 const a={generatedAt:Date.UTC(2026,9,26,8),m15:{intervalMinutes:15,candles:c}};const m=D.build(a,{now:a.generatedAt});assert(m.available);assert(m.previous.endAt<cutoff);assert.equal(m.previous.bars,92);
});
test('map is compact, retains original child bands and exposes the scope without new chart labels',()=>{
 const m=D.observe(D.build(fixture(),{now:AT}),fixture(),AT),html=D.html(m);assert(m.entries.length<=6);assert.match(html,/<details data-day-map>/);assert(!html.includes(' open'));assert.match(html,/P\/EXIT条件/);assert.match(D.lines(m).join('\n'),/当時の表示・配信記録ではありません/);assert(m.entries.every(z=>Array.isArray(z.overlaps)));
});
test('MT5 pure retirement rules match OB close withdrawal and FVG full fill without widening',()=>{
 const src=fs.readFileSync(require.resolve('../mt5/MADayMapCore.mqh'),'utf8'),body=/bool MADayRetired\([^]*?\) \{([^]*?)\n\}/.exec(src)[1],ctx=vm.createContext({});vm.runInContext(`function retire(z,b){${body}}`,ctx);
 assert(ctx.retire({side:1,kind:1,low:100,high:105},{low:100,high:106,close:104}));assert(!ctx.retire({side:1,kind:0,low:100,high:105},{low:99,high:106,close:100}));assert(ctx.retire({side:-1,kind:0,low:100,high:105},{low:100,high:107,close:106}));
 const main=fs.readFileSync(require.resolve('../mt5/MultiAnalyzerGold.mq5'),'utf8');assert.match(main,/CopyRates\(_Symbol,tf,cutoff-1,MA_DAY_MAP_HISTORY\+1/);assert.match(main,/dayMapJson|DayMapJson/);assert.match(main,/InitialDayMap=false/);assert(!src.includes('MAMakePlan'));
});
test('MT5 tracks a short current-session sample without a spurious 60-bar requirement',()=>{
 const src=fs.readFileSync(require.resolve('../mt5/MADayMapCore.mqh'),'utf8'),ctx=vm.createContext({MathIsValidNumber:Number.isFinite,MathMax:Math.max,MathMin:Math.min,ArraySize:a=>a.length,MAHistorySessionOverlap:(a,b)=>b>a});
 for(const [name,args] of [['MADayBarValid','b'],['MADayRetired','z,b'],['MADayObserve','entry,c,cutoff,now,sessions']]){
  const match=new RegExp('(?:bool|void) '+name+'\\([^]*?\\) \\{').exec(src);let end=match.index+match[0].length,start=end,depth=1;while(depth){if(src[end]==='{')depth++;if(src[end]==='}')depth--;end++;}
  let body=src.slice(start,end-1).replace(/datetime expected=\(datetime\)\(\(long\)now\/z.seconds\*z.seconds\);/,'let expected=Math.floor(now/z.seconds)*z.seconds;').replace(/\b(?:bool|int|datetime|MqlRates|MAZone)\s+/g,'let ');vm.runInContext(`function ${name}(${args}){${body}}`,ctx);
 }
 const cutoff=Date.UTC(2026,9,28)/1000,z={seconds:900,side:1,kind:1,low:100,high:105},bars=Array.from({length:3},(_,i)=>({time:cutoff+i*900,open:106,high:107,low:104,close:106})),entry={zone:z};
 ctx.MADayObserve(entry,bars,cutoff,cutoff+2700,[]);assert.equal(entry.status,1);assert.equal(entry.visits,1);
 ctx.MADayObserve(entry,[bars[0],bars[2]],cutoff,cutoff+2700,[]);assert.equal(entry.status,3);
 bars[0].low=100;ctx.MADayObserve(entry,bars,cutoff,cutoff+2700,[]);assert.equal(entry.status,2);assert.equal(entry.changedAt,cutoff+900);assert.deepEqual(z,{seconds:900,side:1,kind:1,low:100,high:105});
});
test('MT5 actual map export expression keeps native clock, bounds and frozen importance as valid JSON',()=>{
 const src=fs.readFileSync(require.resolve('../mt5/MultiAnalyzerGold.mq5'),'utf8'),match=/string DayMapJson\(\) \{/.exec(src);let end=match.index+match[0].length,start=end,depth=1;while(depth){if(src[end]==='{')depth++;if(src[end]==='}')depth--;end++;}
 // Braces inside JSON strings are balanced in this function too.
 const body=src.slice(start,end-1).replace(/\b(?:string|int|MADayEntry)\s+/g,'let ').replace(/\(long\)/g,''),entry={zone:{frame:'H1',seconds:3600,kind:1,side:1,low:100,high:105,formed:900},importance:{score:40},status:2,visits:1,changedAt:1800,through:1800};
 const ctx=vm.createContext({dayMapReady:true,dayMapCutoff:1000,dayMapPreviousStart:10,dayMapHigh:120,dayMapLow:90,dayMapMid:105,dayMapCoverage:'H1 OK',dayMapEntries:[entry],JBool:JSON.stringify,JNumber:String,IntegerToString:String,ChartBasis:()=> 'BID',MAJsonEscape:x=>x,ArraySize:a=>a.length,MAKind:()=> 'FVG',MADayStatus:()=> '解消',ImportanceJson:JSON.stringify});vm.runInContext(`function exportMap(){${body}}`,ctx);
 const output=JSON.parse(ctx.exportMap());assert.equal(output.source,'BROKER_NATIVE_D1');assert.equal(output.priceBasis,'BID');assert.equal(output.cutoffServerTime,1000);assert.equal(output.entries[0].low,100);assert.equal(output.entries[0].importanceAtCutoff.score,40);assert.equal(output.entries[0].current.status,'解消');ctx.dayMapReady=false;assert.equal(JSON.parse(ctx.exportMap()).entries.length,0);
});
