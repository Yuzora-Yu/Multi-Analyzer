'use strict';
// Syntax-only execution of pure MQL functions. Not native chart/API verification.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(){
 const empty=Number.MAX_VALUE,ctx=vm.createContext({MathAbs:Math.abs,MathMax:Math.max,MathMin:Math.min,MathIsValidNumber:Number.isFinite,EMPTY_VALUE:empty,
  ArraySize:a=>a.length,ArrayResize:(a,n)=>{while(a.length<n)a.push({});a.length=n;},ZeroMemory:o=>{for(const k of ['side','phase','index','pressure','held','ribbon','reference','pad','brokenAt','changedAt','expiresAt','time','closedAt'])o[k]=0;},
  MAValid:c=>c.length>=60&&c.every((b,i)=>[b.time,b.open,b.high,b.low,b.close].every(Number.isFinite)&&b.low>0&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&(!i||b.time>c[i-1].time))});
 for(const [file,names] of [['MAZoneCore.mqh',['MAPivot']],['MAResponseCore.mqh',['MAResponse']],['MAVisualCore.mqh',['MACloudPair','MAExitRange','MAExitGroupable','MARetiredEligible','MAZoneFrameVisible','MAActiveZoneEligible','MAContextZoneSelection','MALabelFits']]]){
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  for(const name of names){
   const m=new RegExp('(?:void|bool) '+name+'\\(([^)]*)\\) \\{').exec(source);if(!m)throw Error('Pure function missing: '+name);
   const start=m.index+m[0].length;let end=start,depth=1;while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;if(end>source.length)throw Error('Unbalanced source');}
   const args=m[1].split(',').map(s=>s.match(/([A-Za-z_]\w*)(?:\[\])?$/)?.[1]);
   let body=source.slice(start,end-1).replace(/MAResponseRow state;/,'let state={};').replace(/\b(?:const\s+)?(?:int|bool|double|datetime)\s+/g,'let ').replace(/\(double\)/g,'').replace(/out\[i\]=state;/,'out[i]={...state};');
   if(name==='MACloudPair')body=body.replace(/return;/g,'return [first,second];')+'\nreturn [first,second];';
   vm.runInContext(`function ${name}(${args.join(',')}){${body}}`,ctx);
  }
 }
 return {response:(c,r,s)=>{const out=[];ctx.MAResponse(c,r,s,out);return JSON.parse(JSON.stringify(out));},cloud:(a,b,s)=>Array.from(ctx.MACloudPair(a,b,s)),range:ctx.MAExitRange,group:ctx.MAExitGroupable,retired:ctx.MARetiredEligible,frameVisible:ctx.MAZoneFrameVisible,labelFits:ctx.MALabelFits,activeEligible:ctx.MAActiveZoneEligible,contextZones:(zones,price,bottom,top)=>{const out=[];ctx.MAContextZoneSelection(...['seconds','kind','side','low','high','formed'].map(k=>zones.map(z=>z[k])),price,bottom,top,out);return Array.from(out);},empty};
}
module.exports={load};
