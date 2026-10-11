'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const Archive = require('../research-git-store.cjs');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-analyzer-archive-test-'));
  const workspace = path.join(base, 'Documents', '04-Gemini', 'Multi-Analyzer');
  fs.mkdirSync(workspace, { recursive: true });
  t.after(() => { assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(base, { recursive: true, force: true }); });
  const allRoots = Archive.roots(workspace);
  for (const root of Object.values(allRoots)) fs.mkdirSync(root, { recursive: true });
  function write(alias, relative, value) {
    const target = path.join(allRoots[alias], ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value));
    return target;
  }
  return { base, workspace, allRoots, write };
}

function fakeGitHub() {
  const blobs = new Map(), trees = new Map(), commits = new Map(), calls = [];
  let counter = 0;
  const nextSha = () => (++counter).toString(16).padStart(40, '0');
  const initialTree = nextSha(); trees.set(initialTree, new Map());
  const initialCommit = nextSha(); commits.set(initialCommit, { tree: initialTree, parents: [] });
  const state = { ref: initialCommit, private: true, visibility: 'private', login: 'Yuzora-Yu',
    failUpload: false, failAfterUploads: null, mismatchUpload: false, patchMode: 'normal', tamperedBlob: null, blobs, trees, commits, calls };
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetchImpl(url, options = {}) {
    const endpoint = new URL(url).pathname, method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ endpoint, method, body });
    if (endpoint === '/user') return response({ login: state.login });
    const prefix = '/repos/' + Archive.REPOSITORY;
    if (endpoint === prefix) return response({ full_name: Archive.REPOSITORY, private: state.private,
      visibility: state.visibility, owner: { login: 'Yuzora-Yu' }, permissions: { push: true }, archived: false });
    const relative = endpoint.slice(prefix.length);
    if (relative === '/git/ref/heads/main') return response({ object: { type: 'commit', sha: state.ref } });
    if (relative.startsWith('/git/commits/') && method === 'GET') {
      const sha = relative.split('/').at(-1), commit = commits.get(sha);
      return commit ? response({ sha, tree: { sha: commit.tree }, parents: commit.parents.map(p => ({ sha: p })) }) : response({}, 404);
    }
    if (relative.startsWith('/git/trees/') && method === 'GET') {
      const sha = relative.split('/').at(-1), tree = trees.get(sha);
      return tree ? response({ sha, truncated: false, tree: [...tree].map(([name, blob]) => ({ path: name, sha: blob, mode: '100644', type: 'blob' })) }) : response({},404);
    }
    if (relative.startsWith('/git/blobs/') && method === 'GET') {
      const sha = relative.split('/').at(-1), data = state.tamperedBlob === sha ? Buffer.from('tampered') : blobs.get(sha);
      return data ? response({ sha, size: data.length, encoding: 'base64', content: data.toString('base64') }) : response({},404);
    }
    if (relative === '/git/blobs' && method === 'POST') {
      if (state.failUpload) return response({}, 503);
      if (state.failAfterUploads != null && calls.filter(c => c.method === 'POST' && c.endpoint.endsWith('/git/blobs')).length > state.failAfterUploads) return response({},503);
      const bytes = Buffer.from(body.content, 'base64'), sha = Archive.gitBlobSha(bytes);
      blobs.set(sha, bytes);
      return response({ sha: state.mismatchUpload ? 'e'.repeat(40) : sha });
    }
    if (relative === '/git/trees' && method === 'POST') {
      const tree = new Map(trees.get(body.base_tree));
      for (const item of body.tree) tree.set(item.path, item.sha);
      const sha = nextSha(); trees.set(sha, tree); return response({ sha });
    }
    if (relative === '/git/commits' && method === 'POST') {
      const sha = nextSha(); commits.set(sha, { tree: body.tree, parents: body.parents }); return response({ sha });
    }
    if (relative === '/git/refs/heads/main' && method === 'PATCH') {
      assert.equal(body.force, false);
      if (state.patchMode === 'conflict') return response({}, 422);
      state.ref = body.sha;
      if (state.patchMode === 'written-then-timeout') throw Error('simulated private transport exception');
      return response({ object: { sha: state.ref } });
    }
    if (relative.startsWith('/compare/')) {
      const [base, head] = relative.slice('/compare/'.length).split('...');
      let current = head;
      while (current && current !== base) current = commits.get(current)?.parents[0];
      return response({ status: current === base ? (head === base ? 'identical' : 'ahead') : 'diverged' });
    }
    throw Error(`Unhandled fake API: ${method} ${relative}`);
  }
  const config = { repository: Archive.REPOSITORY, account: 'Yuzora-Yu', branch: 'main', roots: Object.keys(Archive.ROOT_PATHS) };
  let clock = Date.now(); const scheduler = { now: () => clock, sleep: async ms => { clock += ms; } };
  return { api: new Archive.GitHub('fake-memory-only-credential', config, fetchImpl, scheduler), config, state };
}

test('safe JSON/gzip are archived as exact original bytes with preserved price/time/decision', () => {
  const original = Buffer.from('{ "close": 4186.125, "time":1791729000000, "decision":"WAIT" }\r\n');
  const safe = Archive.sanitize(original, 'hourly-observation', 'api-example.json');
  assert.equal(safe.redacted, false); assert.equal(safe.exactOriginalRestorable, true); assert.deepEqual(safe.bytes, original);
  const zipped = zlib.gzipSync(original);
  const compressed = Archive.sanitize(zipped, 'hourly-observation', 'multiframe-example.json.gz');
  assert.deepEqual(compressed.bytes, zipped);
  const pack = Archive.buildPack([{ ...safe }]);
  const contents = Archive.unpack(pack.bytes, { ...pack, bytes: pack.bytes.length });
  assert.deepEqual(contents.get(safe.storedSha256), original);
});

