'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Archive=require('../research-git-store.cjs'),Ledger=require('../demo-archive-ledger.cjs');
const Demo=require('../demo-trading.cjs'),Review=require('../demo-review.cjs'),Version=require('../demo-version.cjs');
const D=Demo.BAR,T=Date.UTC(2026,9,9),CODE=Version.identity().hash,V='4.3.4';
const ORIGINAL_PAGE_READER=Archive.readExactPages;
function fixture(t,{asset='btc',waitCount=0,paged=false}={}) {
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'multi-analyzer-ledger-test-'));
 t.after(()=>{assert.ok(path.resolve(workspace).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(workspace,{recursive:true,force:true});});
 const root=path.join(workspace,'.runtime/demo-lab'),records=[],sources=new Map();let lab;
 const candle=(time,patch={})=>({time,open:100,high:102,low:98,close:100,volume:10,...patch});
 function step(at,patch={}) {
   const tf=minutes=>({ready:true,intervalMinutes:minutes,quality:{stale:false,gaps:0},
     candles:[candle(Math.floor((at-minutes*60000)/(minutes*60000))*minutes*60000)],
     values:{adx:15,emaSlope:0},trend:'range',structure:{trend:'range'},smc:{zones:[]},swings:{highs:[],lows:[]}});
   const exec={...tf(15),candles:[candle(at-2*D),candle(at-D,patch)],
     values:{close:patch.close??100,atr:2,adx:21,atrRank:.5,ema20:99,ema50:99,bbUpper:110,bbLower:90},
     series:{bb:{mid:[100,100],lower:[90,90],upper:[110,110]}},
     flow:{latest:{direction:0,ribbon:0,setup:{ready:true}},lines:{13:[99,99],21:[98,98]}},smc:{zones:[],events:[]}};
   const analysis={version:V,exec,h1:tf(60),h4:tf(240),marketMap:{valid:true,candidates:[],eventRisk:{blocked:false}},
     htfBias:'neutral',actionable:!waitCount,direction:'LONG',state:waitCount?'NO_TRADE':'READY_LONG',plan:{stop:95,tp2:115,orderType:'LIMIT_RETEST'}};
   const pack=rows=>rows.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume]);
   const source={id:`${asset}-${at-D}-${V}`,asset,symbol:asset==='gold'?'XAUUSDT':'BTCUSDT',version:V,createdAt:at+10000,
     settings:{market:asset==='gold'?'futures':'spot',now:at+1},bars:{m15:pack(exec.candles),h1:pack(analysis.h1.candles),h4:pack(analysis.h4.candles)}};
   function persist(result) {
     lab=result.lab;if(!result.record)return;
     const payload={...result.record,sequence:lab.sequence+1,previousHash:lab.chain,codeHash:CODE,
       protocol:structuredClone(lab.protocol),asset:lab.asset,market:lab.market,symbol:lab.symbol,sourceHash:Review.hash(source)};
     lab.sequence=payload.sequence;lab.chain=Review.hash(payload);lab.codeHash=CODE;
     records.push({...payload,hash:lab.chain});sources.set(source.id,structuredClone(source));
   }
   persist(Demo.advance(lab,source,analysis,at+20000));persist(Demo.acknowledge(lab,source.id,at+21000));
 }
 if(waitCount)for(let i=0;i<waitCount;i++)step(T+i*D);
 else {step(T-D);step(T);step(T+2*D,{open:100,high:116,low:94,close:108});}
 const auditAt=T+(waitCount+4)*D,view=Demo.publicView(lab,auditAt);
 function save(relative,payload) {
   const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});
   fs.writeFileSync(file,JSON.stringify({firstRetrievedAt:auditAt-1,payloadHash:Review.hash(payload),original:payload}));
 }
 const prefix=`ledger-cache/${asset}/demo-v1`;
 save(`${prefix}/views/${String(view.sequence).padStart(10,'0')}-${Review.hash(view)}.json`,view);
 for(const r of records)save(`${prefix}/journal/${String(r.sequence).padStart(10,'0')}.json`,r);
 for(const s of sources.values())save(`${prefix}/sources/${Review.hash(s.id)}.json`,s);
 const plan=(paged?Ledger.buildPagedPlan:Ledger.buildPlan)({workspace,asset,sequence:view.sequence,auditAt});
 return {workspace,root,plan,view,records,sources,auditAt};
}
function mockReader(t,x,transform=values=>values) {
 const original=Archive.readExactSet;t.after(()=>{Archive.readExactSet=original;});
 let calls=0;
 Archive.readExactSet=async options=>{calls++;return {verifiedRef:'a'.repeat(40),catalogManifests:1,catalogBytes:500,
   packFetches:1,fetchedPackBytes:1000,returnedBytes:10000,datasetCopiesWritten:0,gitWrites:0,
   values:transform(options.inputs.map(i=>({...i,data:fs.readFileSync(path.join(x.root,i.relative))})))};};
 return ()=>calls;
}
test('full archived ledger audit reproduces forward publication, fixed exit and cost sensitivity without restored inputs',async t=>{
 const x=fixture(t);mockReader(t,x);
 const result=await Ledger.replay(x.plan,{expectedPlanHash:Review.hash(x.plan)});
 assert.deepEqual(result.audit,Review.audit(x.view,x.records,x.sources,{now:x.auditAt}));
 assert.equal(result.audit.valid,true);assert.equal(result.audit.books[3].counts.closed,1);
 assert.equal(result.audit.books[3].validation.statistics,null);assert.equal(result.audit.books[3].lifetime,null);
 assert.ok(result.audit.books[3].warmup.byCost[7].assumedNetPnl>result.audit.books[3].warmup.byCost[21].assumedNetPnl);
 assert.equal(result.datasetCopiesWritten,0);assert.equal(result.gitWrites,0);
 assert.equal(fs.existsSync(path.join(x.workspace,'.runtime/git-data-store/restored')),false);
 assert.match(result.scope,/Not a new prediction/);
});
test('roster requires exact version and past audit time before any remote access',async t=>{
 const x=fixture(t),calls=mockReader(t,x);
 await assert.rejects(Ledger.replay(x.plan,{expectedPlanHash:'a'.repeat(64)}),/PLAN_HASH_MISMATCH/);
 for(const mutate of [p=>{p.auditAt=Date.now()+86400000;},p=>{p.journal[0].sequence=2;},p=>{p.sources[0].asset='gold';},p=>{p.codeHash='b'.repeat(64);}]) {
   const p=structuredClone(x.plan);mutate(p);await assert.rejects(Ledger.replay(p,{expectedPlanHash:Review.hash(p)}));
 }
 assert.equal(calls(),0);
});
test('partial or reordered remote inputs cannot become a valid ledger report',async t=>{
 const x=fixture(t);mockReader(t,x,v=>v.slice(1));
 await assert.rejects(Ledger.replay(x.plan,{expectedPlanHash:Review.hash(x.plan)}),/INPUT_SET_INCOMPLETE/);
 Archive.readExactSet=async options=>({values:options.inputs.map(i=>({...i,data:fs.readFileSync(path.join(x.root,i.relative))})).reverse()});
 await assert.rejects(Ledger.replay(x.plan,{expectedPlanHash:Review.hash(x.plan)}),/INPUT_ORDER_MISMATCH/);
});
test('exact rehashed bytes cannot conceal a changed chain or source binding',async t=>{
 const x=fixture(t),p=structuredClone(x.plan);mockReader(t,x);
 const target=path.join(x.root,Ledger.requests(p)[1].relative),saved=JSON.parse(fs.readFileSync(target));
 saved.original.previousHash='b'.repeat(64);saved.payloadHash=Review.hash(saved.original);
 const bytes=Buffer.from(JSON.stringify(saved));fs.writeFileSync(target,bytes);
 p.journal[0].payloadHash=saved.payloadHash;p.journal[0].originalSha256=Archive.sha256(bytes);
 await assert.rejects(Ledger.replay(p,{expectedPlanHash:Review.hash(p)}),/ARCHIVE_LEDGER_AUDIT_FAILED/);
});

