const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const V=require('../chart-viewport.js');
test('zoom retains latest visible candle and returns to same right edge on zoom out',()=>{
 const r=V.zoom({from:0,to:303},.75,300);assert.equal(r.to,303);assert.ok(r.from<299&&r.to>299);assert.equal(r.to-r.from,227.25);
 assert.deepEqual(V.zoom(r,1/.75,300),{from:0,to:303});
});
test('historical and far-future viewports retain their focal center',()=>{
 assert.deepEqual(V.zoom({from:20,to:100},.75,300),{from:30,to:90});
 assert.deepEqual(V.zoom({from:400,to:480},.75,300),{from:410,to:470});
});
test('invalid ranges and empty data cannot create a chart range',()=>{
 for(const [r,f,c] of [[null,.75,300],[{from:1,to:1},.75,300],[{from:0,to:20},0,300],[{from:0,to:20},.75,0],[{from:0,to:NaN},.75,300]])assert.equal(V.zoom(r,f,c),null);
});
test('actual app zoom and reset use the displayed archive candles, not live/forming count',()=>{
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),source=app.slice(app.indexOf('  function chartCandles()'),app.indexOf('  function updateLiveCandle('));
 let current={from:0,to:302},redraw=0;const api={getVisibleLogicalRange:()=>current,setVisibleLogicalRange:r=>{current=r},fitContent:()=>{current='fit'}};
 const context={INITIAL_PARAMS:new URLSearchParams('snapshot=test'),state:{snapshot:{},analysis:{exec:{candles:Array(299)}},data:{exec:Array(1000)},chart:{timeScale:()=>api},redrawFlow:()=>redraw++},window:{MultiAnalyzerViewport:V},$:()=>({value:'60'})};
 vm.createContext(context);vm.runInContext(source+';zoomChart(.75)',context);assert.equal(current.to,302);assert.ok(current.from<298);assert.equal(redraw,1);
 vm.runInContext('applyChartRange()',context);assert.equal(current.from,239);assert.equal(current.to,302);
 context.INITIAL_PARAMS=new URLSearchParams();vm.runInContext('applyChartRange()',context);assert.equal(current.from,940);assert.equal(current.to,1003);
});
