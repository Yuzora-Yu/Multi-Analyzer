/* Frozen research views and local evidence export. No trading or notification side effects. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerReview=api;})(globalThis,function(){
  'use strict';
  const frames=[['1m',1],['5m',5],['15m',15],['1h',60],['4h',240],['1d',1440]];
  const policy=[
    'メールの自動判定：15分確定足・共通エンジン pullback-v1。1分/5分/1時間/4時間/日足は比較用。',
    'P候補：トレンド継続、直近4本のEMA21への押しとEMA13反対側終値、その後のEMA13奪還。',
    '足の向き・リボン維持・確定H1一致・出来高が過去21本平均以上・ADX20以上が必要。',
    '確定足220本以上、H1準備完了、鮮度・欠損・ブラックアウト・コスト後RRの条件も必要。',
    'コスト/ストップ幅22%以下、最低RRは保存設定を参照。スコアは勝率でも通知トリガーでもありません。',
    '黄EXIT：EMA13反対側で2本確定した撤退注意。反転売買の条件ではありません。',
    '保有EXIT：共通エンジンのストップ・構造/上位足反転・参考候補12時間経過など。実際の保有とは未連携。',
    'クラウド通知：参考保有候補が継続中は新規候補を抑制。同じイベントを重複送信しません。',
    '毎時のAI観測メール：新しい注目理由がある場面のみ。機械サインとは区別し、更新だけでは送りません。',
    '出来高はBybit当該市場のみ。POC/VAはOHLCV近似で、大口の実約定や世界全体の出来高ではありません。',
    'この保存操作はメール送信・発注・個人の口座設定の送信を行いません。収益上の優位性は未確認です。'
  ];
  function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
  // ZIP STORE: PNG is already compressed; no CDN dependency and one mobile download.
  function zip(files){
    const chunks=[],central=[];let offset=0,size=0;
    for(const {name,data} of files){
      if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw Error('Unsafe archive filename');
      const n=new TextEncoder().encode(name),b=typeof data==='string'?new TextEncoder().encode(data):data,c=crc32(b);
      const h=new Uint8Array(30+n.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(12,33,true);v.setUint32(14,c,true);v.setUint32(18,b.length,true);v.setUint32(22,b.length,true);v.setUint16(26,n.length,true);h.set(n,30);
      const d=new Uint8Array(46+n.length),w=new DataView(d.buffer);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(14,33,true);w.setUint32(16,c,true);w.setUint32(20,b.length,true);w.setUint32(24,b.length,true);w.setUint16(28,n.length,true);w.setUint32(42,offset,true);d.set(n,46);
      chunks.push(h,b);central.push(d);offset+=h.length+b.length;size+=d.length;
    }
    const e=new Uint8Array(22),v=new DataView(e.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
    return new Blob([...chunks,...central,e],{type:'application/zip'});
  }
  function closed(rows,minutes,cutoff){return rows.filter(b=>b.time+minutes*60000<=cutoff);}
  function jst(t){return new Date(t).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})+' JST';}
  function num(v){return Number.isFinite(v)?v.toFixed(2):'—';}
  function dir(v){return v>0?'↑':v<0?'↓':'横';}
  function lines(ctx,text,x,y,maxWidth,lineHeight=25){let line='';for(const ch of String(text)){if(ctx.measureText(line+ch).width>maxWidth){ctx.fillText(line,x,y);y+=lineHeight;line='';}line+=ch;}ctx.fillText(line,x,y);return y+lineHeight;}
  function canvas(height=1000){const c=document.createElement('canvas');c.width=1280;c.height=height;const x=c.getContext('2d');x.fillStyle='#0b1018';x.fillRect(0,0,c.width,c.height);x.font='18px sans-serif';x.fillStyle='#dbe7f2';return[c,x];}
  function facts(r){const f=r.analysis.flow?.latest||{},v=r.analysis.values||{},p=r.analysis.flow?.profile;return[
    `${r.tf} / ${r.rows.length}確定足 / 最終確定 ${jst(r.rows.at(-1).time+r.minutes*60000)}`,
    `構造 ${dir(f.structure)}　リボン ${dir(f.ribbon)}　保持方向 ${dir(f.direction)}　ADX ${num(v.adx)}　出来高 ${num(f.volumeRatio)}倍`,
    `POC ${num(p?.poc)}　VAH ${num(p?.vah)}　VAL ${num(p?.val)}　ATR ${num(v.atr)}`,
    `品質：${r.analysis.ready?'計算可能':'履歴不足'} / 欠損 ${r.analysis.quality?.gaps??'不明'} / ${r.analysis.quality?.stale?'基準時刻に対して遅延':'基準時刻まで確定'}。取得時の基準時刻からの経過 ${Math.max(0,Math.round((r.capturedAt-r.cutoff)/60000))}分。`,
    r.tf==='15m'?`共通判定 ${r.signal.state} / ${r.signal.direction} / ${r.snapshotId}`:'環境・執行タイミングの比較用。独立したメール通知や売買推奨はありません。',
    ...(r.tf==='15m'?r.signal.vetoes:[])
  ];}
  function chartImage(r){
    const [c,x]=canvas(1600),bars=r.rows.slice(-180),flow=r.analysis.flow,off=r.rows.length-bars.length;
    x.fillStyle='#e6b85c';x.font='bold 27px sans-serif';x.fillText(`${r.asset.toUpperCase()} / ${r.tf} — 確定足レビュー`,30,42);
    x.font='16px sans-serif';x.fillStyle='#a5b9cc';x.fillText(`Bybit ${r.asset==='gold'?'XAUUSDT perpetual':'BTCUSDT spot'} | 基準 ${jst(r.cutoff)} | Core ${r.version}`,30,74);
    const lo=Math.min(...bars.map(b=>b.low)),hi=Math.max(...bars.map(b=>b.high)),span=Math.max(hi-lo,hi*.001),y=p=>110+(hi+span*.08-p)/(span*1.16)*480,xx=i=>36+i*5.7;
    x.save();x.beginPath();x.rect(25,100,1220,515);x.clip();
    for(let i=0;i<6;i++){const p=lo+(hi-lo)*i/5;x.strokeStyle='#233141';x.beginPath();x.moveTo(25,y(p));x.lineTo(1240,y(p));x.stroke();x.fillStyle='#9ab0c2';x.fillText(num(p),1140,y(p)-5);}
    if(flow)for(let i=1;i<bars.length;i++)for(let k=0;k<flow.periods.length-1;k++){
      const a=flow.lines[flow.periods[k]],b=flow.lines[flow.periods[k+1]],n=off+i;if(!Number.isFinite(a[n-1])||!Number.isFinite(b[n-1]))continue;
      x.fillStyle=flow.history[n]?.ribbon>0?'#24c89444':'#ff557744';x.beginPath();x.moveTo(xx(i-1),y(a[n-1]));x.lineTo(xx(i),y(a[n]));x.lineTo(xx(i),y(b[n]));x.lineTo(xx(i-1),y(b[n-1]));x.fill();
    }
    const maxV=Math.max(1,...bars.map(b=>b.volume));
    for(const z of r.analysis.smc?.zones||[]){if(z.status!=='active')continue;const start=Math.max(0,bars.findIndex(b=>b.time>=z.time));x.fillStyle=z.side==='bull'?'#43d49d16':'#ff6b7816';x.fillRect(xx(start),y(z.high),xx(bars.length-1)-xx(start),y(z.low)-y(z.high));}
    bars.forEach((b,i)=>{x.fillStyle=x.strokeStyle=b.close>=b.open?'#43d49d':'#ff6b78';x.beginPath();x.moveTo(xx(i),y(b.high));x.lineTo(xx(i),y(b.low));x.stroke();x.fillRect(xx(i)-2,y(Math.max(b.open,b.close)),4,Math.max(1,Math.abs(y(b.close)-y(b.open))));x.globalAlpha=.6;x.fillRect(xx(i)-2,608-b.volume/maxV*40,4,b.volume/maxV*40);x.globalAlpha=1;
      const h=flow?.history[off+i];if(h?.exitLong||h?.exitShort){x.fillStyle='#ffcd46';x.beginPath();x.arc(xx(i),y(h.exitLong?b.high:b.low)+(h.exitLong?-12:12),4,0,Math.PI*2);x.fill();}
      if(r.tf==='15m'&&h?.pullbackConfirmed){x.fillStyle=h.direction>0?'#43d49d':'#ff6b78';x.font='bold 13px sans-serif';x.fillText('P',xx(i)-4,y(h.direction>0?b.low:b.high)+(h.direction>0?22:-18));}
    });
    let lastLabel=-10;for(const ev of (r.analysis.smc?.events||[]).slice(-12)){const i=bars.findIndex(b=>b.time===ev.time);if(i<0||i-lastLabel<5)continue;lastLabel=i;x.fillStyle='#98b5e2';x.font='11px sans-serif';x.fillText(ev.type||ev.kind||'SMC',xx(i),y(bars[i].low)+24);}
    const p=flow?.profile;if(p){const max=Math.max(1,...p.bins.map(b=>b.volume));p.bins.forEach((b,i)=>{x.fillStyle=i===p.pocIndex?'#ffcd46':'#6e879b77';x.fillRect(1120-100*b.volume/max,y(b.high),100*b.volume/max,Math.max(1,y(b.low)-y(b.high)-1));});}
    x.restore();x.font='15px sans-serif';x.fillStyle='#98adc0';x.fillText(jst(bars[0].time),30,644);x.fillText(jst(bars.at(-1).time),760,644);
    x.font='18px sans-serif';x.fillStyle='#dbe7f2';let yy=681;for(const t of facts(r))yy=lines(x,t,30,yy,1210,25);
    if(r.signal?.plan)yy=lines(x,planText(r.signal.plan),30,yy,1210,25);
    x.fillStyle='#e6b85c';x.fillText('黄丸 = EXIT注意（反転エントリーではありません） / 価格帯出来高 = OHLCV近似',30,yy+30);
    const [out,ctx]=canvas(yy+60);ctx.drawImage(c,0,0);return out;
  }
  function evidenceImage(pack){
    const [c,x]=canvas(2400);x.font='bold 27px sans-serif';x.fillStyle='#e6b85c';x.fillText('判定・アラート・AI相談用メモ',30,45);x.font='18px sans-serif';x.fillStyle='#dbe7f2';let y=85;
    for(const t of [jst(pack.capturedAt),...pack.assets.map(a=>`${a.asset}: ${a.snapshot.id} / 基準 ${jst(a.snapshot.settings.now)}`),...policy,...pack.errors.map(e=>`未取得 ${e.asset}/${e.tf}: ${e.error}`)])y=lines(x,t,30,y,1210,26)+8;
    for(const a of pack.assets){const s=a.signal,p=s.plan;y=lines(x,`${a.asset.toUpperCase()} ${s.state} | ${s.actionable?'研究用候補':'待機'} | ${s.vetoes.join(' / ')}`,30,y+12,1210,26);if(p)y=lines(x,planText(p),30,y,1210,26);y=lines(x,`共通設定 ${JSON.stringify(a.snapshot.settings)}`,30,y,1210,24);}
    const [out,ctx]=canvas(y+30);ctx.drawImage(c,0,0);return out;
  }
  function planText(p){return `参考プラン（未成立時は発注候補ではありません）：${p.direction} entry ${num(p.entry)} / SL ${num(p.stop)} / TP1 ${num(p.tp1)} / TP2 ${num(p.tp2)} / TP3 ${num(p.tp3)} / net RR ${num(p.netRR)}`;}
  function prompt(pack){return `添付はMulti-Analyzerの確定足レビューです。利益が出るとの前提を置かず、データ鮮度、欠損、上位足構造、EMAリボン、出来高近似、コスト、反証条件から検討してください。EXITを即逆張りと解釈しないでください。\n比較対象：${pack.assets.map(a=>a.asset).join(', ')}。取得開始 ${jst(pack.capturedAt)}。各銘柄の基準時刻・設定・保存判定IDは manifest.json と画像に記載。時間足ごとの終値時刻は異なります。\n1. 現状は待機/押し目/戻り/撤退注意のどれか、根拠と不成立条件\n2. 15分共通判定と1分/5分のタイミング、1時間/4時間/日足の環境は整合するか\n3. 参考SL/TPに対するコストと損益比、飛び乗りを避ける確認水準\n4. この1例から勝率を推定せず、今後記録すべき比較仮説\n画像は直近180本、JSONは全取得確定足を含みます。POCは直近96本の近似で、全世界の約定ではありません。\nhttps://yuzora-yu.github.io/Multi-Analyzer/\n${pack.assets.map(a=>`https://yuzora-yu.github.io/Multi-Analyzer/?asset=${a.asset}&snapshot=${a.snapshot.id}`).join('\n')}\n保存画像は過去の基準時刻の記録であり、現在価格ではありません。`;} 
  async function collect(assets,{signal,archivedId,onProgress=()=>{}}={}){
    const Core=globalThis.MultiAnalyzerCore,Feed=globalThis.MultiAnalyzerFeed,pack={schema:1,capturedAt:Date.now(),version:Core.VERSION,assets:[],records:[],errors:[],policy};
    async function get(url){const r=await fetch(url,{signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(15000)])});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}
    for(const asset of assets){
      signal?.throwIfAborted();onProgress(`${asset}: 共通判定を取得`);
      let s;try{s=await get(`https://multi-analyzer-monitor.rikai-829.workers.dev/api/snapshot?asset=${asset}${archivedId?'&id='+encodeURIComponent(archivedId):''}`);}catch(e){if(signal?.aborted)throw e;pack.errors.push({asset,tf:'all',error:e.message});continue;}
      if(s.version!==Core.VERSION||!s.bars?.m15||s.asset!==asset)throw Error('共通判定の銘柄・バージョン不一致');
      const cutoff=s.settings.now,input=Feed.input(s),marketSignal=Core.analyzeMarket(input,s.settings);pack.assets.push({asset,snapshot:s,signal:marketSignal});
      for(const [tf,minutes] of frames){
        signal?.throwIfAborted();onProgress(`${asset} ${tf}: 確定足を取得`);
        try{
          const rows=tf==='15m'?input.exec:closed(Core.normalizeCandles(Feed.parse(await get(Feed.url(asset,minutes,1000,cutoff-1)))) ,minutes,cutoff);
          if(!rows.length)throw Error('確定足なし');
          const analysis=tf==='15m'?marketSignal.exec:Core.analyzeTimeframe(rows,minutes,cutoff);
          pack.records.push({asset,tf,minutes,rows,analysis,signal:tf==='15m'?marketSignal:null,cutoff,capturedAt:pack.capturedAt,snapshotId:s.id,version:Core.VERSION});
        }catch(e){if(signal?.aborted)throw e;pack.errors.push({asset,tf,error:e.message});}
      }
    }
    if(!pack.records.length)throw Error('取得できた時間足がありません');
    return pack;
  }
  function init({getAsset,getArchiveId,onLayout}){
    const $=id=>document.getElementById(id);let pack=null,controller=null,downloadUrl=null;
    const dialog=$('reviewDialog'),grid=$('reviewGrid'),status=$('reviewStatus');
    function setView(mode){dialog.dataset.view=mode;for(const b of dialog.querySelectorAll('[data-review-view]'))b.setAttribute('aria-pressed',String(b.dataset.reviewView===mode));}
    async function refresh(){
      if(controller)controller.abort();controller=new AbortController();const current=controller;pack=null;grid.replaceChildren();$('reviewSave').disabled=true;$('reviewCopy').disabled=true;$('reviewDownload').hidden=true;if(downloadUrl)URL.revokeObjectURL(downloadUrl);
      try{
        const archive=getArchiveId();$('reviewBoth').disabled=Boolean(archive);if(archive)$('reviewBoth').checked=false;
        const result=await collect(!archive&&$('reviewBoth').checked?['gold','btc']:[getAsset()],{signal:current.signal,archivedId:archive,onProgress:t=>{status.textContent=t;}});
        if(current!==controller)return;pack=result;
        for(const r of pack.records){const article=document.createElement('article');article.className='review-card';const h=document.createElement('h3');h.textContent=`${r.asset.toUpperCase()} / ${r.tf}`;const c=chartImage(r);c.setAttribute('aria-label',facts(r).join('。'));const details=document.createElement('div');details.className='review-facts';for(const text of facts(r)){const p=document.createElement('p');p.textContent=text;details.append(p);}article.append(h,c,details);grid.append(article);}
        const evidence=document.createElement('article');evidence.className='review-evidence';const heading=document.createElement('h3');heading.textContent='アラート条件・共通判定';const text=document.createElement('div');text.className='review-facts';for(const t of [...policy,...pack.assets.flatMap(a=>[`${a.asset.toUpperCase()} / ${a.signal.state}`,a.signal.plan?planText(a.signal.plan):'参考プランなし'])]){const p=document.createElement('p');p.textContent=t;text.append(p);}const image=evidenceImage(pack);image.hidden=true;evidence.append(heading,text,image);grid.append(evidence);
        status.textContent=`${pack.records.length}時間足を固定表示。${pack.errors.length?'未取得: '+pack.errors.map(e=>e.asset+'/'+e.tf+' '+e.error).join(', '):'全時間足の取得完了。'} 基準 ${pack.assets.map(a=>a.asset+' '+jst(a.snapshot.settings.now)).join(' / ')}。更新するまで固定。`;
        $('reviewSave').disabled=false;$('reviewCopy').disabled=false;
      }catch(e){if(current===controller)status.textContent=e.name==='AbortError'?'取得を中止しました。':'取得失敗：'+e.message;}
      finally{if(current===controller)controller=null;}
    }
    $('reviewOpen').addEventListener('click',()=>{dialog.showModal();if(!pack||!pack.assets.some(a=>a.asset===getAsset()))refresh();});
    $('reviewClose').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>controller?.abort());
    $('reviewRefresh').addEventListener('click',refresh);$('reviewCancel').addEventListener('click',()=>controller?.abort());
    $('reviewBoth').addEventListener('change',refresh);
    for(const b of dialog.querySelectorAll('[data-review-view]'))b.addEventListener('click',()=>setView(b.dataset.reviewView));
    $('focusMode').addEventListener('click',()=>{const active=document.body.classList.toggle('chart-focus');$('focusMode').setAttribute('aria-pressed',String(active));onLayout();});
    $('reviewCopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(prompt(pack));status.textContent='AI相談文をコピーしました。保存したPNGもAIに添付してください。';}catch{$('reviewPrompt').hidden=false;$('reviewPrompt').value=prompt(pack);$('reviewPrompt').select();status.textContent='相談文を選択してコピーできます。';}});
    $('reviewSave').addEventListener('click',async()=>{
      if(!pack)return;const saved=pack;const button=$('reviewSave');button.disabled=true;$('reviewRefresh').disabled=true;$('reviewBoth').disabled=true;
      try{
        const files=[];for(const [i,c] of [...grid.querySelectorAll('canvas')].entries()){
          status.textContent=`画像を保存用に変換 ${i+1}/${saved.records.length+1}`;
          const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG変換失敗');
          files.push({name:i<saved.records.length?`${saved.records[i].asset}-${saved.records[i].tf}.png`:'alerts-and-plans.png',data:new Uint8Array(await blob.arrayBuffer())});
        }
        files.push({name:'consult-ai.txt',data:prompt(saved)},{name:'manifest.json',data:JSON.stringify(saved,null,2)});
        if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(zip(files));const link=$('reviewDownload');link.href=downloadUrl;link.download=`multi-analyzer-${new Date(saved.capturedAt).toISOString().replace(/[:.]/g,'-')}.zip`;link.hidden=false;
        status.textContent=`保存の準備完了（${files.length}ファイル）。「ZIP保存」を押してください。AIには展開したPNGと相談文を添付できます。${saved.errors.length?'未取得の時間足はmanifestに記録しました。':''}`;
      }catch(e){status.textContent='保存失敗：'+e.message;}finally{button.disabled=false;$('reviewRefresh').disabled=false;$('reviewBoth').disabled=Boolean(getArchiveId());}
    });
  }
  return{init,collect,zip,crc32,closed,frames,policy,facts,prompt};
});