test('ordinary https market URLs are not mistaken for Windows absolute paths', () => {
  const bytes=Buffer.from(JSON.stringify({close:4186,source:'https://api.bybit.com/v5/market/kline?symbol=XAUUSDT'}));
  const value=Archive.sanitize(bytes,'hourly-observation','api.json');
  assert.equal(value.reason,undefined); assert.equal(value.redacted,false); assert.deepEqual(value.bytes,bytes);
});

test('private metadata is removed in a copy, with both hashes and no claim of original recovery', () => {
  const bytes = Buffer.from(JSON.stringify({ close: 4186.125, time: 1791729000000, decision: 'WAIT',
    email: 'private@example.test', workspacePath: 'C:\\Users\\private-user\\Documents\\Private project',
    credentials: { token: 'github_pat_1234567890SECRET' }, threadId: 'private-thread', headers: { Authorization: 'Bearer credential-value' } }));
  const result = Archive.sanitize(bytes, 'demo-lab', 'operations/report.json');
  assert.equal(result.redacted, true); assert.equal(result.exactOriginalRestorable, false);
  assert.equal(result.originalSha256, Archive.sha256(bytes)); assert.notEqual(result.originalSha256, result.storedSha256);
  const stored = result.bytes.toString('utf8');
  assert.doesNotMatch(stored, /private@example|private-user|github_pat_|private-thread|Bearer/);
  const value = JSON.parse(stored); assert.equal(value.close,4186.125); assert.equal(value.time,1791729000000); assert.equal(value.decision,'WAIT');
});

test('integrity envelopes and prose requiring privacy changes are excluded rather than rewritten', () => {
  const bytes = Buffer.from(JSON.stringify({ firstRetrievedAt: 1, payloadHash: 'a'.repeat(64), original: { sourcePath: 'C:\\Users\\private\\a.json' } }));
  assert.equal(Archive.sanitize(bytes, 'demo-lab', 'ledger-cache/btc/demo-v1/sources/sample.json').reason, 'INTEGRITY_RECORD_REQUIRES_REDACTION');
  assert.equal(Archive.sanitize(Buffer.from('Decision WAIT; source C:\\Users\\private\\a.json'), 'demo-lab','operations/review.md').reason, 'TEXT_PRIVACY_REQUIRES_EXCLUSION');
  assert.equal(Archive.sanitize(Buffer.from(JSON.stringify({ decision: 'WAIT see C:\\Users\\private\\a.json' })), 'demo-lab','operations/review.json').reason, 'INVALID_JSON_OR_UNSAFE_KEY');
});

test('embedded mail history in otherwise ordinary monitor JSON never uploads and null markers are safe', async t => {
  const f=fixture(t), remote=fakeGitHub();
  const original=Buffer.from(JSON.stringify({body:{assets:{gold:{state:'MARKET_CLOSED',lastEmail:{acceptedAt:1791729000000,title:'saved notification'}}}}}));
  const target=f.write('demo-lab','operations/monitor.json',original);
  const result=await Archive.sync({...remote,workspace:f.workspace});
  assert.equal(result.acceptedFiles,0); assert.equal(result.exclusions.MAIL_RECORD_REQUIRES_EXCLUSION,1);
  assert.equal(remote.state.calls.filter(c=>c.method!=='GET').length,0); assert.deepEqual(fs.readFileSync(target),original);
  const empty=Buffer.from(JSON.stringify({body:{state:'WAIT',lastEmail:null,emailEnabled:true}}));
  assert.deepEqual(Archive.sanitize(empty,'demo-lab','operations/status.json').bytes,empty);
});

test('inventory excludes credentials/mail/media, never changes local originals, and includes all 3 persona outputs', async t => {
  const f = fixture(t);
  const source = f.write('hourly-observation','api-1.json', { close: 4, time: 10 });
  const before = fs.readFileSync(source);
  f.write('hourly-observation','email-config.json', { password:'secret' });
  f.write('hourly-observation','smtp-receipts/one.json',{ token:'secret' });
  f.write('hourly-observation','chart.png', Buffer.from('png'));
  f.write('demo-lab','operations/mail-payload.json',{ subject:'private' });
  for (const alias of ['persona-trend','persona-reversion','persona-confirmation']) f.write(alias, 'review.json', { close: 4, decision: 'WAIT' });
  const report = await Archive.inventory({ workspace:f.workspace });
  assert.equal(report.acceptedFiles,4); assert.ok(Object.keys(report.exclusions).length);
  assert.deepEqual(fs.readFileSync(source), before);
  assert.equal(fs.existsSync(path.join(f.workspace,'.runtime/git-data-store')),false);
});

test('sync checks private repository/account, appends content addressed packs, remote readback, and restore roundtrip', async t => {
  const f = fixture(t), remote = fakeGitHub();
  const bytes = Buffer.from('{"time":1791729000000,"close":4185.45,"decision":"WAIT"}\n');
  f.write('hourly-observation','api-1.json',bytes);
  const initialRef = remote.state.ref;
  const result = await Archive.sync({ ...remote, workspace:f.workspace });
  assert.equal(result.mode,'SYNC_VERIFIED'); assert.equal(result.acceptedFiles,1); assert.equal(result.localFilesPruned,0);
  assert.equal(result.baseCommit,initialRef); assert.notEqual(result.baseCommit,result.publishedCommit);
  assert.equal(result.verifiedRef,remote.state.ref);
  const tree = await remote.api.treeAt(remote.state.ref);
  assert.equal([...tree.entries].filter(([name])=>name.startsWith('packs/')).length,1);
  assert.equal([...tree.entries].filter(([name])=>name.startsWith('manifests/')).length,1);
  const restored = await Archive.restore({ api:remote.api, workspace:f.workspace, alias:'hourly-observation',relative:'api-1.json',originalSha256:Archive.sha256(bytes) });
  assert.equal(restored.exactOriginalRestorable,true);
  assert.deepEqual(fs.readFileSync(path.join(f.workspace,restored.destination)),bytes);
  await assert.rejects(Archive.restore({ api:remote.api, workspace:f.workspace,alias:'hourly-observation',relative:'api-1.json',originalSha256:Archive.sha256(bytes) }), /EEXIST/);
});

