const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../zone-checkpoint'),R=require('../review-pack');
const STEP=900000;
const bar=(time,close,high=close+1,low=close-1)=>({time,open:close,high,low,close});
function fixture(){return{version:'test',generatedAt:STEP,marketMap:{valid:true,price:95,candidates:[]},m15:{ready:true,quality:{stale:false},candles:[bar(0,95)],swings:{lows:[{price:94,time:0}],highs:[{price:106,time:0}]}}};}
const zone={id:'short',direction:'SHORT',low:100,high:105,invalidationClose:105,protectiveStop:107};
const options={asset:'gold',market:'futures',symbol:'XAUUSDT',basis:{enabled:true,offset:5,label:'保存した換算'},now:STEP};
function next(a,rows){return{...a,generatedAt:rows.at(-1).time+STEP,m15:{...a.m15,candles:[...a.m15.candles,...rows]}};}
test('original bounds, pivot and price basis never follow later candidate changes',()=>{
 const a=fixture(),c=C.create(a,zone,options),n=next(a,[bar(STEP,102),bar(STEP*2,93)]);n.marketMap.candidates=[{...zone,low:90,high:99}];n.m15.swings.lows=[{price:80}];
 const before=JSON.stringify(c),r=C.advance(c,n,{now:n.generatedAt});assert.equal(r.observation.status,'REACTION_CONFIRMED');assert.equal(r.rule.pivot,94);assert.deepEqual(r.zone,zone);assert.equal(r.basis.offset,5);assert.equal(JSON.stringify(c),before);assert.match(C.describe(r).join(' '),/JST/);assert.match(C.describe(r)[0],/105.00［元 100.00］～110.00/);
});
test('a wick touch cannot also establish a same-bar reaction; later close is required',()=>{
 const a=fixture(),c=C.create(a,zone,options),n=next(a,[bar(STEP,93,103,92)]),r=C.advance(c,n,{now:n.generatedAt});assert.equal(r.observation.status,'TOUCHED');assert.equal(r.observation.confirmedAt,null);
 const later=next(n,[bar(STEP*2,92)]);assert.equal(C.advance(r,later,{now:later.generatedAt}).observation.status,'REACTION_CONFIRMED');
});
test('a partly pre-save wick cannot invent a later touch or SL visit',()=>{
 const a=fixture(),c=C.create(a,zone,{...options,now:STEP+100000}),n=next(a,[bar(STEP,95,108,90)]),r=C.advance(c,n,{now:n.generatedAt});assert.equal(r.observation.status,'WAIT');assert.equal(r.observation.stopTouchedAt,null);
});
test('missing expected bars prevent confirmation, and closure gaps can be explicitly excluded',()=>{
 const a=fixture(),c=C.create(a,zone,options),n=next(a,[bar(STEP*2,102),bar(STEP*3,93)]);
 assert.equal(C.advance(c,n,{now:n.generatedAt}).observation.status,'COVERAGE_UNKNOWN');assert.equal(C.advance(c,n,{now:n.generatedAt,barExpected:()=>false}).observation.status,'REACTION_CONFIRMED');
});
test('withdrawal and stop visit are independent evidence and withdrawal stays latched',()=>{
 const a=fixture(),c=C.create(a,zone,options),n=next(a,[bar(STEP,108)]),r=C.advance(c,n,{now:n.generatedAt});assert.equal(r.observation.status,'INVALIDATED');assert.equal(r.observation.stopTouchedAt,STEP*2);
 const later=next(n,[bar(STEP*2,93)]);assert.equal(C.advance(r,later,{now:later.generatedAt}).observation.status,'INVALIDATED');
 const wick=next(a,[bar(STEP,102,108,101)]);assert.equal(C.advance(c,wick,{now:wick.generatedAt}).observation.status,'STOP_REFERENCE_REACHED');
});
test('unknown pivot, delayed data, code mismatch and weekend pause do not confirm',()=>{
 const a=fixture();a.m15.swings.lows=[];const c=C.create(a,zone,options),n=next(a,[bar(STEP,102),bar(STEP*2,93)]);assert.equal(C.advance(c,n,{now:n.generatedAt}).observation.status,'TOUCHED');
 for(const opts of[{allowed:false},{now:n.generatedAt+21*60000}])assert.equal(C.advance(c,n,{now:n.generatedAt,...opts}).observation.paused,true);
 assert.equal(C.advance(c,{...n,version:'other'},{now:n.generatedAt}).observation.paused,true);assert.throws(()=>C.create({...a,generatedAt:STEP*3},zone,options),/新鮮/);
});
test('long checkpoint uses symmetric frozen swing and withdrawal conditions',()=>{
 const a=fixture(),z={...zone,direction:'LONG',invalidationClose:100,protectiveStop:98},c=C.create(a,z,options),n=next(a,[bar(STEP,102),bar(STEP*2,108)]);assert.equal(C.advance(c,n,{now:n.generatedAt}).observation.status,'REACTION_CONFIRMED');
});
test('AI consultation freezes device records separately and excludes them from historical capture',()=>{
 const a=fixture(),c=C.create(a,zone,options),saved=JSON.stringify(c);global.MultiAnalyzerCheckpoint={...C,read:()=>[c,{...c,savedAt:STEP*10}]};
 try {const r=R.consultation({asset:'gold',signal:a},STEP);assert.equal(r.checkpoints.length,1);assert.equal(JSON.stringify(c),saved);assert.equal(R.consultation({asset:'gold',signal:a},STEP,{archived:true}).checkpoints.length,0);} finally {delete global.MultiAnalyzerCheckpoint;}
});

