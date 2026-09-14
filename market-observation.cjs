/* Recent trade samples are not a continuous order-flow feed. Research only. */
const Feed=require('./market-feed');
function summarizeTrades(rows,symbol){
  const seen=new Set(),trades=[];
  for(const r of rows){
    const price=Number(r.price),size=Number(r.size),time=Number(r.time);
    if(r.symbol!==symbol||!r.execId||seen.has(r.execId)||!['Buy','Sell'].includes(r.side)||!(price>0)||!(size>0)||!Number.isFinite(time)||time<=0||!Number.isFinite(price*size))continue;
    seen.add(r.execId);trades.push({...r,price,size,time});
  }
  trades.sort((a,b)=>a.time-b.time);
  let buy=0,sell=0;for(const r of trades){if(r.side==='Buy')buy+=r.price*r.size;else sell+=r.price*r.size;}
  return {count:trades.length,rejectedOrDuplicate:rows.length-trades.length,start:trades[0]?.time??null,end:trades.at(-1)?.time??null,
    durationSeconds:trades.length?(trades.at(-1).time-trades[0].time)/1000:null,buyNotionalUSDT:buy,sellNotionalUSDT:sell,
    imbalance:buy+sell?(buy-sell)/(buy+sell):null,
    largestPrintUSDT:trades.length?Math.max(...trades.map(r=>r.price*r.size)):null,
    scope:'Returned recent trades only; variable-duration sample, not continuous CVD, not a full candle or global volume.'};
}
function quoteMetrics(t){
  const value=k=>t[k]!==''&&t[k]!=null&&Number.isFinite(Number(t[k]))?Number(t[k]):null;
  const bid=value('bid1Price'),ask=value('ask1Price');
  return {bid,ask,spreadBps:bid>0&&ask>=bid?(ask-bid)/((ask+bid)/2)*10000:null,mark:value('markPrice'),index:value('indexPrice'),fundingRate:value('fundingRate'),nextFundingTime:value('nextFundingTime'),openInterest:value('openInterest')};
}
async function capture(){
  const observation={observedAt:Date.now(),assets:{},errors:[],purpose:'Analysis-only. Not used by live alerts.'};
  for(const [asset,cfg] of Object.entries(Feed.instruments)){
    const query=new URLSearchParams({category:cfg.category,symbol:cfg.symbol});
    async function get(endpoint,extra=''){const response=await fetch(`https://api.bybit.com/v5/market/${endpoint}?${query}${extra}`,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('HTTP '+response.status);const raw=await response.json();if(raw.retCode!==0||!Array.isArray(raw.result?.list))throw Error('Invalid Bybit result');return raw;}
    const result=await Promise.allSettled([get('recent-trade','&limit='+(cfg.category==='spot'?60:1000)),get('tickers')]);
    const item={symbol:cfg.symbol,category:cfg.category};
    if(result[0].status==='fulfilled'){item.tradeResponse=result[0].value;item.sample=summarizeTrades(item.tradeResponse.result.list,cfg.symbol);}else observation.errors.push({asset,type:'trades',error:result[0].reason.message});
    if(result[1].status==='fulfilled'){item.quoteResponse=result[1].value;const t=item.quoteResponse.result.list.find(r=>r.symbol===cfg.symbol);if(t)item.quote=quoteMetrics(t);else observation.errors.push({asset,type:'quote',error:'symbol missing'});}else observation.errors.push({asset,type:'quote',error:result[1].reason.message});
    item.receivedAt=Date.now();observation.assets[asset]=item;
  }
  return observation;
}
module.exports={capture,summarizeTrades,quoteMetrics};
