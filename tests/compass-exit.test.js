const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),source=app.slice(app.indexOf('  function renderCompass()'),app.indexOf('  function renderZones()'));
function render({position=null,health=null,archive=false,exit=true,analysisInput=null}={}){
 const elements={},analysis=analysisInput||{plan:null,state:'NO_TRADE',actionable:false,direction:'SHORT',positionDecision:exit?{action:'EXIT_SHORT',reasons:['保護ストップ到達']}:null,exec:{flow:null,candles:[],smc:null}};
 const state={analysis,feedAt:Date.now(),snapshot:{id:'record',symbol:'XAUUSDT',settings:{position:{direction:'SHORT',entry:100}}}};
 const $=id=>elements[id]??=({style:{},textContent:'',innerHTML:''});
 const run=vm.runInNewContext(source+';renderCompass',{state,$,snapshotHealth:()=>health,getPosition:()=>position,INITIAL_PARAMS:new Set(archive?['snapshot']:[]),currentInstrument:()=>({symbol:'XAUUSDT',market:'futures'}),currentTf:()=>({label:'15m',minutes:15}),stateLabel:x=>x,fmt:String,esc:String,window:{MultiAnalyzerReview:{reasons:()=>['新規条件待ち'],context:require('../review-pack').context},MultiAnalyzerEvidence:{currentEventsText:require('../chart-evidence').currentEventsText,context:()=>({exit:'撤退注意'})}},Date});run();return{elements,analysis};
}
test('reference exit never implies an actual holding or automatic reverse entry',()=>{
 const r=render();assert.match(r.elements.actionHeadline.textContent,/参考候補の撤退注意/);assert.doesNotMatch(r.elements.actionHeadline.textContent,/クローズ推奨|売りポジション/);assert.match(r.elements.actionTargets.textContent,/反転エントリーの確認とは別/);assert.equal(r.elements.sheetSummary.textContent,'× 参考候補の撤退注意');assert.equal(r.analysis.positionDecision.action,'EXIT_SHORT');
});
test('explicit entered holdings retain side and exit evidence without changing engine action',()=>{
 for(const direction of ['LONG','SHORT']){const r=render({position:{direction,entry:100}});assert.match(r.elements.actionHeadline.textContent,new RegExp('入力した'+(direction==='LONG'?'買い':'売り')+'ポジション：撤退条件成立'));assert.match(r.elements.actionTargets.textContent,/保護ストップ到達/);assert.equal(r.elements.sheetSummary?.textContent,'× 保有の撤退条件');}
});
test('blocked health overrides both reference and entered exit displays',()=>{
 for(const position of [null,{direction:'LONG',entry:100}]){const r=render({position,health:{blocked:true,message:'判定不一致'}});assert.match(r.elements.actionHeadline.textContent,/共通判定を保留/);assert.equal(r.elements.actionTargets.textContent,'判定不一致');assert.equal(r.elements.actionCompass.className,'action-compass wait');assert.notEqual(r.elements.sheetSummary?.textContent,'× 保有の撤退条件');}
});
test('archive exit remains labelled as a saved record; ordinary waiting stays unchanged',()=>{
 const r=render({archive:true});assert.match(r.elements.actionHeadline.textContent,/^保存記録｜× 参考候補/);assert.equal(render({exit:false}).elements.actionHeadline.textContent,'— 新規候補なし');
});
test('current CHoCH is visible with retained direction while stale health and old events suppress it',()=>{
 const time=1800000,analysis={generatedAt:time+900000,plan:null,state:'NO_TRADE',actionable:false,direction:'SHORT',positionDecision:null,exec:{intervalMinutes:15,quality:{stale:false},values:{adx:15},candles:[{time,close:102}],flow:{latest:{time,structure:-1,direction:-1,ribbon:1}},smc:{location:'equilibrium',zones:[],liquidity:[],events:[{time,type:'CHoCH',side:'bull',price:100}]}}};
 const before=structuredClone(analysis),r=render({analysisInput:analysis});
 assert.match(r.elements.actionContext.textContent,/確定スイング 下向き \/ リボン 上向き \/ 保持方向と不一致/);assert.match(r.elements.actionContext.textContent,/最新SMC：上向き CHoCH 100\.00/);assert.equal(r.elements.actionHeadline.textContent,'— 新規候補なし');assert.equal(r.elements.actionCompass.className,'action-compass wait');assert.deepEqual(analysis,before);
 assert.doesNotMatch(render({analysisInput:analysis,health:{blocked:true,message:'判定保留'}}).elements.actionContext.textContent,/CHoCH/);
 analysis.exec.smc.events[0].time-=900000;assert.doesNotMatch(render({analysisInput:analysis}).elements.actionContext.textContent,/最新SMC|CHoCH/);
});