test('same path new content is a new archived version; duplicate content does not create new Git blobs', async t => {
  const f=fixture(t), remote=fakeGitHub();
  const first=Buffer.from('{"close":4100}'), second=Buffer.from('{"close":4200}');
  f.write('demo-lab','reviews/current.json',first);
  await Archive.sync({...remote,workspace:f.workspace});
  const blobCount=remote.state.blobs.size, ref=remote.state.ref;
  const duplicate=await Archive.sync({...remote,workspace:f.workspace});
  assert.equal(duplicate.acceptedFiles,0); assert.equal(remote.state.blobs.size,blobCount); assert.equal(remote.state.ref,ref);
  assert.equal(duplicate.statCacheHits,1); assert.equal(duplicate.scannedBytes,0);
  const forced=await Archive.sync({...remote,workspace:f.workspace,rehash:true});
  assert.equal(forced.statCacheHits,0); assert.equal(forced.scannedBytes,first.length);
  f.write('demo-lab','reviews/current.json',second);
  await Archive.sync({...remote,workspace:f.workspace});
  const tree=await remote.api.treeAt(remote.state.ref), versions=[];
  for await(const m of Archive.manifests(remote.api,tree)) versions.push(...m.value.records);
  assert.deepEqual(new Set(versions.map(r=>r.originalSha256)),new Set([Archive.sha256(first),Archive.sha256(second)]));
});

test('sync never writes data to a public repository or different account', async t => {
  const f=fixture(t), remote=fakeGitHub(); f.write('hourly-observation','api.json',{ close:4 });
  remote.state.private=false; remote.state.visibility='public';
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/GITHUB_REPOSITORY_NOT_PRIVATE_WRITABLE/);
  assert.equal(remote.state.calls.filter(c=>c.method!=='GET').length,0);
  remote.state.private=true; remote.state.visibility='private'; remote.state.login='other-account';
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/GITHUB_ACCOUNT_MISMATCH/);
  assert.equal(remote.state.calls.filter(c=>c.method!=='GET').length,0);
});

test('failed/mismatched upload preserves originals, publishes no commit, and prunes nothing', async t => {
  const f=fixture(t), remote=fakeGitHub(); const target=f.write('hourly-observation','research-forward/evaluation-1700000000000.json',{ close:4 });
  const first=remote.state.ref, bytes=fs.readFileSync(target); remote.state.failUpload=true;
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/GITHUB_HTTP_503/);
  assert.deepEqual(fs.readFileSync(target),bytes); assert.equal(remote.state.ref,first);
  remote.state.failUpload=false; remote.state.mismatchUpload=true;
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/UPLOADED_BLOB_SHA_MISMATCH/);
  assert.deepEqual(fs.readFileSync(target),bytes); assert.equal(remote.state.ref,first);
  assert.equal(fs.existsSync(path.join(f.workspace,'.runtime/git-data-store/LOCK')),false);
});

test('optimistic conflict stops; written-then-timeout is resolved from actual remote ref/readback', async t => {
  const f=fixture(t), remote=fakeGitHub(); const target=f.write('hourly-observation','api.json',{ close:4 });
  remote.state.patchMode='conflict'; const initial=remote.state.ref;
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/REMOTE_UPDATE_CONFLICT_OR_UNRESOLVED/);
  assert.equal(remote.state.ref,initial); assert.ok(fs.existsSync(target));
  remote.state.patchMode='written-then-timeout';
  const result=await Archive.sync({...remote,workspace:f.workspace}); assert.equal(result.mode,'SYNC_VERIFIED');
  assert.notEqual(remote.state.ref,initial);
  assert.ok(remote.state.calls.filter(c=>c.method==='PATCH').every(c=>c.body.force===false));
});

test('tampered blob/manifest/pack fails restoration and deletion', async t => {
  const f=fixture(t), remote=fakeGitHub();
  const bytes=Buffer.from('{"close":4}'); f.write('hourly-observation','api.json',bytes);
  await Archive.sync({...remote,workspace:f.workspace});
  const tree=await remote.api.treeAt(remote.state.ref), pack=[...tree.entries].find(([n])=>n.startsWith('packs/'));
  remote.state.tamperedBlob=pack[1];
  await assert.rejects(Archive.restore({ api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'api.json',originalSha256:Archive.sha256(bytes) }),/REMOTE_BLOB_HASH_MISMATCH/);
  assert.equal(fs.existsSync(path.join(f.workspace,'.runtime/git-data-store/restored')),false);
  const safe=Archive.sanitize(bytes,'hourly-observation','api.json'), built=Archive.buildPack([safe]);
  const modified=Buffer.from(built.bytes); modified[modified.length-1]^=1;
  assert.throws(()=>Archive.unpack(modified,{...built,bytes:built.bytes.length}),/PACK_HASH_MISMATCH/);
});

test('path traversal/root alias injection and symlinks cannot read or restore outside allowlist', async t => {
  const f=fixture(t); const outside=path.join(f.base,'outside.json'); fs.writeFileSync(outside,'{}');
  assert.throws(()=>Archive.resolveSource('hourly-observation','../../outside.json',f.allRoots),/UNSAFE_RELATIVE_PATH/);
  assert.throws(()=>Archive.resolveSource('outside','outside.json',f.allRoots),/ROOT_NOT_ALLOWED/);
  assert.throws(()=>Archive.restoreTarget(f.workspace,'hourly-observation','../outside.json'),/UNSAFE_RELATIVE_PATH/);
  const link=path.join(f.allRoots['hourly-observation'],'link.json');
  try { fs.symlinkSync(outside,link); } catch(error) { if(error.code==='EPERM') return; throw error; }
  assert.throws(()=>Archive.resolveSource('hourly-observation','link.json',f.allRoots),/SOURCE_LINK_NOT_ALLOWED/);
  const result=await Archive.inventory({workspace:f.workspace}); assert.equal(result.exclusions.SYMLINK_EXCLUDED,1);
});

