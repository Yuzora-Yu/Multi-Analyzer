const test=require('node:test'),assert=require('node:assert/strict'),B=require('../price-basis');
test('paired prices infer sign and keep risk distances unchanged',()=>{
  const now=Date.now(),p=B.calibration(4128.76,4133.76,now,now,now),b=B.resolve(p,'gold',now);
  assert.equal(p.offset,-5);assert.equal(B.convert(4143.23,b),4138.23);
  assert.equal(B.convert(4152,b)-B.convert(4143,b),9);
  assert.equal(B.convert(4143,B.resolve(p,'btc',now)),4143);
});
test('calibration rejects asynchronous, old, future and missing quotes',()=>{
  const now=Date.now();
  assert.throws(()=>B.calibration(4128,4133,now,now-16000,now));
  assert.throws(()=>B.calibration(4128,4133,now-31000,now-31000,now));
  assert.throws(()=>B.calibration(4128,null,now,now,now));
  assert.throws(()=>B.calibration(4128,4133,now+1,now,now));
});
test('expired or invalid offsets revert to original prices, never silent zero calibration',()=>{
  const now=Date.now();
  assert.equal(B.resolve({offset:-5,updatedAt:now-B.MAX_AGE-1},'gold',now).enabled,false);
  assert.equal(B.resolve({offset:null,updatedAt:now},'gold',now).enabled,false);
  assert.equal(B.convert(null,{enabled:true,offset:-5}),null);
  assert.match(B.resolve({offset:-5,updatedAt:now,mode:'estimate'},'gold',now).label,/手動推定/);
});
