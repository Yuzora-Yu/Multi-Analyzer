'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),R=require('../review-pack');
const minute=60000,cutoff=Date.UTC(2026,9,16,6);
function fixture(archived=false){
  const capturedAt=cutoff+7.5*minute,decisionCutoff=cutoff+1,id='gold-fixed',version='4.3.4';
  const bar=(time,close=103)=>({time,open:102,high:104,low:101,close,volume:10});
  const zone=(direction,low,high)=>({id:direction,direction,frame:'15m',type:'OB',time:cutoff-3600000,low,high,
    invalidationClose:direction==='LONG'?low-1:high+1,protectiveStop:direction==='LONG'?low-2:high+2});
  const m15={ready:true,intervalMinutes:15,candles:[{...bar(cutoff-15*minute),close:103}],quality:{stale:false,gaps:0}};
  const entry={asset:'gold',snapshot:{id,asset:'gold',symbol:'XAUUSDT',version,settings:{now:decisionCutoff,market:'futures'}},
    signal:{version,generatedAt:decisionCutoff,m15,marketMap:{valid:true,candidates:[zone('LONG',100,102),zone('SHORT',110,112)]}},health:{blocked:false}};
  const records=[1,5].map(minutes=>{
    const end=archived?cutoff:cutoff+Math.floor(7/minutes)*minutes*minute;
    const rows=Array.from({length:4},(_,i)=>bar(end-(4-i)*minutes*minute));
    const history=rows.map((b,i)=>({time:b.time,direction:1,ribbon:-1,structure:0,switched:i===0}));
    return {asset:'gold',tf:minutes+'m',minutes,snapshotId:id,version,decisionCutoff,cutoff:archived?decisionCutoff:capturedAt,
      timeBasis:archived?'archived-decision':'latest-closed',rows,analysis:{ready:true,intervalMinutes:minutes,quality:{stale:false,gaps:0},candles:structuredClone(rows),flow:{history,latest:history.at(-1)}}};
  });
  return {pack:{mode:archived?'archived':'latest',capturedAt,assets:[entry],records},entry,capturedAt};
}
test('zone location, ribbon, retained direction and turn age remain separate without mutating the source',()=>{
  const {pack,entry,capturedAt}=fixture(),before=JSON.stringify(pack),t=R.timingContext(pack,entry,capturedAt);
  assert.equal(t.available,true);assert.equal(t.reference.tf,'1m');assert.equal(t.reference.price,103);
  assert.equal(t.frames[0].ribbon,-1);assert.equal(t.frames[0].direction,1);assert.equal(t.frames[0].turn.ageMinutes,3);
  assert.equal(t.zones[0].position,'ABOVE');assert.equal(t.zones[0].ribbonAgreement[0].value,'OPPOSITE');
  assert.match(R.timingText(t).join(' '),/接触後の突破・初戻りは未判定/);
  assert.match(R.timingText(t).join(' '),/新規P・注文・反転売買の成立を示しません/);
  assert.equal(JSON.stringify(pack),before);
});
test('a missing minute frame uses an identified five-minute close and never manufactures the missing state',()=>{
  const {pack,entry,capturedAt}=fixture();pack.records.shift();const t=R.timingContext(pack,entry,capturedAt);
  assert.equal(t.reference.tf,'5m');assert.equal(t.frames[0].available,false);assert.equal(t.zones[0].ribbonAgreement[0].value,'UNKNOWN');
});
test('expired timing is suspended, while old canonical and blocked monitor states suppress the whole view',()=>{
  const {pack,entry,capturedAt}=fixture();let t=R.timingContext(pack,entry,capturedAt+11*minute);assert.equal(t.available,false);
  const overview=R.overview(pack,capturedAt+11*minute)[0];assert.equal(overview.timing.available,false);assert.equal(overview.decision.timingContext.available,false);
  t=R.timingContext(pack,entry,cutoff+21*minute);assert.equal(t.available,false);assert.equal(t.zones.length,0);
  entry.health.blocked=true;t=R.timingContext(pack,entry,capturedAt);assert.equal(t.available,false);assert.equal(t.frames.length,0);
});
test('an unknown monitor or a different contract cannot be treated as the same current market',()=>{
  for(const change of [e=>delete e.health,e=>e.snapshot.symbol='XAUUSD',e=>e.snapshot.settings.market='spot',e=>e.signal.version='new']){
    const {pack,entry,capturedAt}=fixture();change(entry);assert.equal(R.timingContext(pack,entry,capturedAt).available,false);
  }
});
test('wrong snapshot, instrument, version, time basis or duplicate frame cannot supply a timing observation',()=>{
  for(const mutate of [r=>r.snapshotId='other',r=>r.asset='btc',r=>r.version='other',r=>r.timeBasis='archived-decision',r=>r.decisionCutoff++,r=>r.minutes=5]){
    const {pack,entry,capturedAt}=fixture();mutate(pack.records[0]);assert.equal(R.timingContext(pack,entry,capturedAt).frames[0].available,false);
  }
  const {pack,entry,capturedAt}=fixture();pack.records.push(structuredClone(pack.records[0]));assert.equal(R.timingContext(pack,entry,capturedAt).frames[0].available,false);
});
test('forming, duplicate, conflicting OHLCV, and wrong flow time are rejected',()=>{
  for(const mutate of [r=>r.rows.push({...r.rows.at(-1),time:cutoff+8*minute}),r=>r.rows.push({...r.rows.at(-1)}),r=>r.analysis.candles.at(-1).volume++,r=>r.analysis.flow.latest.time--,r=>r.rows.at(-1).low=0,r=>r.analysis.quality.gaps=1]){
    const {pack,entry,capturedAt}=fixture();mutate(pack.records[0]);assert.equal(R.timingContext(pack,entry,capturedAt).frames[0].available,false);
  }
});
test('withdrawn original zones are excluded and a later price return does not revive them',()=>{
  const {pack,entry,capturedAt}=fixture();Object.assign(entry.signal.m15.candles.at(-1),{close:98,low:97});
  const t=R.timingContext(pack,entry,capturedAt);assert.equal(t.zones.some(z=>z.direction==='LONG'),false);assert.equal(t.zones[0].direction,'SHORT');
});
test('archives use only their original cutoff and stay historical even when opened much later',()=>{
  const {pack,entry}=fixture(true),t=R.timingContext(pack,entry,cutoff+100*86400000);
  assert.equal(t.available,true);assert.equal(t.archived,true);assert.equal(t.reference.closedAt,cutoff);
  assert.match(R.timingText(t).join(' '),/現在相場ではありません/);
  pack.records[0].cutoff++;assert.equal(R.timingContext(pack,entry,pack.capturedAt).frames[0].available,false);
});
test('saved decision text and JSON include the captured observation without rewriting the canonical signal',()=>{
  const {pack,entry,capturedAt}=fixture();entry.signal.exec={};const before=JSON.stringify(entry.signal);
  entry.timingContext=R.timingContext(pack,entry,capturedAt);const d=R.decision(entry,capturedAt);
  assert.deepEqual(d.timingContext,entry.timingContext);assert.match(R.decisionText(d).join(' '),/1m：リボン 下向き \/ 保持方向 上向き/);
  assert.equal(JSON.stringify(entry.signal),before);
});
