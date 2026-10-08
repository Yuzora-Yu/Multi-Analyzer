/* Opt-in passive diagnostics only: never replaces fetch or performs requests. */
'use strict';
const dc=require('node:diagnostics_channel'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORIGINS=new Set(['https://multi-analyzer-monitor.rikai-829.workers.dev','https://api.bybit.com']);
const PATHS=new Set(['/api/snapshot','/api/monitor','/v5/market/time','/v5/market/kline','/v5/market/recent-trade','/v5/market/tickers']);
const STAGES={'research-ordered-run.cjs':'runner','research-observer.cjs':'collector','research-forward.cjs':'freeze','research-reference-bridge.cjs':'bridge'};
const NAMES=new Set(['Error','TypeError','AggregateError','DOMException','AbortError','TimeoutError','ConnectTimeoutError','HeadersTimeoutError','BodyTimeoutError','SocketError','RequestAbortedError']);
const CODES=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN','ENOTFOUND','EHOSTUNREACH','ENETUNREACH','EPIPE','EACCES','EPERM','ERR_TLS_CERT_ALTNAME_INVALID','DEPTH_ZERO_SELF_SIGNED_CERT','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','SELF_SIGNED_CERT_IN_CHAIN','ERR_SSL_WRONG_VERSION_NUMBER','ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','UND_ERR_ABORTED','UND_ERR_DESTROYED','UND_ERR_CLOSED','UND_ERR_RES_CONTENT_LENGTH_MISMATCH','UND_ERR_REQ_CONTENT_LENGTH_MISMATCH','UND_ERR_RESPONSE_STATUS_CODE','UND_ERR_INVALID_ARG','UND_ERR_INFO','ABORT_ERR']);
const SYSCALLS=new Set(['connect','getaddrinfo','read','write','send','recv']);
const CHANNELS=['undici:request:create','undici:request:headers','undici:request:trailers','undici:request:error','undici:client:beforeConnect','undici:client:connected','undici:client:connectError'];
function errorEvidence(error,seen=new Set(),depth=0){
 if(!error||typeof error!=='object')return null;
 if(depth>4||seen.has(error))return {truncated:true};seen.add(error);
 const out={name:NAMES.has(error.name)?error.name:'UnknownError',code:CODES.has(error.code)?error.code:null};
 if(error.code!=null&&out.code===null)out.unrecognizedCode=true;
 if(SYSCALLS.has(error.syscall))out.syscall=error.syscall;
 if(Number.isInteger(error.errno))out.errno=error.errno;
 if(error.cause)out.cause=errorEvidence(error.cause,seen,depth+1);
 if(Array.isArray(error.errors))out.errors=error.errors.slice(0,8).map(e=>errorEvidence(e,seen,depth+1));
 return out; // No message, stack, addresses, headers, body or environment values.
}
function endpoint(request,allowLoopback=false){
 if(!request||!['GET','HEAD'].includes(request.method))return null;
 const u=new URL(request.path,String(request.origin));
 if(u.username||u.password)return null;
 const loopback=allowLoopback&&u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname);
 if(!loopback&&(!ORIGINS.has(u.origin)||!PATHS.has(u.pathname)))return null;
 const result={origin:u.origin,path:loopback?'/offline-fixture':u.pathname,method:request.method};
 const asset=u.searchParams.get('asset');if(['gold','btc'].includes(asset))result.asset=asset;
 // All other query values, including arbitrary IDs and tokens, are omitted.
 return result;
}
function connection(params,allowLoopback=false){
 if(!params)return null;
 const host=params.hostname,protocol=params.protocol;
 const live=protocol==='https:'&&['api.bybit.com','multi-analyzer-monitor.rikai-829.workers.dev'].includes(host)&&(!params.port||Number(params.port)===443);
 const fixture=allowLoopback&&protocol==='http:'&&['127.0.0.1','::1','[::1]'].includes(host);
 return live||fixture?{host,protocol,association:'Connection event is not attributable to a specific request.'}:null;
}
function privateWriter(directory=path.join(__dirname,'.runtime/hourly-observation/research-network-trace')){
 return record=>{
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,record.startedAt+'-'+process.pid+'-'+crypto.randomUUID()+'.json');
  fs.writeFileSync(file+'.tmp',JSON.stringify(record,null,2),{flag:'wx'});fs.renameSync(file+'.tmp',file);return file;
 };
}
function start({write=privateWriter(),now=Date.now,monotonic=()=>performance.now(),allowLoopback=false,limit=4096,exitHook=true,stage='diagnostic'}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>4096)throw Error('Invalid diagnostic event limit');
 const startedAt=now(),subscriptions=[],requests=new WeakMap(),events=[],errors=[];
 let nextId=0,droppedEvents=0,observerErrors=0,closed=false,writeFailed=false,file=null;
 const record={schema:1,version:'passive-undici-trace-v1',startedAt,pid:process.pid,parentPid:process.ppid,stage:STAGES[stage]||(['collector','freeze','bridge','runner','diagnostic'].includes(stage)?stage:'diagnostic'),node:process.version,undici:process.versions.undici??null,
  instrumentationSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),events,errors,
  scope:'Passive Node transport diagnostics. Request status/body-completion is not parsed market data, a saved forecast, a delivered email or continuity/recovery proof. Local timestamps are not exchange-clock evidence. Connection events have no specific request association.',
  collectorExecutedByDiagnostic:false,networkRequestsByDiagnostic:0,fetchReplaced:false,retriesAdded:false};
 function append(row,isError){if(events.length<limit)events.push(row);else droppedEvents++;if(isError){if(errors.length===128)errors.shift();errors.push(row);}}
 for(const name of CHANNELS){
  const onMessage=message=>{try{
   if(closed)return;
   const at=now(),kind=name.slice('undici:'.length);
   if(name.startsWith('undici:client:')){
    const info=connection(message.connectParams,allowLoopback);if(!info)return;
    append({kind,at,...info,...(message.error?{error:errorEvidence(message.error)}:{})},Boolean(message.error));return;
   }
   const info=endpoint(message.request,allowLoopback);if(!info)return;
   let tracked=requests.get(message.request);
   if(!tracked){tracked={id:++nextId,tick:monotonic(),createObserved:name==='undici:request:create'};requests.set(message.request,tracked);}
   const elapsed=monotonic()-tracked.tick;
   const row={kind,at,requestId:tracked.id,...info,createObserved:tracked.createObserved,durationMs:Number.isFinite(elapsed)&&elapsed>=0?elapsed:null};
   if(name==='undici:request:headers')row.httpStatus=Number.isInteger(message.response?.statusCode)?message.response.statusCode:null;
   if(message.error)row.error=errorEvidence(message.error);
   append(row,Boolean(message.error));
  }catch{observerErrors++;}}; // A diagnostics subscriber must never throw into the transport.
  dc.subscribe(name,onMessage);subscriptions.push([name,onMessage]);
 }
 function stop(){
  if(closed)return {file,writeFailed};closed=true;
  for(const [name,fn]of subscriptions)dc.unsubscribe(name,fn);
  if(exitHook)process.removeListener('exit',stop);
  Object.assign(record,{completedAt:now(),droppedEvents,observerErrors,requestIds:nextId});
  try{file=write(record);}catch{writeFailed=true;}
  return {file,writeFailed};
 }
 if(exitHook)process.once('exit',stop);
 return {stop,snapshot:()=>structuredClone({...record,droppedEvents,observerErrors,requestIds:nextId})};
}
// Preload only for the exact parent-owned programs in this checkout.
const main=process.argv[1]?path.resolve(process.argv[1]):null;
const autoEnabled=process.env.MULTI_ANALYZER_NETWORK_TRACE==='1'&&main&&path.dirname(main)===__dirname&&STAGES[path.basename(main)];
let autoStarted=false,autoStartFailed=false;
if(autoEnabled){try{start({stage:autoEnabled});autoStarted=true;}catch{autoStartFailed=true;}}
// Setup failure also stays contained. No automatic retries, stderr or exit-code changes.
module.exports={start,endpoint,connection,errorEvidence,privateWriter,autoEnabled:Boolean(autoEnabled),autoStarted,autoStartFailed};
