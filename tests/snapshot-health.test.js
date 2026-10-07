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