test('local lock collision stops before GitHub requests; stale lock is never broken automatically', async t => {
  const f=fixture(t), remote=fakeGitHub(); const dir=path.join(f.workspace,'.runtime/git-data-store');
  fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'LOCK'),'existing');
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/ARCHIVE_LOCK_BUSY/);
  assert.equal(remote.state.calls.length,0); assert.equal(fs.readFileSync(path.join(dir,'LOCK'),'utf8'),'existing');
});

test('verified prune preserves raw inputs/cache/registration/latest 3/recent 24h and LATEST pointer', async t => {
  const f=fixture(t), remote=fakeGitHub(); const old=Date.now()-5*86400000, paths=[];
  for(let i=0;i<7;i++){
    const relative=`research-forward/evaluation-${old+i*1000}.json`, target=f.write('hourly-observation',relative,{close:i+1});
    fs.utimesSync(target,new Date(old),new Date(old)); paths.push({relative,target});
  }
  f.write('hourly-observation','research-forward/LATEST.json',{ evaluation:paths[0].relative });
  const raw=f.write('hourly-observation','research-forward/predictions/source.json',{close:4});
  const cache=f.write('demo-lab','ledger-cache/sources/source.json',{close:4});
  const registration=f.write('demo-lab','preregistration-1.json',{version:'demo-v1'});
  const recent=f.write('hourly-observation',`research-forward/evaluation-${Date.now()-1000}.json`,{close:4});
  await Archive.sync({...remote,workspace:f.workspace});
  const dry=await Archive.prune({api:remote.api,workspace:f.workspace});
  assert.equal(dry.prunedFiles,0); assert.equal(dry.eligibleFiles,4);
  assert.ok(paths.every(p=>fs.existsSync(p.target)));
  const applied=await Archive.prune({api:remote.api,workspace:f.workspace,apply:true}); assert.equal(applied.prunedFiles,4);
  assert.ok(fs.existsSync(paths[0].target)); assert.ok(paths.slice(-2).every(p=>fs.existsSync(p.target)));
  assert.ok([raw,cache,registration,recent].every(p=>fs.existsSync(p)));
  const r=await Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:paths[1].relative,originalSha256:Archive.sha256(Buffer.from(JSON.stringify({close:2})))});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.workspace,r.destination),'utf8')),{close:2});
});

test('prune does not remove changed local version or any candidate after remote hash failure', async t => {
  const f=fixture(t), remote=fakeGitHub(), old=Date.now()-5*86400000;
  const targets=[];
  for(let i=0;i<5;i++){const target=f.write('hourly-observation',`research-forward/evaluation-${old+i*1000}.json`,{close:i}); fs.utimesSync(target,new Date(old),new Date(old)); targets.push(target);}
  await Archive.sync({...remote,workspace:f.workspace});
  fs.writeFileSync(targets[0],JSON.stringify({close:999})); fs.utimesSync(targets[0],new Date(old),new Date(old));
  const result=await Archive.prune({api:remote.api,workspace:f.workspace}); assert.equal(result.skipped.LOCAL_VERSION_CHANGED,1); assert.equal(result.eligibleFiles,1);
  const tree=await remote.api.treeAt(remote.state.ref); remote.state.tamperedBlob=[...tree.entries].find(([n])=>n.startsWith('packs/'))[1];
  await assert.rejects(Archive.prune({api:remote.api,workspace:f.workspace,apply:true}),/REMOTE_BLOB_HASH_MISMATCH/);
  assert.ok(targets.every(p=>fs.existsSync(p)));
});

test('repeat prune reads no historical packs after eligible local evaluations are gone', async t => {
  const f=fixture(t), remote=fakeGitHub(), old=Date.now()-5*86400000;
  for(let i=0;i<5;i++){
    const target=f.write('hourly-observation',`research-forward/evaluation-${old+i*1000}.json`,{close:i});
    fs.utimesSync(target,new Date(old),new Date(old));
  }
  const applied=await (async()=>{
    await Archive.sync({...remote,workspace:f.workspace});
    return Archive.prune({api:remote.api,workspace:f.workspace,apply:true});
  })();
  assert.equal(applied.prunedFiles,2); assert.equal(applied.verifiedPacks,1);
  const tree=await remote.api.treeAt(remote.state.ref);
  const packSha=[...tree.entries].find(([name])=>name.startsWith('packs/'))[1];
  remote.state.tamperedBlob=packSha; remote.state.calls.length=0;
  const again=await Archive.prune({api:remote.api,workspace:f.workspace,apply:true});
  assert.equal(again.eligibleFiles,0); assert.equal(again.prunedFiles,0); assert.equal(again.verifiedPacks,0);
  assert.equal(remote.state.calls.filter(c=>c.method==='GET'&&c.endpoint.endsWith('/git/blobs/'+packSha)).length,0);
});

