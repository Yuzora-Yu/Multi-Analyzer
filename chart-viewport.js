/* Logical chart navigation only; no analysis or signal changes. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerViewport=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function zoom(range,factor,count){
    if(!range||![range.from,range.to,factor,count].every(Number.isFinite)||range.to<=range.from||factor<=0||count<=0)return null;
    const span=Math.max(12,Math.min(Math.max(30,count+6),(range.to-range.from)*factor));
    const latest=count-1,nearLatest=range.from<=latest&&range.to>=latest&&range.to<=count+6;
    if(nearLatest)return {from:range.to-span,to:range.to};
    const middle=(range.from+range.to)/2;return {from:middle-span/2,to:middle+span/2};
  }
  return {zoom};
});
