/* Presentation-only M15 background map. Selected chart analysis stays intact. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./strategy-core'):root.MultiAnalyzerCore);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerZoneView=api;
})(globalThis,function(Core){
  'use strict';
  function analysis(a){
    if(!a||a.exec?.intervalMinutes===15)return a;
    const tf=a.m15,last=tf?.candles?.at(-1),closedAt=last?.time+900000;
    const available=a.marketMap?.valid&&tf?.ready&&tf.intervalMinutes===15&&!tf.quality?.stale&&
      !(tf.quality?.gaps>3)&&Number.isFinite(a.generatedAt)&&Number.isFinite(last?.time)&&
      last.time%900000===0&&Number.isFinite(closedAt)&&closedAt<=a.generatedAt&&
      Number.isFinite(last?.close)&&last.close>0&&tf.values?.close===last.close&&
      Number.isFinite(tf.values?.atr)&&tf.values.atr>0;
    if(!available)return {...a,marketMap:{valid:false}};
    // Do not promote the selected timeframe's P state into a M15 entry claim.
    const view={...a,exec:tf,actionable:false};
    const risk=a.marketMap.eventRisk;
    const map=Core.buildMarketMap(view,{blackout:Boolean(risk?.blocked)});
    view.marketMap={...map,...(risk?{eventRisk:risk}:{}),
      note:map.note+' 候補帯の距離・SL参考・局所帯は15分確定値を使用。共通の新規判定は15分画面で確認。'};
    return view;
  }
  return {analysis};
});
