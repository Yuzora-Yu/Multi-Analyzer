const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../review-pack');
const btc={id:'saved-btc',asset:'btc',symbol:'BTCUSDT',settings:{market:'spot',now:1000}};
test('execution context verifies source identity but never account borrowing or execution',()=>{
 const before=JSON.stringify(btc),c=R.executionContext(btc);assert.equal(c.available,true);assert.equal(c.shortRequiresBorrow,true);assert.equal(c.accountExecutionVerified,false);assert.match(c.text,/保有BTCの売却/);assert.match(c.text,/借入/);assert.equal(JSON.stringify(btc),before);
 const gold=R.executionContext({asset:'gold',symbol:'XAUUSDT',settings:{market:'futures'}});assert.equal(gold.available,true);assert.equal(gold.shortRequiresBorrow,null);assert.match(gold.text,/無期限先物/);
 for(const s of [null,{}, {...btc,symbol:'BTCUSD'},{...btc,settings:{market:'futures'}},{...btc,asset:'gold'}]){assert.equal(R.executionContext(s).available,false);assert.equal(R.executionContext(s).shortRequiresBorrow,null);}
});
test('AI decision preserves hypothetical short and adds market scope without approving execution',()=>{
 const a={asset:'btc',snapshot:btc,signal:{state:'NO_TRADE',vetoes:[],plan:{direction:'SHORT',entry:100,stop:110,netRR:1.8}}};const before=JSON.stringify(a),d=R.decision(a,2000);
 assert.deepEqual(d.plan,a.signal.plan);assert.equal(d.executionContext.market,'spot');assert.equal(d.executionContext.accountExecutionVerified,false);
 assert.match(R.prompt({capturedAt:2000,assets:[a]}),/新規ショートには借入が必要/);assert.equal(JSON.stringify(a),before);
 const old={...d};delete old.executionContext;assert.doesNotThrow(()=>R.decisionText(old));
});
test('candidate renderer uses saved source market and does not infer a CSV execution venue',()=>{
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),block=app.slice(app.indexOf('  function renderMarketMap(a)'),app.indexOf('  function renderPlan()')),box={},state={snapshot:btc,settings:{market:'futures'},offlineCsv:false};
 const run=vm.runInNewContext(block+';renderMarketMap',{window:{MultiAnalyzerReview:R},state,INITIAL_PARAMS:new Set(),snapshotHealth:()=>null,$:()=>box,priceBasis:()=>({label:'元価格'}),mappedPrice:String,fmt:String,esc:String,Date});
 const a={generatedAt:1000,marketMap:{valid:true,candidates:[],trends:[],entryState:'待機',eventRisk:{events:[],message:'未確認'}}};
 run(a);assert.match(box.innerHTML,/BTCUSDT現物/);assert.doesNotMatch(box.innerHTML,/XAUUSDT無期限先物/);
 state.offlineCsv=true;run(a);assert.match(box.innerHTML,/元市場の銘柄・区分を確認できません/);assert.doesNotMatch(box.innerHTML,/BTCUSDT現物/);
});
