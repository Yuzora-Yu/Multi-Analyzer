/* Parent-only opt-in launcher; runs the existing ordered runner exactly once. */
'use strict';
const path=require('node:path'),{spawn}=require('node:child_process');
function launchOptions({root=__dirname,environment=process.env,node=process.execPath}={}){
 root=path.resolve(root);const preload=path.join(__dirname,'research-network-trace.cjs').replace(/\\/g,'/');
 if(/["\r\n]/.test(preload))throw Error('Invalid diagnostic preload path');
 return {node,args:[path.join(root,'research-ordered-run.cjs')],options:{cwd:root,shell:false,windowsHide:true,stdio:'inherit',env:{...environment,MULTI_ANALYZER_NETWORK_TRACE:'1',NODE_OPTIONS:[environment.NODE_OPTIONS||'','--require="'+preload+'"'].filter(Boolean).join(' ')}}};
}
function launch({spawnChild=spawn,...options}={}){
 const configured=launchOptions(options);
 return new Promise((resolve,reject)=>{
  const child=spawnChild(configured.node,configured.args,configured.options);let spawnError;
  child.once('error',error=>{spawnError=error;});
  child.once('close',(exitCode,signal)=>{if(spawnError)reject(spawnError);else resolve({exitCode,signal});});
 });
}
if(require.main===module)launch().then(r=>{process.exitCode=r.signal||r.exitCode===null?1:r.exitCode;}).catch(()=>{console.error('Diagnostic ordered launcher failed');process.exitCode=1;});
module.exports={launchOptions,launch};
