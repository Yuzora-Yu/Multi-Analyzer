const test=require('node:test'),assert=require('node:assert/strict'),dc=require('node:diagnostics_channel'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),{EventEmitter}=require('node:events');
const T=require('../research-network-trace.cjs'),L=require('../research-ordered-diagnostic.cjs');
function request(p='/api/snapshot?asset=gold&token=PRIVATE_SECRET&id=PRIVATE_SECRET'){return {origin:'https://multi-analyzer-monitor.rikai-829.workers.dev',path:p,method:'GET',headers:'PRIVATE_SECRET'};}
test('diagnostics retain only allowed endpoints and whitelisted error fields',()=>{
 assert.deepEqual(T.endpoint(request()),{origin:'https://multi-analyzer-monitor.rikai-829.workers.dev',path:'/api/snapshot',method:'GET',asset:'gold'});
 for(const r of [{...request(),method:'POST'},{...request(),origin:'https://private.example.com'},{...request(),origin:'https://user:PRIVATE_SECRET@api.bybit.com'},request('/arbitrary/PRIVATE_SECRET')])assert.equal(T.endpoint(r),null);
 const error=new TypeError('PRIVATE_SECRET',{cause:Object.assign(new Error('PRIVATE_SECRET'),{code:'ENOTFOUND',syscall:'getaddrinfo',address:'PRIVATE_SECRET',headers:'PRIVATE_SECRET'})});
 error.cause.cause=error;error.errors=[Object.assign(new Error('PRIVATE_SECRET'),{name:'PRIVATE_SECRET',code:'PRIVATE_SECRET'})];
 const evidence=T.errorEvidence(error);assert.equal(evidence.cause.code,'ENOTFOUND');assert.equal(evidence.cause.cause.truncated,true);assert.ok(!JSON.stringify(evidence).includes('PRIVATE_SECRET'));
 assert.equal(T.connection({hostname:'api.bybit.com',protocol:'https:',port:443}).association,'Connection event is not attributable to a specific request.');
 assert.equal(T.connection({hostname:'private.example.com',protocol:'https:'}),null);assert.equal(T.autoEnabled,false);
});
test('passive channel events preserve request, response, errors and fetch identity',()=>{
 const originalFetch=global.fetch,r=request(),before=structuredClone(r),error=Object.assign(new Error('PRIVATE_SECRET'),{code:'ECONNRESET'});let saved,tick=1;
 const s=T.start({exitHook:false,write:x=>{saved=structuredClone(x);return 'fixture';},now:()=>123,monotonic:()=>tick++});
 dc.channel('undici:request:create').publish({request:r});dc.channel('undici:request:headers').publish({request:r,response:{statusCode:503,headers:['PRIVATE_SECRET']}});dc.channel('undici:request:trailers').publish({request:r,trailers:['PRIVATE_SECRET']});dc.channel('undici:request:error').publish({request:r,error});
 dc.channel('undici:client:connectError').publish({connectParams:{hostname:'api.bybit.com',protocol:'https:',port:443},error});
 assert.deepEqual(r,before);assert.equal(global.fetch,originalFetch);assert.equal(s.stop().file,'fixture');assert.equal(saved.events[1].httpStatus,503);assert.equal(saved.errors[0].error.code,'ECONNRESET');assert.ok(saved.events.slice(0,4).every(x=>x.requestId===1));assert.equal(saved.events[4].requestId,undefined);assert.ok(!JSON.stringify(saved).includes('PRIVATE_SECRET'));
 const n=saved.events.length;dc.channel('undici:request:create').publish({request:request()});assert.equal(s.snapshot().events.length,n);
});
test('malformed subscribers and write errors never escape; truncation is explicit',()=>{
 const s=T.start({exitHook:false,limit:1,write:()=>{throw Error('sink unavailable');}}),r=request();
 dc.channel('undici:request:create').publish({request:r});dc.channel('undici:request:error').publish({request:r,error:Object.assign(new Error(),{code:'ECONNREFUSED'})});
 const bad=request();Object.defineProperty(bad,'path',{get(){throw Error('PRIVATE_SECRET');}});assert.doesNotThrow(()=>dc.channel('undici:request:create').publish({request:bad}));
 assert.equal(s.snapshot().observerErrors,1);assert.equal(s.snapshot().droppedEvents,1);assert.equal(s.snapshot().errors[0].error.code,'ECONNREFUSED');assert.equal(s.stop().writeFailed,true);assert.doesNotThrow(()=>s.stop());
});
test('actual native fetch status, body and rejection survive passive observation',async t=>{
 const server=http.createServer((req,res)=>{res.writeHead(503);res.end('original fixture body');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const port=server.address().port,s=T.start({allowLoopback:true,exitHook:false,write:()=>{}}),originalFetch=global.fetch;t.after(()=>s.stop());
 const response=await fetch('http://127.0.0.1:'+port+'/fixture?token=PRIVATE_SECRET');assert.equal(response.status,503);assert.equal(await response.text(),'original fixture body');
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 let actualError;try{await fetch('http://127.0.0.1:'+port+'/fixture',{signal:AbortSignal.timeout(1000)});}catch(e){actualError=e;}
 assert.ok(actualError instanceof TypeError);assert.equal(actualError.cause.code,'ECONNREFUSED');assert.equal(global.fetch,originalFetch);
 const rows=s.snapshot();assert.ok(rows.events.some(x=>x.httpStatus===503));assert.ok(rows.events.some(x=>x.kind==='request:trailers'));assert.ok(rows.errors.some(x=>x.error.code==='ECONNREFUSED'));assert.ok(!JSON.stringify(rows).includes('PRIVATE_SECRET'));
});
test('process exit writes a private atomic trace; preloading is disabled outside parent programs',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'passive-network-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const modulePath=path.resolve(__dirname,'../research-network-trace.cjs'),script=path.join(temp,'fixture.cjs'),logs=path.join(temp,'logs');
 fs.writeFileSync(script,'const T=require('+JSON.stringify(modulePath)+');const dc=require("node:diagnostics_channel");T.start({write:T.privateWriter('+JSON.stringify(logs)+')});dc.channel("undici:request:error").publish({request:{origin:"https://api.bybit.com",path:"/v5/market/time?secret=PRIVATE_SECRET",method:"GET"},error:Object.assign(new Error("PRIVATE_SECRET"),{code:"ENOTFOUND"})});');
 const result=spawnSync(process.execPath,[script],{encoding:'utf8'});assert.equal(result.status,0);assert.equal(result.stdout,'');assert.equal(result.stderr,'');const files=fs.readdirSync(logs);assert.equal(files.length,1);assert.ok(files[0].endsWith('.json'));const saved=JSON.parse(fs.readFileSync(path.join(logs,files[0])));assert.equal(saved.errors[0].error.code,'ENOTFOUND');assert.ok(!JSON.stringify(saved).includes('PRIVATE_SECRET'));
 const disabled=spawnSync(process.execPath,['--require',modulePath,'-e','console.log(require('+JSON.stringify(modulePath)+').autoEnabled)'],{encoding:'utf8',env:{...process.env,MULTI_ANALYZER_NETWORK_TRACE:'1'}});assert.equal(disabled.status,0);assert.equal(disabled.stdout.trim(),'false');
});

test('native abort and body failure remain original transport errors',async t=>{
 let headersSent;
 const headersReady=new Promise(resolve=>{headersSent=resolve;});
 const server=http.createServer((req,res)=>{
  if(req.url==='/body'){res.writeHead(200,{'content-length':'100'});res.write('partial');headersSent();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const s=T.start({allowLoopback:true,exitHook:false,write:()=>{}});
 t.after(()=>{s.stop();server.closeAllConnections();server.close();});
 const origin='http://127.0.0.1:'+server.address().port;
 const controller=new AbortController(),reason=new Error('original abort reason'),aborted=fetch(origin+'/wait',{signal:controller.signal});
 controller.abort(reason);await assert.rejects(aborted,e=>e===reason);
 const response=await fetch(origin+'/body');await headersReady;const body=response.text();
 server.closeAllConnections();await assert.rejects(body,e=>e instanceof TypeError&&e.cause.code==='UND_ERR_SOCKET');
 assert.ok(s.snapshot().errors.some(row=>row.error.code==='UND_ERR_SOCKET'));
});

test('optional preload setup failure cannot fail the parent program',()=>{
 const modulePath=path.resolve(__dirname,'../research-network-trace.cjs'),parentProgram=path.resolve(__dirname,'../research-ordered-run.cjs');
 const script='process.argv[1]='+JSON.stringify(parentProgram)+';const fs=require("node:fs"),read=fs.readFileSync;let moduleReads=0;fs.readFileSync=function(p,...args){if(p==='+JSON.stringify(modulePath)+'&&++moduleReads>1)throw Error("fixture instrumentation unavailable");return read.call(this,p,...args)};const t=require('+JSON.stringify(modulePath)+');console.log(JSON.stringify({enabled:t.autoEnabled,started:t.autoStarted,failed:t.autoStartFailed}));';
 const result=spawnSync(process.execPath,['-e',script],{encoding:'utf8',env:{...process.env,MULTI_ANALYZER_NETWORK_TRACE:'1'}});
 assert.equal(result.status,0);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),{enabled:true,started:false,failed:true});
});
test('launcher preserves inherited options and original runner argv, exits and one attempt',async()=>{
 const env={NODE_OPTIONS:'--stack-trace-limit=12',EXISTING:'untouched'},before=structuredClone(env),configured=L.launchOptions({environment:env});assert.deepEqual(env,before);assert.equal(configured.options.env.EXISTING,'untouched');assert.ok(configured.options.env.NODE_OPTIONS.startsWith('--stack-trace-limit=12 --require="'));assert.equal(configured.options.env.MULTI_ANALYZER_NETWORK_TRACE,'1');assert.equal(configured.options.shell,false);assert.equal(configured.options.windowsHide,true);assert.equal(configured.options.stdio,'inherit');assert.equal(configured.args.length,1);assert.equal(path.basename(configured.args[0]),'research-ordered-run.cjs');
 let calls=0;const result=await L.launch({environment:env,spawnChild:()=>{calls++;const child=new EventEmitter();queueMicrotask(()=>child.emit('close',1,null));return child;}});assert.equal(calls,1);assert.equal(result.exitCode,1);
});

test('diagnostic preload propagates to nested Node children without running collectors',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'diagnostic ordered fixture '));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const modulePath=path.resolve(__dirname,'../research-network-trace.cjs'),launcherPath=path.resolve(__dirname,'../research-ordered-diagnostic.cjs');
 const child='const t=require('+JSON.stringify(modulePath)+');console.log(JSON.stringify({preloaded:!!require.cache[require.resolve('+JSON.stringify(modulePath)+')],enabled:t.autoEnabled,flag:process.env.MULTI_ANALYZER_NETWORK_TRACE}));process.exitCode=17;';
 fs.writeFileSync(path.join(temp,'research-ordered-run.cjs'),'const {spawnSync}=require("node:child_process");const r=spawnSync(process.execPath,["-e",'+JSON.stringify(child)+'],{stdio:"inherit"});process.exitCode=r.status;');
 const runner='require('+JSON.stringify(launcherPath)+').launch({root:'+JSON.stringify(temp)+'}).then(r=>{process.exitCode=r.exitCode}).catch(()=>{process.exitCode=99});';
 const result=spawnSync(process.execPath,['-e',runner],{encoding:'utf8',env:{...process.env,NODE_OPTIONS:'--stack-trace-limit=12'}});
 assert.equal(result.status,17);assert.equal(result.stderr,'');assert.deepEqual(JSON.parse(result.stdout),{preloaded:true,enabled:false,flag:'1'});
});
