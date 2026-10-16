/* Read-only explanations of markers already drawn by the chart. No signal engine. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerMarkerDetails=api;})(globalThis,function(){
  'use strict';
  const validTime=t=>Number.isSafeInteger(t)&&t>=0&&t<=8640000000000000;
  function stamp(t){return validTime(t)?new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' JST':'不明';}
  function meaning(marker){
    const text=String(marker.text||''),where=marker.position==='aboveBar'?'ローソクの上側':marker.position==='belowBar'?'ローソクの下側':'位置不明';
    if(text==='買 EXIT注意')return {kind:'EXIT_LONG',text:`${where}の黄丸：買い側のEXIT注意。EMA13を下抜け、下側で2本確定した時の表示です。実際の買い保有の有無とは別で、売り入口の成立ではありません。`};
    if(text==='売 EXIT注意')return {kind:'EXIT_SHORT',text:`${where}の黄丸：売り側のEXIT注意。EMA13を上抜け、上側で2本確定した時の表示です。実際の売り保有の有無とは別で、買い入口の成立ではありません。`};
    if(text.startsWith('P '))return {kind:'P_HISTORY',text:'過去のP条件表示：押し・戻り、EMA13再突破、出来高、確定H1一致などの条件です。当時の費用・RR・ブラックアウト等を含む全見送り条件の通過や、注文・約定を証明しません。'};
    if(text.startsWith('リボン'))return {kind:'RIBBON',text:'EMA5とEMA144の上下関係が変わった足です。緑はEMA5が上、赤は下。すべての移動平均線や上位足が同方向という意味ではありません。'};
    if(text.startsWith('方向転換'))return {kind:'TURN',text:'高安構造・リボン・ADX・幅・転換票などで、エンジンの保持方向が変わった足です。実際の保有や新規入口とは別です。S/A/Bは勝率順位ではありません。'};
    const structureSide=marker.position==='belowBar'?'上向き':marker.position==='aboveBar'?'下向き':'方向未確認';
    if(text==='BOS')return {kind:'BOS',text:`${structureSide}：確認済みの直近高値・安値を終値で突破した構造イベントです。単独で新規入口の成立とはしません。`};
    if(text==='CHoCH')return {kind:'CHOCH',text:`${structureSide}：それまでの構造方向に対し、反対側の確認済み高値・安値を終値で突破した変化です。反転完成や新規入口の保証ではありません。`};
    if(text==='SWEEP')return {kind:'SWEEP',text:`${structureSide}：確認済みの高値・安値の外へヒゲが出た後、終値が内側へ戻ったイベントです。流動性や注文の実測、反転入口の成立を意味しません。`};
    if(text==='OB BREAK')return {kind:'OB_BREAK',text:'推定OBの反対端を終値で越えた構造イベントです。反対方向の新規入口成立とは別です。'};
    if(text==='買い候補'||text==='売り候補')return {kind:'CURRENT_CANDIDATE',text:'この表示中の最新確定判定で、新規候補の条件が成立した時の金色丸です。過去のPや黄EXIT丸とは別で、実注文・約定・保有を示しません。'};
    return {kind:'UNKNOWN',text:'元の説明を特定できません。色や位置から売買条件を推定しません。'};
  }
  function describe({markers=[],candles=[],intervalMinutes,analysisAt,asset,symbol,market,mode='live',state='不明',actionable=false,blocked=false}={}){
    const step=Number.isInteger(intervalMinutes)&&intervalMinutes>0?intervalMinutes*60000:null;
    const rows=new Map(),duplicates=new Set();
    for(const b of candles){if(!validTime(b?.time))continue;if(rows.has(b.time))duplicates.add(b.time);else rows.set(b.time,b);}
    function closedAt(time){
      const b=rows.get(time),close=step&&validTime(time)?time+step:null;
      if(!step||!validTime(analysisAt)||!b||duplicates.has(time)||!validTime(close)||close>analysisAt)return null;
      if(!['open','high','low','close'].every(k=>Number.isFinite(b[k]))||b.low>b.high||b.open<b.low||b.open>b.high||b.close<b.low||b.close>b.high)return null;
      return close;
    }
    const marketName=asset==='gold'&&symbol==='XAUUSDT'&&market==='futures'?'Bybit XAUUSDT 無期限先物':asset==='btc'&&symbol==='BTCUSDT'&&market==='spot'?'Bybit BTCUSDT 現物':'銘柄・契約未確認';
    const basis=mode==='csv'?'CSV（銘柄・契約未確認）':marketName;
    const frame=step?`${intervalMinutes}分足`:'時間足不明';
    const seen=new Map(),records=markers.map(m=>{
      const openAt=Number.isFinite(m.time)?m.time*1000:null,closeAt=closedAt(openAt),info=meaning(m);
      const identity=JSON.stringify([m.time,m.position,m.shape,m.text]),n=seen.get(identity)||0;seen.set(identity,n+1);
      const label=String(m.text||'説明なし'),position=m.position==='aboveBar'?'上側':m.position==='belowBar'?'下側':'位置不明';
      return {key:identity+':'+n,openAt,closeAt,label,position,kind:info.kind,meaning:info.text,
        option:`${closeAt==null?'確定不明':stamp(closeAt)} / ${label}（${position}）`,
        timing:closeAt==null?'確定時刻を確認できません。対応する足・時間足・分析時刻の欠測、重複、未確定などがあるため推定しません。':`足の開始 ${stamp(openAt)} / 確定 ${stamp(closeAt)}`};
    }).sort((a,b)=>(b.openAt??-1)-(a.openAt??-1));
    const latest=candles.at(-1),latestClose=latest?closedAt(latest.time):null;
    const verdict=blocked?'判断保留・表示中の記録':actionable?'研究用の新規候補':'新規条件待ち';
    return {context:`${mode==='archive'?'保存記録 / ':''}${basis} / ${frame}`,
      current:`${mode==='live'?'表示中の最新判定':'表示中の保存判定'}：${verdict}（${state}） / 確定 ${stamp(latestClose)}`,
      note:'過去のマーカーの説明と、表示中の最新判定を分けて読みます。どちらも実際の注文・保有とは別です。文字が重なって消えた印も、元の説明をここで確認できます。',records};
  }
  function create(root){
    if(!root)return null;
    const select=root.querySelector('select'),context=root.querySelector('[data-marker-context]'),current=root.querySelector('[data-marker-current]'),detail=root.querySelector('[data-marker-detail]');
    let model=null,source=null,listKey=null;
    function selected(){
      detail.replaceChildren();
      const r=model?.records.find(r=>r.key===select.value);if(!r){detail.textContent='読み込んだ足に表示マーカーはありません。';return;}
      for(const text of [r.label+'（'+r.position+'）',r.timing,r.meaning]){const p=root.ownerDocument.createElement('p');p.textContent=text;detail.append(p);}
    }
    select.addEventListener('change',selected);
    return {render(next){
      const previous=source===next.context?select.value:null;model=next;source=next.context;context.textContent=next.context;current.textContent=next.current;
      const nextKey=JSON.stringify(next.records);
      if(nextKey!==listKey){
        select.replaceChildren();
        for(const r of next.records){const option=root.ownerDocument.createElement('option');option.value=r.key;option.textContent=r.option;select.append(option);}
        select.disabled=!next.records.length;if(previous&&next.records.some(r=>r.key===previous))select.value=previous;
        listKey=nextKey;
      }
      selected();
    }};
  }
  return {stamp,meaning,describe,create};
});
