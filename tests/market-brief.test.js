const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../market-brief'),K=require('../market-knowledge'),R=require('../review-pack');
const STEP=900000;
function fixture(iso='2026-10-15T02:30:10Z'){
 const now=Date.parse(iso),cutoff=Math.floor(now/STEP)*STEP;
 const candles=Array.from({length:140},(_,i)=>({time:cutoff-(140-i)*STEP,open:100,high:102,low:98,close:100,volume:10}));
 const event=Date.parse('2026-10-14T12:30:00Z');
 for(let i=0;i<4;i++){const b=candles.find(b=>b.time===event+i*STEP);if(b)Object.assign(b,{open:100-i,high:101-i,low:96-i,close:98-i});}
 const tf=(minutes,trend,structure)=>({ready:true,intervalMinutes:minutes,quality:{stale:false,gaps:0},trend,structure:{trend:structure},values:{close:100,atr:2},candles:[{time:Math.floor(cutoff/(minutes*60000))*(minutes*60000)-minutes*60000,open:100,high:102,low:98,close:100}]});
 const m15={...tf(15,'bull','bull'),candles};
 m15.candles.at(-1).close=99;m15.values.close=99;
 const short={id:'synthetic-sell',time:cutoff-86400000,frame:'15m',type:'OB',direction:'SHORT',low:105,high:110,invalidationClose:110,protectiveStop:111,targets:[100,95],condition:'合意した拒否と安値割れ',phase:'WAIT'};
 const long={...short,id:'synthetic-buy',direction:'LONG',low:90,high:95,invalidationClose:90,protectiveStop:89,targets:[105,110],condition:'合意した回復と高値越え'};
 const a={generatedAt:cutoff+1,m15,h1:tf(60,'range','bear'),h4:tf(240,'bear','range'),marketMap:{valid:true,candidates:[short,long]}};
 return {a,now,zones:[{zone:short,withdrawal:null},{zone:long,withdrawal:null}]};
}
function describe(f,extra={}){return B.describe(f.a,{asset:'gold',now:f.now,snapshotId:'synthetic-snapshot',zoneReviews:f.zones,...extra});}

test('conditional plan carries original prices and separates technical preference from missing macro confirmation',()=>{
 const f=fixture(),before=JSON.stringify(f),b=describe(f);
 assert.equal(b.available,true);assert.equal(b.actionable,false);assert.equal(b.preferredSide,'SHORT');assert.match(b.stance,/戻り売り/);
 assert.match(b.technicalReason,/15分は反対方向/);assert.match(b.macroConclusion,/マクロによる方向の追認は保留/);
 assert.equal(b.plans[0].priority,'主シナリオ');assert.deepEqual(b.plans[0].zone,f.zones[0].zone);assert.equal(b.plans[1].priority,'反対シナリオ');
 assert.equal(b.previous.stage,'NEXT_SESSION');assert.equal(b.upcoming.name,'米PPI（9月）');
 assert.equal(b.anchors.preClose,100);assert.deepEqual(b.anchors.firstHour,{high:101,low:93,close:95});
 assert.equal(JSON.stringify(f),before);
});

test('withdrawn zones stay excluded and missing review evidence cannot create a new zone or widen a stop',()=>{
 const f=fixture();f.zones[0].withdrawal={status:'WITHDRAWAL_OBSERVED'};
 const b=describe(f);assert.equal(b.plans.length,1);assert.equal(b.plans[0].direction,'LONG');assert.equal(b.plans[0].zone.protectiveStop,89);
 assert.deepEqual(describe(f,{zoneReviews:null}).plans,[]);
 f.zones[1].zone.high=NaN;assert.deepEqual(describe(f).plans,[]);
});

test('a next-session full recovery of the event move removes an unqualified upper-trend priority',()=>{
 const f=fixture();f.a.m15.candles.at(-1).close=100;
 const b=describe(f);assert.equal(b.eventOpposes,true);assert.equal(b.preferredSide,null);assert.match(b.stance,/全戻し/);assert.ok(b.plans.every(p=>p.priority==='並列シナリオ'));
 assert.equal(b.plans.find(p=>p.direction==='SHORT').zone.protectiveStop,111);
});

