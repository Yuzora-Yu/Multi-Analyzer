import { DurableObject } from 'cloudflare:workers';
import Core from '../strategy-core.js';
import { timingSafeEqual } from 'node:crypto';

async function json(url) {
  const r = await fetch(url, {signal: AbortSignal.timeout(12000),headers:{'User-Agent':'MultiAnalyzer/4.1 (public market data research)'}});
  if (!r.ok) { const reader=r.body.getReader(); const chunk=await reader.read(); await reader.cancel(); throw new Error(`Market HTTP ${r.status}`); }
  const reader = r.body.getReader(); let size = 0; const chunks = [];
  while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>500000) {await reader.cancel(); throw new Error('Market response too large');} chunks.push(value); }
  const body = new Uint8Array(size); let offset=0; for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(body));
}
const handler = {
  async fetch(request, env) {
    const token = request.headers.get('Authorization') || '';
    const expected = `Bearer ${env.PROBE_TOKEN}`;
    if (!env.PROBE_TOKEN || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return new Response('Not found',{status:404});
    if(request.method !== 'POST') return new Response('Method not allowed',{status:405});
    const url = new URL(request.url);
    try {
      if(url.pathname === '/probe-volume-feed') {
        const asset=url.searchParams.get('asset')==='btc'?'btc':'gold';
        const venue=url.searchParams.get('venue')==='bybit'?'bybit':'okx';
        const endpoint=venue==='okx'?'https://www.okx.com/api/v5/market/candles?instId='+ (asset==='gold'?'XAU-USDT-SWAP':'BTC-USDT')+'&bar=15m&limit=300':'https://api.bybit.com/v5/market/kline?category='+ (asset==='gold'?'linear':'spot')+'&symbol='+(asset==='gold'?'XAUUSDT':'BTCUSDT')+'&interval=15&limit=300';
        const data=await json(endpoint);
        return Response.json({venue,asset,code:data.code??data.retCode,bars:data.data?.length??data.result?.list?.length,first:data.data?.[0]??data.result?.list?.[0]});
      }
      if (url.pathname === '/test-email') {
        await env.EMAIL.send({from:'alerts@yu-zora.com',to:env.EMAIL_TO,subject:'Multi-Analyzer｜Cloudflare移行テスト',text:'Cloudflareからの通知テストです。トレード推奨ではありません。\n公開チャート: https://yuzora-yu.github.io/Multi-Analyzer/',html:'<p>Cloudflareからの通知テストです。トレード推奨ではありません。</p><p><a href="https://yuzora-yu.github.io/Multi-Analyzer/">公開チャートを開く</a></p>'});
        return Response.json({emailAccepted:true});
      }
      if(url.pathname === '/probe-gold-trial') {
        const interval=url.searchParams.get('interval')||'15min'; if(!['15min','1h','4h'].includes(interval)) return new Response('Invalid interval',{status:400});
        if(!env.TWELVE_API_KEY) throw new Error('API key missing');
        const r=await json('https://api.twelvedata.com/time_series?'+new URLSearchParams({symbol:'XAU/USD',interval,outputsize:'300',timezone:'UTC',apikey:env.TWELVE_API_KEY}));
        return Response.json({status:r.status,code:r.code,message:r.message,meta:r.meta,bars:r.values?.length,latest:r.values?.[0]});
      }
      if(url.pathname === '/probe-ws') {
        const btc=url.searchParams.get('asset')==='btc';
        const endpoint=btc?'https://data-stream.binance.vision/ws/btcusdt@kline_15m':'https://fstream.binance.com/market/ws/xauusdt@kline_15m';
        const r=await fetch(endpoint,{headers:{Upgrade:'websocket'},signal:AbortSignal.timeout(12000)});
        if(!r.webSocket) throw new Error(`WebSocket HTTP ${r.status}`);
        const ws=r.webSocket; ws.accept();
        const result=await new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.close();reject(new Error('WebSocket timeout'));},7000);ws.addEventListener('message',e=>{clearTimeout(t);resolve(JSON.parse(e.data));ws.close();},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('WebSocket error'));},{once:true});});
        return Response.json({stream:result.s,price:result.k?.c,time:result.E});
      }
      if(url.pathname === '/analyze-fixture') {
        const reader=request.body.getReader(); let size=0; const chunks=[]; while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>400000) {await reader.cancel(); return new Response('Too large',{status:413});} chunks.push(value); } const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;} const raw=new TextDecoder().decode(bytes);
        const input=JSON.parse(raw); const a=Core.analyzeMarket(input.data,input.settings);
        console.log(JSON.stringify({fixture:true,state:a.state})); return Response.json({state:a.state});
      }
      if(url.pathname !== '/probe') return new Response('Not found',{status:404});
      const asset = url.searchParams.get('asset');
      if(!['gold','btc'].includes(asset)) return new Response('Invalid asset',{status:400});
      const market = asset === 'gold' ? 'futures' : 'spot';
      const base = market === 'futures' ? 'https://fapi.binance.com/fapi/v1' : 'https://data-api.binance.vision/api/v3';
      const symbol = asset === 'gold' ? 'XAUUSDT' : 'BTCUSDT';
      const [exec,h1,h4,ticker] = await Promise.all([...['15m','1h','4h'].map(async interval => (await json(`${base}/klines?symbol=${symbol}&interval=${interval}&limit=300`)).map(b=>({time:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}))), json(`${base}/ticker/bookTicker?symbol=${symbol}`)]);
      const bid=Number(ticker.bidPrice),ask=Number(ticker.askPrice);
      if(!(bid>0 && ask>=bid)) throw new Error('Invalid quote');
      const result=Core.analyzeMarket({exec,m15:exec,h1,h4},{now:Date.now(),executionMinutes:15,market,livePrice:(bid+ask)/2});
      console.log(JSON.stringify({probe:asset,state:result.state,colo:request.cf?.colo}));
      return Response.json({asset,state:result.state,bars:result.exec.candles.length,colo:request.cf?.colo});
    } catch(e) {
      console.log(JSON.stringify({probeError:String(e.message).slice(0,160)}));
      return Response.json({error:String(e.message).slice(0,160)},{status:502});
    }
  }
};

export class AnalysisProbe extends DurableObject {
  async run(path, method, authorization, body) {
    return handler.fetch(new Request('https://probe.internal'+path,{method,headers:{Authorization:authorization},body:method==='POST'?body:undefined}),this.env);
  }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    const auth=request.headers.get('Authorization')||'';
    const expected=`Bearer ${env.PROBE_TOKEN}`;
    if(!env.PROBE_TOKEN || Buffer.byteLength(auth)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(auth),Buffer.from(expected))) return new Response('Not found',{status:404});
    if(Number(request.headers.get('content-length')||0)>400000) return new Response('Too large',{status:413});
    const reader=request.body?.getReader(); let body='';
    if(reader) {let size=0;const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>400000){await reader.cancel();return new Response('Too large',{status:413});}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}
    return env.PROBE.getByName(url.searchParams.get('asset')==='btc'?'btc':'gold').run(url.pathname+url.search,request.method,auth,body);
  }
};
