const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const source=app.slice(app.indexOf('  function resetAnalysisView()'),app.indexOf('  function analysisSettings('));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function setup({tf='15m',closed=false}={}){
  const state={instrumentId:'btc',tf,loadId:1,analysis:{old:'gold'},preview:{old:'gold'},snapshot:{id:'gold-old'},monitor:{old:true},data:{exec:[]}};
  const elements={},requests=[],connections=[],errors=[];
  const element=id=>elements[id]??=({textContent:'old gold 4167.07',className:'old-positive',hidden:false,style:{setProperty(k,v){this[k]=v;}},value:id==='positionEntry'?'4186':id==='positionStop'?'4195':id==='positionDirection'?'SHORT':'',title:'old gold spread'});
  // textContent replaces children in a real DOM, including old zone tracking buttons.
  for(const id of ['marketMap','trendContext','checkpointStatus']){
    const node=element(id);let content='<button>old gold 4167.07</button>';
    Object.defineProperties(node,{textContent:{get:()=>content,set:v=>{content=v;}},innerHTML:{get:()=>content,set:v=>{content=v;}}});
  }
  for(const id of ['snapshotHealth','entryValue','stopValue','signalTime','livePrice','positionEntry','positionStop','positionDirection','flowSummary','longScore','tf4Trend'])element(id);
  const request=()=>{const d=deferred();requests.push(d);return d.promise;};
  const loader=vm.runInNewContext(source+';loadAllData',{
    state,$:element,stopRealtime:()=>{},currentInstrument:()=>({name:'BITCOIN',symbol:'BTCUSDT',sourceLabel:'BINANCE BTC SPOT'}),currentTf:()=>({label:tf,minutes:tf==='15m'?15:5}),
    demoPanel:null,pauseClosedMarket:()=>closed,refreshServices:()=>{},refreshSnapshot:request,fetchKlines:request,
    TF:{'5m':{limit:500},'15m':{limit:500},'1h':{limit:500},'4h':{limit:500}},
    setLoading:()=>{},setConnection:(...args)=>connections.push(args),INITIAL_PARAMS:new URLSearchParams(),STATIC_HOST:true,
    connectRealtime:()=>{},setInterval:()=>1,clearInterval:()=>{},console:{error:e=>errors.push(e.message)},Date,Promise
  });
  return{state,elements,requests,connections,errors,loader};
}
function assertWaiting(f){
  assert.equal(f.state.analysis,null);assert.equal(f.state.preview,null);
  assert.equal(f.elements.symbolCode.textContent,'BTCUSDT');
  for(const id of ['entryValue','stopValue','signalTime','livePrice','longScore','tf4Trend'])assert.equal(f.elements[id].textContent,'—',id);
  for(const id of ['marketMap','trendContext','flowSummary'])assert.doesNotMatch(f.elements[id].textContent,/4167\.07|old gold|<button>/,id);
  assert.equal(f.elements.checkpointStatus.innerHTML,'');assert.equal(f.elements.checkpointStatus.hidden,true);
  assert.equal(f.elements.snapshotHealth.textContent,'共通判定の確認待ち');
  assert.equal(f.elements.currentSnapshotLink.href,'?asset=btc&tf=15m');
  assert.equal(f.elements.dataSource.textContent,'BINANCE BTC SPOT');
  assert.equal(f.elements.positionEntry.value,'4186');assert.equal(f.elements.positionStop.value,'4195');assert.equal(f.elements.positionDirection.value,'SHORT');
}
test('full asset load clears prior gold claims immediately and keeps them cleared after M15 failure',async()=>{
  const f=setup(),pending=f.loader();assert.equal(f.requests.length,1);assertWaiting(f);
  f.requests[0].reject(Error('snapshot unavailable'));await pending;assertWaiting(f);
  assert.match(f.elements.actionHeadline.textContent,/取得失敗/);assert.equal(f.connections.at(-1)[0],'error');
});
test('environment timeframe fetch failure cannot leave a previous plan, MA context or health claim visible',async()=>{
  const f=setup({tf:'5m'}),pending=f.loader();assert.equal(f.requests.length,4);assertWaiting(f);
  f.requests[0].reject(Error('kline unavailable'));await pending;assertWaiting(f);
  assert.equal(f.elements.tfExecLabel.textContent,'5m');assert.equal(f.elements.planAction.textContent,'WAIT / NO TRADE');
});
test('market closure gate clears discarded analysis without requesting data or deleting position inputs',async()=>{
  const f=setup({closed:true});await f.loader();assertWaiting(f);assert.equal(f.requests.length,0);assert.equal(f.connections.length,0);
});
test('a late failure from a superseded full load does not overwrite the newer loading state',async()=>{
  const f=setup(),first=f.loader(),second=f.loader();assert.equal(f.requests.length,2);
  f.requests[0].reject(Error('old failure'));await first;assertWaiting(f);
  assert.equal(f.elements.actionHeadline.textContent,'データ取得中・判断待機');assert.deepEqual(f.errors,[]);
  f.requests[1].reject(Error('current failure'));await second;assert.match(f.elements.actionHeadline.textContent,/取得失敗/);assert.deepEqual(f.errors,['current failure']);
});
