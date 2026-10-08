/* Presentation health is separate from the immutable canonical decision. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./market-feed.js'):root.MultiAnalyzerFeed);if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerSnapshotHealth=api;})(globalThis,function(Feed){
  'use strict';
  function sessionCandlePending(snapshot,monitor,closedAt,now){
    const bar=900000;
    if(!Feed||snapshot?.asset!=='gold'||monitor?.error!=='STALE_MARKET'||
      monitor.collectionSchedule?.allowed!==true||monitor.collectionSchedule.version!==Feed.SESSION_VERSION||
      !Feed.collectionPolicy('gold',now).allowed||closedAt%bar!==0||now-closedAt>4*86400000)return false;
    let paused=false;
    // Only explain the gap when every intervening decision boundary was excluded
    // by the unchanged session policy. A missed open-market bar remains an error.
    const cutoff=Math.floor((now-2000)/bar)*bar;
    for(let at=closedAt+bar;at<=cutoff;at+=bar){
      if(Feed.barExpected('gold',at-bar,15)&&Feed.collectionPolicy('gold',at).allowed)return false;
      paused=true;
    }
    return paused;
  }
  function assess({snapshot,monitor,monitorReceivedAt,now=Date.now(),archived=false,snapshotError=false}){
    const open=snapshot?.bars?.m15?.at(-1)?.[0],closedAt=Number.isFinite(open)?open+900000:null;
    const out=(kind,blocked,message)=>({kind,blocked,message,closedAt,assessedAt:now,monitorUpdatedAt:Number.isFinite(monitor?.updatedAt)?monitor.updatedAt:null});
    if(archived)return out('ARCHIVE',false,'保存判定の記録。現在の売買判断ではありません。');
    if(!Number.isFinite(now)||!Number.isFinite(closedAt)||closedAt>now+2000)return out('INVALID_TIME',true,'共通判定の確定時刻を確認できません。');
    if(snapshotError)return out('SNAPSHOT_ERROR',true,'共通判定の取得失敗。表示中の足は前回の記録です。');
    if(!monitor||!Number.isFinite(monitorReceivedAt)||monitorReceivedAt>now||now-monitorReceivedAt>90000)return out('MONITOR_UNKNOWN',true,'監視状態を確認できません。表示中の足で新しい判断をしません。');
    if(!Number.isFinite(monitor.updatedAt)||monitor.updatedAt>now+5000||now-monitor.updatedAt>180000)return out('MONITOR_DELAY',true,'監視更新が遅れています。価格配信と共通判定の更新は別です。');
    if(monitor.state==='MARKET_CLOSED')return out('MARKET_CLOSED',true,'市場休場。表示中の足は最終取得時点の記録です。');
    if(monitor.state==='DATA_ERROR'&&sessionCandlePending(snapshot,monitor,closedAt,now))return out('SESSION_CANDLE_PENDING',true,'GOLD休場明け・新しい15分確定足待ち。前回の足を表示しています。新しい売買判断は保留します。');
    if(monitor.state==='DATA_ERROR'||monitor.error)return out('DATA_ERROR',true,'監視のデータ取得エラー。表示中の足は前回の記録です。');
    if(monitor.snapshotId!==snapshot.id)return out('ID_MISMATCH',true,'画面と監視の判定IDが未一致。同期するまで判断を保留します。');
    if(closedAt<Math.floor((now-2000)/900000)*900000)return out('NEXT_CANDLE_PENDING',true,'新しい確定足の共通判定を取得待ち。前回の足を表示しています。');
    return out('CURRENT',false,'監視と判定IDが一致。以下は表示時刻の15分確定足です。');
  }
  return {assess};
});
