(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerFeed=api;})(globalThis,function(){
  'use strict';
  const instruments={gold:{symbol:'XAUUSDT',category:'linear',market:'futures'},btc:{symbol:'BTCUSDT',category:'spot',market:'spot'}};
  function url(asset,minutes,limit=300,end){
    const cfg=instruments[asset];if(!cfg||![5,15,60,240].includes(minutes))throw new Error('Invalid market');
    return 'https://api.bybit.com/v5/market/kline?'+new URLSearchParams({category:cfg.category,symbol:cfg.symbol,interval:String(minutes),limit:String(limit),...(end?{end:String(end)}:{})});
  }
  function parse(raw){
    if(raw.retCode!==0||!Array.isArray(raw.result?.list))throw new Error('Invalid Bybit candles');
    return raw.result.list.map(b=>({time:+b[0],open:+b[1],high:+b[2],low:+b[3],close:+b[4],volume:+b[5]})).sort((a,b)=>a.time-b.time);
  }
  function pack(rows){return rows.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume]);}
  function unpack(rows){return rows.map(b=>({time:b[0],open:b[1],high:b[2],low:b[3],close:b[4],volume:b[5]}));}
  function input(snapshot){const exec=unpack(snapshot.bars.m15);return {exec,m15:exec,h1:unpack(snapshot.bars.h1),h4:unpack(snapshot.bars.h4)};}
  return {instruments,url,parse,pack,unpack,input};
});