test('Asia reference range uses complete expected Bybit bars and labels a partial session explicitly',()=>{
 const f=fixture(),r=B.asiaRange(f.a,f.now);assert.ok(r);assert.equal(r.complete,false);assert.equal(r.through,f.a.generatedAt-1);assert.equal(r.count,6);assert.match(r.source,/SGEの価格・出来高ではありません/);
 f.a.m15.candles=f.a.m15.candles.filter(b=>b.time!==r.startAt);assert.equal(B.asiaRange(f.a,f.now),null);
 const g=fixture('2026-10-15T08:00:10Z');assert.equal(B.asiaRange(g.a,g.now).complete,true);
 const h=fixture();h.zones[0].zone.low=99;h.zones[0].zone.high=105;assert.ok(describe(h).plans[0].contextMatches.some(r=>r.label==='指標前15分終値'));
});

test('archive, CSV, other assets and not-yet-known knowledge cannot acquire current context',()=>{
 const f=fixture();for(const mode of ['archive','csv']){const b=describe(f,{mode});assert.equal(b.available,false);assert.deepEqual(b.plans,[]);assert.deepEqual(b.knowledge,[]);assert.deepEqual(b.sources,[]);assert.equal(b.upcoming,undefined);}
 assert.equal(describe(f,{asset:'btc'}).available,false);
 const b=describe(f,{knowledge:{...K,reviewedAt:f.now+1}});assert.equal(b.available,false);assert.deepEqual(b.knowledge,[]);
});

test('stale, future, malformed, blocked and closed-market inputs suppress prospective plans',()=>{
 for(const mutate of [f=>f.a.generatedAt=f.now-21*60000,f=>f.a.generatedAt=f.now+1,f=>f.a.m15.quality.stale=true,f=>f.a.m15.quality.gaps=4,f=>f.a.m15.candles.at(-1).time++,f=>f.a.m15.candles.at(-1).close=NaN,f=>f.a.marketMap.valid=false]){
  const f=fixture();mutate(f);assert.equal(describe(f).available,false);
 }
 assert.equal(describe(fixture(),{health:{blocked:true}}).available,false);
 assert.equal(describe(fixture('2026-10-17T02:30:10Z')).available,false);
});

test('expired calendars and future-known facts do not claim event absence or realized results',()=>{
 const f=fixture(),knowledge=structuredClone(K);knowledge.calendar.expiresAt=f.now-1;
 let b=describe(f,{knowledge});assert.equal(b.calendar.fresh,false);assert.equal(b.previous,null);assert.equal(b.upcoming,null);assert.match(B.lines(b).join(' '),/指標なしと判断せず/);
 knowledge.calendar.expiresAt=f.now+100000;knowledge.calendar.events[0].result.knownAt=f.now+1;
 b=describe(f,{knowledge});assert.equal(b.previous.result,null);
 knowledge.calendar.events[0].knownAt=f.now+1;assert.equal(describe(f,{knowledge}).previous,null);
 const p=fixture('2026-10-15T12:31:00Z');b=describe(p);assert.equal(b.previous.stage,'IMPULSE');assert.equal(b.previous.result,null);assert.equal(b.nearEvent,true);assert.equal(b.anchors,null);
});

test('event levels require the complete original closed path, without filling missing or conflicting candles',()=>{
 const f=fixture(),e=K.calendar.events[0],before=JSON.stringify(f.a),anchors=B.eventAnchors(f.a,e,f.now);
 assert.ok(anchors);assert.equal(anchors.direction,'DOWN');assert.equal(JSON.stringify(f.a),before);
 const at=e.time+STEP;f.a.m15.candles=f.a.m15.candles.filter(b=>b.time!==at);assert.equal(B.eventAnchors(f.a,e,f.now),null);
 const g=fixture(),b=g.a.m15.candles.find(b=>b.time===e.time);g.a.m15.candles.push({...b,close:b.close-1});assert.equal(B.eventAnchors(g.a,e,g.now),null);
 const h=fixture();h.a.generatedAt=e.time+3*STEP;assert.equal(B.eventAnchors(h.a,e,h.now),null);
});

