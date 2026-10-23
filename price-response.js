/* Read-only closed-candle context. Never a P/EXIT, order or demo input. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./market-feed'):root.MultiAnalyzerFeed);if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerResponse=api;})(globalThis,function(Feed){
  'use strict';
  const VERSION='closed-response-v1',EXPIRY=12,PAD=.15;
  const phaseName=['基準待ち','突破・後続足待ち','後続足で再試し確認','奪回され撤回','観察期限終了','足の空白・経過不明'];
  const direction=n=>n>0?'上':n<0?'下':'混在';
  function analyze(c,rows,seconds){
    if(!Array.isArray(c)||!Array.isArray(rows)||c.length!==rows.length||rows.some(r=>!r||typeof r!=='object')||!Number.isFinite(seconds)||seconds<=0||c.some((b,i)=>!b||![b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||(i&&b.time<=c[i-1].time)))return [];
    let hi=-1,lo=-1,usedHi=-1,usedLo=-1,start=0;
    let state={side:0,phase:0,reference:0,pad:0,brokenAt:0,changedAt:0,expiresAt:0,index:-1};const out=[];
    for(let i=0;i<c.length;i++){
      const b=c[i],r=rows[i],gap=i>0&&b.time-c[i-1].time!==seconds;
      if(gap){if(state.side&&state.phase<=2)state={...state,phase:5,changedAt:b.time+seconds};hi=lo=usedHi=usedLo=-1;start=i;}
      if(!gap&&state.side&&state.phase<=2&&i>state.index){
        const reclaimed=state.side>0?b.close<state.reference:b.close>state.reference;
        if(reclaimed)state={...state,phase:3,changedAt:b.time+seconds};
        else if(i-state.index>EXPIRY)state={...state,phase:4,changedAt:b.time+seconds};
        else if(state.phase===1&&(state.side>0?b.low<=state.reference+state.pad&&b.close>state.reference+state.pad:b.high>=state.reference-state.pad&&b.close<state.reference-state.pad))state={...state,phase:2,changedAt:b.time+seconds};
      }
      const bull=hi>=start&&usedHi!==hi&&i>0&&c[i-1].close<=c[hi].high&&b.close>c[hi].high;
      const bear=lo>=start&&usedLo!==lo&&i>0&&c[i-1].close>=c[lo].low&&b.close<c[lo].low;
      if((bull||bear)&&rows[i-1]?.atr>0){
        if(bull)usedHi=hi;else usedLo=lo;
        state={side:bull?1:-1,phase:1,reference:bull?c[hi].high:c[lo].low,pad:rows[i-1].atr*PAD,brokenAt:b.time+seconds,changedAt:b.time+seconds,expiresAt:b.time+seconds*(EXPIRY+1),index:i};
      }
      // A swing recognized by this close can only trigger on a LATER candle.
      const p=i-3;
      if(p>=start+3){let high=true,low=true;for(let j=p-3;j<=p+3;j++){if(j===p)continue;if(c[j].high>=c[p].high)high=false;if(c[j].low<=c[p].low)low=false;}if(high)hi=p;if(low)lo=p;}
      const usable=[r.ema13,r.ema21].every(Number.isFinite);
      const pressure=usable?(b.close>r.ema13&&r.ema13>r.ema21?1:b.close<r.ema13&&r.ema13<r.ema21?-1:0):0;
      out.push({...state,time:b.time,closedAt:b.time+seconds,pressure,held:r.direction||0,ribbon:r.ribbon||0});
    }
    return out;
  }
  function describe(a,{asset='gold',now=Date.now(),mode='live',health=null}={}){
    const out={version:VERSION,scope:'CURRENT_CLOSED_RESPONSE',available:false,frames:[],observedAt:now,sourceGeneratedAt:a?.generatedAt??null,parameters:{pivotBars:3,padATR:PAD,expiryBars:EXPIRY}};
    if(asset!=='gold'||mode!=='live'||health?.blocked||!Number.isFinite(a?.generatedAt)||a.generatedAt>now||now-a.generatedAt>20*60000||!Feed.collectionPolicy('gold',now).allowed)return out;
    const seen=new Set();
    for(const tf of [a.exec,a.m15,a.h1,a.h4]){
      if(!tf?.ready||tf.quality?.stale||!tf.flow?.history?.length||seen.has(tf.intervalMinutes))continue;
      const sec=tf.intervalMinutes*60,last=tf.candles?.at(-1);if(!Number.isFinite(sec)||!last||last.time+sec*1000>a.generatedAt)continue;
      seen.add(tf.intervalMinutes);
      const c=tf.candles.map(b=>({...b,time:b.time/1000})),rows=tf.flow.history.map((r,i)=>({direction:r.direction,ribbon:r.ribbon,ema13:tf.flow.lines[13]?.[i],ema21:tf.flow.lines[21]?.[i],atr:tf.series?.atr14?.[i]}));
      const history=analyze(c,rows,sec);if(!history.length)continue;
      const current=history.at(-1),events=history.filter((r,i)=>r.side&&(i===0||r.changedAt!==history[i-1].changedAt)).slice(-6);
      out.frames.push({name:tf.intervalMinutes<60?tf.intervalMinutes+'m':tf.intervalMinutes/60+'H',minutes:tf.intervalMinutes,current,events,conflict:current.pressure!==0&&current.held!==0&&current.pressure!==current.held});
    }
    out.available=out.frames.length>0;return out;
  }
  function lines(d,{formatPrice=p=>p.toFixed(2)}={}){
    if(!d?.available)return ['確定足の圧力・支持抵抗の経過は、現在の足と鮮度を確認できるときに表示します。'];
    return ['確定足の圧力と支持・抵抗の変化',...d.frames.flatMap(f=>{
      const r=f.current,t=new Date(r.closedAt*1000).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false});
      return [`${f.name} 確定 ${t} JST：短期圧力 ${direction(r.pressure)} / 保持方向 ${direction(r.held)} / リボン ${direction(r.ribbon)}${f.conflict?'。短期と保持方向が不一致':''}。`,...(r.side?[`${f.name} 元の確定${r.side>0?'高値':'安値'} ${formatPrice(r.reference)}：${phaseName[r.phase]}${r.phase===2?(r.side>0?'（押し支え）':'（戻り失敗）'):''}。固定観察幅 ${formatPrice(r.reference-r.pad)}〜${formatPrice(r.reference+r.pad)}。`]:[])];
    }),'後続の同じ時間足だけで確認。観察幅は突破前ATR×0.15で固定、期限は12本。確定足からの再構築であり、当時の保存・入場成立・反転確率を示しません。P・EXIT・固定デモ条件は変更しません。'];
  }
  function html(d,options={}){
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),text=lines(d,options),p=s=>'<p>'+esc(s)+'</p>';
    if(!d?.available)return '<h3>短期圧力・支持抵抗の経過</h3>'+p(text[0]);
    const current=text.filter(s=>s.includes(' 確定 ')),events=text.slice(1,-1).filter(s=>!s.includes(' 確定 '));
    return '<h3>短期圧力・支持抵抗の経過</h3>'+current.map(p).join('')+'<details '+(options.expanded?'open':'')+'><summary>支持抵抗の経過・元水準（再構築）</summary>'+events.map(p).join('')+p(text.at(-1))+'</details><small>雲はリボン方向、短期圧力は終値とEMA13/21。方向が食い違うことがあります。P・EXITとは別の観察表示です。</small>';
  }
  return {VERSION,analyze,describe,lines,html};
});
