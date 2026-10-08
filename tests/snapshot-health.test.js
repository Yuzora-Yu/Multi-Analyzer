const test=require('node:test'),assert=require('node:assert/strict'),H=require('../snapshot-health');
function fixture(){const close=Date.UTC(2026,9,7,14);return {now:close+5*60000,snapshot:{id:'gold-1',bars:{m15:[[close-900000]]}},monitor:{snapshotId:'gold-1',updatedAt:close+5*60000,state:'READY_SHORT',error:null},monitorReceivedAt:close+5*60000};}
test('healthy confirmed snapshot preserves canonical state and does not infer accuracy',()=>{
 const f=fixture(),before=JSON.stringify(f),r=H.assess(f);assert.equal(r.kind,'CURRENT');assert.equal(r.blocked,false);assert.equal(r.closedAt,f.snapshot.bars.m15[0][0]+900000);assert.equal(JSON.stringify(f),before);
});
test('fresh quotes or fresh monitor polls do not certify a failed or prior snapshot',()=>{
 const f=fixture();f.monitor.state='DATA_ERROR';f.monitor.error='BYBIT_RET_CODE';assert.equal(H.assess(f).kind,'DATA_ERROR');
 f.monitor.state='READY_SHORT';f.monitor.error=null;f.now+=11*60000;f.monitor.updatedAt=f.now;f.monitorReceivedAt=f.now;assert.equal(H.assess(f).kind,'NEXT_CANDLE_PENDING');assert.equal(H.assess(f).blocked,true);
});
test('failed retrieval, missing monitor, stale status and race in IDs remain explicit',()=>{
 const f=fixture();assert.equal(H.assess({...f,snapshotError:true}).kind,'SNAPSHOT_ERROR');assert.equal(H.assess({...f,monitor:null}).kind,'MONITOR_UNKNOWN');
 f.monitor.updatedAt-=181000;assert.equal(H.assess(f).kind,'MONITOR_DELAY');f.monitor.updatedAt=f.now;f.monitor.snapshotId='gold-next';assert.equal(H.assess(f).kind,'ID_MISMATCH');
 assert.equal(H.assess({...f,monitorReceivedAt:f.now-91000}).kind,'MONITOR_UNKNOWN');
});
test('archive and market closure are distinct from live success; future close is invalid',()=>{
 const f=fixture();f.monitor.state='MARKET_CLOSED';assert.equal(H.assess(f).kind,'MARKET_CLOSED');const archived=H.assess({...f,archived:true});assert.equal(archived.kind,'ARCHIVE');assert.equal(archived.blocked,false);assert.match(archived.message,/現在の売買判断ではありません/);
 f.snapshot.bars.m15[0][0]=f.now;assert.equal(H.assess(f).kind,'INVALID_TIME');
});

function reopenedGold(now='2026-10-09T07:04:00+09:00',closed='2026-10-09T05:45:00+09:00'){
 const Feed=require('../market-feed.js'),time=Date.parse(now);
 return {now:time,snapshot:{id:'gold-before-pause',asset:'gold',bars:{m15:[[Date.parse(closed)-900000]]}},monitor:{state:'DATA_ERROR',error:'STALE_MARKET',updatedAt:time,collectionSchedule:Feed.collectionPolicy('gold',time)},monitorReceivedAt:time};
}
test('scheduled Gold reopening explains a pending first candle while keeping the error and decision block',()=>{
 const f=reopenedGold(),before=JSON.stringify(f),r=H.assess(f);
 assert.equal(r.kind,'SESSION_CANDLE_PENDING');assert.equal(r.blocked,true);assert.match(r.message,/STALE_MARKET/);assert.equal(JSON.stringify(f),before);
 assert.equal(H.assess(reopenedGold('2026-10-09T07:15:01+09:00')).kind,'SESSION_CANDLE_PENDING');
 assert.equal(H.assess(reopenedGold('2026-10-09T07:15:03+09:00')).kind,'DATA_ERROR');
});
test('reopening cannot hide a pre-pause missing candle, unrelated API error or incomplete policy metadata',()=>{
 assert.equal(H.assess(reopenedGold(undefined,'2026-10-09T05:30:00+09:00')).kind,'DATA_ERROR');
 const f=reopenedGold();f.monitor.error='BYBIT_RET_CODE';assert.equal(H.assess(f).kind,'DATA_ERROR');
 f.monitor.error='STALE_MARKET';f.monitor.collectionSchedule.version='unknown';assert.equal(H.assess(f).kind,'DATA_ERROR');
 delete f.monitor.collectionSchedule;assert.equal(H.assess(f).kind,'DATA_ERROR');
 const btc=reopenedGold();btc.snapshot.asset='btc';assert.equal(H.assess(btc).kind,'DATA_ERROR');
 const stale=reopenedGold();stale.monitor.updatedAt-=181000;assert.equal(H.assess(stale).kind,'MONITOR_DELAY');
});
test('session explanation follows JST weekend and New York winter rules without granting live/archive success',()=>{
 const f=reopenedGold('2026-11-09T08:04:00+09:00','2026-11-06T23:45:00+09:00');
 assert.equal(H.assess(f).kind,'SESSION_CANDLE_PENDING');assert.equal(H.assess(f).blocked,true);
 assert.equal(H.assess(reopenedGold('2026-11-09T08:15:03+09:00','2026-11-06T23:45:00+09:00')).kind,'DATA_ERROR');
 f.archived=true;assert.equal(H.assess(f).kind,'ARCHIVE');
 const closed=reopenedGold('2026-10-09T06:30:00+09:00');closed.monitor.state='MARKET_CLOSED';closed.monitor.error=null;assert.equal(H.assess(closed).kind,'MARKET_CLOSED');
});
