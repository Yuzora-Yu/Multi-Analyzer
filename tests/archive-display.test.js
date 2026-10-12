'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const header=app.slice(app.indexOf('  function updateLiveHeader()'),app.indexOf('  function renderHeader()'));
const services=app.slice(app.indexOf('  async function refreshServices()'),app.indexOf('  function renderTfRow('));
const candle=Date.UTC(2026,9,12,20,30),wall=Date.UTC(2026,9,12,21,8);
class WallDate extends Date {constructor(...args){super(...(args.length?args:[wall]));}static now(){return wall;}}
function setup({archive=false,csv=false,paused=false,exec={candles:[{time:candle}],intervalMinutes:15},fetcher}={}){
 const elements={},requests=[],state={instrumentId:'gold',loadId:1,servicesRequestId:0,offlineCsv:csv,marketPaused:paused,livePrice:4178.19,analysis:{exec},monitor:{updatedAt:1},monitorReceivedAt:1,reference:{price:1}},params=new Set(archive?['snapshot']:[]);
 const $=id=>elements[id]??=({textContent:''});
 const context={state,$,INITIAL_PARAMS:params,currentInstrument:()=>({digits:2}),fmt:x=>String(x),Date:WallDate,demoPanel:{sync(){},refresh(){}},pauseClosedMarket:()=>paused,STATIC_HOST:true,CLOUD:'https://monitor.invalid',analyzeAndRender(){},fetchJson:u=>{requests.push(u);return fetcher?fetcher(u):Promise.resolve(u.endsWith('/api/monitor')?{assets:{gold:{updatedAt:wall}},updatedAt:wall}:{price:1,updatedAt:new Date(wall).toISOString()});}};
 const run=vm.runInNewContext(header+services+';({updateLiveHeader,refreshServices})',context);return{...run,state,params,elements,requests};
}
test('saved chart names the historical candle close instead of replay wall time',()=>{
 const r=setup({archive:true}),before=JSON.stringify(r.state.analysis);r.updateLiveHeader();
 assert.match(r.elements.lastUpdate.textContent,/保存判定.*10\/13.*05:45.*JST/);assert.doesNotMatch(r.elements.lastUpdate.textContent,/LIVE|06:08/);assert.equal(r.elements.livePrice.textContent,'4178.19');assert.equal(JSON.stringify(r.state.analysis),before);
});
test('CSV close, missing interval and out-of-range time never acquire a LIVE timestamp',()=>{
 const csv=setup({csv:true});csv.updateLiveHeader();assert.match(csv.elements.lastUpdate.textContent,/CSV確定足.*05:45/);
 for(const exec of [{candles:[],intervalMinutes:15},{candles:[{time:candle}]},{candles:[{time:Infinity}],intervalMinutes:15},{candles:[{time:8640000000000000}],intervalMinutes:15}]){const r=setup({archive:true,exec});r.updateLiveHeader();assert.equal(r.elements.lastUpdate.textContent,'保存判定・確定時刻不明');}
});
test('closed-session header stops the live claim while the live quote header remains live',()=>{
 const paused=setup({paused:true});paused.updateLiveHeader();assert.equal(paused.elements.lastUpdate.textContent,'休場・価格取得停止');
 const live=setup();live.updateLiveHeader();assert.match(live.elements.lastUpdate.textContent,/^LIVE /);
});
test('historical/CSV service refresh makes zero requests and clears current auxiliary prices',async()=>{
 for(const options of [{archive:true},{csv:true}]){const r=setup(options);await r.refreshServices();assert.equal(r.requests.length,0);assert.equal(r.state.reference,null);assert.equal(r.state.monitor,null);assert.equal(r.state.monitorReceivedAt,0);assert.match(r.elements.referenceQuote.textContent,/現在の参考価格は取得しません/);}
});
test('Gold pause makes zero service requests, ordinary current mode keeps both services',async()=>{
 const paused=setup({paused:true});await paused.refreshServices();assert.equal(paused.requests.length,0);
 const live=setup();await live.refreshServices();assert.equal(live.requests.length,2);assert.match(live.elements.referenceQuote.textContent,/USD参考値/);assert.match(live.elements.monitorStatus.textContent,/クラウド監視/);
});
test('in-flight current reference and monitor cannot update a chart switched to CSV',async()=>{
 const pending=[],r=setup({fetcher:u=>new Promise(resolve=>pending.push({u,resolve}))});const call=r.refreshServices();assert.equal(pending.length,2);r.state.offlineCsv=true;
 for(const p of pending)p.resolve(p.u.endsWith('/api/monitor')?{assets:{gold:{updatedAt:wall}},updatedAt:wall}:{price:999,updatedAt:new Date(wall).toISOString()});
 await call;assert.equal(r.elements.referenceQuote,undefined);assert.equal(r.elements.monitorStatus,undefined);assert.equal(r.state.monitor.updatedAt,1);
});
