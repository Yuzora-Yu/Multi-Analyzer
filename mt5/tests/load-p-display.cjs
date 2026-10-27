'use strict';
// Execute the pure MQL ledger functions after syntax translation. No native UI claim.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(){
 const ctx=vm.createContext({ArraySize:a=>a.length,ArrayResize:(a,n)=>{a.length=n;},MathIsValidNumber:Number.isFinite});
 const source=fs.readFileSync(path.join(__dirname,'../MAPDisplayCore.mqh'),'utf8');
 for(const name of ['MAPDisplayEligible','MAPDisplayFind','MAPDisplayValid','MAPDisplayRemember']){
  const m=new RegExp('(?:bool|int) '+name+'\\(([^)]*)\\) \\{').exec(source);if(!m)throw Error(name);
  const start=m.index+m[0].length;let end=start,depth=1;
  while(depth){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;if(end>source.length)throw Error('Unbalanced MQL');}
  const args=m[1].split(',').map(s=>s.match(/([A-Za-z_]\w*)(?:\[\])?$/)[1]);
  const body=source.slice(start,end-1).replace(/\b(?:const\s+)?(?:int|bool|datetime)\s+/g,'let ')
   .replace(/records\[i-1\]=records\[i\];/g,'records[i-1]={...records[i]};').replace(/records\[n\]=r;/g,'records[n]={...r};');
  vm.runInContext(`function ${name}(${args.join(',')}){${body}}`,ctx);
 }
 return {eligible:ctx.MAPDisplayEligible,find:ctx.MAPDisplayFind,valid:ctx.MAPDisplayValid,remember:ctx.MAPDisplayRemember};
}
module.exports={load};
