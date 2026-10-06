(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerPriceBasis=api;})(globalThis,function(){
  'use strict';
  const MAX_AGE=24*3600000;
  function calibration(broker,reference,brokerAt,referenceAt,now=Date.now()){
    if(![broker,reference,brokerAt,referenceAt,now].every(Number.isFinite)||broker<=0||reference<=0)throw Error('価格・取得時刻が不正です');
    if(Math.abs(brokerAt-referenceAt)>15000||now-brokerAt>30000||now-referenceAt>30000||brokerAt>now||referenceAt>now)
      throw Error('15秒以内の同時刻価格で照合してください');
    return {offset:broker-reference,updatedAt:now,mode:'paired'};
  }
  function resolve(profile,asset,now=Date.now()){
    if(asset!=='gold')return {enabled:false,offset:0,label:'元市場価格'};
    if(!profile||!Number.isFinite(profile.offset)||!profile.updatedAt)return {enabled:false,offset:0,label:'業者価格の差額未設定'};
    if(now-profile.updatedAt>MAX_AGE||profile.updatedAt>now)return {enabled:false,offset:0,label:'差額の確認期限切れ（24時間）。再照合が必要'};
    return {enabled:true,offset:profile.offset,label:`業者価格の概算（${profile.offset>=0?'+':''}${profile.offset.toFixed(2)} USD／${profile.mode==='paired'?'同時刻照合':'手動推定'}）`,updatedAt:profile.updatedAt};
  }
  function convert(value,basis){return typeof value==='number'&&Number.isFinite(value)?value+(basis?.enabled?basis.offset:0):null;}
  return {calibration,resolve,convert,MAX_AGE};
});
