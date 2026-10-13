const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../strategy-core'),View=require('../zone-view'),Focus=require('../zone-focus'),Checkpoint=require('../zone-checkpoint');
const now=Date.parse('2026-10-13T05:00:00Z');
function fixture(minutes=5){
  const tf={ready:true,quality:{stale:false,gaps:0},trend:'bear',structure:{trend:'bear'},intervalMinutes:15,
    candles:[{time:now-900000,open:100,high:101,low:99,close:100}],values:{close:100,atr:4,ema20:102,ema50:104,bbUpper:108,bbLower:95},
    series:{bb:{mid:[102]}},swings:{lows:[{price:96,time:now-3600000}],highs:[{price:110,time:now-3600000}]},
    smc:{zones:[{type:'OB',side:'bear',low:102,high:104,time:now-3600000,status:'active'}]}};
  const exec=minutes===15?tf:{...tf,intervalMinutes:minutes,values:{...tf.values,close:103,atr:1},candles:[{time:now-minutes*60000,open:102,high:105,low:101,close:103}]};
  const a={version:Core.VERSION,exec,m15:tf,h1:{...tf,intervalMinutes:60},h4:{...tf,intervalMinutes:240},generatedAt:now,state:'READY_SHORT',actionable:true,direction:'SHORT'};
  a.marketMap=Core.buildMarketMap(a);return a;
}
test('chart switching cannot substitute selected-frame price, ATR, targets or P eligibility into the M15 background',()=>{
  for(const minutes of [1,5,60,240,1440]){
    const a=fixture(minutes),before=JSON.stringify(a),view=View.analysis(a),expected=Core.buildMarketMap({...a,exec:a.m15,actionable:false});
    assert.equal(view.marketMap.price,100);assert.deepEqual(view.marketMap.candidates,expected.candidates);
    assert.equal(view.marketMap.candidates[0].protectiveStop,104.8);
    assert.notEqual(a.marketMap.candidates[0].protectiveStop,view.marketMap.candidates[0].protectiveStop);
    assert.equal(view.marketMap.candidates[0].phase,'APPROACH');assert.equal(view.marketMap.entryState,'条件待ち');
    assert.equal(Focus.describe(view,view.marketMap.candidates[0]).radius,.8);
    assert.equal(JSON.stringify(a),before);assert.equal(view.exec,a.m15);
  }
});
test('canonical M15 map remains the exact original object and blackout evidence is preserved',()=>{
  const canonical=fixture(15);assert.equal(View.analysis(canonical),canonical);
  const a=fixture();a.marketMap.eventRisk={blocked:true,coverage:'partial',message:'元の指標警戒',events:[]};
  const v=View.analysis(a);assert.equal(v.marketMap.eventRisk,a.marketMap.eventRisk);assert.equal(v.marketMap.entryState,'指標警戒・入場保留');
  assert.ok(v.marketMap.candidates.every(z=>z.phase!=='ENTRY_CONFIRMED'));
});
test('missing, stale, gapped, forming or inconsistent M15 cannot borrow the selected chart map',()=>{
  for(const change of [a=>delete a.m15,a=>a.m15.ready=false,a=>a.m15.intervalMinutes=5,a=>a.m15.quality.stale=true,a=>a.m15.quality.gaps=4,a=>a.m15.candles=[],a=>a.m15.candles[0].time=now,a=>a.m15.values.close=999,a=>a.m15.values.atr=NaN,a=>a.marketMap.valid=false]){
    const a=fixture();change(a);assert.equal(View.analysis(a).marketMap.valid,false);
  }
});
test('rendered source and a newly fixed checkpoint use the same M15 stop and price without editing old records',()=>{
  const a=fixture(),v=View.analysis(a),z=v.marketMap.candidates[0];
  const record=Checkpoint.create(v,z,{asset:'gold',market:'futures',symbol:'XAUUSDT',now});
  assert.equal(record.source.price,100);assert.equal(record.zone.protectiveStop,104.8);assert.equal(record.rule.minutes,15);
  const before=JSON.stringify(record);View.analysis(fixture(60));assert.equal(JSON.stringify(record),before);
  const src=fs.readFileSync(require.resolve('../app.js'),'utf8'),block=src.slice(src.indexOf('  function renderMarketMap(a)'),src.indexOf('  function renderPlan()')),box={};
  const render=vm.runInNewContext(block+';renderMarketMap',{window:{MultiAnalyzerZoneView:View,MultiAnalyzerZoneFocus:Focus},state:{offlineCsv:false},INITIAL_PARAMS:new Set(),snapshotHealth:()=>null,$:()=>box,priceBasis:()=>({label:'元市場価格'}),mappedPrice:v=>v.toFixed(2),fmt:String,esc:String,Date});
  render(a);assert.match(box.innerHTML,/確定価格 100.00/);assert.match(box.innerHTML,/104.80/);assert.doesNotMatch(box.innerHTML,/104.20/);assert.match(box.innerHTML,/±0.8（15分ATR/);
  assert.match(src,/const a=window\.MultiAnalyzerZoneView\?\.analysis\(state\.analysis\)\|\|state\.analysis,z=a\.marketMap/);
});