test('first saved touch retains its original timestamp and price source across later revisits',()=>{
 const a=fixture();a.marketMap.price=102;const c=C.create(a,zone,options),e=structuredClone(c.observation.touchEvidence),n=next(a,[bar(STEP,103),bar(STEP*2,102)]);
 const r=C.advance(c,n,{now:n.generatedAt});assert.equal(r.observation.touchedAt,c.observation.touchedAt);assert.equal(r.observation.touchSource,'保存時の分析価格');assert.deepEqual(r.observation.touchEvidence,e);
 assert.match(C.describe(r).join(' '),/保存時の分析価格/);assert.equal(r.observation.status,'TOUCHED');
});
test('post-save full candle touch and reaction preserve separate closed-candle evidence',()=>{
 const a=fixture(),c=C.create(a,zone,options),n=next(a,[bar(STEP,102,104,101),bar(STEP*2,93)]),r=C.advance(c,n,{now:n.generatedAt});
 assert.deepEqual(r.observation.touchEvidence,{kind:'full-bar-range',observedAt:STEP*3,closedAt:STEP*2,barOpenAt:STEP,close:102,high:104,low:101});
 assert.equal(r.observation.confirmationEvidence.close,93);assert.equal(r.observation.confirmationEvidence.closedAt,STEP*3);
 assert.match(C.describe(r).join(' '),/この端末での確認/);
 assert.match(C.describe(r).join(' '),/足内の到達順・時刻は不明/);assert.match(C.describe(r).join(' '),/反応条件の確定/);
});
test('partial pre-save candle records only the later close, never its earlier wick range',()=>{
 const a=fixture(),c=C.create(a,zone,{...options,now:STEP+100000}),n=next(a,[bar(STEP,102,108,90)]),r=C.advance(c,n,{now:n.generatedAt});
 assert.equal(r.observation.touchEvidence.kind,'post-save-close');assert.equal(r.observation.touchEvidence.high,undefined);assert.equal(r.observation.stopEvidence,null);
 assert.match(C.describe(r).join(' '),/保存前を含むヒゲは根拠にしません/);
});
test('old records disclose absent price evidence without inventing it during a later visit',()=>{
 const a=fixture();a.marketMap.price=102;const c=C.create(a,zone,options);delete c.observation.touchEvidence;
 const n=next(a,[bar(STEP,103)]),r=C.advance(c,n,{now:n.generatedAt});assert.equal(r.observation.touchEvidence,undefined);assert.match(C.describe(r).join(' '),/旧記録は根拠価格を保存していません/);
 assert.ok(C.describe(C.create(fixture(),zone,options)).every(x=>typeof x==='string'));
});
