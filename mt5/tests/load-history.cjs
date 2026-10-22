'use strict';
// Execute the small pure MQL history functions after syntax-only translation.
// This checks branch/interval behavior, not native API calls or chart rendering.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function load(){
 const source=fs.readFileSync(path.join(__dirname,'../MAHistoryCore.mqh'),'utf8');
 const names=['MAAppendSession','MAHistorySessionOverlap','MARecentHistoryStart','MAHistoryWitnessStatus'];
 const context=vm.createContext({MathMax:Math.max,MathMin:Math.min,MathFloor:Math.floor,ArraySize:a=>a.length,
  ArrayResize:(a,n)=>{while(a.length<n)a.push({});a.length=n;}});
 for(const name of names){
  const match=new RegExp('(?:bool|int) '+name+'\\(([^)]*)\\) \\{').exec(source);
  if(!match)throw Error('History function not found: '+name);
  const start=match.index+match[0].length;let end=start,depth=1;
  while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  if(depth)throw Error('Unbalanced history source');
  const args=match[1].split(',').map(x=>x.match(/([A-Za-z_]\w*)(?:\[\])?$/)?.[1]);
  if(args.some(x=>!x))throw Error('Unsupported history parameter');
  const body=source.slice(start,end-1).replace(/\b(?:const\s+)?(?:int|long|datetime|double|bool)\s+/g,'let ')
   .replace(/\((?:int|long|datetime|double|bool)\)/g,'');
  vm.runInContext(`function ${name}(${args.join(',')}){${body}}`,context);
 }
 return Object.fromEntries(names.map(name=>[name,context[name]]));
}
module.exports={load};
