import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import Core from '../strategy-core.js';
import { canReuse } from './logic.mjs';
import Events from '../alert-event.js';
import Feed from '../market-feed.js';

const ASSETS = {gold:'XAUUSDT',btc:'BTCUSDT'};
const INTERVALS = {m15:15,h1:60,h4:240};
const PAGE='https://yuzora-yu.github.io/Multi-Analyzer/';
const safeJson = async response => {
  if(!response.ok) throw new Error(`Data HTTP ${response.status}`);
  const reader=response.body.getReader();const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>500000){await reader.cancel();throw new Error('Data too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
};
const escapeHtml = text => text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class MarketMonitor extends DurableObject {
  async start(asset){
    if(!ASSETS[asset]) throw new Error('Invalid asset');
    await this.ctx.storage.put('asset',asset);
    const scheduledAt=Date.now()+30000;await this.ctx.storage.setAlarm(scheduledAt);return {scheduledAt};
  }
  async alarm(){
    const asset=await this.ctx.storage.get('asset');if(!ASSETS[asset])return;
    await this.ctx.storage.setAlarm(Date.now()+60000);
    await this.tick(asset);
  }
  async snapshot(id){return (await this.ctx.storage.get(id ? 'snapshot:'+id : 'snapshot')) || (id ? this.ctx.storage.get('alert:'+id) : undefined);}
  async status(){ const status=await this.ctx.storage.get('status') || {state:'NOT_STARTED',updatedAt:0}; return {...status,nextRunAt:await this.ctx.storage.getAlarm()}; }
  async tick(asset, dryRun=false){
    if(!ASSETS[asset]) throw new Error('Invalid asset');
    if(this.pending) return this.pending;
    this.pending=this.perform(asset,dryRun);
    try{return await this.pending;}finally{this.pending=null;}
  }
  async perform(asset,dryRun){
    const now=Date.now(), day=new Date(now).toISOString().slice(0,10);
    let state=await this.ctx.storage.get('state') || {delivered:{},baseline:false,cache:{},day,count:0};
    if(state.feed!=='bybit-v1'){state={delivered:{},baseline:false,cache:{},day,count:0,feed:'bybit-v1',archives:[]};}
    if(state.day!==day){state.day=day;state.count=0;}
    const status={updatedAt:now,state:'DATA_ERROR',source:'Bybit',symbol:ASSETS[asset],pollMinutes:1,requestsToday:state.count,emailEnabled:this.env.ALERTS_ENABLED==='true',dryRun};
    try {
      const series={};
      for(const [interval,minutes] of Object.entries(INTERVALS)){
        const cached=state.cache[interval];
        if(interval!=='m15' && canReuse(cached,interval,now,minutes*60000)){series[interval]=cached.rows;continue;}
        if(state.count>=2000)throw new Error('FREE_DAILY_BUDGET_REACHED');
        state.count++;
        const raw=await safeJson(await fetch(Feed.url(asset,minutes),{signal:AbortSignal.timeout(12000)}));
        const rows=Core.normalizeCandles(Feed.parse(raw));
        if(rows.length<220)throw new Error('INVALID_CANDLES');
        series[interval]=rows;state.cache[interval]={rows,fetchedAt:now};
      }
      const closed=Core.filterClosedCandles(series.m15,15,now-2000);
      const bar=closed.at(-1)?.time;
      if(!bar || now-bar>2100000)throw new Error('STALE_MARKET');
      const id=asset+'-'+bar+'-'+Core.VERSION;
      let snapshot=await this.ctx.storage.get('snapshot:'+id);
      if(!snapshot){
        const settings={...Core.DEFAULTS,position:state.paperPosition||null,executionMinutes:15,now:bar+900000+1,market:Feed.instruments[asset].market,livePrice:closed.at(-1).close};
        snapshot={id,asset,source:'Bybit',symbol:ASSETS[asset],version:Core.VERSION,createdAt:now,settings,bars:{m15:Feed.pack(closed),h1:Feed.pack(Core.filterClosedCandles(series.h1,60,settings.now)),h4:Feed.pack(Core.filterClosedCandles(series.h4,240,settings.now))}};
        await this.ctx.storage.put('snapshot:'+id,snapshot);
        state.archives.push(id);
        while(state.archives.length>24)await this.ctx.storage.delete('snapshot:'+state.archives.shift());
      }
      const analysis=Core.analyzeMarket(Feed.input(snapshot),snapshot.settings);
      await this.ctx.storage.put('snapshot',snapshot);
      const note='BybitのUSDT参考市場。金は無期限契約、BTCは現物です。出来高は同取引所の取引量で、XMのUSD価格・世界全体の出来高とは異なります。ランク・バッジ・スコアは勝率ではありません。撤退通知は前回の候補を保有している場合の案内で、実際の保有情報は取得していません。通知は15分確定足で確認し、ブローカーのSL注文を代行しません。';
      const position=snapshot.settings.position;
      const exit=analysis.positionDecision?.action.startsWith('EXIT');
      const event=position && !exit ? null : Events.eventFor(analysis,asset,position,{symbol:ASSETS[asset],note,snapshot:id,version:Core.VERSION,conditionalExit:Boolean(position)});
      if(!dryRun){
        if(!state.baseline){state.baseline=true;if(event)state.delivered[event.key]=now;}
        else if(event && !state.delivered[event.key] && this.env.ALERTS_ENABLED==='true'){
          await this.ctx.storage.put('alert:'+id,snapshot);
          state.alertIds=state.alertIds||[];
          if(!state.alertIds.includes(id))state.alertIds.push(id);
          while(state.alertIds.length>100)await this.ctx.storage.delete('alert:'+state.alertIds.shift());
          await this.env.EMAIL.send({from:'alerts@yu-zora.com',to:this.env.EMAIL_TO,subject:event.title,text:event.text,html:'<div style="white-space:pre-wrap">'+escapeHtml(event.text)+'</div><p><a href="'+event.url+'">公開チャートを開く</a></p>'});
          state.delivered[event.key]=now;status.emailAcceptedAt=now;
          if(exit)state.paperPosition=null;
          else state.paperPosition={direction:analysis.direction,entry:analysis.plan.entry,stop:analysis.plan.stop,openedAt:snapshot.settings.now,referenceOnly:true};
        }
      }
      state.delivered=Object.fromEntries(Object.entries(state.delivered).sort((a,b)=>b[1]-a[1]).slice(0,200));
      Object.assign(status,{state:analysis.state,bar:analysis.exec.candles.at(-1)?.time,checkedAt:now,error:null,snapshotId:id,engineVersion:Core.VERSION,volumeAvailable:closed.some(b=>b.volume>0),requestsToday:state.count});
    }catch(error){status.error=String(error.message).replace(/apikey=[^&\s]+/g,'apikey=[REDACTED]').slice(0,100);status.requestsToday=state.count;}
    await this.ctx.storage.put({state,status});
    console.log(JSON.stringify({asset,state:status.state,error:status.error,requestsToday:status.requestsToday}));
    return status;
  }
}
const authorized=(request,env)=>{
  const got=request.headers.get('Authorization')||'',want=`Bearer ${env.ADMIN_TOKEN}`;
  return Boolean(env.ADMIN_TOKEN && Buffer.byteLength(got)===Buffer.byteLength(want) && timingSafeEqual(Buffer.from(got),Buffer.from(want)));
};
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='GET' && url.pathname==='/api/monitor'){
      const assets={};for(const asset of Object.keys(ASSETS))assets[asset]=await env.MONITOR.getByName(asset).status();
      const updatedAt=Math.min(...Object.values(assets).map(s=>s.updatedAt||0));
      const errors=Object.entries(assets).filter(([,s])=>s.error).map(([a,s])=>`${a}: ${s.error}`);
      return Response.json({updatedAt,channels:env.ALERTS_ENABLED==='true'?['Email']:[],assets,error:errors.join(' / ')||null,summary:Object.entries(assets).map(([a,s])=>`${a}: ${s.state}`).join(' / '),source:'Bybit / 1分間隔監視・15分確定足 / 画面と同一判定'}, {headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=60'}});
    }
    if(request.method==='GET' && url.pathname==='/api/snapshot'){
      const asset=url.searchParams.get('asset'),id=url.searchParams.get('id');
      if(!ASSETS[asset] || (id && !/^(gold|btc)-[0-9]+-[0-9.]+$/.test(id)))return new Response('Invalid snapshot',{status:400});
      const snapshot=await env.MONITOR.getByName(asset).snapshot(id);
      return Response.json(snapshot||{error:'Snapshot expired or not ready'},{status:snapshot?200:404,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=15'}});
    }
    if(!authorized(request,env))return new Response('Not found',{status:404});
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    if(url.pathname==='/start'){const asset=url.searchParams.get('asset');if(!ASSETS[asset])return new Response('Invalid asset',{status:400});return Response.json(await env.MONITOR.getByName(asset).start(asset));}
    if(url.pathname==='/run'){
      const asset=url.searchParams.get('asset');if(!ASSETS[asset])return new Response('Invalid asset',{status:400});
      return Response.json(await env.MONITOR.getByName(asset).tick(asset,url.searchParams.get('dry')==='true'));
    }
    if(url.pathname==='/test-email'){
      const text='Cloudflareの無料枠による監視の接続テストです。トレード推奨ではありません。\n'+PAGE+'\nBybitの価格・出来高を1分間隔で確認し、15分確定足を画面と同じエンジンで分析します。';
      await env.EMAIL.send({from:'alerts@yu-zora.com',to:env.EMAIL_TO,subject:'Multi-Analyzer｜クラウド監視接続テスト',text,html:'<p>'+escapeHtml(text)+'</p><a href="'+PAGE+'">公開ページ</a>'});return Response.json({emailAccepted:true});
    }
    return new Response('Not found',{status:404});
  }
};