function mockPageReader(t,x,mutate=values=>values,{lateFailure=false,afterPages=()=>{}}={}) {
 t.after(()=>{Archive.readExactPages=ORIGINAL_PAGE_READER;});let calls=0;
 Archive.readExactPages=async options=>{
  calls++;const values=options.inputs.map((i,inputIndex)=>({...i,inputIndex,data:fs.readFileSync(path.join(x.root,i.relative))}));
  const order=mutate(values).toReversed();let pages=0;
  for(let i=0;i<order.length;i+=13){await options.onPage(order.slice(i,i+13));pages++;}
  if(lateFailure)throw Error('LATE_PACK_OR_PRIVACY_FAILURE');
  afterPages();
  return {verifiedRef:'a'.repeat(40),verifiedInputs:values.length,pagesRead:pages,pageInputLimit:16,pageByteLimit:4*1024*1024,
   catalogManifests:1,catalogBytes:500,packFetches:1,fetchedPackBytes:1000,returnedBytes:values.reduce((n,v)=>n+v.data.length,0),datasetCopiesWritten:0,gitWrites:0};
 };return ()=>calls;
}

test('paged Gold ledger reproduces a prefix beyond the legacy1024-input ceiling without changing fixed audit rules',async t=>{
 const x=fixture(t,{asset:'gold',waitCount:519,paged:true});mockPageReader(t,x);
 assert.equal(x.plan.schemaVersion,2);assert.ok(Ledger.requests(x.plan).length>1024);
 assert.throws(()=>Ledger.buildPlan({workspace:x.workspace,asset:'gold',sequence:x.view.sequence,auditAt:x.auditAt}),/INPUT_COUNT_EXCEEDED/);
 const result=await Ledger.replayPaged(x.plan,{expectedPlanHash:Review.hash(x.plan)});
 assert.deepEqual(result.audit,Review.audit(x.view,x.records,x.sources,{now:x.auditAt}));
 assert.equal(result.mode,'ARCHIVE_PAGED_LEDGER_RECONSTRUCTION');assert.equal(result.audit.valid,true);
 assert.equal(result.audit.validationState,'WITHHELD_UNTIL_FIXED_END');assert.equal(result.audit.books[0].lifetime,null);
 assert.equal(result.datasetCopiesWritten,0);assert.equal(result.gitWrites,0);assert.ok(result.pagesRead>64);
 assert.equal(fs.existsSync(path.join(x.workspace,'.runtime/git-data-store/restored')),false);
});