test('one remaining local candidate still requires full pack integrity before any deletion', async t => {
  const f=fixture(t), remote=fakeGitHub(), old=Date.now()-5*86400000, targets=[];
  for(let i=0;i<5;i++){
    const target=f.write('hourly-observation',`research-forward/evaluation-${old+i*1000}.json`,{close:i});
    fs.utimesSync(target,new Date(old),new Date(old)); targets.push(target);
  }
  await Archive.sync({...remote,workspace:f.workspace});
  fs.unlinkSync(targets[0]);
  const tree=await remote.api.treeAt(remote.state.ref);
  remote.state.tamperedBlob=[...tree.entries].find(([name])=>name.startsWith('packs/'))[1];
  await assert.rejects(Archive.prune({api:remote.api,workspace:f.workspace,apply:true}),/REMOTE_BLOB_HASH_MISMATCH/);
  assert.ok(targets.slice(1).every(target=>fs.existsSync(target)));
  remote.state.tamperedBlob=null;
  const applied=await Archive.prune({api:remote.api,workspace:f.workspace,apply:true});
  assert.equal(applied.prunedFiles,1); assert.equal(applied.verifiedPacks,1);
  assert.ok(targets.slice(2).every(target=>fs.existsSync(target)));
});

test('old evaluation timestamp with a recent local update skips pack retrieval', async t => {
  const f=fixture(t), remote=fakeGitHub(), old=Date.now()-5*86400000;
  let oldest;
  for(let i=0;i<4;i++){
    const target=f.write('hourly-observation',`research-forward/evaluation-${old+i*1000}.json`,{close:i});
    fs.utimesSync(target,new Date(old),new Date(old)); if(!i)oldest=target;
  }
  await Archive.sync({...remote,workspace:f.workspace});
  fs.utimesSync(oldest,new Date(),new Date());
  const result=await Archive.prune({api:remote.api,workspace:f.workspace,apply:true});
  assert.equal(result.verifiedPacks,0); assert.equal(result.eligibleFiles,0); assert.equal(result.prunedFiles,0);
  assert.ok(fs.existsSync(oldest));
});

test('redacted archive restore requires explicit flag and never prunes that copy', async t => {
  const f=fixture(t), remote=fakeGitHub();
  const bytes=Buffer.from(JSON.stringify({close:4,email:'private@example.test'})); f.write('demo-lab','operations/review.json',bytes);
  await Archive.sync({...remote,workspace:f.workspace});
  const options={api:remote.api,workspace:f.workspace,alias:'demo-lab',relative:'operations/review.json',originalSha256:Archive.sha256(bytes)};
  await assert.rejects(Archive.restore(options),/REDACTED_COPY_IS_NOT_ORIGINAL/);
  const result=await Archive.restore({...options,allowRedacted:true}); assert.equal(result.exactOriginalRestorable,false);
  assert.doesNotMatch(fs.readFileSync(path.join(f.workspace,result.destination),'utf8'),/private@example/);
});

test('oversized/invalid binary input is safely excluded without inventing data', () => {
  assert.equal(Archive.sanitize(Buffer.from([255,0]),'hourly-observation','api.json').reason,'NON_UTF8_TEXT');
  assert.equal(Archive.sanitize(Buffer.from('broken'),'hourly-observation','api.json').reason,'INVALID_JSON_OR_UNSAFE_KEY');
  assert.equal(Archive.sanitize(Buffer.from('notgzip'),'hourly-observation','api.json.gz').reason,'INVALID_OR_OVERSIZED_GZIP');
});

test('per-file gzip packs many large compressible originals and lazily decodes one file', () => {
  const records=[];
  for(let i=0;i<8;i++) {
    const bytes=Buffer.from(JSON.stringify({time:1791729000000+i,close:4100+i,padding:'a'.repeat(4*1024*1024)}));
    records.push({bytes,storedBytes:bytes.length,storedSha256:Archive.sha256(bytes)});
  }
  const pack=Archive.buildPack(records); assert.ok(pack.rawBytes>32*1024*1024); assert.ok(pack.bytes.length<200000);
  const decoded=Archive.unpack(pack.bytes,{...pack,bytes:pack.bytes.length});
  assert.equal(decoded.size,8); assert.equal(decoded.totalRawBytes,pack.rawBytes);
  assert.deepEqual(decoded.get(records[4].storedSha256),records[4].bytes);
});

test('content write budget stops without deleting any input and saves safe failure state', async t => {
  const f=fixture(t), remote=fakeGitHub(); f.write('hourly-observation','api.json',{close:4});
  remote.config.maxContentWrites=1;
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/GITHUB_CONTENT_WRITE_BUDGET_EXHAUSTED/);
  assert.ok(fs.existsSync(path.join(f.allRoots['hourly-observation'],'api.json')));
  const report=JSON.parse(fs.readFileSync(path.join(f.workspace,'.runtime/git-data-store/FAILURE-LATEST.json'),'utf8'));
  assert.equal(report.localFilesPruned,0); assert.equal(report.noAutomaticRetry,true);
  assert.doesNotMatch(JSON.stringify(report),/fake-memory-only|Authorization/);
});

test('sensitive JSON keys with secret-shaped values and long @-free strings have bounded privacy handling', () => {
  const large=Buffer.from(JSON.stringify({close:4186,padding:'A'.repeat(1024*1024),GITHUB_TOKEN:'opaque-sensitive-value'}));
  const safe=Archive.sanitize(large,'demo-lab','operations/sample.json');
  assert.equal(safe.redacted,true); assert.doesNotMatch(safe.bytes.toString(),/opaque-sensitive-value/);
  assert.equal(JSON.parse(safe.bytes).close,4186);
});

test('camelCase credential metadata is redacted even when values have no recognizable token prefix', () => {
  const bytes=Buffer.from(JSON.stringify({close:4186,time:1791729000000,apiToken:'opaque-one',smtpPassword:'opaque-two',
    cloudflareApiKey:'opaque-three',githubToken:'opaque-four'}));
  const safe=Archive.sanitize(bytes,'demo-lab','operations/sample.json');
  assert.equal(safe.redacted,true); assert.doesNotMatch(safe.bytes.toString(),/opaque-(?:one|two|three|four)/);
  assert.equal(JSON.parse(safe.bytes).close,4186); assert.equal(JSON.parse(safe.bytes).time,1791729000000);
});

