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

test('London and New York observation clocks follow separate DST transitions',()=>{
 const iso=(now,zone,h,m)=>new Date(B.localTime(Date.parse(now),zone,h,m).time).toISOString();
 assert.equal(iso('2026-10-15T00:00:00Z','Europe/London',10,30),'2026-10-15T09:30:00.000Z');
 assert.equal(iso('2026-10-26T00:00:00Z','Europe/London',10,30),'2026-10-26T10:30:00.000Z');
 assert.equal(iso('2026-10-29T12:00:00Z','America/New_York',8,0),'2026-10-29T12:00:00.000Z');
 assert.equal(iso('2026-11-02T12:00:00Z','America/New_York',8,0),'2026-11-02T13:00:00.000Z');
 const clocks=B.clockPoints(Date.parse('2026-10-16T23:00:00Z'));assert.ok(clocks.every(c=>new Date(c.time).getUTCDay()!==0&&new Date(c.time).getUTCDay()!==6));
});

test('event phases cover preprint, initial reaction, assimilation and next session without encoding a direction',()=>{
 const e={time:Date.parse('2026-10-14T12:30:00Z')};
 for(const [minutes,stage]of [[-1,'BEFORE'],[0,'IMPULSE'],[5,'FIRST_HOUR'],[60,'ASSIMILATION'],[240,'FOLLOW_THROUGH'],[900,'NEXT_SESSION'],[2200,'OLDER']])assert.equal(B.eventStage(e,e.time+minutes*60000),stage);
 assert.equal(B.eventStage(e,Date.parse('2026-10-14T21:59:00Z')),'FOLLOW_THROUGH');assert.equal(B.eventStage(e,Date.parse('2026-10-14T22:00:00Z')),'NEXT_SESSION');
 assert.equal(typeof B.session(e.time).direction,'undefined');
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
