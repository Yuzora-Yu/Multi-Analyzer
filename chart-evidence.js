/* Presentation of confirmed engine events; never a second signal engine. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerEvidence=api;})(globalThis,function(){
  'use strict';
  function markers(history,start){
    const out=[];
    for(let i=0;i<history.length;i++){
      const f=history[i],p=history[i-1];
      if(f.time<start)continue;
      const add=(side,color,shape,text)=>out.push({time:Math.floor(f.time/1000),position:side>0?'belowBar':'aboveBar',color,shape,text});
      if(p&&Math.abs(p.ribbon)===1&&Math.abs(f.ribbon)===1&&p.ribbon!==f.ribbon)add(f.ribbon,f.ribbon>0?'#43d49d':'#ff6b78',f.ribbon>0?'arrowUp':'arrowDown',f.ribbon>0?'リボン ↑':'リボン ↓');
      if(f.switched)add(f.direction,f.direction>0?'#43d49d':'#ff6b78',f.direction>0?'arrowUp':'arrowDown',`方向転換 ${f.direction>0?'買':'売'} ${f.rank||'B'}`);
      if(f.pullbackConfirmed)add(f.direction,'#bf9dff','circle','P 押し目条件');
      if(f.exitLong||f.exitShort)add(f.exitLong?-1:1,'#ffd44a','circle',f.exitLong?'買 EXIT注意':'売 EXIT注意');
    }
    return out;
  }
  function hourlyZones(h1,executionClose){
    // A currently active zone is a current reference, never a historical signal.
    // Do not show an H1 result newer than the displayed execution candle.
    const last=h1?.candles?.at(-1);
    if(!last||last.time+3600000>executionClose||h1.quality?.stale)return [];
    return (h1.smc?.zones||[]).filter(z=>z.type==='OB'&&z.status==='active'&&z.time+3600000<=executionClose&&Number.isFinite(z.low)&&Number.isFinite(z.high)).slice(-2);
  }
  function spaceLabels(markers,seconds){
    const priority=m=>m.text.startsWith('方向転換')?4:m.text.startsWith('リボン')?3:m.text.startsWith('P ')?2:m.text.includes('EXIT')?1:0;
    const used=[];
    for(const m of [...markers].sort((a,b)=>priority(b)-priority(a)||b.time-a.time)){
      if(used.some(t=>Math.abs(t-m.time)<seconds))m.text='';else used.push(m.time);
    }
    return markers;
  }
  function context(a){
    const direction=n=>n===1?'上向き':n===-1?'下向き':n===0?'中立':'不明';
    const frame=f=>!f?.ready||f.quality?.stale?'不明':`${direction(f.flow?.latest?.structure)}（MA ${f.trend==='bull'?'上':f.trend==='bear'?'下':f.trend==='range'?'横':'不明'}）`;
    const f=a.exec?.flow?.latest,m=a.exec?.smc;
    if(!f||a.exec.quality?.stale)return {environment:'データ不足・更新停止',location:'不明',confirmation:'判定を保留',exit:'不明'};
    const conflict=f.direction!==0&&f.ribbon!==0&&f.direction!==f.ribbon;
    const event=m?.events?.filter(e=>e.time===f.time).map(e=>`${e.side==='bull'?'買':'売'} ${e.type}`).join(' / ');
    return {
      environment:`H4構造 ${frame(a.h4)} / H1構造 ${frame(a.h1)} / 執行足 ${direction(f.structure)}`,
      location:m?.location==='premium'?'確認済み高安レンジの上半分':m?.location==='discount'?'確認済み高安レンジの下半分':'高安レンジ未確定',
      confirmation:conflict?'保持方向とリボンが不一致。継続の根拠を再確認':event?`最新確定足：${event}`:'最新確定足に新しい構造イベントなし',
      exit:f.exitLong?'買いEXIT注意：EMA13下で2本確定':f.exitShort?'売りEXIT注意：EMA13上で2本確定':'最新確定足のEXIT注意なし'
    };
  }
  return {markers,hourlyZones,spaceLabels,context};
});
