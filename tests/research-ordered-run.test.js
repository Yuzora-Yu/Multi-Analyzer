const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const R=require('../research-ordered-run.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ordered-run-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const file of ['research-observer.cjs','research-forward.cjs','research-reference-bridge.cjs'])fs.writeFileSync(path.join(root,file),'// fixture');const parent=path.join(root,'.runtime/hourly-observation/research-forward/predictions');fs.mkdirSync(parent,{recursive:true});const directory=path.join(parent,'btc-original');fs.mkdirSync(directory);return {root,directory};}
test('one sequential run passes only actual freeze directories with monotonic durations and private journal',async t=>{
 const {root,directory}=fixture(t),calls=[];let tick=0,wall=10000;
 const r=await R.run({root,now:()=>wall--,monotonic:()=>tick,executeStage:async s=>{calls.push(s);tick+=10;return {exitCode:0,stdout:JSON.stringify(s.file==='research-forward.cjs'?{frozen:[{directory}]}:{ok:true})};}});
 assert.equal(r.status,'completed');assert.deepEqual(calls.map(s=>s.file),['research-observer.cjs','research-forward.cjs','research-reference-bridge.cjs']);assert.deepEqual(calls[0].args,['--multiframe']);assert.deepEqual(calls[2].args,[fs.realpathSync(directory)]);assert.equal(r.durationMs,30);assert.ok(r.stages.every(s=>s.durationMs===10));assert.equal(JSON.parse(fs.readFileSync(r.file)).accuracyProven,false);assert.ok(!fs.existsSync(path.join(root,'.runtime/hourly-observation/research-ordered-run/active.lock')));
});
test('stage exit, malformed JSON and changed code stop successors without retry and retain failure',async t=>{
 for(const mode of ['exit','json','changed']){const {root}=fixture(t);let calls=0;const r=await R.run({root,executeStage:async s=>{calls++;if(mode==='changed')fs.appendFileSync(path.join(root,'research-forward.cjs'),'changed');return {exitCode:mode==='exit'?1:0,stdout:mode==='json'?'invalid':'{}'};}});assert.equal(r.status,'failed');assert.equal(calls,1);assert.ok(fs.existsSync(r.file));}
});
test('empty freeze skips bridge; duplicate and out-of-root directories are rejected',async t=>{
 for(const mode of ['empty','duplicate','outside']){const {root,directory}=fixture(t),calls=[];const frozen=mode==='empty'?[]:mode==='duplicate'?[{directory},{directory}]:[{directory:root}];const r=await R.run({root,executeStage:async s=>{calls.push(s.file);return {exitCode:0,stdout:JSON.stringify(s.file==='research-forward.cjs'?{frozen}:{})};}});assert.equal(calls.length,2);assert.equal(r.status,mode==='empty'?'completed':'failed');}
});
test('exclusive lock rejects concurrent wrapper and never deletes another owner lock',async t=>{
 const {root}=fixture(t),base=path.join(root,'.runtime/hourly-observation/research-ordered-run');fs.mkdirSync(base);const lock=path.join(base,'active.lock');fs.writeFileSync(lock,'owner');await assert.rejects(R.run({root,executeStage:()=>{throw Error('must not execute');}}),/EEXIST/);assert.equal(fs.readFileSync(lock,'utf8'),'owner');
});
test('actual child runner preserves argv without a shell and captures stderr on process failure',async t=>{
 const {root}=fixture(t),file='offline-child.cjs',args=['literal $(no-shell)','space value'];fs.writeFileSync(path.join(root,file),'console.log(JSON.stringify(process.argv.slice(2))); console.error("fixture stderr"); process.exitCode=3;');const stdoutFile=path.join(root,'out.log'),stderrFile=path.join(root,'err.log');const r=await R.execute({root,file,args,stdoutFile,stderrFile});assert.equal(r.exitCode,3);assert.deepEqual(JSON.parse(r.stdout),args);assert.match(fs.readFileSync(stderrFile,'utf8'),/fixture stderr/);assert.equal(r.overflow,false);
});
test('actual offline child pipeline writes stage logs and preserves collector completion before freeze',async t=>{
 const {root,directory}=fixture(t);
 fs.writeFileSync(path.join(root,'research-observer.cjs'),'require("node:fs").writeFileSync("collector.done","complete"); console.log(JSON.stringify({errors:[{error:"fixture warning"}]}));');
 fs.writeFileSync(path.join(root,'research-forward.cjs'),'if(require("node:fs").readFileSync("collector.done","utf8")!=="complete")throw Error("order"); console.log(JSON.stringify({frozen:[{directory:'+JSON.stringify(directory)+'}]}));');
 fs.writeFileSync(path.join(root,'research-reference-bridge.cjs'),'console.log(JSON.stringify({explicit:process.argv.slice(2)}));');
 const r=await R.run({root});assert.equal(r.status,'completed');assert.equal(r.stages.length,3);assert.equal(r.collectorReportedErrors.snapshots[0].error,'fixture warning');assert.deepEqual(JSON.parse(fs.readFileSync(r.stages[2].stdoutFile)).explicit,[fs.realpathSync(directory)]);assert.ok(r.stages.every(s=>fs.existsSync(s.stdoutFile)&&fs.existsSync(s.stderrFile)));assert.ok(r.stages[1].startedAt>=r.stages[0].completedAt);assert.ok(r.stages[2].startedAt>=r.stages[1].completedAt);
});
