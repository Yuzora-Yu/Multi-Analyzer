const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {load}=require('../mt5/tests/load-history.cjs');
const H=load(),monday=Date.parse('2026-10-19T00:00:00Z')/1000;
const rates=times=>times.map(time=>({time}));
function sessions(){const s=[];for(let day=1;day<=5;day++)H.MAAppendSession(s,day,3600,86340);return s;}
test('empty session placeholders cannot turn weekends into 24-hour trading',()=>{
 const s=[];assert.equal(H.MAAppendSession(s,0,0,0),false);assert.equal(s.length,0);
 assert.equal(H.MAAppendSession(s,1,0,86400),true);
 assert.equal(H.MAHistorySessionOverlap(monday,monday+1,s),true);
 assert.equal(H.MAHistorySessionOverlap(monday+86400,monday+86401,s),false);
});
test('overnight sessions belong to their starting weekday and have an exclusive close',()=>{
 const s=[];H.MAAppendSession(s,5,22*3600,2*3600);
 const saturday=monday+5*86400;
 assert.equal(H.MAHistorySessionOverlap(saturday+3600,saturday+3660,s),true);
 assert.equal(H.MAHistorySessionOverlap(saturday+7200,saturday+7260,s),false);
 assert.equal(H.MAHistorySessionOverlap(monday+4*86400+3600,monday+4*86400+3660,s),false);
});
test('normal daily breaks and weekends preserve the original history seed',()=>{
 const s=sessions(),friday=monday-3*86400;
 const times=[friday+23*3600+45*60];
 for(let t=monday+3600;t<monday+86400;t+=900)times.push(t);
 times.push(monday+86400+3600);const c=rates(times);
 assert.equal(H.MARecentHistoryStart(c,900,s),0);
});
test('an unexplained gap restarts at the last gap instead of contaminating the suffix',()=>{
 const s=sessions();const c=rates([3600,4500,6300,7200,9900,10800].map(t=>monday+t));
 assert.equal(H.MARecentHistoryStart(c,900,s),4);
 assert.deepEqual(c.slice(4).map(x=>x.time),[monday+9900,monday+10800]);
 assert.equal(c.length,6,'source candles must not be filled or modified');
});
test('overlapping bars stay invalid even when a later gap exists',()=>{
 assert.equal(H.MARecentHistoryStart(rates([monday+3600,monday+4200,monday+9900]),900,sessions()),-1);
});
test('sub-minute interval overlap matches an independent minute-session oracle',()=>{
 const s=sessions();H.MAAppendSession(s,5,23*3600,2*3600);
 const open=t=>{for(let offset=0;offset<=1;offset++){const day=Math.floor(t/86400)*86400-offset*86400,w=new Date(day*1000).getUTCDay();for(const x of s)if(x.weekday===w&&t>=day+x.start&&t<day+x.stop)return true;}return false;};
 for(let i=0;i<180;i++){const start=monday+(i*7193)%(7*86400),end=start+1+(i*37)%301;
  let expected=false;for(let t=start;t<end;t++)if(open(t)){expected=true;break;}
  assert.equal(H.MAHistorySessionOverlap(start,end,s),expected,`interval ${i}`);
 }
});
test('indicator keeps frame availability separate from P warmup and other frames',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../mt5/MultiAnalyzerGold.mq5'),'utf8');
 assert.match(source,/const int minimum=60/);
 assert.match(source,/int painted=RenderCandidates\(\)/);
 assert(!/if\(!ok\)\s*\{ArrayResize\(candidates,0\)/.test(source));
 assert.match(source,/historySeedStart=NativeHistoryStart/);
 assert.match(source,/ArrayCopy\(raw,lastRawRates\)/);
 assert.match(source,/derivedAvailable/);
 const core=fs.readFileSync(path.join(__dirname,'../mt5/MAFlowCore.mqh'),'utf8');
 assert.match(core,/bars>=220/,'new P warmup must not be lowered');
});
test('native lower-frame evidence must bracket a disputed gap without contradicting it',()=>{
 const from=monday+86400,to=from+3600;
 assert.equal(H.MAHistoryWitnessStatus(rates([from-60,to,to+60]),from,to,3600),1);
 assert.equal(H.MAHistoryWitnessStatus(rates([from-60,from+120,to]),from,to,3600),-1);
 assert.equal(H.MAHistoryWitnessStatus(rates([to]),from,to,3600),0);
 assert.equal(H.MAHistoryWitnessStatus(rates([from-7200,to]),from,to,3600),0);
 assert.equal(H.MAHistoryWitnessStatus([],from,to,3600),0);
});
