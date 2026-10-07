/* Observation-only distances at the existing fixed-checkpoint confirmation boundary. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerZoneGeometry=api;})(globalThis,function(){
  'use strict';
  function describe(a,z){
    const tf=a?.m15,last=tf?.candles?.at(-1),long=z?.direction==='LONG';
    if(!a?.marketMap?.valid||!tf?.ready||tf.quality?.stale||tf.quality?.gaps||!Number.isFinite(a.generatedAt)||!Number.isFinite(last?.time)||last.time+900000>a.generatedAt)return {available:false,reason:'確定15分足の品質を確認できません'};
    if(!['LONG','SHORT'].includes(z?.direction)||![z.low,z.high,z.protectiveStop].every(Number.isFinite)||z.low<=0||z.protectiveStop<=0||z.high<z.low||(long?z.protectiveStop>=z.low:z.protectiveStop<=z.high))return {available:false,reason:'候補帯・元のSL参考の位置を確認できません'};
    const pivot=(long?tf.swings?.highs:tf.swings?.lows)?.at(-1)?.price;
    if(!Number.isFinite(pivot)||pivot<=0)return {available:false,reason:'固定追跡に使う確定スイングが未取得です'};
    const boundary=long?Math.max(z.high,pivot):Math.min(z.low,pivot),sign=long?1:-1;
    const targets=[...new Set((z.targets||[]).filter(t=>Number.isFinite(t)&&t>0))];
    const passedTargets=targets.filter(t=>sign*(t-boundary)<=0).sort((x,y)=>sign*(x-y));
    const remaining=targets.filter(t=>sign*(t-boundary)>0).sort((x,y)=>sign*(x-y));
    const target=remaining[0]??null,riskDistance=sign*(boundary-z.protectiveStop),obstacleDistance=target===null?null:sign*(target-boundary);
    return {available:true,direction:z.direction,pivot,boundary,protectiveStop:z.protectiveStop,target,passedTargets,riskDistance,obstacleDistance,grossDistanceRatio:obstacleDistance===null?null:obstacleDistance/riskDistance,
      note:'この候補を今から固定追跡する場合の15分確認条件での距離比較。保存済み記録の条件は別に維持します。境界は入場価格ではありません。実際の終値・次足価格・費用・再訪高安は未反映。確認成立や売買の有利さを示すものではありません。'};
  }
  function text(g,price=v=>v.toFixed(2)){
    if(!g?.available)return [g?.reason||'確認境界の距離は未取得です'];
    const lines=[`帯と確定スイングを${g.direction==='LONG'?'上回る':'下回る'}境界 ${price(g.boundary)}。元のSL参考 ${price(g.protectiveStop)}までの距離 ${g.riskDistance.toFixed(2)}。`];
    lines.push(g.target===null?'確認境界を越えた先に、元の反応候補が残っていません。遠い目標を追加して比率を改善しません。':`境界の先に残る最寄りの反応候補 ${price(g.target)}まで ${g.obstacleDistance.toFixed(2)}。距離比 ${g.grossDistanceRatio.toFixed(2)}R（費用前・約定未確認）。`);
    if(g.passedTargets.length)lines.push(`元の反応候補 ${g.passedTargets.map(price).join(' / ')}は、確認境界以前に通過する位置です。確認後の残り値幅に数えません。`);
    lines.push(g.note);return lines;
  }
  return {describe,text};
});