test('page reorder, duplicate, omission and late failure cannot publish a partial audit',async t=>{
 const x=fixture(t,{asset:'gold',paged:true}),audit=Review.audit;let audits=0;
 Review.audit=(...args)=>{audits++;return audit(...args);};t.after(()=>{Review.audit=audit;});
 for(const mutate of [v=>v.slice(1),v=>[...v,v[0]],v=>v.map((x,i)=>i===0?{...x,inputIndex:-1}:x),
  v=>v.map((x,i)=>i===0?{...x,relative:'wrong.json'}:x)]){
  mockPageReader(t,x,mutate);await assert.rejects(Ledger.replayPaged(x.plan,{expectedPlanHash:Review.hash(x.plan)}));
 }
 mockPageReader(t,x,v=>v,{lateFailure:true});
 await assert.rejects(Ledger.replayPaged(x.plan,{expectedPlanHash:Review.hash(x.plan)}),/LATE_PACK_OR_PRIVACY_FAILURE/);
 const expected=Review.hash(x.plan);mockPageReader(t,x,v=>v,{afterPages:()=>{x.plan.auditAt--;}});
 await assert.rejects(Ledger.replayPaged(x.plan,{expectedPlanHash:expected}),/PLAN_HASH_MISMATCH/);
 assert.equal(audits,0);
});

test('paged and legacy rosters cannot silently select the other read mode, and a changed chain still fails audit',async t=>{
 const x=fixture(t,{asset:'gold',paged:true}),calls=mockPageReader(t,x);
 await assert.rejects(Ledger.replay(x.plan,{expectedPlanHash:Review.hash(x.plan)}),/READ_MODE_INVALID/);
 const legacy={...x.plan,schemaVersion:1,kind:'LATER_EXACT_LEDGER_INPUT_ROSTER'};delete legacy.readMode;
 await assert.rejects(Ledger.replayPaged(legacy,{expectedPlanHash:Review.hash(legacy)}),/READ_MODE_INVALID/);assert.equal(calls(),0);
 const p=structuredClone(x.plan),file=path.join(x.root,Ledger.requests(p)[1].relative),saved=JSON.parse(fs.readFileSync(file));
 saved.original.previousHash='b'.repeat(64);saved.payloadHash=Review.hash(saved.original);
 const bytes=Buffer.from(JSON.stringify(saved));fs.writeFileSync(file,bytes);p.journal[0].payloadHash=saved.payloadHash;p.journal[0].originalSha256=Archive.sha256(bytes);
 await assert.rejects(Ledger.replayPaged(p,{expectedPlanHash:Review.hash(p)}),/ARCHIVE_LEDGER_AUDIT_FAILED/);
});
