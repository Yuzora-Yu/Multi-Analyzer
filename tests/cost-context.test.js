const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../review-pack');
const original={feeBpsPerSide:2,spreadBps:1.8,slippageBps:1.2};
test('cost context preserves original assumptions, treats valid zero as zero and missing fields as unavailable',()=>{
 const before=JSON.stringify(original),c=R.costContext(original);assert.equal(c.totalBps,7);assert.equal(c.roundTripFeeBps,4);assert.match(c.text,/未確認/);assert.match(c.text,/実損益ではありません/);assert.equal(JSON.stringify(original),before);
 assert.equal(R.costContext({feeBpsPerSide:0,spreadBps:0,slippageBps:0}).totalBps,0);
 for(const change of [undefined,{}, {...original,feeBpsPerSide:null},{...original,spreadBps:-1},{...original,slippageBps:'1.2'},{...original,feeBpsPerSide:Infinity},{...original,feeBpsPerSide:Number.MAX_VALUE}]){const c=R.costContext(change);assert.equal(c.available,false);assert.equal(c.totalBps,null);assert.match(c.text,/確認できません/);}
});
test('AI decision and prompt retain each saved snapshot cost basis without changing plans',()=>{
 const make=(asset,fee)=>({asset,snapshot:{id:asset+'-fixed',settings:{...original,feeBpsPerSide:fee,now:1000}},signal:{state:'NO_TRADE',vetoes:[],plan:{netRR:1.91}}});
 const pack={capturedAt:2000,assets:[make('gold',2),make('btc',10)]},before=JSON.stringify(pack);
 assert.equal(R.decision(pack.assets[0],2000).costAssumptions.totalBps,7);assert.equal(R.decision(pack.assets[1],2000).costAssumptions.totalBps,23);
 const text=R.prompt(pack);assert.match(text,/合計 7.00bps/);assert.match(text,/合計 23.00bps/);assert.equal(JSON.stringify(pack),before);
});
test('candidate renderer uses saved common settings and uses local settings only for CSV',()=>{
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),block=app.slice(app.indexOf('  function renderMarketMap(a)'),app.indexOf('  function renderPlan()'));
 const box={},state={snapshot:{settings:original},settings:{...original,feeBpsPerSide:10},offlineCsv:false};
 const run=vm.runInNewContext(block+';renderMarketMap',{window:{MultiAnalyzerReview:R},state,INITIAL_PARAMS:new Set(),snapshotHealth:()=>null,$:()=>box,priceBasis:()=>({label:'元価格'}),mappedPrice:String,fmt:String,esc:String,Date});
 const a={generatedAt:1000,marketMap:{valid:true,candidates:[],trends:[],entryState:'待機',eventRisk:{events:[],message:'未確認'}}};
 run(a);assert.match(box.innerHTML,/RR計算の費用/);assert.match(box.innerHTML,/合計 7.00bps/);assert.doesNotMatch(box.innerHTML,/合計 23.00bps/);
 state.offlineCsv=true;run(a);assert.match(box.innerHTML,/合計 23.00bps/);
});
