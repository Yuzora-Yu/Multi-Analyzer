/* Previous-session context, reconstructed from a fixed closed-bar prefix. No trade inputs. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./strategy-core'):root.MultiAnalyzerCore,typeof module==='object'&&module.exports?require('./market-feed'):root.MultiAnalyzerFeed,typeof module==='object'&&module.exports?require('./zone-importance'):root.MultiAnalyzerZoneImportance);if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerDayMap=api;})(globalThis,function(Core,Feed,Importance){
  'use strict';
  const VERSION='previous-session-map-v1',DAY=86400000,HISTORY=220;
  const NOTE='前日確定足からの再構築。当時の表示・配信記録ではありません。帯の重なりは独立した票数・反発確率ではなく、P/EXIT条件にも使いません。';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const price=n=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'未取得';
  const stamp=t=>new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' JST';
  function parts(t){return Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(t).filter(x=>x.type!=='literal').map(x=>[x.type,+x.value]));}
  function boundary(t,days=0){const p=parts(t);let desired=Date.UTC(p.year,p.month-1,p.day+days,18),utc=desired;for(let i=0;i<3;i++){const q=parts(utc);utc+=desired-Date.UTC(q.year,q.month-1,q.day,q.hour,q.minute,q.second);}return utc;}
  function sessionStart(at){let t=boundary(at);return t>at?boundary(at,-1):t;}
  function valid(b){return b&&[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close);}
  function frames(a){return [...new Map(['m15','h1','h4','exec'].map(k=>a?.[k]).filter(f=>[5,15,60,240].includes(f?.intervalMinutes)).map(f=>[f.intervalMinutes,f])).values()];}
  function clean(rows,step,through){const out=[],seen=new Set();for(const b of rows||[]){if(Number.isFinite(b?.time)&&b.time+step>through)continue;if(!valid(b)||b.time%step||seen.has(b.time)||(out.length&&b.time<=out.at(-1).time))return null;seen.add(b.time);if(b.time+step<=through)out.push(b);}return out;}
  function complete(rows,start,end,minutes){const step=minutes*60000,byTime=new Map(rows.map(b=>[b.time,b]));let n=0;for(let t=start;t<end;t+=step){if(Feed.barExpected('gold',t,minutes)){if(!byTime.has(t))return false;n++;}}return true;}
  function previousRange(rows,cutoff){for(let days=1;days<=5;days++){const start=boundary(cutoff,-days),end=boundary(cutoff,1-days),sample=rows.filter(b=>b.time>=start&&b.time<end);let expected=false;for(let t=start;t<end;t+=900000)expected ||= Feed.barExpected('gold',t,15);if(!expected)continue;if(!complete(sample,start,end,15))return null;const high=Math.max(...sample.map(b=>b.high)),low=Math.min(...sample.map(b=>b.low));return {startAt:start,endAt:end,high,low,midpoint:(high+low)/2,bars:sample.length};}return null;}
  function build(a,{asset='gold',now=Date.now(),mode='live',health=null}={}){
    const base={version:VERSION,available:false,observationOnly:true,note:NOTE};
    if(asset!=='gold'||mode!=='live'||health?.blocked||!Number.isFinite(a?.generatedAt)||!Number.isFinite(now))return {...base,reason:'現在のGold確定足が必要です。過去表示には現在の地図を混入しません。'};
    const at=Math.min(now,a.generatedAt),cutoff=sessionStart(at),m15=clean(a.m15?.candles,900000,cutoff);
    if(!m15)return {...base,reason:'M15の時刻・OHLCに不整合があります。'};
    const previous=previousRange(m15,cutoff);if(!previous)return {...base,cutoff,reason:'前営業日の期待M15足が揃わず、前日高安・半値を保留しています。'};
    const zones=[],coverage=[];
    for(const f of frames(a)){
      const minutes=f.intervalMinutes,step=minutes*60000,rows=clean(f.candles,step,cutoff)?.slice(-HISTORY);
      const ready=rows?.length===HISTORY&&complete(rows,rows[0].time,rows.at(-1).time+step,minutes);
      coverage.push({minutes,ready,bars:rows?.length||0});if(!ready)continue;
      const tf=Core.analyzeTimeframe(rows,minutes,cutoff,'gold'),prepared=Importance.prepare(rows,minutes);
      for(const z of tf.smc?.zones||[]){
        const q=Importance.evaluate(prepared,z,z.index,{observedAt:cutoff});if(!q.available||q.retired)continue;
        const distance=Math.max(z.low-previous.midpoint,previous.midpoint-z.high,0);if(distance>2*(previous.high-previous.low))continue;
        zones.push({id:`${minutes}:${z.type}:${z.side}:${z.time}:${z.low}:${z.high}`,kind:z.type,side:z.side==='bull'?1:-1,minutes,low:z.low,high:z.high,formedAt:z.time+step,originAt:z.originTime??null,importance:q,distance});
      }
    }
    // One nearest original zone per side and horizon. Never merge into a synthetic OB/FVG.
    const entries=[];for(const role of [3,2,1])for(const side of [1,-1]){const list=zones.filter(z=>z.side===side&&Importance.role(z.minutes).order===role).sort((x,y)=>x.distance-y.distance||y.minutes-x.minutes||y.importance.score-x.importance.score||x.id.localeCompare(y.id));if(list.length)entries.push(list[0]);}
    for(const z of entries)z.overlaps=entries.filter(x=>x.id!==z.id&&x.low<=z.high&&x.high>=z.low).map(x=>x.id);
    return {...base,available:true,cutoff,source:'Bybit XAUUSDT無期限・NY18時区切り（既存Gold日足と同じ）',clock:'UTC milliseconds',historyBarsPerFrame:HISTORY,previous,coverage,entries};
  }
  function observe(map,a,at=Math.min(Date.now(),a?.generatedAt??0)){
    if(!map.available)return map;const all=frames(a);
    return {...map,observedAt:at,entries:map.entries.map(z=>{
      const step=z.minutes*60000,f=all.find(x=>x.intervalMinutes===z.minutes),rows=clean(f?.candles,step,at),after=rows?.filter(b=>b.time+step>map.cutoff)||[];
      let status='未接触',changedAt=null,inside=false,visits=0;
      for(const b of after){if((z.side>0?b.close<z.low:b.close>z.high)||(z.kind==='FVG'&&(z.side>0?b.low<=z.low:b.high>=z.high))){status='解消';changedAt=b.time+step;break;}const touch=b.low<=z.high&&b.high>=z.low;if(touch&&!inside){visits++;status='接触';changedAt=b.time+step;}inside=touch;}
      const expectedEnd=Math.floor(at/step)*step;
      if(status!=='解消'&&(!rows||!complete(after,Math.floor(map.cutoff/step)*step,expectedEnd,z.minutes)))status='追跡不足';
      return {...z,current:{status,changedAt,visits,through:after.at(-1)?.time+step||map.cutoff}};
    })};
  }
  function lines(m){if(!m?.available)return ['前日確定マップ：'+(m?.reason||'未取得')];return [`前日確定マップ 基準 ${stamp(m.cutoff)} / ${m.source}`,`前日高値 ${price(m.previous.high)} / 半値 ${price(m.previous.midpoint)} / 安値 ${price(m.previous.low)}`,...m.entries.map(z=>`${z.minutes}分 ${z.side>0?'買い':'売り'}${z.kind} ${price(z.low)}～${price(z.high)} / 形成 ${stamp(z.formedAt)} / ${Importance.summary(z.importance)} / 当日${z.current?.status||'未追跡'}${z.overlaps.length?' / 他の元帯と重なる':''}`),NOTE];}
  function html(m){if(!m?.available)return `<details><summary>前日確定マップ：保留</summary><p>${esc(m?.reason)}</p></details>`;return `<details data-day-map><summary>前日確定マップ <span class="muted">半値 ${price(m.previous.midpoint)} / 高値 ${price(m.previous.high)} / 安値 ${price(m.previous.low)}</span></summary><p>基準 ${esc(stamp(m.cutoff))}。${esc(m.source)}。地図の元水準は固定し、当日の経過を別記します。</p>${m.entries.map(z=>`<p><strong>${z.minutes}分 ${z.side>0?'買い':'売り'}${esc(z.kind)} ${price(z.low)}～${price(z.high)}</strong> / 当日${esc(z.current?.status||'未追跡')}<br><small>形成 ${esc(stamp(z.formedAt))} / ${esc(Importance.summary(z.importance))}${z.overlaps.length?' / 他の元帯と重なる':''}</small></p>`).join('')}<p class="muted">${esc(NOTE)}</p><small>起点履歴：${m.coverage.map(f=>`${f.minutes}分 ${f.ready?'220本確認':'不足・除外'}`).join(' / ')}。表示中の足にM5がある場合は短期起点も評価します。</small></details>`;}
  return {VERSION,HISTORY,sessionStart,boundary,complete,build,observe,lines,html};
});