test('verified PPI results appear only after actual review time without changing prospective zones',()=>{
 const e=K.calendar.events.find(e=>e.id==='us-ppi-202609');
 const before=describe(fixture(new Date(e.result.knownAt-1).toISOString()));
 const after=describe(fixture(new Date(e.result.knownAt).toISOString()));
 assert.equal(before.previous.id,e.id);assert.equal(before.previous.result,null);
 assert.doesNotMatch(B.lines(before).join(' '),/総合（最終需要）前月比\+1\.3/);
 assert.equal(after.previous.result.knownAt,e.result.knownAt);
 assert.match(B.html(after),/実績確認 10\/15 22:06 JST/);
 assert.match(B.html(after),/https:\/\/www\.bls\.gov\/news\.release\/ppi\.nr0\.htm/);
 assert.match(B.lines(after).join(' '),/食品・エネルギー・商業サービス除き/);
 assert.match(B.lines(after).join(' '),/予想値・同時刻の金利とドルは未取得/);
 assert.deepEqual(after.plans,before.plans);assert.equal(after.actionable,false);
});

test('London and New York observation clocks follow separate DST transitions',()=>{
 const iso=(now,zone,h,m)=>new Date(B.localTime(Date.parse(now),zone,h,m).time).toISOString();
 assert.equal(iso('2026-10-15T00:00:00Z','Europe/London',10,30),'2026-10-15T09:30:00.000Z');
 assert.equal(iso('2026-10-26T00:00:00Z','Europe/London',10,30),'2026-10-26T10:30:00.000Z');
 assert.equal(iso('2026-10-29T12:00:00Z','America/New_York',8,0),'2026-10-29T12:00:00.000Z');
 assert.equal(iso('2026-11-02T12:00:00Z','America/New_York',8,0),'2026-11-02T13:00:00.000Z');
 const clocks=B.clockPoints(Date.parse('2026-10-16T23:00:00Z'));assert.ok(clocks.every(c=>new Date(c.time).getUTCDay()!==0&&new Date(c.time).getUTCDay()!==6));
});

test('a newly verified Fed appearance is visible only from its review time and does not fabricate remarks',()=>{
 const e=K.calendar.events.find(e=>e.id==='fed-warsh-imf-20261016');
 const before=describe(fixture(new Date(e.knownAt-1).toISOString()));
 const after=describe(fixture(new Date(e.knownAt).toISOString()));
 assert.equal(new Date(e.time).toISOString(),'2026-10-16T03:30:00.000Z');
 assert.equal(before.upcoming.id,'us-import-202609');
 assert.equal(before.sources.some(s=>s.id===e.source),false);
 assert.equal(after.upcoming.id,e.id);assert.equal(after.upcoming.result,null);
 assert.match(B.lines(after).join(' '),/12:30 JST.*ウォーシュ/);
 assert.match(B.html(after),/予定の個別確認 10\/16 12:07 JST/);
 assert.match(B.html(after),/https:\/\/www\.federalreserve\.gov\/newsevents\/2026-october\.htm/);
 assert.deepEqual(after.plans,before.plans);assert.equal(after.actionable,false);
 const started=describe(fixture(new Date(e.time+1000).toISOString()));
 assert.equal(started.previous.id,e.id);assert.equal(started.previous.result,null);assert.equal(started.anchors,null);
});

test('event phases cover preprint, initial reaction, assimilation and next session without encoding a direction',()=>{
 const e={time:Date.parse('2026-10-14T12:30:00Z')};
 for(const [minutes,stage]of [[-1,'BEFORE'],[0,'IMPULSE'],[5,'FIRST_HOUR'],[60,'ASSIMILATION'],[240,'FOLLOW_THROUGH'],[900,'NEXT_SESSION'],[2200,'OLDER']])assert.equal(B.eventStage(e,e.time+minutes*60000),stage);
 assert.equal(B.eventStage(e,Date.parse('2026-10-14T21:59:00Z')),'FOLLOW_THROUGH');assert.equal(B.eventStage(e,Date.parse('2026-10-14T22:00:00Z')),'NEXT_SESSION');
 assert.equal(typeof B.session(e.time).direction,'undefined');
});

