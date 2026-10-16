const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const source=app.slice(app.indexOf('  async function refreshServices()'),app.indexOf('  function renderTfRow('));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function setup(){
 const state={instrumentId:'gold',loadId:1,servicesRequestId:0,monitor:null,monitorReceivedAt:0,snapshot:{}},elements={},requests=[],renders=[];
 const refresh=vm.runInNewContext(source+';refreshServices',{state,INITIAL_PARAMS:new Set(),demoPanel:null,STATIC_HOST:false,CLOUD:'cloud',pauseClosedMarket:()=>false,fetchJson:url=>{const d=deferred();requests.push({url,...d});return d.promise;},$:id=>elements[id]??=({textContent:''}),fmt:x=>String(x),analyzeAndRender:()=>renders.push(state.monitor),Date,Promise});
 return{state,elements,requests,renders,refresh};
}
const status=(at=Date.now())=>({updatedAt:at,assets:{gold:{updatedAt:at,state:'NO_TRADE',snapshotId:'gold-test'}}});
const drain=async()=>{await Promise.resolve();await Promise.resolve();};
test('monitor is applied and rendered while reference request remains pending',async()=>{
 const f=setup(),p=f.refresh(),m=status();assert.equal(f.requests.length,2);f.requests[1].resolve(m);await drain();assert.equal(f.state.monitor,m.assets.gold);assert.equal(f.renders.length,1);assert.equal(f.elements.referenceQuote,undefined);f.requests[0].reject(Error('reference timeout'));await p;assert.equal(f.state.monitor,m.assets.gold);assert.equal(f.renders.length,1);
});
test('monitor failure clears health immediately even when reference succeeds later',async()=>{
 const f=setup();f.state.monitor=status().assets.gold;const p=f.refresh();f.requests[1].reject(Error('monitor timeout'));await drain();assert.equal(f.state.monitor,null);assert.equal(f.state.monitorReceivedAt,0);assert.equal(f.renders.length,1);f.requests[0].resolve({price:10,updatedAt:new Date().toISOString()});await p;assert.equal(f.state.monitor,null);assert.match(f.elements.referenceQuote.textContent,/参考値/);
});
test('missing monitor body or asset clears previous health instead of leaving a usable old record',async()=>{
 for(const payload of [null,{}, {assets:{btc:{updatedAt:Date.now()}}}]){const f=setup();f.state.monitor=status().assets.gold;const p=f.refresh();f.requests[1].resolve(payload);await drain();assert.equal(f.state.monitor,null);assert.equal(f.state.monitorReceivedAt,0);assert.equal(f.renders.length,1);f.requests[0].reject(Error('reference'));await p;}
});
test('superseded monitor rejection and reference response cannot overwrite newer service results',async()=>{
 const f=setup(),first=f.refresh(),second=f.refresh(),newer=status();f.requests[3].resolve(newer);f.requests[2].resolve({price:20,updatedAt:new Date().toISOString()});await second;f.requests[1].reject(Error('old failure'));f.requests[0].resolve({price:10,updatedAt:new Date().toISOString()});await first;assert.equal(f.state.monitor,newer.assets.gold);assert.match(f.elements.referenceQuote.textContent,/\$20/);assert.equal(f.renders.length,1);
});
test('asset or load change discards replies; older monitor payload cannot refresh health timestamp',async()=>{
 for(const key of ['instrumentId','loadId']){const f=setup(),p=f.refresh();f.state[key]=key==='instrumentId'?'btc':2;f.requests[1].resolve(status());f.requests[0].reject(Error('old'));await p;assert.equal(f.renders.length,0);assert.equal(f.state.monitor,null);}
 const f=setup(),now=Date.now();f.state.monitor=status(now).assets.gold;f.state.monitorReceivedAt=123;const p=f.refresh();f.requests[1].resolve(status(now-1));f.requests[0].reject(Error('reference'));await p;assert.equal(f.state.monitor.updatedAt,now);assert.equal(f.state.monitorReceivedAt,123);assert.equal(f.renders.length,0);
});
test('market pause blocks late replies without starting another request',async()=>{
 const f=setup(),p=f.refresh();f.state.marketPaused=true;f.requests[1].resolve(status());f.requests[0].resolve({price:10,updatedAt:new Date().toISOString()});await p;assert.equal(f.renders.length,0);assert.equal(f.state.monitor,null);assert.equal(f.elements.referenceQuote,undefined);assert.equal(f.requests.length,2);
});

test('actual CSV import immediately clears previously displayed live reference and monitor without new requests',async()=>{
 const importSource=app.slice(app.indexOf('  async function importCsv('),app.indexOf('  function runBacktest('));
 const candles=Array.from({length:80},(_,i)=>({time:i*900000,open:100,high:102,low:99,close:101,volume:1}));
 const state={instrumentId:'gold',loadId:1,servicesRequestId:1,reference:{price:4155.6},monitor:{updatedAt:1},monitorReceivedAt:1,data:{},micro:{}},elements={},requests=[];
 const $=id=>elements[id]??=({textContent:'current live price',value:'selected.csv'});
 const run=vm.runInNewContext(source+importSource+';importCsv',{state,$,INITIAL_PARAMS:new Set(),demoPanel:null,stopRealtime:()=>{},pauseClosedMarket:()=>false,fetchJson:url=>requests.push(url),Core:{parseCSV:()=>candles,inferIntervalMinutes:()=>15,aggregateCandles:()=>candles},TF:{'15m':{minutes:15}},qsa:()=>[],currentTf:()=>({minutes:15}),analyzeAndRender:()=>{},renderChart:()=>{},setLoading:()=>{},setConnection:()=>{},alert:msg=>assert.fail(msg),Date});
 await run({text:async()=>''});assert.equal(state.offlineCsv,true);assert.equal(state.reference,null);assert.equal(state.monitor,null);assert.equal(state.monitorReceivedAt,0);assert.match(elements.referenceQuote.textContent,/現在の参考価格は取得しません/);assert.equal(requests.length,0);
});
