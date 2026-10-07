const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Core=require('../strategy-core');
test('chart draws the engine BB at original closed candle times, skips warm-up and preserves values when hidden',()=>{
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),line=app.slice(app.indexOf('  function toChartTime('),app.indexOf('  function renderChart()')),render=app.slice(app.indexOf('  function renderChartBands('),app.indexOf('  function applyChartRange('));
 const candles=Array.from({length:40},(_,i)=>({time:900000*i,open:100+i,high:102+i,low:99+i,close:101+i,volume:10})),bb=Core.bollinger(candles.map(c=>c.close),20,2),original=JSON.stringify({candles,bb}),writes={},options={};
 const state={showChartBands:true,bbSeries:['upper','mid','lower'].map(key=>({key,series:{setData:data=>writes[key]=data,applyOptions:o=>options[key]=o}}))};
 const context={state,candles,bb};vm.createContext(context);vm.runInContext(line+render+';renderChartBands(candles,bb)',context);
 for(const key of ['upper','mid','lower']){assert.equal(writes[key].length,21);assert.equal(writes[key][0].time,candles[19].time/1000);assert.equal(writes[key].at(-1).value,bb[key].at(-1));assert.equal(writes[key].at(-1).time,candles.at(-1).time/1000);assert.equal(options[key].visible,true);}
 state.showChartBands=false;vm.runInContext('renderChartBands(candles,bb)',context);assert.ok(Object.values(options).every(o=>o.visible===false));assert.equal(JSON.stringify({candles,bb}),original);
 vm.runInContext('renderChartBands(candles,null)',context);assert.ok(Object.values(writes).every(r=>r.length===0));
});
