const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../marker-details'),E=require('../chart-evidence');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const time=Date.parse('2026-10-16T00:00:00Z');
const candle={time,open:100,high:102,low:99,close:101};
const marker=(text,position='aboveBar')=>({time:time/1000,text,position,shape:'circle',color:'#ffd44a'});
const input=()=>({markers:[marker('買 EXIT注意')],candles:[{...candle}],intervalMinutes:1,analysisAt:time+60000,asset:'gold',symbol:'XAUUSDT',market:'futures',state:'NO_TRADE'});

test('marker identity uses the matching candle close, correct market and explicit entry separation',()=>{
 const source=input(),before=structuredClone(source),r=D.describe(source);
 assert.equal(r.records[0].closeAt,time+60000);assert.match(r.records[0].option,/09:01:00/);assert.match(r.context,/XAUUSDT 無期限先物 \/ 1分足/);
 assert.match(r.current,/新規条件待ち.*NO_TRADE/);assert.match(r.records[0].meaning,/買い側のEXIT/);assert.match(r.records[0].meaning,/売り入口の成立ではありません/);assert.deepEqual(source,before);
 const short=D.meaning(marker('売 EXIT注意','belowBar'));assert.match(short.text,/下側.*売り側のEXIT/);assert.match(short.text,/買い入口の成立ではありません/);
});
test('unknown, missing, duplicated, malformed and unfinished candles never acquire a fabricated close time',()=>{
 const cases=[{candles:[]},{candles:[candle,candle]},{intervalMinutes:null},{intervalMinutes:0},{analysisAt:undefined},{analysisAt:time+59999},{candles:[{...candle,close:103}]},{markers:[{...marker('買 EXIT注意'),time:'bad'}]}];
 for(const patch of cases){const r=D.describe({...input(),...patch}).records[0];assert.equal(r.closeAt,null);assert.match(r.option,/確定不明/);assert.match(r.timing,/推定しません/);}
});
test('suppressed chart text remains recoverable from originals and historical P is not full execution permission',()=>{
 const original=[marker('買 EXIT注意'),{...marker('方向転換 売 B'),time:time/1000+1},marker('P 押し目条件','belowBar')],before=structuredClone(original);
 const laidOut=E.viewportLabels(original,()=>100,320,()=>100);assert.equal(laidOut[0].text,'');
 const result=D.describe({...input(),markers:original});assert.ok(result.records.some(r=>r.label==='買 EXIT注意'));
 const p=result.records.find(r=>r.kind==='P_HISTORY');assert.match(p.meaning,/費用・RR・ブラックアウト/);assert.match(p.meaning,/通過や、注文・約定を証明しません/);assert.deepEqual(original,before);
 const candidate=D.meaning(marker('売り候補'));assert.equal(candidate.kind,'CURRENT_CANDIDATE');assert.match(candidate.text,/金色丸/);assert.match(candidate.text,/過去のPや青いEXIT丸とは別/);
});
test('explanations do not guess meaning from marker color and preserve frame disagreement',()=>{
 assert.equal(D.meaning(marker('')).kind,'UNKNOWN');assert.equal(D.meaning(marker('unknown')).kind,'UNKNOWN');
 assert.match(D.meaning(marker('リボン ↓')).text,/EMA5とEMA144/);assert.match(D.meaning(marker('方向転換 売 B')).text,/保持方向/);
 for(const text of ['BOS','CHoCH','SWEEP'])assert.match(D.meaning(marker(text,'belowBar')).text,/上向き/);
 assert.match(D.describe({...input(),mode:'csv'}).context,/CSV（銘柄・契約未確認）/);assert.match(D.describe({...input(),mode:'archive'}).context,/保存記録/);
 assert.match(D.describe({...input(),asset:'btc',symbol:'XAUUSDT'}).context,/銘柄・契約未確認/);
 assert.match(D.describe({...input(),intervalMinutes:240,analysisAt:time+14400000,blocked:true,actionable:true}).current,/判断保留/);
});

test('profile provenance uses the actual candle window and distinguishes price from volume',()=>{
 const source={...input(),candles:[{...candle},{...candle,time:time+60000}],analysisAt:time+120000,
  profile:{method:'OHLCV_RANGE_APPROXIMATION',start:time,end:time+60000,poc:100.25,val:99,vah:102,bins:[{},{}]}};
 const before=structuredClone(source),r=D.describe(source);
 assert.match(r.profile,/Bybit XAUUSDT 無期限先物/);assert.match(r.profile,/直近2本・2区間/);assert.match(r.profile,/09:00:00.*09:02:00/);
 assert.match(r.profile,/POC 100\.25 は価格/);assert.match(r.profile,/実際の価格別約定分布ではありません/);assert.deepEqual(source,before);
 assert.match(D.describe({...source,mode:'csv'}).profile,/CSV（銘柄・契約未確認）/);
 for(const patch of [{profile:null},{analysisAt:time+119999},{profile:{...source.profile,method:'UNKNOWN'}},{profile:{...source.profile,start:time-60000}}])assert.match(D.describe({...source,...patch}).profile,/確認できません/);
});

test('actual app detail renderer withholds a stale live candidate but preserves the dated archive and CSV',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),source=app.slice(app.indexOf('  function renderMarkerDetails()'),app.indexOf('  function renderChartMarkerLabels()'));
 const a={generatedAt:time+60000,state:'LONG',actionable:true,exec:{candles:[candle],intervalMinutes:1,quality:{stale:false}}};
 for(const mode of ['live','archive','csv']){
  const views=[],state={instrumentId:'gold',analysis:a,chartMarkers:[marker('買い候補')],feedAt:time,offlineCsv:mode==='csv'};
  const before=structuredClone(state),clock=class extends Date{static now(){return time+90000;}};
  const run=vm.runInNewContext(source+';renderMarkerDetails',{state,markerPanel:{render:v=>views.push(v)},window:{MultiAnalyzerMarkerDetails:D},currentInstrument:()=>({symbol:'XAUUSDT',market:'futures'}),INITIAL_PARAMS:new Set(mode==='archive'?['snapshot']:[]),snapshotHealth:()=>null,Date:clock});
  run();assert.match(views[0].current,mode==='live'?/判断保留/:/研究用の新規候補/);assert.deepEqual(state,before);
 }
});
