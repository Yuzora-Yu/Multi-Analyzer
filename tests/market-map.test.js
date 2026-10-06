const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../strategy-core');
const Events=require('../alert-event');
const now=Date.parse('2026-10-06T12:45:00+09:00');
function fixture(){
  const tf={ready:true,quality:{stale:false,gaps:0},trend:'bear',structure:{trend:'bear'},intervalMinutes:15,
    candles:[{time:now-900000}],values:{close:100,atr:4,ema20:102,ema50:104,bbUpper:108,bbLower:95},
    series:{bb:{mid:[102]}},swings:{lows:[{price:96},{price:90}],highs:[{price:110}]},
    smc:{zones:[{type:'OB',side:'bear',low:102,high:104,time:now-3600000,status:'active'},
      {type:'OB',side:'bear',low:98,high:99,time:now-7200000,status:'active'},
      {type:'FVG',side:'bull',low:94,high:96,time:now-3600000,status:'broken'}]}};
  const a={exec:tf,m15:tf,h1:{...tf,intervalMinutes:60},h4:{...tf,intervalMinutes:240},
    generatedAt:now,state:'NO_TRADE',actionable:false,direction:'SHORT',vetoes:['P未成立']};
  a.marketMap=Core.buildMarketMap(a);return a;
}
test('prospective map excludes broken and already invalidated zones; separates direction from entry',()=>{
  const a=fixture(),map=a.marketMap;
  assert.equal(map.valid,true);assert.equal(map.entryState,'条件待ち');
  assert.ok(map.candidates.length);assert.ok(map.candidates.every(z=>z.low===102));
  assert.ok(map.candidates[0].evidence.includes('15m EMA20'));
  assert.equal(map.candidates[0].invalidationClose,104);assert.equal(map.candidates[0].protectiveStop,104.8);
  assert.equal(map.candidates[0].phase,'APPROACH');
});
test('GOLD sends a zone briefing before P entry, EXIT is only supplemental, key survives next candle',()=>{
  const a=fixture();a.positionDecision={action:'EXIT_SHORT',reasons:['EMA13注意']};
  const event=Events.eventFor(a,'gold',{entry:106,stop:108},{now});
  assert.equal(event.kind,'ANALYSIS');assert.match(event.title,/戻り売り候補/);assert.doesNotMatch(event.title,/クローズ/);
  assert.match(event.text,/補助の撤退注意/);assert.match(event.text,/P未成立/);assert.match(event.text,/見立て無効化/);
  const b=fixture();b.generatedAt+=900000;b.exec={...b.exec,candles:[{time:now}]};
  assert.equal(Events.eventFor(b,'gold',null,{now:now+900000}).key,event.key);
});
test('stale feeds, missing confluence, blackout and weekends cannot generate zone mail',()=>{
  const a=fixture();
  assert.equal(Events.eventFor(a,'gold',null,{now:now+1200001}),null);
  a.marketMap.valid=false;assert.equal(Events.eventFor(a,'gold',null,{now}),null);
  a.marketMap.valid=true;a.marketMap.candidates.forEach(z=>z.evidence=['OB']);
  assert.equal(Events.eventFor(a,'gold',null,{now}),null);
  const b=fixture();b.marketMap.eventRisk.blocked=true;assert.equal(Events.eventFor(b,'gold',null,{now}),null);
  assert.equal(Events.eventFor(fixture(),'gold',null,{now:Date.parse('2026-10-10T12:00:00+09:00')}),null);
});
test('zone mail opens with a Japanese conclusion and wait conditions, not an entry or EXIT instruction',()=>{
  const a=fixture();a.positionDecision={action:'EXIT_SHORT',reasons:['EMA13注意']};
  const event=Events.eventFor(a,'gold',null,{now});
  assert.ok(event.text.startsWith('結論：戻り売り候補 102～104 に近づいています。'));
  const opening=event.text.split('詳しい分析')[0];
  assert.match(opening,/反応を待つ段階/);assert.match(opening,/接触だけではエントリーしません/);
  assert.match(opening,/終値が 104 を上回る/);assert.match(opening,/参考価格：104.8/);
  assert.match(opening,/価格補正はこのメールには適用されません/);
  assert.doesNotMatch(opening,/条件が成立しました|クローズ推奨|EXIT/);
  assert.match(event.text,/4時間足 高安の構造下向き・移動平均線下向き/);
  assert.match(event.text,/15分足 指数移動平均線20/);
});
test('zone conclusion distinguishes confirmed entry and countertrend buy waiting',()=>{
  const a=fixture(),z=a.marketMap.candidates[0];
  a.actionable=true;z.phase='ENTRY_CONFIRMED';
  assert.match(Events.eventFor(a,'gold',null,{now}).text.split('\n\n')[0],/既存エントリー条件が成立/);
  a.actionable=false;z.phase='IN_ZONE';z.direction='LONG';z.role='逆張り・短期反発';
  a.marketMap.candidates=[z];
  const text=Events.eventFor(a,'gold',null,{now}).text;
  assert.ok(text.startsWith('結論：押し目買い候補'));
  assert.match(text.split('詳しい分析')[0],/上位足に逆らう短期/);
  assert.match(text,/終値が 104 を下回る/);
});
test('calendar is explicitly partial, gates release window and expires',()=>{
  const r=Core.calendarRisk(Date.parse('2026-10-06T21:15:00+09:00'));
  assert.equal(r.coverage,'partial');assert.equal(r.blocked,true);assert.equal(r.events[0].name,'米貿易収支');
  const old=Core.calendarRisk(Date.parse('2026-10-12T12:00:00+09:00'));
  assert.equal(old.coverage,'expired');assert.equal(old.events.length,0);assert.match(old.message,/期限切れ/);
});
