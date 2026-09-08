import { DurableObject } from 'cloudflare:workers';
import { timingSafeEqual } from 'node:crypto';
import Core from '../strategy-core.js';
import { canReuse } from './logic.mjs';
import Events from '../alert-event.js';

const ASSETS = {gold:'XAU/USD',btc:'BTC/USD'};
const INTERVALS = {'15min':900000,'1h':3600000,'4h':14400000};
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
  async status(){ return await this.ctx.storage.get('status') || {state:'NOT_STARTED',updatedAt:0}; }
  async tick(asset, dryRun=false){
    if(!ASSETS[asset]) throw new Error('Invalid asset');
    if(this.pending) return this.pending;
    this.pending=this.perform(asset,dryRun);
    try{return await this.pending;}finally{this.pending=null;}
  }
  async perform(asset,dryRun){
    const now=Date.now(), day=new Date(now).toISOString().slice(0,10);
    let state=await this.ctx.storage.get('state') || {delivered:{},baseline:false,cache:{},day,count:0};
    if(state.day!==day){state.day=day;state.count=0;}
    const status={updatedAt:now,state:'DATA_ERROR',source:'Twelve Data',symbol:ASSETS[asset],pollMinutes:5,requestsToday:state.count,emailEnabled:this.env.ALERTS_ENABLED==='true',dryRun};
    try {
      if(!this.env.TWELVE_API_KEY) throw new Error('API key missing');
      const series={};
      for(const [interval,ms] of Object.entries(INTERVALS)){
        const cached=state.cache[interval];
        // 15m is refreshed every five minutes; HTF refreshed at most once per interval.
        if(canReuse(cached,interval,now,ms)){series[interval]=cached.rows;continue;}
        if(state.count>=350) throw new Error('FREE_DAILY_BUDGET_REACHED');
        state.count++;
        await this.ctx.storage.put('state',state); // Failed requests also consume budget.
        const params=new URLSearchParams({symbol:ASSETS[asset],interval,outputsize:'300',timezone:'UTC',apikey:this.env.TWELVE_API_KEY});
        const raw=await safeJson(await fetch('https://api.twelvedata.com/time_series?'+params,{signal:AbortSignal.timeout(12000)}));
        if(raw.status!=='ok' || !Array.isArray(raw.values) || raw.values.length<200) throw new Error('INVALID_OR_INCOMPLETE_DATA');
        const rows=Core.normalizeCandles(raw.values.map(b=>({time:Date.parse(b.datetime.replace(' ','T')+'Z'),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume||0})));
        if(rows.length<200) throw new Error('INVALID_CANDLES');
        series[interval]=rows;state.cache[interval]={rows,fetchedAt:now};
      }
      const exec=series['15min'];
      // Use this provider's own latest candle, never mix a different market's live price.
      const analysis=Core.analyzeMarket({exec,m15:exec,h1:series['1h'],h4:series['4h']},{executionMinutes:15,now,market:asset==='gold'?'forex':'spot',livePrice:exec.at(-1).close});
      const note='Twelve DataのUSD市場による5分間隔の分析です。出来高未提供の場合、VWAP・出来高スコア・POCは使いません。公開ページのBinance USDT参考チャートとは価格・判定が異なります。スコアは勝率ではありません。保有ポジションはクラウドへ同期していないため、この通知は新規候補のみです。';
      const event=Events.eventFor(analysis,asset,null,{symbol:ASSETS[asset],note});
      if(!dryRun){
        if(!state.baseline){state.baseline=true;if(event)state.delivered[event.key]=now;}
        else if(event && !state.delivered[event.key] && this.env.ALERTS_ENABLED==='true'){
          await this.env.EMAIL.send({from:'alerts@yu-zora.com',to:this.env.EMAIL_TO,subject:event.title,text:event.text,html:'<div style="white-space:pre-wrap">'+escapeHtml(event.text)+'</div><p><a href="'+event.url+'">公開チャートを開く</a></p>'});
          state.delivered[event.key]=now;status.emailAcceptedAt=now;
        }
      }
      state.delivered=Object.fromEntries(Object.entries(state.delivered).sort((a,b)=>b[1]-a[1]).slice(0,200));
      Object.assign(status,{state:analysis.state,bar:analysis.exec.candles.at(-1)?.time,checkedAt:now,error:null,volumeAvailable:exec.some(b=>b.volume>0),requestsToday:state.count});
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
  async scheduled(controller,env){
    // Sequential assets keep the free API's eight requests/minute budget bounded.
    for(const asset of Object.keys(ASSETS))await env.MONITOR.getByName(asset).tick(asset);
  },
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==='GET' && url.pathname==='/api/monitor'){
      const assets={};for(const asset of Object.keys(ASSETS))assets[asset]=await env.MONITOR.getByName(asset).status();
      const updatedAt=Math.min(...Object.values(assets).map(s=>s.updatedAt||0));
      const errors=Object.entries(assets).filter(([,s])=>s.error).map(([a,s])=>`${a}: ${s.error}`);
      return Response.json({updatedAt,channels:env.ALERTS_ENABLED==='true'?['Email']:[],assets,error:errors.join(' / ')||null,summary:Object.entries(assets).map(([a,s])=>`${a}: ${s.state}`).join(' / '),source:'Twelve Data USD / 5分間隔 / 新規候補のみ'}, {headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=60'}});
    }
    if(!authorized(request,env))return new Response('Not found',{status:404});
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    if(url.pathname==='/run'){
      const asset=url.searchParams.get('asset');if(!ASSETS[asset])return new Response('Invalid asset',{status:400});
      return Response.json(await env.MONITOR.getByName(asset).tick(asset,url.searchParams.get('dry')==='true'));
    }
    if(url.pathname==='/test-email'){
      const text='Cloudflareの無料枠による監視の接続テストです。トレード推奨ではありません。\n'+PAGE+'\n5分間隔・Twelve Data USD市場を分析します。公開チャートとは取得元が異なります。';
      await env.EMAIL.send({from:'alerts@yu-zora.com',to:env.EMAIL_TO,subject:'Multi-Analyzer｜クラウド監視接続テスト',text,html:'<p>'+escapeHtml(text)+'</p><a href="'+PAGE+'">公開ページ</a>'});return Response.json({emailAccepted:true});
    }
    return new Response('Not found',{status:404});
  }
};