test('high-entropy JSON inputs are flushed before gzip payload exceeds budget, every remote blob stays under 20 MiB', async t => {
  const f=fixture(t), remote=fakeGitHub();
  for(let i=0;i<2;i++) f.write('hourly-observation',`entropy-${i}.json`,JSON.stringify({close:4100+i,padding:crypto.randomBytes(12*1024*1024).toString('base64')}));
  const result=await Archive.sync({...remote,workspace:f.workspace});
  assert.equal(result.acceptedFiles,2);
  const tree=await remote.api.treeAt(remote.state.ref);
  const packs=[...tree.entries].filter(([n])=>n.startsWith('packs/'));
  assert.equal(packs.length,2);
  for(const [,sha] of packs) assert.ok(remote.state.blobs.get(sha).length<=Archive.MAX_BLOB);
  for await(const m of Archive.manifests(remote.api,tree)) assert.ok(m.value.pack.payloadBytes<=Archive.PACK_PAYLOAD_BUDGET);
});

test('a single already-compressed payload over the pack budget now uses verified fragments and retains its original', async t => {
  const f=fixture(t), remote=fakeGitHub();
  const plain=Buffer.from(JSON.stringify({close:4186,padding:crypto.randomBytes(19*1024*1024).toString('base64')}));
  const source=zlib.gzipSync(plain);
  assert.ok(source.length<Archive.MAX_FILE);
  const target=f.write('hourly-observation','entropy.json.gz',source);
  const result=await Archive.sync({...remote,workspace:f.workspace});
  assert.equal(result.acceptedFiles,1); assert.equal(result.fragmentedFiles,1);
  assert.equal(result.exclusions.SOURCE_FILE_COMPRESSION_TOO_LARGE,undefined);
  assert.deepEqual(fs.readFileSync(target),source);
  const r=await Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'entropy.json.gz',originalSha256:Archive.sha256(source)});
  assert.equal(r.schema,2); assert.deepEqual(fs.readFileSync(path.join(f.workspace,r.destination)),source);
});

function largeDocument(mib = 23) {
  return Buffer.from(JSON.stringify({time:1791750000000,close:4186.125,decision:'WAIT',
    padding:'A'.repeat(8*1024*1024)+'B'.repeat(8*1024*1024)+'C'.repeat((mib-16)*1024*1024)}));
}
function fragmentManifest(remote) {
  const tree=remote.state.trees.get(remote.state.commits.get(remote.state.ref).tree);
  const [name,sha]=[...tree].find(([n,s])=>n.startsWith('manifests/') && JSON.parse(remote.state.blobs.get(s)).schema===2);
  return { tree,name,sha,value:JSON.parse(remote.state.blobs.get(sha)) };
}
function replaceManifest(remote, mutate) {
  const found=fragmentManifest(remote), value=structuredClone(found.value); mutate(value);
  const bytes=Buffer.from(JSON.stringify(value)), sha=Archive.gitBlobSha(bytes), name=`manifests/${Archive.sha256(bytes)}.json`;
  found.tree.delete(found.name); found.tree.set(name,sha); remote.state.blobs.set(sha,bytes);
  return value;
}

test('55 MiB original uses schema2 and roundtrips exactly alongside a legacy schema1 archive', async t => {
  const f=fixture(t), remote=fakeGitHub(), original=largeDocument(55);
  const source=f.write('hourly-observation','research-forward/evaluation-1700000000000.json',original);
  f.write('hourly-observation','api-small.json',Buffer.from('{ "close": 4186.125 }\r\n'));
  const report=await Archive.sync({...remote,workspace:f.workspace});
  assert.equal(report.acceptedFiles,2); assert.equal(report.fragmentedFiles,1); assert.equal(report.fragments,7);
  const tree=await remote.api.treeAt(remote.state.ref), schemas=[];
  for await(const m of Archive.manifests(remote.api,tree)) schemas.push(m.value.schema);
  assert.deepEqual(new Set(schemas),new Set([1,2]));
  const r=await Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'research-forward/evaluation-1700000000000.json',originalSha256:Archive.sha256(original)});
  assert.equal(r.schema,2); assert.equal(r.exactOriginalRestorable,true); assert.equal(r.fragments,7);
  assert.deepEqual(fs.readFileSync(path.join(f.workspace,r.destination)),original); assert.deepEqual(fs.readFileSync(source),original);
  const old=await Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'api-small.json',originalSha256:Archive.sha256(Buffer.from('{ "close": 4186.125 }\r\n'))});
  assert.equal(old.schema,1); assert.equal(old.fragments,0);
  await assert.rejects(Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'research-forward/evaluation-1700000000000.json',originalSha256:Archive.sha256(original)}),/EEXIST/);
  assert.equal(fs.readdirSync(path.dirname(path.join(f.workspace,r.destination))).filter(n=>n.endsWith('.tmp')).length,0);
});

test('privacy is inspected before fragmenting even when a credential key crosses the 8 MiB boundary', async t => {
  const f=fixture(t), remote=fakeGitHub();
  const prefix='{"close":4186.125,"time":1791750000000,"padding":"';
  const splitKey='githubToken', keyStart=Archive.FRAGMENT_BYTES-5;
  const leading=prefix+'A'.repeat(keyStart-prefix.length-3)+'","';
  assert.equal(Buffer.byteLength(leading),keyStart);
  const original=Buffer.from(leading+splitKey+'":"opaque-secret-crossing-boundary","suffix":"'+'B'.repeat(14*1024*1024)+'"}');
  const source=f.write('hourly-observation','big-redacted.json',original);
  const report=await Archive.sync({...remote,workspace:f.workspace}); assert.equal(report.redactedFiles,1); assert.equal(report.fragmentedFiles,1);
  const found=fragmentManifest(remote), record=found.value.records[0];
  assert.equal(record.originalSha256,Archive.sha256(original)); assert.notEqual(record.originalSha256,record.storedSha256);
  const restored=await Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'big-redacted.json',originalSha256:Archive.sha256(original),allowRedacted:true});
  const bytes=fs.readFileSync(path.join(f.workspace,restored.destination));
  assert.doesNotMatch(bytes.toString(),/opaque-secret-crossing-boundary/); assert.equal(restored.exactOriginalRestorable,false);
  assert.equal(JSON.parse(bytes).close,4186.125); assert.equal(JSON.parse(bytes).time,1791750000000);
  assert.deepEqual(fs.readFileSync(source),original);
});

