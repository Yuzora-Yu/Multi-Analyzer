const test=require('node:test'),assert=require('node:assert/strict');
const {retired}=require('../mt5/tests/load-response.cjs').load();
const now=1800000000,minute=60;
test('an old formation retired recently remains available as historical context',()=>{
 assert.equal(retired(false,4011.69,4015.10,now-500*minute,now-2*minute,now,minute,32),true);
});
test('live zones and unconfirmed or zero-duration retirements never enter historical display',()=>{
 assert.equal(retired(true,4011.69,4015.10,now-300,now-60,now,minute,32),false);
 assert.equal(retired(false,4011.69,4015.10,now-300,now+60,now,minute,32),false);
 assert.equal(retired(false,4011.69,4015.10,now-300,now-300,now,minute,32),false);
});
test('the age boundary uses the source timeframe and is inclusive',()=>{
 assert.equal(retired(false,4011.69,4015.10,now-20000,now-32*300,now,300,32),true);
 assert.equal(retired(false,4011.69,4015.10,now-20000,now-32*300-1,now,300,32),false);
 assert.equal(retired(false,4011.69,4015.10,now-20000,now-32*300,now,60,32),false);
});
test('malformed geometry and unavailable source clocks fail closed',()=>{
 for(const [low,high,formed,seconds,age] of [[4015,4011,now-300,60,32],[4015,4015,now-300,60,32],[NaN,4015,now-300,60,32],[4011,Infinity,now-300,60,32],[0,4015,now-300,60,32],[4011,4015,0,60,32],[4011,4015,now-300,0,32],[4011,4015,now-300,60,-1]])
  assert.equal(retired(false,low,high,formed,now-60,now,seconds,age),false);
});
