const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const T=require('../mt5/release-tools.cjs'),{publish}=require('../mt5/publish-release.cjs');
const root=path.resolve(__dirname,'..'),meta=JSON.parse(fs.readFileSync(path.join(root,'downloads/mt5-latest.json')));
const target={root,repo:'Yuzora-Yu/Multi-Analyzer',tag:'mt5-v'+meta.version,commit:'a'.repeat(40),token:'synthetic-only'};
test('downloaded version is bound to original sources, binary evidence, page and exact archive bytes',()=>{assert.equal(T.verify(root).version,meta.version);assert.equal(meta.stage,'preview');assert.match(meta.runtimeVerification,/未確認/);});
test('metadata cannot redirect a source read outside the exact public package',()=>{for(const patch of [{version:'../../private'},{file:'../../private.zip'},{sources:{'../../private':'a'.repeat(64)}},{compiler:{errors:0,warnings:1}}])assert.throws(()=>T.validate({...meta,...patch}));});
test('draft uploads are read back before publication, and auth stays on GitHub API hosts',async()=>{
 const calls=[],data=new Map();let next=10;
 const fetcher=async(url,o)=>{calls.push({url,method:o.method||'GET'});assert.match(new URL(url).hostname,/^(api|uploads)\.github\.com$/);
  if(url.includes('/releases/tags/'))return new Response('',{status:404});
  if(o.method==='POST'&&url.endsWith('/releases'))return Response.json({id:1,tag_name:target.tag,draft:true,assets:[]});
  if(new URL(url).hostname==='uploads.github.com'){const id=next++;data.set(id,Buffer.from(o.body));return Response.json({id,size:o.body.length});}
  if(url.includes('/releases/assets/'))return new Response(data.get(Number(url.split('/').at(-1))));
  if(o.method==='PATCH'){assert.equal(data.size,2);return Response.json({draft:false});}throw Error('unexpected call');};
 const result=await publish({...target,fetcher});assert.equal(result.verifiedAssets,2);assert.equal(calls.at(-1).method,'PATCH');assert.equal(calls.filter(x=>x.method==='POST').length,3);
});
test('a changed published asset stops without upload, overwrite, deletion or republishing',async()=>{
 const methods=[];await assert.rejects(publish({...target,fetcher:async(url,o)=>{methods.push(o.method||'GET');
  if(url.includes('/releases/tags/'))return Response.json({id:1,tag_name:target.tag,draft:false,assets:[{id:2,name:meta.file,size:meta.bytes}]});
  return new Response('changed');}}),/READBACK_HASH_MISMATCH/);assert.deepEqual(methods,['GET','GET']);
});
test('wrong tag and local tampering are refused before any external publication request',async t=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('must not request');};await assert.rejects(publish({...target,tag:'mt5-v9.0.0',fetcher}),/INVALID_RELEASE_TARGET/);assert.equal(calls,0);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ma-mt5-test-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.match(path.basename(dir),/^ma-mt5-test-[A-Za-z0-9]+$/);fs.rmSync(dir,{recursive:true,force:true});});fs.mkdirSync(path.join(dir,'downloads'));fs.copyFileSync(path.join(root,'downloads/mt5-latest.json'),path.join(dir,'downloads/mt5-latest.json'));fs.writeFileSync(path.join(dir,'downloads',meta.file),'changed');
 await assert.rejects(publish({...target,root:dir,fetcher}),/ARCHIVE_HASH_MISMATCH/);assert.equal(calls,0);
});
