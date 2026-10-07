const test=require('node:test'),assert=require('node:assert/strict'),R=require('../review-pack.js'),Core=require('../strategy-core.js');
function fixture(){const now=Date.parse('2026-10-08T17:15:00+09:00');return {asset:'btc',snapshot:{id:'saved',settings:{now,market:'spot'}},signal:{generatedAt:now,exec:{values:{adx:21},flow:{latest:{setup:{}}}},marketMap:{eventRisk:Core.calendarRisk(now)}}};}
test('review retains original calendar rather than using the review clock and serializes it before zones/EXIT',()=>{
 const a=fixture(),before=JSON.stringify(a),reviewAt=Date.parse('2026-10-16T12:00:00+09:00'),d=R.decision(a,reviewAt),texts=R.decisionText(d);
 assert.equal(d.eventRisk.blocked,true);assert.equal(d.eventRiskBasis.decisionAt,a.signal.generatedAt);assert.equal(d.eventRiskBasis.reviewCapturedAt,reviewAt);assert.deepEqual(d.eventRisk,a.signal.marketMap.eventRisk);assert.notEqual(d.eventRisk,a.signal.marketMap.eventRisk);assert.match(texts.join('\n'),/Waller/);assert.match(texts.join('\n'),/federalreserve.gov/);assert.match(texts.join('\n'),/全予定を網羅/);assert.ok(texts.findIndex(x=>x.startsWith('指標警戒'))<texts.findIndex(x=>x.includes('今回の足に黄EXIT')));assert.equal(JSON.stringify(a),before);
 d.eventRisk.events[0].name='changed';assert.notEqual(a.signal.marketMap.eventRisk.events[0].name,'changed');
 const pack={capturedAt:reviewAt,assets:[a]};assert.match(R.prompt(pack),/指標警戒/);assert.match(R.prompt(pack),/元判定/);assert.deepEqual(JSON.parse(JSON.stringify(R.decision(a,reviewAt))).eventRisk,a.signal.marketMap.eventRisk);
});
test('expired, absent and malformed calendar metadata cannot imply a clear event schedule',()=>{
 const a=fixture();a.signal.marketMap.eventRisk={coverage:'expired',events:[],checkedAt:1,blocked:false};let text=R.decisionText(R.decision(a)).join('\n');assert.match(text,/確認期限切れ/);assert.match(text,/指標がないことを示しません/);
 delete a.signal.marketMap.eventRisk;text=R.decisionText(R.decision(a)).join('\n');assert.match(text,/予定情報は未取得/);
 a.signal.marketMap.eventRisk={events:[{name:'fixture'}]};text=R.decisionText(R.decision(a)).join('\n');assert.match(text,/予定時刻未確認/);assert.match(text,/確認範囲未確認/);
});
