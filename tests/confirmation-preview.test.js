const test=require('node:test'),assert=require('node:assert/strict'),R=require('../review-pack'),G=require('../zone-geometry'),C=require('../zone-checkpoint');
function fixture(direction='SHORT'){
 const z={id:'zone',direction,low:100,high:110,protectiveStop:direction==='SHORT'?112:98,invalidationClose:direction==='SHORT'?110:100,targets:[95,120],condition:'元条件'};
 const a={version:'test',generatedAt:900001,marketMap:{valid:true,price:106,candidates:[z]},m15:{ready:true,quality:{stale:false,gaps:0},candles:[{time:0,open:105,high:107,low:104,close:106}],swings:{lows:[{price:95,time:0}],highs:[{price:115,time:0}]}}};return {a,z};
}
test('preview matches original fixed checkpoint pivot and strict boundary without mutating it',t=>{
 global.MultiAnalyzerZoneGeometry=G;t.after(()=>delete global.MultiAnalyzerZoneGeometry);
 for(const direction of ['SHORT','LONG']){const {a,z}=fixture(direction),before=JSON.stringify({a,z}),c=C.create(a,z,{asset:'gold',symbol:'XAUUSDT',market:'futures',now:900001}),q=R.confirmationContext(a,z);
 assert.equal(q.pivot,c.rule.pivot);assert.equal(q.minutes,c.rule.minutes);assert.equal(q.boundary,direction==='SHORT'?95:115);assert.equal(q.sourceClosedAt,c.source.closedAt);assert.match(q.text,/後続15分終値/);assert.match(q.text,/等値は未成立/);assert.match(q.text,/現時点の成立やPサインを示すものではありません/);assert.equal(JSON.stringify({a,z}),before);
 const translated=R.confirmationContext(a,z,v=>(v+5).toFixed(2));assert.equal(translated.boundary,q.boundary);assert.match(translated.text,new RegExp((q.boundary+5).toFixed(2)));}
});
test('missing swing, gapped or unfinished evidence cannot present confirmation prices',t=>{
 global.MultiAnalyzerZoneGeometry=G;t.after(()=>delete global.MultiAnalyzerZoneGeometry);
 for(const mutate of [a=>a.m15.swings.lows=[],a=>a.m15.quality.gaps=1,a=>a.generatedAt=800000,a=>a.marketMap.valid=false]){const {a,z}=fixture();mutate(a);const q=R.confirmationContext(a,z);assert.equal(q.available,false);assert.equal(q.boundary,undefined);assert.match(q.text,/未取得/);}
 delete global.MultiAnalyzerZoneGeometry;assert.equal(R.confirmationContext(...Object.values(fixture())).available,false);
});
test('actual renderer and archived AI export retain the same preview without changing saved conditions',t=>{
 global.MultiAnalyzerZoneGeometry=G;t.after(()=>delete global.MultiAnalyzerZoneGeometry);
 const {a,z}=fixture(),asset={asset:'gold',snapshot:{id:'original-id',settings:{now:900001}},signal:{...a,exec:{},state:'NO_TRADE',direction:'SHORT'}};
 asset.consultation=R.consultation(asset,900001,{archived:true});const q=asset.consultation.zones[0].confirmationPreview;assert.equal(q.boundary,95);assert.equal(q.scope,'saved-decision-checkpoint-reconstruction');assert.match(q.text,/保存判定からの後日再構築/);assert.doesNotMatch(q.text,/今から固定追跡/);assert.deepEqual(asset.consultation.checkpoints,[]);assert.match(R.decisionText(R.decision(asset,900001)).join('\n'),/後続15分終値が 95.00 を下回る/);assert.equal(asset.consultation.zones[0].zone.condition,z.condition);
 const fs=require('node:fs'),vm=require('node:vm'),src=fs.readFileSync(require.resolve('../app.js'),'utf8'),block=src.slice(src.indexOf('  function renderMarketMap(a)'),src.indexOf('  function renderPlan()')),box={};
 a.generatedAt=Date.now();a.marketMap.trends=[];a.marketMap.entryState='条件待ち';a.marketMap.eventRisk={events:[],message:'部分'};z.phase='IN_ZONE';
 const render=vm.runInNewContext(block+';renderMarketMap',{window:{MultiAnalyzerZoneGeometry:G,MultiAnalyzerReview:R},state:{offlineCsv:false},INITIAL_PARAMS:new Set(),snapshotHealth:()=>null,$:()=>box,priceBasis:()=>({label:'元市場'}),mappedPrice:v=>v.toFixed(2),fmt:String,esc:String,Date});render(a);
 assert.match(box.innerHTML,/固定追跡の確認価格/);assert.match(box.innerHTML,/後続15分終値が 95.00 を下回る/);assert.match(box.innerHTML,/data-track-zone="0"/);assert.match(box.innerHTML,/15分終値110.00超で背景帯の見立て無効/);
});
