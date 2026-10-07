const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../zone-geometry.js'),C=require('../zone-checkpoint.js');
const bar={time:0,open:105,high:107,low:104,close:106};
function analysis(){return {version:'test',generatedAt:900001,marketMap:{valid:true,price:106},m15:{ready:true,quality:{stale:false,gaps:0},candles:[bar],swings:{lows:[{price:95,time:0}],highs:[{price:115,time:0}]}}};}
const short=()=>({id:'s',direction:'SHORT',low:100,high:110,protectiveStop:112,invalidationClose:110,targets:[95,90,92,92]});
test('confirmation crossing a target leaves only farther original obstacles, not an invented entry',()=>{
 const a=analysis(),z=short(),before=JSON.stringify({a,z}),g=G.describe(a,z);
 assert.equal(g.boundary,95);assert.equal(g.target,92);assert.deepEqual(g.passedTargets,[95]);assert.equal(g.riskDistance,17);assert.equal(g.obstacleDistance,3);assert.equal(g.grossDistanceRatio,3/17);
 const checkpoint=C.create(a,z,{asset:'gold',market:'futures',symbol:'XAUUSDT',now:900001});assert.equal(checkpoint.rule.pivot,g.pivot);assert.equal(checkpoint.zone.protectiveStop,g.protectiveStop);
 assert.equal(JSON.stringify({a,z}),before);assert.match(G.text(g).join(' '),/境界は入場価格ではありません/);assert.match(G.text(g).join(' '),/確認後の残り値幅に数えません/);
});
test('long and short mirror by distance; the stricter zone edge can determine the boundary',()=>{
 const a=analysis(),s=short();s.low=90;const g=G.describe(a,s);assert.equal(g.boundary,90);assert.equal(g.target,null);
 const l={direction:'LONG',low:90,high:110,protectiveStop:88,targets:[105,108,110]};a.m15.swings.highs=[{price:105}];const mirror=G.describe(a,l);
 assert.equal(mirror.boundary,110);assert.equal(mirror.riskDistance,g.riskDistance);assert.equal(mirror.target,null);assert.match(G.text(mirror).join(' '),/遠い目標を追加/);
});
test('missing, unclosed, gapped, stale and wrong-side stop inputs cannot produce ratios',()=>{
 const z=short();for(const change of [a=>a.m15.swings.lows=[],a=>a.m15.quality.stale=true,a=>a.m15.quality.gaps=1,a=>a.generatedAt=800000,a=>a.marketMap.valid=false]){const a=analysis();change(a);assert.equal(G.describe(a,z).available,false);}
 assert.equal(G.describe(analysis(),{...z,protectiveStop:109}).available,false);
 assert.equal(G.describe(analysis(),{...z,targets:[]}).grossDistanceRatio,null);
});
test('broker display translation changes labels only, retaining original distance calculations',()=>{
 const g=G.describe(analysis(),short()),before=JSON.stringify(g),text=G.text(g,v=>(v+5).toFixed(2)).join(' ');
 assert.match(text,/境界 100.00/);assert.match(text,/距離 17.00/);assert.match(text,/反応候補 97.00/);assert.equal(JSON.stringify(g),before);
});
test('actual market-map renderer retains original fields and tracking index beside the folded comparison',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const block=source.slice(source.indexOf('  function renderMarketMap(a)'),source.indexOf('  function renderPlan()'));
 const a=analysis(),z={...short(),phase:'IN_ZONE',frame:'15m',type:'FVG',role:'上位足に沿う候補',condition:'元の確認条件'};
 a.generatedAt=Date.now();a.marketMap={...a.marketMap,candidates:[z],trends:[{name:'4H',structure:'下',ma:'下'}],entryState:'条件待ち',eventRisk:{events:[],message:'部分カレンダー',checkedAt:0,coverage:'partial'},note:'元の観察'};
 const box={},before=JSON.stringify(a),esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const run=vm.runInNewContext(block+';renderMarketMap',{window:{MultiAnalyzerZoneGeometry:G},state:{offlineCsv:false},INITIAL_PARAMS:new Set(),snapshotHealth:()=>null,$:()=>box,priceBasis:()=>({label:'元市場価格'}),mappedPrice:v=>v.toFixed(2),fmt:String,esc,Date});
 run(a);assert.match(box.innerHTML,/<details data-geometry-zone="s" ><summary>確認を待った場合の残り値幅/);assert.match(box.innerHTML,/距離比 0.18R/);assert.match(box.innerHTML,/元の確認条件/);assert.match(box.innerHTML,/data-track-zone="0"/);assert.match(box.innerHTML,/95.00 \/ 90.00 \/ 92.00 \/ 92.00/);assert.equal(JSON.stringify(a),before);
 box.querySelectorAll=()=>[{open:true,dataset:{geometryZone:'s'}},{open:true,dataset:{geometryZone:'other'}}];run(a);assert.match(box.innerHTML,/<details data-geometry-zone="s" open>/);
 a.marketMap.candidates=[{...z,id:'new'}];run(a);assert.doesNotMatch(box.innerHTML,/<details[^>]* open>/);
});
