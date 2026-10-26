'use strict';
// Syntax-only execution of actual pure/adapter MQL bodies with synthetic terminal
// values. Does not verify native broker distribution or run a trading terminal.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function load(){
 const names=['SYMBOL_COMMISSION_ENTRY_INOUT','SYMBOL_COMMISSION_ENTRY_IN','SYMBOL_COMMISSION_ENTRY_OUT','SYMBOL_COMMISSION_DIRECTION_BOTH','SYMBOL_COMMISSION_DIRECTION_BUY','SYMBOL_COMMISSION_DIRECTION_SELL','SYMBOL_COMMISSION_CHARGE_INSTANT','SYMBOL_COMMISSION_CHARGE_DAILY','SYMBOL_COMMISSION_PROFIT_ALL','SYMBOL_COMMISSION_PROFIT_PROFIT','SYMBOL_COMMISSION_DISABLED','SYMBOL_COMMISSION_PERCENT','SYMBOL_COMMISSION_PIPS','SYMBOL_COMMISSION_MONEY_SYMBOL_PROFIT','SYMBOL_COMMISSION_MONEY_SYMBOL_BASE','SYMBOL_COMMISSION_MONEY_SPECIFIED','SYMBOL_COMMISSION_MONEY_DEPOSIT','SYMBOL_COMMISSION_VOLUME_TYPE_VOLUME','SYMBOL_COMMISSION_VOLUME_TYPE_TURNOVER','SYMBOL_COMMISSION_VOLUME_TYPE_TRADE','SYMBOL_CALC_MODE_FOREX','SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE','SYMBOL_CALC_MODE_CFD','SYMBOL_CALC_MODE_CFDLEVERAGE','SYMBOL_CALC_MODE_EXCH_STOCKS','SYMBOL_TRADE_CONTRACT_SIZE','SYMBOL_CURRENCY_BASE','SYMBOL_CURRENCY_PROFIT','SYMBOL_TRADE_CALC_MODE'];
 const ctx=vm.createContext({Object,Number,JSON,MathMax:Math.max,MathMin:Math.min,MathAbs:Math.abs,MathPow:Math.pow,MathFloor:Math.floor,MathIsValidNumber:Number.isFinite,EMPTY_VALUE:Number.MAX_VALUE,DBL_MAX:Number.MAX_VALUE,
  ArraySize:a=>a.length,ArrayResize:(a,n)=>{while(a.length<n)a.push({});a.length=n;},
  StringLen:s=>s.length,StringGetCharacter:(s,i)=>s.charCodeAt(i),StringSubstr:(s,i,n)=>s.slice(i,i+n),StringFormat:(_,v)=>v.toString(16).toUpperCase().padStart(4,'0'),IntegerToString:String,DoubleToString:(v,n)=>v.toFixed(n),
  ZeroMemory:o=>{Object.assign(o,{ready:false,direction:0,entry:0,stop:0,tp1:0,tp2:0,tp3:0,risk:0,totalCost:0,costRiskRatio:0,netRR:0,valid:false,costOK:false,pCandidate:false,spreadPrice:0,commissionPrice:0,totalPrice:0,bps:0,basis:'',reason:'',commissionObservedAt:0,observedAt:0});},
  MA_BROKER_AUTO:0,MA_FIXED_BPS:1,PCostMode:0,AssumedRoundTripCostBps:7,MinimumNetRR:1.8,_Point:.01,_Digits:2,_Symbol:'GOLD',brokerCommissionCount:0,brokerCommissionRules:[],brokerCommissionObservedAt:1000,costMemos:[]});
 names.push('SYMBOL_TRADE_TICK_SIZE');names.forEach((name,i)=>ctx[name]=i+10);
 ctx.clock=1000;ctx.TimeTradeServer=()=>ctx.clock;
 ctx.tick={bid:4000,ask:4000.5,time:1000};ctx.SymbolInfoTick=(_,t)=>{Object.assign(t,ctx.tick);return true;};
 ctx.SymbolInfoDouble=()=>100;ctx.SymbolInfoString=(_,prop)=>prop===ctx.SYMBOL_CURRENCY_BASE?'XAU':'USD';ctx.SymbolInfoInteger=()=>ctx.SYMBOL_CALC_MODE_FOREX;
 for(const [file,funcs] of [
  ['MAInstrumentCore.mqh',['MAPlanDigits','MAJsonEscape','MASpreadBps']],
  ['MABrokerCost.mqh',['MACostMemoCompare','MACostNumber','MACostParts','MACommissionLegs','MACommissionTierPrice','MABrokerRecord','MALinearProfitMode']],
  ['MAFlowCore.mqh',['MARound','MAMakePlan']],
  ['MultiAnalyzerGold.mq5',['PruneCostMemos','BrokerCost','SignalCost','CostedPlan','JNumber','JBool','CostJson']]
 ]){
  const source=fs.readFileSync(path.join(root,file),'utf8');
  for(const name of funcs){
   const m=new RegExp('(?:void|int|double|bool|string|MACostRecord|MAPlan) '+name+'\\(([^)]*)\\) \\{').exec(source);if(!m)throw Error('Missing '+name);
   let start=m.index+m[0].length,end=start,depth=1;while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;if(end>source.length)throw Error('Unbalanced '+name);}
   const types='const|int|long|double|bool|string|datetime|MqlRates|MAFlowRow|MqlCommissionTier|MqlCommission|MACostMemo|MACostRecord';
   const args=m[1].split(',').map(s=>s.replace(new RegExp('\\b(?:'+types+')\\b|&|\\[\\]','g'),'').trim());
   let body=source.slice(start,end-1).replace(/\b(?:MACostRecord|MACostMemo|MqlTick|MAPlan) (\w+);/g,'let $1={};')
    .replace(/\b(?:const\s+)?(?:int|long|double|bool|string|ushort|datetime|MACostRecord|MACostMemo|MAPlan)\s+/g,'let ').replace(/\((?:int|long|double|ushort)\)/g,'')
    .replace('let mid=(lo+hi)/2;','let mid=MathFloor((lo+hi)/2);');
   vm.runInContext(`function ${name}(${args.join(',')}){${body}}`,ctx);
  }
 }
 return ctx;
}
module.exports={load};
