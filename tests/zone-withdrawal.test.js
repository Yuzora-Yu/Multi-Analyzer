'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../review-pack'),STEP=900000;
const bar=(n,close,high=close+1,low=close-1)=>({time:n*STEP,open:close,high,low,close,volume:1});
function fixture(direction='SHORT'){
  const z={id:'original-zone',frame:'4H',type:'OB',direction,time:0,low:100,high:110,
    invalidationClose:direction==='SHORT'?110:100,protectiveStop:direction==='SHORT'?112:98,condition:'元の確認条件',targets:[95],phase:'IN_ZONE'};
  const a={version:'fixed-v1',generatedAt:19*STEP+1,state:'NO_TRADE',actionable:false,direction:'LONG',exec:{},
    m15:{ready:true,intervalMinutes:15,quality:{stale:false,gaps:0},candles:[bar(17,direction==='SHORT'?111:99),bar(18,105)],swings:{lows:[{price:95}],highs:[{price:115}]}},
    marketMap:{valid:true,price:105,candidates:[z],trends:[],entryState:'条件待ち',eventRisk:{events:[],message:'一部予定'}}};
  return {a,z};
}
test('revisited upper-frame zone retains the observed M15 withdrawal without changing its original engine result',()=>{
  for(const direction of ['SHORT','LONG']){
    const {a,z}=fixture(direction),before=JSON.stringify({a,z}),w=R.zoneWithdrawal(a,z);
    assert.equal(w.closedAt,18*STEP);assert.equal(w.invalidationClose,z.invalidationClose);assert.equal(w.zoneId,z.id);
    assert.equal(w.scope,'available-snapshot-closed-candles');assert.match(w.note,/表示範囲外の過去は未確認/);
    assert.match(R.withdrawalText(w),/元の見立ては再開しません/);
    const preview=R.confirmationContext(a,z);assert.equal(preview.available,false);assert.equal(preview.reason,'WITHDRAWAL_OBSERVED');assert.equal(preview.boundary,undefined);
    assert.equal(JSON.stringify({a,z}),before);assert.equal(a.marketMap.candidates[0].phase,'IN_ZONE');
  }
});
test('wick-only, equal close, pre-creation and unfinished candles do not establish withdrawal',()=>{
  const {a,z}=fixture();
  for(const bars of [[bar(17,110,114,109),bar(18,105)],[bar(14,111),bar(15,111),bar(18,105)]]){
    assert.equal(R.zoneWithdrawal({...a,m15:{...a.m15,candles:bars}},z),null);
  }
  assert.equal(R.zoneWithdrawal({...a,generatedAt:17*STEP+1},z),null);
  assert.equal(R.zoneWithdrawal({...a,m15:{...a.m15,intervalMinutes:5}},z),null);
  assert.equal(R.zoneWithdrawal(a,{...z,time:NaN}),null);
});
test('conflicting or malformed candle evidence is not used to withdraw a hypothesis',()=>{
  const {a,z}=fixture();
  for(const bars of [[bar(17,111),bar(17,105),bar(18,105)],[{...bar(17,111),high:100},bar(18,105)],
    [{...bar(17,111),time:17*STEP+1},bar(18,105)]]){
    assert.equal(R.zoneWithdrawal({...a,m15:{...a.m15,candles:bars}},z),null);
  }
  assert.equal(R.zoneWithdrawal({...a,m15:{...a.m15,candles:[...a.m15.candles].reverse()}},z).closedAt,18*STEP);
});
test('a different zone keeps its own original bounds and confirmation path',()=>{
  const {a,z}=fixture();
  assert.equal(R.zoneWithdrawal(a,{...z,id:'new-zone',high:120,invalidationClose:120}),null);
  assert.equal(R.zoneWithdrawal(a,{...z,id:'later-zone',time:18*STEP}),null);
});
test('actual candidate renderer and AI export suppress renewed tracking and geometry while retaining raw evidence',t=>{
  const {a,z}=fixture(),before=JSON.stringify({a,z});
  global.MultiAnalyzerZoneGeometry={describe:()=>{throw Error('Withdrawn zone must not receive new entry geometry');}};
  t.after(()=>delete global.MultiAnalyzerZoneGeometry);
  const asset={asset:'gold',snapshot:{id:'fixed-snapshot',settings:{now:a.generatedAt}},signal:a};
  asset.consultation=R.consultation(asset,a.generatedAt);
  assert.deepEqual(asset.consultation.zones[0].zone,z);assert.equal(asset.consultation.zones[0].geometry,null);
  assert.deepEqual(asset.consultation.zones[0].geometryText,[]);
  assert.match(R.decisionText(R.decision(asset,a.generatedAt)).join('\n'),/元の見立ては再開しません/);
  const archived=R.consultation(asset,a.generatedAt,{archived:true});
  assert.equal(archived.zones[0].withdrawal.closedAt,18*STEP);assert.match(archived.zones[0].confirmationPreview.text,/後日再構築/);
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),block=source.slice(source.indexOf('  function renderMarketMap(a)'),source.indexOf('  function renderPlan()')),box={};
  const render=vm.runInNewContext(block+';renderMarketMap',{window:{MultiAnalyzerReview:R,MultiAnalyzerZoneGeometry:global.MultiAnalyzerZoneGeometry},state:{offlineCsv:false},INITIAL_PARAMS:new Set(),snapshotHealth:()=>null,$:()=>box,priceBasis:()=>({label:'元市場'}),mappedPrice:v=>v.toFixed(2),fmt:String,esc:String,Date});
  render(a);assert.match(box.innerHTML,/撤回確認済み・売り背景/);assert.match(box.innerHTML,/撤回した確定足/);
  assert.match(box.innerHTML,/data-track-zone="0" disabled/);assert.doesNotMatch(box.innerHTML,/data-geometry-zone/);
  assert.equal(JSON.stringify({a,z}),before);
});
