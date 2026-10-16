const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Feed=require('../market-feed.js');
const {archiveTargets,archivePlan}=require('../research-observer.cjs');
const S=900000;
test('archive recovery captures boundary drift gap beyond latest four without rewriting known IDs',()=>{
 const known=Array.from({length:8},(_,i)=>i*S);
 assert.deepEqual(archiveTargets(12*S,known),[12,11,10,9,8].map(i=>i*S));
 assert.deepEqual(archiveTargets(12*S,[...known,8*S,9*S,10*S,11*S,12*S]),[]);
});
test('archive requests stay within24 retained bars and initial collection remains four',()=>{
 assert.deepEqual(archiveTargets(40*S,[]),[40,39,38,37].map(i=>i*S));
 const targets=archiveTargets(40*S,[0]);assert.equal(targets.length,24);assert.equal(targets.at(-1),17*S);
});
test('Gold reopening requests only missing open-session decisions and records the twenty scheduled exclusions',()=>{
 const last=Date.UTC(2026,9,11,22,45),known=[Date.UTC(2026,9,9,14)],before=[...known];
 const plan=archivePlan('gold',last,known);
 assert.deepEqual(plan.targets,[last,last-S,last-2*S,last-3*S]);assert.equal(plan.excluded.length,20);
 assert.ok(plan.excluded.every(x=>x.decisionAt===x.barOpenedAt+S+1));
 assert.equal(plan.excluded.filter(x=>x.reason==='GOLD_MARKET_CLOSED').length,19);
 assert.equal(plan.excluded[0].reason,'NO_EXPECTED_MARKET_BAR');
 assert.deepEqual(known,before);
 // Received IDs stay known; the schedule is not a replacement missing-price label.
 const observed=archivePlan('gold',last,[...known,last,last-S,last-2*S,last-3*S]);
 assert.deepEqual(observed.targets,[]);assert.equal(observed.excluded.length,20);
});
test('Gold daily pause and JST weekend are assessed at the decision close rather than its preceding open',()=>{
 const reopen=Date.UTC(2026,9,12,22,0),daily=archivePlan('gold',reopen,[]);
 assert.deepEqual(daily.targets,[reopen]);assert.equal(daily.excluded.length,3);
 const fridayLast=Date.UTC(2026,9,9,15),weekend=archivePlan('gold',fridayLast,[]);
 assert.deepEqual(weekend.targets,[fridayLast,fridayLast-2*S,fridayLast-3*S]);
 assert.equal(weekend.excluded[0].barOpenedAt,Date.UTC(2026,9,9,14,45));
 // A genuinely received latest snapshot is retained even across that boundary.
 const received=archivePlan('gold',Date.UTC(2026,9,9,14,45),[]);
 assert.equal(received.targets[0],Date.UTC(2026,9,9,14,45));
});
test('missing expected Gold decisions and every BTC decision retain recovery requests, including winter NY sessions',()=>{
 const monday=Date.UTC(2026,9,12,3),known=[monday-8*S];
 assert.deepEqual(archivePlan('gold',monday,known).targets,archiveTargets(monday,known));
 assert.deepEqual(archivePlan('btc',Date.UTC(2026,9,11,22,45),known).targets,archiveTargets(Date.UTC(2026,9,11,22,45),known));
 assert.deepEqual(archivePlan('btc',monday,known).excluded,[]);
 const winter=Date.UTC(2026,10,8,23,45),plan=archivePlan('gold',winter,[Date.UTC(2026,10,6,14)]);
 assert.deepEqual(plan.targets,[winter,winter-S,winter-2*S,winter-3*S]);assert.equal(plan.excluded.length,20);
 assert.throws(()=>archivePlan('unknown',monday,known),/Unsupported/);
});
test('offline collector execution omits scheduled requests, preserves an open-market 404 and creates no replacement samples',async()=>{
 const last=Date.UTC(2026,9,11,22,45),wall=last+S+55000,root=path.resolve('virtual-observer'),dir=path.join(root,'.runtime','hourly-observation','cohort-v1');
 const source=(asset,time)=>({id:`${asset}-${time}-4.3.4`,asset,version:'4.3.4',createdAt:time+S+4500,symbol:Feed.instruments[asset].symbol,
  settings:{now:time+S+1,market:Feed.instruments[asset].market},bars:{m15:[[time,100,101,99,100,10]],h1:[],h4:[]}});
 const old=source('gold',Date.UTC(2026,9,9,14)),oldFile=path.join(dir,'snapshots',old.id+'.json'),oldBytes=JSON.stringify({firstObservedAt:old.createdAt+100,snapshot:old});
 const stoppedBTC={id:'btc-stopped-original',asset:'btc',bar:last,actionable:false,liveObservation:true};
 const stoppedOutcome={id:stoppedBTC.id,asset:'btc',outcomes:[1,4,8,16].map(horizon=>({horizon,status:'pending-or-missing',stoppedSentinel:true}))};
 const files=new Map([[oldFile,oldBytes],[path.join(dir,'samples.jsonl'),JSON.stringify(stoppedBTC)+'\n'],[path.join(dir,'outcomes.json'),JSON.stringify([stoppedOutcome])]]),requests=[],missing=`gold-${last-S}-4.3.4`;
 const fakeFs={mkdirSync(){},existsSync:f=>files.has(f),readFileSync:f=>{assert.ok(files.has(f),'unexpected read');return files.get(f);},
  readdirSync:d=>[...files.keys()].filter(f=>path.dirname(f)===d).map(f=>path.basename(f)),
  writeFileSync(f,data,options){if(options?.flag==='wx')assert.equal(files.has(f),false);files.set(f,data);}};
 const core={VERSION:'4.3.4',analyzeMarket(input){return {exec:{candles:input.exec,flow:{latest:{}},values:{atr:1},quality:{}},h1:{},h4:{}};}};
 const mod={exports:{}},requireMock=name=>name==='node:fs'?fakeFs:name==='node:path'?path:name==='./strategy-core'?core:name==='./market-feed'?{...Feed,collectionPolicy:(asset,now=wall)=>Feed.collectionPolicy(asset,now)}:assert.fail('unexpected dependency '+name);
 requireMock.main=mod;
 const Clock=class extends Date{constructor(...args){super(...(args.length?args:[wall]));}static now(){return wall;}};
 const summary=await new Promise((resolve,reject)=>{
  vm.runInNewContext(fs.readFileSync(require.resolve('../research-observer.cjs'),'utf8'),{require:requireMock,module:mod,__dirname:root,process:{argv:[]},Date:Clock,AbortSignal,
   fetch:async url=>{const u=new URL(url),asset=u.searchParams.get('asset'),id=u.searchParams.get('id');requests.push({asset,id});
    return {ok:id!==missing,status:id===missing?404:200,json:async()=>source(asset,id?Number(id.split('-')[1]):last)};},
   console:{log:s=>resolve(JSON.parse(s)),error:reject}});
 });
 assert.equal(requests.length,4);assert.equal(requests.filter(r=>r.asset==='gold').length,4);assert.ok(requests.every(r=>r.asset==='gold'));
 assert.deepEqual(summary.errors,[{id:missing,error:'HTTP 404'}]);assert.equal(summary.archivePolicy.excluded.length,20);
 assert.equal(files.get(oldFile),oldBytes);assert.equal(summary.samples,5);
 const samples=files.get(path.join(dir,'samples.jsonl')).trim().split('\n').map(JSON.parse);
 assert.ok(summary.archivePolicy.excluded.every(x=>!samples.some(s=>s.id===x.id)));
 assert.ok(!samples.some(s=>s.id===missing));
 assert.deepEqual(samples.find(s=>s.id===stoppedBTC.id),stoppedBTC);
 const outcomes=JSON.parse(files.get(path.join(dir,'outcomes.json')));
 assert.deepEqual(outcomes.find(r=>r.id===stoppedBTC.id),stoppedOutcome);
 assert.ok(outcomes.find(r=>r.id===`gold-${last-2*S}-4.3.4`).outcomes.every(o=>o.status==='pending-or-missing'));
 assert.ok(outcomes.find(r=>r.id===old.id).outcomes.every(o=>o.status==='pending-or-missing'));
});
