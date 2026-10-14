'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Review=require('../review-pack'),Core=require('../strategy-core'),Feed=require('../market-feed');
const error={asset:'gold',tf:'4h',error:'Invalid Bybit candles'};
const request=(overrides={})=>({id:0,asset:'gold',tf:'4h',status:'received',httpStatus:200,bybitCode:10006,
  url:'https://api.bybit.com/v5/market/kline?category=linear&symbol=XAUUSDT&interval=240',...overrides});
const pack=(requests,uses=[])=>({capturedAt:1000,assets:[],errors:[error],acquisition:{requests,uses}});

test('a received Bybit rejection remains missing and its recorded response reaches the AI text without extra requests',async(t)=>{
  const cutoff=Date.UTC(2026,9,14,5),rows=m=>Array.from({length:301},(_,i)=>({time:cutoff+(i-300)*m*60000,open:100,high:102,low:99,close:101,volume:50}));
  const snapshot={id:'btc-response-test',asset:'btc',version:Core.VERSION,settings:{...Core.DEFAULTS,now:cutoff,executionMinutes:15,market:'spot'},
    bars:{m15:Feed.pack(rows(15).slice(0,300)),h1:Feed.pack(rows(60).slice(0,300)),h4:Feed.pack(rows(240).slice(0,300))}};
  global.MultiAnalyzerCore=Core;global.MultiAnalyzerFeed=Feed;t.mock.method(Date,'now',()=>cutoff);
  const urls=[];t.mock.method(global,'fetch',async url=>{
    urls.push(url);if(url.includes('/api/snapshot'))return{ok:true,status:200,json:async()=>structuredClone(snapshot)};
    const interval=new URL(url).searchParams.get('interval');
    return{ok:true,status:200,headers:{get:()=>null},json:async()=>interval==='240'?{retCode:10006,result:{list:[]}}:
      {retCode:0,result:{list:Feed.pack(rows(interval==='D'?1440:+interval)).reverse()}}};
  });
  const before=JSON.stringify(snapshot),p=await Review.collect(['btc'],{archivedId:snapshot.id}),saved=JSON.stringify(p),count=urls.length;
  assert.equal(count,6);assert.equal(p.records.length,5);assert.equal(p.records.some(r=>r.tf==='4h'),false);
  assert.deepEqual(p.errors,[{asset:'btc',tf:'4h',error:'Invalid Bybit candles'}]);
  assert.match(Review.acquisitionErrorText(p,p.errors[0]),/HTTP 200.*Bybit応答 10006.*制限ヘッダー未取得/);
  assert.match(Review.prompt(p),/未取得 btc\/4h.*Bybit応答 10006/);
  assert.equal(urls.length,count);assert.equal(JSON.stringify(p),saved);assert.equal(JSON.stringify(snapshot),before);
  assert.deepEqual(p.records.find(r=>r.tf==='15m').signal,Core.analyzeMarket(Feed.input(snapshot),snapshot.settings));
});

test('HTTP success and Bybit zero do not claim valid candles; missing and corrupt metadata never become zero quota',()=>{
  const p=pack([request({bybitCode:0,rateLimit:{limit:'secret',remaining:NaN,scope:'secret metadata'}})]),before=JSON.stringify(p);
  const text=Review.acquisitionErrorText(p,error);
  assert.match(text,/Invalid Bybit candles.*HTTP 200.*Bybit応答 0.*制限ヘッダー未取得/);
  assert.doesNotMatch(text,/成功|正常|残数 0|secret|https:/);assert.equal(JSON.stringify(p),before);
  assert.equal(Review.acquisitionFailure(pack([request({httpStatus:'200',bybitCode:'10006'})]),error),null);
  assert.match(Review.acquisitionErrorText({errors:[error]},error),/応答詳細未記録/);
});

test('reused responses retain their earlier frame and quota facts without inventing a new acquisition',()=>{
  const p=pack([request({tf:'1h',bybitCode:0,rateLimit:{limit:100,remaining:0}})],
    [{asset:'gold',tf:'4h',requestId:0,reused:true}]),before=JSON.stringify(p);
  const evidence=Review.acquisitionFailure(p,error),text=Review.acquisitionErrorText(p,error);
  assert.equal(evidence.reused,true);assert.equal(evidence.requestId,0);assert.match(text,/残数 0.*適用範囲未確認.*再利用応答/);
  assert.equal(JSON.stringify(p),before);
  const inconsistent=Review.acquisitionErrorText(pack([request({rateLimit:{limit:100,remaining:200}})]),error);
  assert.match(inconsistent,/制限ヘッダー不整合/);
});

test('unrelated markets and credential-bearing or foreign URLs cannot supply Bybit response details',()=>{
  const unrelated=pack([request({asset:'btc'})],[{asset:'gold',tf:'4h',requestId:0,reused:true}]);
  assert.equal(Review.acquisitionFailure(unrelated,error),null);
  for(const url of ['https://user:secret@api.bybit.com/v5/market/kline','https://api.bybit.com.example.test/v5/market/kline']){
    const text=Review.acquisitionErrorText(pack([request({url,rateLimit:{limit:1,remaining:0}})]),error);
    assert.match(text,/HTTP 200/);assert.doesNotMatch(text,/Bybit応答|制限ヘッダー|secret|https:/);
  }
  assert.equal(Review.acquisitionErrorText({}, {asset:'gold',tf:'all',error:'GOLD休場・データ取得停止'}),'gold/all GOLD休場・データ取得停止');
});
