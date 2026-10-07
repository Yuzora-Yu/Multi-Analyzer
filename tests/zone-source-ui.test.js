const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const block=source.slice(source.indexOf('  function renderMarketMap(a)'),source.indexOf('  function renderPlan()'));
function fixture(){return {generatedAt:Date.parse('2026-10-07T18:19:00Z'),m15:{ready:true,intervalMinutes:15,quality:{stale:false},candles:[{time:Date.parse('2026-10-07T18:00:00Z'),close:4119.06}]},marketMap:{valid:true,price:9999,candidates:[],trends:[],entryState:'条件待ち',eventRisk:{events:[],message:'未確認'},note:''}};}
function render(a,{csv=false,archive=false,blocked=false}={}){
 const box={};const run=vm.runInNewContext(block+';renderMarketMap',{window:{},state:{offlineCsv:csv},INITIAL_PARAMS:new Set(archive?['snapshot']:[]),snapshotHealth:()=>({blocked}),$:()=>box,priceBasis:()=>({label:'元価格'}),mappedPrice:v=>v.toFixed(2),fmt:String,esc:String,Date});
 run(a);return box.innerHTML;
}
test('candidate view uses M15 close boundary and close price rather than generation time or other-frame map price',()=>{
 const a=fixture(),before=JSON.stringify(a),html=render(a);
 assert.match(html,/10\/08 03:15 JST \/ 確定価格 4119.06/);assert.doesNotMatch(html,/03:19|9999/);
 assert.match(html,/上部の進行中価格とは別/);assert.ok(html.indexOf('15分足の基準')<html.indexOf('価格基準'));
 assert.equal(JSON.stringify(a),before);
});
test('unconfirmed or unidentified source boundaries are unavailable and source modes stay explicit',()=>{
 for(const mutate of [a=>a.generatedAt=a.m15.candles[0].time,a=>a.m15.intervalMinutes=5,a=>a.m15.quality.stale=true,a=>a.m15.candles=[],a=>a.m15.candles[0].close=NaN]){const a=fixture();mutate(a);assert.match(render(a),/確定時刻・価格を確認できません/);}
 assert.match(render(fixture(),{archive:true}),/保存記録（現在の推奨ではありません）/);
 assert.match(render(fixture(),{csv:true}),/CSV検証/);
 assert.match(render(fixture(),{blocked:true}),/共通判定を保留・前回の足/);
});