test('later import results and G17 schedule do not leak into earlier context or alter original zones',()=>{
 const e=K.calendar.events.find(e=>e.id==='us-import-202609'),g=K.calendar.events.find(e=>e.id==='us-g17-202609');
 const before=describe(fixture(new Date(e.result.knownAt-1).toISOString()));
 const after=describe(fixture(new Date(e.result.knownAt).toISOString()));
 assert.equal(before.previous.id,e.id);assert.equal(before.previous.result,null);assert.equal(before.upcoming,null);
 assert.equal(before.sources.some(s=>s.id===e.result.source||s.id===g.source),false);
 assert.equal(after.previous.result.knownAt,e.result.knownAt);assert.equal(after.upcoming.id,g.id);
 assert.match(B.html(after),/実績確認 10\/16 22:09 JST/);
 assert.match(B.html(after),/https:\/\/www\.bls\.gov\/news\.release\/ximpim\.nr0\.htm/);
 assert.match(B.lines(after).join(' '),/輸入物価 前月比\+1\.1％・前年比\+8\.1％/);
 assert.match(B.lines(after).join(' '),/予想値・同時刻の金利とドルは未取得/);
 assert.deepEqual(after.plans,before.plans);assert.equal(after.actionable,false);
 assert.equal(K.calendar.verifiedAt,Date.parse('2026-10-15T02:16:00Z'));
 assert.equal(K.calendar.expiresAt,Date.parse('2026-10-17T02:16:00Z'));
});

test('G17 retains its verified EDT time and no invented result when the scheduled time passes',()=>{
 const e=K.calendar.events.find(e=>e.id==='us-g17-202609');
 assert.equal(new Date(e.time).toISOString(),'2026-10-16T13:15:00.000Z');
 const b=describe(fixture(new Date(e.time+1000).toISOString()));
 assert.equal(b.previous.id,e.id);assert.equal(b.previous.result,null);
 assert.match(B.lines(b).join(' '),/発表結果・予想差は背景記録に未収録/);
 assert.doesNotMatch(B.html(b),/実績確認|輸入物価 前月比/);
 assert.equal(b.actionable,false);
});

test('calendar rechecks become visible at their own clock without renewing earlier context',()=>{
 const review=K.calendar.reviews[0],before=describe(fixture(new Date(review.verifiedAt-1).toISOString())),after=describe(fixture(new Date(review.verifiedAt).toISOString()));
 assert.equal(before.calendar.fresh,false);assert.equal(before.upcoming,null);
 assert.equal(before.sources.some(s=>s.id===review.source),false);
 assert.equal(after.calendar.fresh,true);assert.equal(after.calendar.verifiedAt,review.verifiedAt);
 assert.equal(after.upcoming.id,'us-state-employment-202609');assert.equal(after.upcoming.result,null);
 assert.equal(new Date(after.upcoming.time).toISOString(),'2026-10-20T14:00:00.000Z');
 assert.match(B.lines(after).join(' '),/10\/20 23:00 JST.*州別雇用/);
 assert.match(B.html(after),/予定の個別確認 10\/20 14:00 JST/);
 assert.match(after.calendar.note,/部分記録|掲載なしを指標なしと判断しません/);
 assert.deepEqual(after.plans,before.plans);assert.equal(after.actionable,false);
 assert.equal(K.calendar.verifiedAt,Date.parse('2026-10-15T02:16:00Z'));
 assert.equal(K.calendar.expiresAt,Date.parse('2026-10-17T02:16:00Z'));
});

test('a reviewed schedule expires without rolling back and future rechecks cannot leak in',()=>{
 const review=K.calendar.reviews[0],knowledge=structuredClone(K),f=fixture(new Date(review.verifiedAt+60000).toISOString());
 knowledge.calendar.reviews.push({...structuredClone(review),verifiedAt:f.now+60000,events:[{...review.events[0],name:'FUTURE_RECHECK'}]});
 let b=describe(f,{knowledge});assert.equal(b.calendar.verifiedAt,review.verifiedAt);assert.doesNotMatch(B.lines(b).join(' '),/FUTURE_RECHECK/);
 const oldKnowledge=structuredClone(K);oldKnowledge.calendar.reviews=oldKnowledge.calendar.reviews.filter(r=>r.expiresAt===review.expiresAt);
 b=describe(fixture(new Date(review.expiresAt+1).toISOString()),{knowledge:oldKnowledge});
 assert.equal(b.calendar.verifiedAt,oldKnowledge.calendar.reviews.at(-1).verifiedAt);assert.equal(b.calendar.fresh,false);assert.equal(b.previous,null);assert.equal(b.upcoming,null);
 assert.match(B.lines(b).join(' '),/掲載なしを指標なしと判断せず/);
 for(const mode of ['archive','csv']){b=describe(f,{mode});assert.equal(b.available,false);assert.deepEqual(b.sources,[]);assert.equal(b.upcoming,undefined);}
 const earnings=review.events.find(e=>e.id==='us-weekly-earnings-2026q3');
 assert.equal(new Date(earnings.time).toISOString(),'2026-10-21T14:00:00.000Z');assert.equal(earnings.result,undefined);
});

