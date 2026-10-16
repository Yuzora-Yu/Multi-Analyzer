const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Forward=require('../research-forward.cjs'),Gold=require('../research-forward-gold.cjs');
test('Gold route preserves frozen calculation and never reads stopped BTC predictions',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-gold-scope-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const now=Date.now(),r={id:'gold-scope',specId:Forward.SPEC.id,generatedAt:now,transport:{receivedAt:now},latestInfoEventAt:0,cutoff:1,asset:'gold',market:'linear',symbol:'XAUUSDT',entryAt:Math.ceil((now+120000)/900000)*900000,clockBounds:{valid:true,upperOffsetMs:0},issues:[],prediction:{state:'NO_TRADE'}};
 Forward.persist(root,r);const asOf=Date.now()+1,expected=Forward.evaluate(root,[],asOf);
 fs.mkdirSync(path.join(root,'predictions','btc-stopped'));fs.writeFileSync(path.join(root,'predictions','btc-stopped','prediction.json'),'invalid stopped record must never be read');
 assert.deepEqual(Gold.evaluateGold(root,[],asOf),expected);assert.equal(Gold.evaluateGold(root,[],asOf)[0].asset,'gold');
});
test('microstructure capture requests Gold only and rejects BTC before networking',async t=>{
 const capture=require('../market-observation.cjs').capture,Feed=require('../market-feed');let urls=[];const fetchBefore=global.fetch,policy=Feed.collectionPolicy;
 t.after(()=>{global.fetch=fetchBefore;Feed.collectionPolicy=policy});Feed.collectionPolicy=()=>({allowed:true});
 global.fetch=async url=>{urls.push(String(url));return {ok:true,json:async()=>({retCode:0,time:Date.now(),result:{list:[]}})}};
 const result=await capture();assert.deepEqual(Object.keys(result.assets),['gold']);assert.equal(urls.length,2);assert.ok(urls.every(u=>new URL(u).searchParams.get('symbol')==='XAUUSDT'));
 urls=[];await assert.rejects(capture({assets:['btc']}),/Only Gold/);assert.equal(urls.length,0);
});
