(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerFeed=api;})(globalThis,function(){
  'use strict';
  const instruments={gold:{symbol:'XAUUSDT',category:'linear',market:'futures'},btc:{symbol:'BTCUSDT',category:'spot',market:'spot'}};
  const SESSION_VERSION='gold-session-v2';
  const nyClock=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',hourCycle:'h23'});
  function marketOpen(asset,time){
    if(asset!=='gold')return true;
    if(!Number.isFinite(Number(time)))return false;
    const p=Object.fromEntries(nyClock.formatToParts(new Date(Number(time))).map(x=>[x.type,x.value]));
    const h=Number(p.hour);
    return p.weekday!=='Sat' && !(p.weekday==='Fri'&&h>=17) && !(p.weekday==='Sun'&&h<18) && h!==17;
  }
  function collectionPolicy(asset,now=Date.now()){
    const d=new Date(now+9*3600000).getUTCDay();
    const allowed=asset!=='gold'||(d!==0&&d!==6&&marketOpen(asset,now));
    return {allowed,rule:asset==='gold'?'GOLD_MARKET_SESSION':'ALWAYS',timezone:'America/New_York',reason:allowed?null:'GOLD_MARKET_CLOSED',version:SESSION_VERSION};
  }
  function barExpected(asset,time,minutes){
    if(asset!=='gold')return true;
    for(let t=time;t<time+minutes*60000;t+=Math.min(minutes,60)*60000)if(marketOpen(asset,t))return true;
    return false;
  }
  function aggregate(rows,minutes){
    const bins=new Map(),duration=minutes*60000;
    for(const b of rows){
      // A daily GOLD session starts at NY 18:00, avoiding a synthetic Sunday daily bar.
      const h=minutes===1440?Number(nyClock.formatToParts(new Date(b.time)).find(p=>p.type==='hour').value):0;
      const anchor=minutes===1440?((18-h+new Date(b.time).getUTCHours()+24)%24)*3600000:0;
      const time=Math.floor((b.time-anchor)/duration)*duration+anchor,c=bins.get(time);
      if(c){c.high=Math.max(c.high,b.high);c.low=Math.min(c.low,b.low);c.close=b.close;c.volume+=b.volume;}
      else bins.set(time,{...b,time});
    }
    return [...bins.values()];
  }
  async function load(asset,minutes,limit=300,get,end,now=Date.now()){
    if(!collectionPolicy(asset,now).allowed)throw new Error('GOLD_MARKET_CLOSED');
    if(asset!=='gold')return parse(await get(url(asset,minutes,limit,end)));
    const base=minutes>=60?60:minutes,rows=new Map();let cursor=end,previous=Infinity;
    const maxPages=Math.ceil(limit*minutes/base*1.6/1000)+3;
    for(let page=0;page<maxPages;page++){
      if(!collectionPolicy(asset,Date.now()).allowed)throw new Error('GOLD_MARKET_CLOSED');
      const batch=parse(await get(url(asset,base,1000,cursor)));
      if(!collectionPolicy(asset,Date.now()).allowed)throw new Error('GOLD_MARKET_CLOSED');
      if(!batch.length||batch[0].time>=previous)break;
      previous=batch[0].time;cursor=previous-1;
      for(const b of batch)if(marketOpen(asset,b.time))rows.set(b.time,b);
      const result=aggregate([...rows.values()].sort((a,b)=>a.time-b.time),minutes);
      if(result.length>=limit)return result.slice(-limit);
    }
    return aggregate([...rows.values()].sort((a,b)=>a.time-b.time),minutes).slice(-limit);
  }
  function url(asset,minutes,limit=300,end){
    const cfg=instruments[asset];if(!cfg||![1,5,15,60,240,1440].includes(minutes))throw new Error('Invalid market');
    return 'https://api.bybit.com/v5/market/kline?'+new URLSearchParams({category:cfg.category,symbol:cfg.symbol,interval:minutes===1440?'D':String(minutes),limit:String(limit),...(end?{end:String(end)}:{})});
  }
  function parse(raw){
    if(raw.retCode!==0||!Array.isArray(raw.result?.list))throw new Error('Invalid Bybit candles');
    return raw.result.list.map(b=>({time:+b[0],open:+b[1],high:+b[2],low:+b[3],close:+b[4],volume:+b[5]})).sort((a,b)=>a.time-b.time);
  }
  function pack(rows){return rows.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume]);}
  function unpack(rows){return rows.map(b=>({time:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));}
  function input(snapshot){const exec=unpack(snapshot.bars.m15);return {exec,m15:exec,h1:unpack(snapshot.bars.h1),h4:unpack(snapshot.bars.h4)};}
  return {instruments,url,parse,pack,unpack,input,marketOpen,collectionPolicy,barExpected,load,SESSION_VERSION};
});