test('state employment result keeps publication, observation and market reopening clocks separate',()=>{
 const review=K.calendar.reviews.find(r=>r.source==='bls-calendar-20261021'),event=review.events.find(e=>e.id==='us-state-employment-202609');
 assert.equal(new Date(event.time).toISOString(),'2026-10-20T14:00:00.000Z');
 assert.equal(new Date(event.result.knownAt).toISOString(),'2026-10-20T21:00:44.000Z');
 assert.equal(review.expiresAt,K.calendar.reviews[0].expiresAt);
 const before=describe(fixture('2026-10-20T20:59:59Z'));
 assert.equal(before.calendar.verifiedAt,K.calendar.reviews[0].verifiedAt);assert.equal(before.previous.result,null);
 assert.equal(before.sources.some(s=>s.id===event.result.source),false);
 const paused=describe(fixture(new Date(review.verifiedAt).toISOString()));assert.equal(paused.available,false);assert.equal(paused.previous,undefined);
 const f=fixture('2026-10-20T22:00:10Z'),after=describe(f),oldKnowledge=structuredClone(K);oldKnowledge.calendar.reviews=oldKnowledge.calendar.reviews.filter(r=>r.verifiedAt<review.verifiedAt);
 const old=describe(f,{knowledge:oldKnowledge});
 assert.equal(after.previous.id,event.id);assert.equal(after.previous.result.knownAt,event.result.knownAt);assert.equal(after.previous.stage,'NEXT_SESSION');
 assert.match(B.html(after),/実績確認 10\/21 06:00 JST/);assert.match(B.html(after),/https:\/\/www\.bls\.gov\/news\.release\/laus\.nr0\.htm/);
 assert.match(B.lines(after).join(' '),/5州で低下、45州とDCは概ね不変/);assert.match(B.lines(after).join(' '),/全国雇用統計の再発表ではありません/);
 assert.equal(after.upcoming.id,'us-weekly-earnings-2026q3');assert.equal(after.upcoming.result,null);
 assert.deepEqual(after.plans,old.plans);assert.equal(after.actionable,false);
 for(const mode of ['archive','csv']){const b=describe(f,{mode});assert.equal(b.available,false);assert.equal(b.previous,undefined);assert.deepEqual(b.sources,[]);}
});

test('quarterly earnings result appears only at its observation clock with unchanged expiry and plans',()=>{
 const review=K.calendar.reviews.find(r=>r.source==='bls-calendar-20261022'),event=review.events.find(e=>e.id==='us-weekly-earnings-2026q3');
 assert.equal(new Date(event.time).toISOString(),'2026-10-21T14:00:00.000Z');
 assert.equal(new Date(event.result.knownAt).toISOString(),'2026-10-21T17:00:53.000Z');
 const before=describe(fixture(new Date(event.result.knownAt-1).toISOString())),after=describe(fixture(new Date(event.result.knownAt).toISOString()));
 assert.equal(before.previous.id,event.id);assert.equal(before.previous.result,null);assert.equal(before.sources.some(s=>s.id===event.result.source),false);
 assert.equal(after.previous.result.knownAt,event.result.knownAt);assert.equal(after.calendar.verifiedAt,review.verifiedAt);
 assert.equal(review.expiresAt,K.calendar.reviews[0].expiresAt);
 assert.match(B.lines(after).join(' '),/通常週収中央値は1,232ドル、前年比\+1\.5％/);
 assert.match(B.lines(after).join(' '),/季節調整前、フルタイム賃金・給与労働者/);
 assert.match(B.html(after),/実績確認 10\/22 02:00 JST/);assert.match(B.html(after),/https:\/\/www\.bls\.gov\/news\.release\/wkyeng\.nr0\.htm/);
 assert.match(B.lines(after).join(' '),/月次CPIの新規発表ではありません/);assert.match(B.lines(after).join(' '),/予想値・同時刻の金利とドルは未取得/);
 assert.deepEqual(after.plans,before.plans);assert.equal(after.actionable,false);
 for(const old of K.calendar.reviews.filter(r=>r.verifiedAt<review.verifiedAt))assert.equal(old.events.find(e=>e.id===event.id).result,undefined);
 for(const mode of ['archive','csv']){const b=describe(fixture(new Date(review.verifiedAt).toISOString()),{mode});assert.equal(b.available,false);assert.equal(b.previous,undefined);assert.deepEqual(b.sources,[]);}
});

