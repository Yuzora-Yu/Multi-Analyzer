const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../mt5');
// Execute actual pure MQL helper bodies with syntax-only translation. Native API
// integration is separately compiled; this is not broker/chart verification.
function pure(file,names){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const ctx=vm.createContext({MathMax:Math.max,MathMin:Math.min,MathAbs:Math.abs,MathPow:Math.pow,MathFloor:Math.floor,
  MathIsValidNumber:Number.isFinite,EMPTY_VALUE:Number.MAX_VALUE,StringLen:s=>s.length,StringGetCharacter:(s,i)=>s.charCodeAt(i),StringSubstr:(s,i,n)=>s.slice(i,i+n),
  StringFormat:(_,v)=>v.toString(16).toUpperCase().padStart(4,'0'),
  ZeroMemory:o=>{for(const k of ['direction','entry','stop','tp1','tp2','tp3','risk','totalCost','costRiskRatio','netRR'])o[k]=0;for(const k of ['valid','costOK','pCandidate'])o[k]=false;}});
 for(const name of names){
  const m=new RegExp('(?:int|string|double|MAPlan) '+name+'\\(([^)]*)\\) \\{').exec(source);assert(m,name);
  const start=m.index+m[0].length;let end=start,depth=1;
  // Braces within these function strings do not contain unmatched delimiters.
  while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;assert(end<=source.length);}
  const args=m[1].split(',').map(s=>s.replace(/\b(?:const|int|string|double|bool|MAFlowRow|MqlRates)\b|&/g,'').trim());
  const body=source.slice(start,end-1).replace(/MAPlan p;ZeroMemory\(p\);/,'let p={};ZeroMemory(p);')
   .replace(/\b(?:const\s+)?(?:int|double|string|ushort)\s+/g,'let ').replace(/\((?:int|double)\)/g,'');
  vm.runInContext(`function ${name}(${args.join(',')}){${body}}`,ctx);
 }
 return ctx;
}
const I=pure('MAInstrumentCore.mqh',['MAPlanDigits','MAFileSymbol','MAJsonEscape','MASpreadBps']);
const P=pure('MAFlowCore.mqh',['MARound','MAMakePlan']);
test('broker suffixes and symbol separators retain distinct safe export names',()=>{
 const symbols=['GOLD','BTCUSD','BTC/USD','BTCUSD#','USDJPY','USDJPY.','EURUSD','EURUSDmicro','a/b','a~002Fb','..\\USDJPY','ドル円'];
 const files=symbols.map(s=>I.MAFileSymbol(s));assert.equal(new Set(files).size,symbols.length);
 for(const f of files)assert.match(f,/^[A-Za-z0-9_~]+$/);
 assert.equal(I.MAFileSymbol('BTC/USD'),'BTC~002FUSD');assert.equal(I.MAFileSymbol('USDJPY'),'USDJPY');
 for(const s of [...symbols,'quote"slash\\\n\t\r\u0000'])assert.equal(JSON.parse('"'+I.MAJsonEscape(s)+'"'),s);
});
test('observed spread uses relative bps without guessing instrument commission',()=>{
 for(const [bid,ask,expected] of [[4000,4000.56,1.4],[150,150.015,1],[1.1,1.1001,0.909090909],[70000,70010,1.428571429]])
  assert(Math.abs(I.MASpreadBps(bid,ask)-expected)<1e-6);
 for(const [bid,ask] of [[0,1],[1,0],[NaN,2],[1,Infinity]])assert.equal(I.MASpreadBps(bid,ask),Number.MAX_VALUE);
});
test('Gold, BTC, yen and five/eight-digit FX preserve price scaling and explicit cost gates',()=>{
 for(const [price,atr,digits] of [[4000,10,2],[70000,180,2],[150,0.1,3],[1.1,0.001,5],[0.00001234,0.00000012,8]]){
  const r={direction:1,ready:true,atr,lastLow:price-atr,lastHigh:price+atr,pullbackConfirmed:true,adx:25};
  const d=I.MAPlanDigits(digits),plan=P.MAMakePlan({close:price},r,900,220,0.1,1.8,false,d);
  assert(plan.valid);assert(plan.pCandidate);assert(plan.stop<price);assert(plan.tp2>price);assert(plan.risk>0);
  assert(Math.abs(plan.entry-price)<=0.51*Math.pow(10,-d));
  const costly=P.MAMakePlan({close:price},r,900,220,100,1.8,false,d);assert.equal(costly.pCandidate,false);
  assert.equal(P.MAMakePlan({close:price},r,300,220,0.1,1.8,false,d).pCandidate,false);
  assert.equal(P.MAMakePlan({close:price},r,900,219,0.1,1.8,false,d).pCandidate,false);
  assert.equal(P.MAMakePlan({close:price},r,900,220,0.1,1.8,true,d).pCandidate,false);
  const old=P.MAMakePlan({close:price},r,900,220,7,1.8,false),precise=P.MAMakePlan({close:price},r,900,220,7,1.8,false,d);
  assert.equal(precise.pCandidate,old.pCandidate);assert.equal(precise.netRR,old.netRR);assert.equal(precise.costRiskRatio,old.costRiskRatio);
  if(digits<=6)assert.equal(JSON.stringify(precise),JSON.stringify(old),'existing Gold/FX price outputs stay identical');
 }
});
test('broker sessions determine FX and crypto availability without a hardcoded Gold calendar',()=>{
 const H=require('../mt5/tests/load-history.cjs').load(),s=[],monday=Date.parse('2026-10-26T00:00:00Z')/1000;
 for(let day=0;day<7;day++)H.MAAppendSession(s,day,0,86400);
 assert(H.MAHistorySessionOverlap(monday+6*86400,monday+6*86400+60,s));
 const fx=[];for(let day=1;day<=5;day++)H.MAAppendSession(fx,day,0,86400);
 assert.equal(H.MAHistorySessionOverlap(monday+6*86400,monday+6*86400+60,fx),false);
});
test('indicator uses the chart symbol, explicit precision and quote basis at every plan/export call site',()=>{
 const s=fs.readFileSync(path.join(root,'MultiAnalyzerGold.mq5'),'utf8');
 assert(!/StringFind\(symbol,"(?:GOLD|XAU)"/.test(s));assert.match(s,/INDICATOR_DIGITS,_Digits/);
 assert.match(s,/SYMBOL_CHART_MODE_LAST\?tick.last:tick.bid/);assert.match(s,/SYMBOL_TRADE_TICK_SIZE/);
 assert.match(s,/MAFileSymbol\(_Symbol\)/);assert.match(s,/MAJsonEscape\(_Symbol\)/);
 const calls=s.match(/MAMakePlan\([^\n]+/g);assert.equal(calls.length,2);
 for(const call of calls)assert(call.includes('MAPlanDigits(_Digits)'));
 assert.equal((s.match(/MAPlan p=CostedPlan\(/g)||[]).length,3);
 assert.match(s,/p=CostedPlan\(raw\[i\]/);
 for(const file of ['MAInstrumentCore.mqh','MABrokerCost.mqh','MultiAnalyzerGold.mq5'])assert(!/\b(?:OrderSend|SendMail|WebRequest|AccountInfo\w*|PositionGet\w*)\s*\(/.test(fs.readFileSync(path.join(root,file),'utf8')));
});