test('non-metadata credential spanning a fragment boundary is excluded before any API mutation', async t => {
  const f=fixture(t), remote=fakeGitHub();
  const prefix='{"close":4186,"padding":"';
  const original=Buffer.from(prefix+'A'.repeat(Archive.FRAGMENT_BYTES-prefix.length-4)+'github_pat_ABCDEFGHIJKSECRET'+'B'.repeat(14*1024*1024)+'"}');
  f.write('hourly-observation','private-prose.json',original);
  const report=await Archive.sync({...remote,workspace:f.workspace});
  assert.equal(report.acceptedFiles,0); assert.equal(report.exclusions.INVALID_JSON_OR_UNSAFE_KEY,1);
  assert.equal(remote.state.calls.filter(c=>c.method!=='GET').length,0);
});

test('missing fragments, duplicate indexes, wrong order/offset/size are rejected without publishing restore', async t => {
  const f=fixture(t), remote=fakeGitHub(), original=largeDocument();
  f.write('hourly-observation','big.json',original); await Archive.sync({...remote,workspace:f.workspace});
  const originalTree=new Map(fragmentManifest(remote).tree);
  const mutations=[
    ['missing', v=>v.records[0].fragments.pop(),/MANIFEST_FRAGMENT_COUNT_INVALID/],
    ['duplicate-index', v=>v.records[0].fragments[1].index=0,/MANIFEST_FRAGMENT_ORDER_OR_SIZE_INVALID/],
    ['order', v=>v.records[0].fragments.reverse(),/MANIFEST_FRAGMENT_ORDER_OR_SIZE_INVALID/],
    ['offset', v=>v.records[0].fragments[1].offset++,/MANIFEST_FRAGMENT_ORDER_OR_SIZE_INVALID/],
    ['size', v=>v.records[0].fragments[1].bytes--,/MANIFEST_FRAGMENT_ORDER_OR_SIZE_INVALID/]
  ];
  for(const [label,mutate,expected] of mutations){
    await t.test(label,async()=>{
      remote.state.trees.set(remote.state.commits.get(remote.state.ref).tree,new Map(originalTree));
      replaceManifest(remote,mutate);
      await assert.rejects(Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'big.json',originalSha256:Archive.sha256(original)}),expected);
      assert.equal(fs.existsSync(path.join(f.workspace,'.runtime/git-data-store/restored')),false);
    });
  }
});

test('fragment tamper, duplicate content in wrong position, full-file hash and missing remote pack fail reassembly', async t => {
  const f=fixture(t), remote=fakeGitHub(), original=largeDocument();
  f.write('hourly-observation','big.json',original); await Archive.sync({...remote,workspace:f.workspace});
  const originalTree=new Map(fragmentManifest(remote).tree), saved=structuredClone(fragmentManifest(remote).value);
  const tree=await remote.api.treeAt(remote.state.ref);
  const badHash=structuredClone(saved); badHash.records[0].fragments[0].sha256='f'.repeat(64);
  await assert.rejects(Archive.verifiedFragmentRecord(remote.api,tree,badHash),/FRAGMENT_DATA_MISMATCH/);
  const duplicate=structuredClone(saved);
  duplicate.records[0].fragments[1]={...duplicate.records[0].fragments[0],index:1,offset:Archive.FRAGMENT_BYTES};
  await assert.rejects(Archive.verifiedFragmentRecord(remote.api,tree,duplicate),/REASSEMBLED_FILE_HASH_MISMATCH/);
  const badWhole=structuredClone(saved); badWhole.records[0].originalSha256=badWhole.records[0].storedSha256='f'.repeat(64);
  await assert.rejects(Archive.verifiedFragmentRecord(remote.api,tree,badWhole),/REASSEMBLED_FILE_HASH_MISMATCH/);
  remote.state.tamperedBlob=saved.records[0].fragments[0].pack.gitSha;
  await assert.rejects(Archive.verifiedFragmentRecord(remote.api,tree,saved),/REMOTE_BLOB_HASH_MISMATCH/);
  remote.state.tamperedBlob=null;
  const missingTree=new Map(originalTree); missingTree.delete(saved.records[0].fragments[1].pack.path);
  remote.state.trees.set(remote.state.commits.get(remote.state.ref).tree,missingTree);
  await assert.rejects(Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'big.json',originalSha256:Archive.sha256(original)}),/MANIFEST_PACK_MISSING_FROM_REF/);
  assert.equal(fs.existsSync(path.join(f.workspace,'.runtime/git-data-store/restored')),false);
});

test('partial fragment upload failure and optimistic conflict preserve original and publish no partial file', async t => {
  const f=fixture(t), remote=fakeGitHub(), original=largeDocument(), source=f.write('hourly-observation','big.json',original);
  const startingRef=remote.state.ref; remote.state.failAfterUploads=1;
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/GITHUB_HTTP_503/);
  assert.equal(remote.state.ref,startingRef); assert.deepEqual(fs.readFileSync(source),original);
  assert.equal(fs.existsSync(path.join(f.workspace,'.runtime/git-data-store/INDEX.json')),false);
  remote.state.failAfterUploads=null; remote.state.patchMode='conflict';
  await assert.rejects(Archive.sync({...remote,workspace:f.workspace}),/REMOTE_UPDATE_CONFLICT_OR_UNRESOLVED/);
  assert.equal(remote.state.ref,startingRef); assert.deepEqual(fs.readFileSync(source),original);
  remote.state.patchMode='normal'; await Archive.sync({...remote,workspace:f.workspace});
  const dir=path.join(f.workspace,'.runtime/git-data-store'); fs.writeFileSync(path.join(dir,'LOCK'),'other-process');
  await assert.rejects(Archive.restore({api:remote.api,workspace:f.workspace,alias:'hourly-observation',relative:'big.json',originalSha256:Archive.sha256(original)}),/ARCHIVE_LOCK_BUSY/);
  assert.equal(fs.existsSync(path.join(dir,'restored')),false); fs.unlinkSync(path.join(dir,'LOCK'));
});