test('DOL weekly schedule uses EDT and its own knowledge clock without inventing a result',()=>{
 const review=K.calendar.reviews.find(r=>r.source==='bls-calendar-20261022-morning'),event=review.events.find(e=>e.id==='us-weekly-claims-20261022');
 const before=describe(fixture(new Date(review.verifiedAt-1).toISOString())),after=describe(fixture(new Date(review.verifiedAt).toISOString()));
 assert.equal(before.upcoming,null);assert.equal(before.sources.some(s=>s.id===event.source),false);
 assert.equal(after.upcoming.id,event.id);assert.equal(after.upcoming.result,null);assert.equal(after.upcoming.knownAt,review.verifiedAt);
 assert.equal(event.time,B.localTime(event.time,'America/New_York',8,30).time);
 assert.equal(new Date(event.time).toISOString(),'2026-10-22T12:30:00.000Z');
 assert.match(B.lines(after).join(' '),/10\/22 21:30 JST.*週間失業保険/);
 assert.match(B.html(after),/予定の個別確認 10\/22 10:07 JST/);assert.match(B.html(after),/content\.govdelivery\.com\/accounts\/USDOL\/bulletins\/42c4a8a/);
 assert.match(after.calendar.note,/公式PDFは15日版/);assert.match(after.calendar.note,/22日の実績・予想値は未取得/);
 assert.deepEqual(after.plans,before.plans);assert.equal(after.actionable,false);
 const released=describe(fixture(new Date(event.time+1000).toISOString()));
 assert.equal(released.previous.id,event.id);assert.equal(released.previous.result,null);assert.match(B.lines(released).join(' '),/発表結果・予想差は背景記録に未収録/);
 for(const old of K.calendar.reviews.filter(r=>r.verifiedAt<review.verifiedAt))assert.equal(old.events.some(e=>e.id===event.id),false);
});

test('new partial DOL review expires independently and is excluded from archived or CSV context',()=>{
 const review=K.calendar.reviews.find(r=>r.source==='bls-calendar-20261022-morning');
 const f=fixture(new Date(review.verifiedAt+1000).toISOString());
 for(const mode of ['archive','csv']){const b=describe(f,{mode});assert.equal(b.available,false);assert.equal(b.upcoming,undefined);assert.deepEqual(b.sources,[]);}
 const oldKnowledge=structuredClone(K);oldKnowledge.calendar.reviews=oldKnowledge.calendar.reviews.filter(r=>r.verifiedAt<=review.verifiedAt);
 const expired=describe(fixture(new Date(review.expiresAt+1).toISOString()),{knowledge:oldKnowledge});
 assert.equal(expired.calendar.verifiedAt,review.verifiedAt);assert.equal(expired.calendar.fresh,false);assert.equal(expired.upcoming,null);assert.equal(expired.previous,null);
 assert.match(B.lines(expired).join(' '),/予定の確認期限切れ|掲載なしを指標なしと判断せず/);
 assert.equal(K.calendar.reviews[0].expiresAt,Date.parse('2026-10-22T05:00:39Z'));
});

