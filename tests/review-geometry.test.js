'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),R=require('../review-pack'),G=require('../zone-geometry');
function asset(){const z={id:'s',direction:'SHORT',low:100,high:110,protectiveStop:112,targets:[95,92],frame:'15m',type:'FVG',condition:'元の確認条件',invalidationClose:110};return{asset:'gold',snapshot:{id:'gold-0-test',settings:{now:900001}},signal:{generatedAt:900001,marketMap:{valid:true,candidates:[z]},m15:{ready:true,quality:{gaps:0,stale:false},candles:[{time:0}],swings:{lows:[{price:95}]}},exec:{},state:'NO_TRADE',direction:'SHORT'}};}
test('AI manifest and consultation text preserve original geometry, boundaries and passed target',t=>{
 global.MultiAnalyzerZoneGeometry=G;t.after(()=>delete global.MultiAnalyzerZoneGeometry);
 const a=asset(),before=JSON.stringify(a),started=Date.now();a.consultation=R.consultation(a,1000000);const z=a.consultation.zones[0];
 assert.deepEqual(z.geometry,G.describe(a.signal,a.signal.marketMap.candidates[0]));assert.equal(z.geometryBasis.sourceId,a.snapshot.id);assert.equal(z.geometryBasis.sourceClosedAt,900000);assert.equal(z.geometryBasis.reviewCapturedAt,1000000);assert.ok(z.geometryBasis.calculatedAt>=started&&z.geometryBasis.calculatedAt<=Date.now());
 const text=R.prompt({assets:[a],capturedAt:1000000});assert.match(text,/確認を待った場合の残り値幅/);assert.match(text,/距離比 0.18R/);assert.match(text,/確認境界以前に通過/);assert.match(text,/境界は入場価格ではありません/);
 assert.deepEqual(JSON.parse(JSON.stringify(a.consultation)).zones[0].geometry,z.geometry);delete a.consultation;assert.equal(JSON.stringify(a),before);
});
test('archived export labels later reconstruction and excludes current device records; missing helper remains compatible',t=>{
 global.MultiAnalyzerZoneGeometry=G;global.MultiAnalyzerCheckpoint={read:()=>{throw Error('Archive must not read current device records');}};t.after(()=>{delete global.MultiAnalyzerZoneGeometry;delete global.MultiAnalyzerCheckpoint;});
 const a=asset(),q=R.consultation(a,2000000,{archived:true});assert.deepEqual(q.checkpoints,[]);assert.equal(q.zones[0].geometryBasis.scope,'saved-decision-reconstruction');assert.match(q.zones[0].geometryBasis.note,/当時の表示・保存・約定の証拠ではなく/);assert.equal(q.zones[0].geometry.boundary,95);
 delete global.MultiAnalyzerZoneGeometry;delete global.MultiAnalyzerCheckpoint;const old=R.consultation(a,2000000);assert.equal(old.zones[0].geometry,null);assert.deepEqual(old.zones[0].geometryText,[]);a.consultation=old;assert.doesNotThrow(()=>R.prompt({assets:[a],capturedAt:2000000}));
 a.signal.m15.quality.gaps=1;global.MultiAnalyzerZoneGeometry=G;const invalid=R.consultation(a,2000000);assert.equal(invalid.zones[0].geometry.available,false);assert.ok(!invalid.zones[0].geometryText.join('').includes('距離比'));
});