test('prune retains schema2 large originals and still verifies eligible legacy reports', async t => {
  const f=fixture(t), remote=fakeGitHub(), old=Date.now()-5*86400000;
  const source=f.write('hourly-observation',`research-forward/evaluation-${old}.json`,largeDocument()); fs.utimesSync(source,new Date(old),new Date(old));
  const small=[];
  for(let i=1;i<5;i++){const target=f.write('hourly-observation',`research-forward/evaluation-${old+i*1000}.json`,{close:i}); fs.utimesSync(target,new Date(old),new Date(old)); small.push(target);}
  await Archive.sync({...remote,workspace:f.workspace});
  const report=await Archive.prune({api:remote.api,workspace:f.workspace,apply:true});
  assert.equal(report.skipped.FRAGMENTED_ORIGINAL_RETAINED,1); assert.equal(report.prunedFiles,1); assert.ok(fs.existsSync(source));
  assert.equal(fs.existsSync(small[0]),false); assert.ok(small.slice(1).every(target=>fs.existsSync(target)));
});

test('64 MiB source/inflation and JSON structure bounds reject larger data explicitly', () => {
  const over=Buffer.alloc(Archive.MAX_SOURCE_FILE+1,65);
  assert.equal(Archive.sanitize(over,'hourly-observation','big.txt').reason,'SOURCE_FILE_TOO_LARGE');
  assert.equal(Archive.sanitize(zlib.gzipSync(over),'hourly-observation','big.txt.gz').reason,'INVALID_OR_OVERSIZED_GZIP');
  let deep='1'; for(let i=0;i<Archive.MAX_JSON_DEPTH+2;i++)deep='['+deep+']';
  assert.equal(Archive.sanitize(Buffer.from(deep),'hourly-observation','deep.json').reason,'JSON_STRUCTURE_BUDGET_EXCEEDED');
});

test('hash-consistent malicious fragments still require full privacy inspection, legacy checks remain separate', async t => {
  const f=fixture(t), remote=fakeGitHub(), original=largeDocument();
  f.write('hourly-observation','big.json',original); await Archive.sync({...remote,workspace:f.workspace});
  const found=fragmentManifest(remote), record=found.value.records[0];
  const prefix='{"close":4186,"padding":"';
  const unsafe=Buffer.from(prefix+'A'.repeat(Archive.FRAGMENT_BYTES-prefix.length-5)+'github_pat_ABCDEFGHIJKLMNOPQRSTUV'+'B'.repeat(14*1024*1024)+'"}');
  record.originalSha256=record.storedSha256=Archive.sha256(unsafe); record.originalBytes=record.storedBytes=unsafe.length;
  record.fragments=[];
  for(let offset=0,index=0;offset<unsafe.length;offset+=Archive.FRAGMENT_BYTES,index++) {
    const bytes=unsafe.subarray(offset,Math.min(offset+Archive.FRAGMENT_BYTES,unsafe.length)), hash=Archive.sha256(bytes);
    const pack=Archive.buildPack([{bytes,storedBytes:bytes.length,storedSha256:hash}]);
    const reference={path:`packs/${pack.sha256}.json.gz`,sha256:pack.sha256,gitSha:pack.gitSha,bytes:pack.bytes.length};
    found.tree.set(reference.path,reference.gitSha); remote.state.blobs.set(reference.gitSha,pack.bytes);
    record.fragments.push({index,offset,bytes:bytes.length,sha256:hash,pack:reference});
  }
  const tree=await remote.api.treeAt(remote.state.ref);
  await assert.rejects(Archive.verifiedFragmentRecord(remote.api,tree,found.value),/ARCHIVED_FILE_PRIVACY_CHECK_FAILED/);
  await assert.rejects(Archive.verifiedPack(remote.api,tree,found.value),/FRAGMENTS_MUST_USE_WHOLE_FILE_VERIFICATION/);

  const bytes=Buffer.from('{"close":4186,"apiToken":"opaque-private-value"}');
  const pack=Archive.buildPack([{bytes,storedBytes:bytes.length,storedSha256:Archive.sha256(bytes)}]);
  const reference={path:`packs/${pack.sha256}.json.gz`,sha256:pack.sha256,gitSha:pack.gitSha,bytes:pack.bytes.length};
  found.tree.set(reference.path,reference.gitSha); remote.state.blobs.set(reference.gitSha,pack.bytes);
  const legacy={schema:1,privacyPolicy:Archive.POLICY,pack:reference,records:[{alias:'hourly-observation',relative:'unsafe.json',
    privacyPolicy:Archive.POLICY,originalSha256:Archive.sha256(bytes),storedSha256:Archive.sha256(bytes),originalBytes:bytes.length,
    storedBytes:bytes.length,redacted:false,exactOriginalRestorable:true}]};
  await assert.rejects(Archive.verifiedPack(remote.api,await remote.api.treeAt(remote.state.ref),legacy),/ARCHIVED_FILE_PRIVACY_CHECK_FAILED/);
  legacy.records[0].originalBytes++;
  assert.throws(()=>Archive.validateManifest(legacy),/MANIFEST_RECORD_INVALID/);
});