test('weekly claims result preserves release and observation clocks, revisions, different weeks and original plans',()=>{
 const review=K.calendar.reviews.find(r=>r.source==='dol-claims-20261022'),event=review.events.find(e=>e.id==='us-weekly-claims-20261022');
 const morning=K.calendar.reviews.find(r=>r.source==='bls-calendar-20261022-morning');
 assert.equal(new Date(event.time).toISOString(),'2026-10-22T12:30:00.000Z');
 assert.equal(new Date(event.result.knownAt).toISOString(),'2026-10-22T13:07:00.000Z');
 assert.equal(review.expiresAt,morning.expiresAt);assert.equal(event.knownAt,morning.verifiedAt);
 const before=describe(fixture(new Date(event.result.knownAt-1).toISOString())),after=describe(fixture(new Date(event.result.knownAt).toISOString()));
 assert.equal(before.previous.id,event.id);assert.equal(before.previous.result,null);assert.equal(before.sources.some(s=>s.id===event.result.source),false);
 assert.equal(after.previous.result.knownAt,event.result.knownAt);assert.equal(after.calendar.verifiedAt,review.verifiedAt);
 assert.match(B.lines(after).join(' '),/19万4,000件.*20万件から6,000件減/);
 assert.match(B.lines(after).join(' '),/19万9,000件から上方改定/);
 assert.match(B.lines(after).join(' '),/172万8,000件.*10月10日終了週/);
 assert.match(B.lines(after).join(' '),/新規申請とは対象週が異なります/);
 assert.match(B.lines(after).join(' '),/予想値・同時刻の金利とドルは未取得/);
 assert.match(B.html(after),/実績確認 10\/22 22:07 JST/);assert.match(B.html(after),/https:\/\/www\.dol\.gov\/ui\/data\.pdf/);
 assert.equal(after.anchors,null); // Four post-release M15 bars have not yet closed.
 assert.deepEqual(after.plans,before.plans);assert.equal(after.actionable,false);
 for(const old of K.calendar.reviews.filter(r=>r.verifiedAt<review.verifiedAt))assert.equal(old.events.find(e=>e.id===event.id)?.result,undefined);
 for(const mode of ['archive','csv']){const b=describe(fixture(new Date(review.verifiedAt).toISOString()),{mode});assert.equal(b.available,false);assert.equal(b.previous,undefined);assert.deepEqual(b.sources,[]);}
 const expired=describe(fixture(new Date(review.expiresAt+1).toISOString()));assert.equal(expired.calendar.verifiedAt,review.verifiedAt);assert.equal(expired.calendar.fresh,false);assert.equal(expired.previous,null);
});

test('presentation escapes input, uses the selected price basis and keeps limits and sources visible',()=>{
 const b=describe(fixture());b.plans[0].zone.condition='<img src=x onerror=alert(1)>';
 b.plans[0].focus={windows:[{levels:[{label:'4H EMA20',price:106},{label:'15m BB上限',price:108}]}]};
 const html=B.html(b,{formatPrice:v=>'mapped-'+v});assert.match(html,/mapped-105～mapped-110/);assert.match(html,/mapped-111/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
 assert.match(html,/MA・BBの参照：4H EMA20 mapped-106 \/ 15m BB上限 mapped-108/);
 assert.match(html,/一般知識|一般知|条件付き|条件付き仮説/);assert.match(html,/時間帯・指標後の水準・根拠を見る/);assert.match(html,/金の勝率に変換しない/);assert.match(html,/https:\/\/www.gold.org/);
 assert.match(B.lines(b).join(' '),/背景確認.*15分確定/);
});

test('AI consultation exports current overlay separately and never changes the original signal or old records',t=>{
 global.MultiAnalyzerMarketBrief=B;t.after(()=>delete global.MultiAnalyzerMarketBrief);
 const f=fixture(),before=JSON.stringify(f.a),q=R.consultation({asset:'gold',signal:f.a,snapshot:{id:'synthetic-snapshot'}},f.now);
 assert.equal(q.marketBrief.scope,'CURRENT_CONTEXT_OVERLAY');assert.equal(q.marketBrief.available,true);assert.equal(q.marketBrief.observedAt,f.now);assert.equal(JSON.stringify(f.a),before);
 const d={verdict:'NO_TRADE',direction:'LONG',consultation:q,levels:{},checks:[],vetoes:[]};assert.match(R.decisionText(d).join(' '),/時間帯・材料の事前シナリオ/);assert.equal(d.verdict,'NO_TRADE');
 const old=R.consultation({asset:'gold',signal:f.a,snapshot:{id:'synthetic-old'}},f.now,{archived:true});assert.equal(old.marketBrief.available,false);assert.deepEqual(old.marketBrief.knowledge,[]);assert.equal(old.marketBrief.upcoming,undefined);
});
