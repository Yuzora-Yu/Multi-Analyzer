const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const A=require('../demo-source-audit.cjs'),V=require('../demo-version.cjs');
function fixture(t){
  const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'demo-source-audit-'));
  for(const file of Object.keys(A.baseline.files)){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});
    fs.copyFileSync(path.join(__dirname,'..',file),path.join(root,file));
  }
  t.after(()=>{const checked=path.resolve(root);assert.equal(path.dirname(checked),parent);assert.ok(path.basename(checked).startsWith('demo-source-audit-'));fs.rmSync(checked,{recursive:true,force:true});});
  return root;
}
test('source supplement covers the local Worker closure without changing the registered seven-file identity',()=>{
  const legacy=V.identity();assert.equal(legacy.hash,A.baseline.legacyExecutionHash);
  const result=A.audit(path.join(__dirname,'..'),legacy.hash);
  assert.equal(result.valid,true);assert.equal(result.fileCount,11);assert.equal(result.sourceHash,result.expectedSourceHash);
  for(const file of ['cloudflare/market-response.mjs','cloudflare/logic.mjs','alert-event.js','cloudflare/demo-code-version.mjs']){
    assert.ok(A.baseline.files[file]);assert.equal(legacy.files[file],undefined);
  }
  assert.match(result.scope,/not retroactive preregistration/);
});
test('an omitted acquisition helper can pass the old identity but fails the independent source guard',t=>{
  const root=fixture(t),file='cloudflare/market-response.mjs';fs.appendFileSync(path.join(root,file),'\n// changed parser\n');
  const legacy=V.identity(root);assert.equal(legacy.hash,A.baseline.legacyExecutionHash);
  const result=A.audit(root,legacy.hash);assert.equal(result.valid,false);
  assert.deepEqual(result.issues,[{code:'SOURCE_CONTENT_CHANGED',file}]);
});
test('cache and authority-marker changes are independently detected and CRLF-only differences are normalized',t=>{
  const root=fixture(t),file='cloudflare/logic.mjs',target=path.join(root,file),original=fs.readFileSync(target,'utf8');
  fs.writeFileSync(target,original.replace(/\r?\n/g,'\r\n'));assert.equal(A.audit(root,V.identity(root).hash).valid,true);
  fs.appendFileSync(target,'\n// changed reuse\n');fs.appendFileSync(path.join(root,'cloudflare/demo-code-version.mjs'),'\n// changed marker\n');
  const result=A.audit(root,V.identity(root).hash);assert.equal(result.valid,false);
  assert.deepEqual(result.issues.map(x=>x.file).sort(),['cloudflare/demo-code-version.mjs',file].sort());
});
test('unavailable source and rewritten legacy identity cannot receive a verified supplement',t=>{
  const root=fixture(t),file='alert-event.js';fs.unlinkSync(path.join(root,file));
  const result=A.audit(root,'0'.repeat(64));assert.equal(result.valid,false);
  assert.ok(result.issues.some(x=>x.code==='REGISTERED_IDENTITY_MISMATCH'));
  assert.ok(result.issues.some(x=>x.code==='SOURCE_UNAVAILABLE'&&x.file===file));
});
test('unsafe or malformed manifests fail before reading paths outside the root',()=>{
  const root=path.join(__dirname,'..'),manifest=structuredClone(A.baseline);
  manifest.files={'../outside.js':'0'.repeat(64),'C:/outside.js':'0'.repeat(64)};
  const result=A.audit(root,manifest.legacyExecutionHash,manifest);assert.equal(result.valid,false);assert.equal(result.fileCount,0);
  assert.ok(result.issues.every(x=>x.code==='INVALID_SOURCE_ENTRY'));
  for(const bad of [null,{}, {...A.baseline,files:{}}, {...A.baseline,files:[]}])assert.equal(A.audit(root,A.baseline.legacyExecutionHash,bad).valid,false);
});

test('the ledger runner stops before API reads and saves an untrusted report if an omitted helper changes',async t=>{
  const root=fixture(t);fs.appendFileSync(path.join(root,'cloudflare/market-response.mjs'),'\n// changed acquisition\n');
  let calls=0;const report=await require('../demo-review.cjs').run({root:path.join(root,'private-audit'),codeRoot:root,
    fetcher:async()=>{calls++;throw Error('Unexpected API read');},now:Date.UTC(2026,9,9)});
  assert.equal(calls,0);assert.equal(report.valid,false);assert.equal(report.sourceAudit.valid,false);
  assert.ok(report.assets.every(a=>a.error==='LOCAL_SOURCE_UNVERIFIED'&&a.books.length===0));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'private-audit','reviews',report.reportDirectory,'report.json'),'utf8')).valid,false);
});
