const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const P=require('../mt5/tests/load-p-display.cjs').load();
const row=(source=36000,seconds=3600,delay=0)=>({source,confirmed:source+seconds,observedServer:source+seconds+delay+2,observedUTC:source+seconds+delay+2-7200,displayBar:source+seconds+delay,side:-1,sourcePrice:4018.8,displayPrice:3993.4,delayed:delay>0});
test('P source, confirmation and first-render candle differ; never timestamp startup history as live',()=>{
 const baseline=36000;
 assert.equal(P.eligible(32400,3600,baseline,36002,36000,-1),false);
 assert.equal(P.eligible(36000,3600,baseline,39599,36000,-1),false);
 assert.equal(P.eligible(36000,3600,baseline,39602,39600,-1),true);
 assert.equal(P.eligible(36000,3600,baseline,43202,43200,-1),true); // later appearance is recorded at the later bar
 assert.equal(P.eligible(36000,3600,0,39602,39600,-1),false);
 for(const seconds of [60,300])assert.equal(P.eligible(36000,seconds,36000,39602,39600,-1),false);
});
test('unmapped future bars, missing bars and stale server clocks cannot make a display record',()=>{
 assert.equal(P.eligible(36000,3600,36000,39602,43200,-1),false);
 assert.equal(P.eligible(36000,3600,36000,43202,39600,-1),false);
 assert.equal(P.eligible(36000,3600,36000,39602,0,-1),false);
 assert.equal(P.eligible(36000,3600,36000,39602,39600,0),false);
 const bad=row();bad.displayBar=36000;assert.equal(P.valid(bad,3600),false);
});
test('redraws, revised prices, disappearance and reappearance never move the first record',()=>{
 const records=[],first=row();assert.equal(P.remember(records,first,3600,256),true);
 const changed={...row(36000,3600,3600),sourcePrice:4020,displayPrice:3980};
 assert.equal(P.remember(records,changed,3600,256),false);assert.deepEqual(JSON.parse(JSON.stringify(records)),[first]);
 first.sourcePrice=1;assert.equal(records[0].sourcePrice,4018.8); // record owns its first anchor
 assert.equal(P.find(records,36000,-1),0);assert.equal(P.find(records,36000,1),-1);
});
test('bounded record replay retains first broker/UTC stamps and rejects malformed timestamps',()=>{
 const records=[];for(let i=0;i<260;i++)assert(P.remember(records,row(36000+i*3600),3600,256));
 assert.equal(records.length,256);assert.equal(records[0].source,50400);
 const restored=[];for(const r of JSON.parse(JSON.stringify(records)))assert(P.remember(restored,r,3600,256));
 assert.deepEqual(restored,records);assert.equal(P.remember(restored,{...row(records.at(-1).source),observedServer:9999999},3600,256),false);
 for(const patch of [{confirmed:0},{observedUTC:0},{side:0},{sourcePrice:NaN},{displayPrice:-1},{observedServer:1},{delayed:true}])assert.equal(P.valid({...row(),...patch},3600),false);
 assert.equal(P.valid(row(36000,3600,7200),3600),true);
});
test('native integration gates actual display, preserves source signals and exports a distinct observation ledger',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../mt5/MultiAnalyzerGold.mq5'),'utf8');
 assert.match(s,/if\(!showSignals\|\|!chartAvailable\|\|MQLInfoInteger\(MQL_TESTER\)/);
 assert.match(s,/if\(p\.pCandidate\) \{if\(r\.direction>0\) pBuy\[i\]=b\.low-r\.atr\*\.2;else pSell\[i\]=b\.high\+r\.atr\*\.2;RecordPDisplay\(b,r\);\}/);
 assert.match(s,/entry\.observedUTC=TimeGMT\(\)/);assert.match(s,/entry\.observedServer=now/);
 assert.match(s,/FileMove\(temp,0,pDisplayFile,FILE_REWRITE\)/);assert.match(s,/pDisplayStoreWritable=false/);
 assert.match(s,/SavePDisplayTrace\(\);FileWriteString\(file,"\],\\"pDisplayTrace/);
 assert.match(s,/Button\("pDisplay","P表示足"/);assert.match(s,/OBJPROP_RAY_RIGHT,false/);
 assert.match(s,/pDisplayBaseline=chartRates\[ArraySize\(chartRates\)-1\]\.time\+PeriodSeconds\(\)/);
});
