/* Parent-owned runner: preserves collector -> freeze -> explicit bridge order. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const FILES=['research-observer.cjs','research-forward.cjs','research-reference-bridge.cjs'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function atomic(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2),{flag:'wx'});fs.renameSync(file+'.tmp',file);}
function hashes(root){return Object.fromEntries(FILES.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));}
function frozenDirectories(result,root){
 if(!Array.isArray(result.frozen)||result.frozen.length>2)throw Error('Invalid freeze result');
 const parent=fs.realpathSync(path.join(root,'.runtime/hourly-observation/research-forward/predictions'));
 const seen=new Set();
 return result.frozen.map(row=>{
   if(typeof row.directory!=='string'||!row.directory)throw Error('Missing explicit frozen directory');
   const directory=fs.realpathSync(row.directory);
   if(path.dirname(directory)!==parent||seen.has(directory))throw Error('Unexpected or duplicate frozen directory');
   seen.add(directory);return directory;
 });
}
function execute({root,file,args,stdoutFile,stderrFile}){
 return new Promise((resolve,reject)=>{
   const out=fs.openSync(stdoutFile,'wx'),err=fs.openSync(stderrFile,'wx');
   const chunks=[];let bytes=0,overflow=false,spawnError=null;
   const child=spawn(process.execPath,[path.join(root,file),...args],{cwd:root,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',chunk=>{fs.writeSync(out,chunk);bytes+=chunk.length;if(bytes<=1048576)chunks.push(chunk);else overflow=true;});
   child.stderr.on('data',chunk=>fs.writeSync(err,chunk));
   child.on('error',error=>{spawnError=error;});
   child.on('close',(exitCode,signal)=>{fs.closeSync(out);fs.closeSync(err);if(spawnError)reject(spawnError);else resolve({exitCode,signal,stdout:Buffer.concat(chunks).toString('utf8'),overflow});});
 });
}
async function run({root=__dirname,executeStage=execute,now=Date.now,monotonic=()=>performance.now()}={}){
 root=path.resolve(root);
 const base=path.join(root,'.runtime/hourly-observation/research-ordered-run');fs.mkdirSync(base,{recursive:true});
 const lock=path.join(base,'active.lock'),id=now()+'-'+crypto.randomUUID(),directory=path.join(base,id);
 // Never reclaim a stale lock automatically: inspect process ownership first.
 const fd=fs.openSync(lock,'wx');
 let journal;
 try{
   fs.writeSync(fd,JSON.stringify({pid:process.pid,id,startedAt:now()}));fs.closeSync(fd);
   fs.mkdirSync(directory);
   journal={schema:1,id,startedAt:now(),codeSha256:hashes(root),runnerSha256:hash(fs.readFileSync(__filename)),stages:[],status:'running',order:'collector -> freeze -> explicit bridge',accuracyProven:false};
   const start=monotonic();
   async function stage(name,file,args){
     if(JSON.stringify(hashes(root))!==JSON.stringify(journal.codeSha256))throw Error('Stage code changed during ordered run');
     const item={name,file,args,startedAt:now(),stdoutFile:path.join(directory,name+'.stdout.log'),stderrFile:path.join(directory,name+'.stderr.log')};
     journal.stages.push(item);const tick=monotonic();
     try{
       const result=await executeStage({root,file,args,stdoutFile:item.stdoutFile,stderrFile:item.stderrFile});
       item.exitCode=result.exitCode;item.signal=result.signal??null;
       if(result.exitCode!==0||result.signal)throw Error(name+' process failed');
       if(result.overflow)throw Error(name+' result exceeded parse limit');
       return JSON.parse(result.stdout);
     }finally{item.completedAt=now();item.durationMs=monotonic()-tick;}
   }
   try{
     const collection=await stage('collector',FILES[0],['--multiframe']);
     journal.collectorReportedErrors={snapshots:collection.errors??null,multiframe:collection.multiframe?.errors??collection.multiframe?.error??null,microstructure:collection.microstructure?.errors??null};
     const freeze=await stage('freeze',FILES[1],[]);
     const directories=frozenDirectories(freeze,root);journal.frozenDirectories=directories;
     if(directories.length)await stage('bridge',FILES[2],directories);
     else journal.bridgeSkipped='No explicit frozen sources returned';
     if(JSON.stringify(hashes(root))!==JSON.stringify(journal.codeSha256))throw Error('Stage code changed during ordered run');
     journal.status='completed';
   }catch(error){journal.status='failed';journal.error=error.message;}
   journal.durationMs=monotonic()-start;journal.completedAt=now();
   const file=path.join(directory,'run.json');atomic(file,journal);return {file,...journal};
 }finally{try{fs.closeSync(fd);}catch{}fs.unlinkSync(lock);}
}
if(require.main===module)run().then(result=>{console.log(JSON.stringify({file:result.file,status:result.status,error:result.error,stages:result.stages.map(s=>({name:s.name,durationMs:s.durationMs,exitCode:s.exitCode}))},null,2));if(result.status!=='completed')process.exitCode=1;}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run,execute,frozenDirectories};
