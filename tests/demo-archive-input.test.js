'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Archive=require('../research-git-store.cjs');
const Demo=require('../demo-review.cjs');
const Input=require('../demo-archive-input.cjs');
const Core=require('../strategy-core.js');
function sample(asset='gold') {
  const time=1791756000000;
  const source={id:`${asset}-${time}-${Core.VERSION}`,asset,version:Core.VERSION,
    symbol:asset==='gold'?'XAUUSDT':'BTCUSDT',settings:{market:asset==='gold'?'futures':'spot',now:time+900001},
    bars:{m15:[[time,4180,4190,4170,4186,7]],h1:[],h4:[]}};
  const envelope={firstRetrievedAt:time+950000,payloadHash:Demo.hash(source),original:source};
  const bytes=Buffer.from(JSON.stringify(envelope));
  return {bytes,source,envelope,input:{asset,snapshotId:source.id,sourceHash:envelope.payloadHash,originalSha256:Archive.sha256(bytes)}};
}
function modified(original,change) {
  const envelope=structuredClone(original.envelope);change(envelope.original);envelope.payloadHash=Demo.hash(envelope.original);
  const bytes=Buffer.from(JSON.stringify(envelope));
  return {bytes,input:{...original.input,sourceHash:envelope.payloadHash,originalSha256:Archive.sha256(bytes)}};
}
test('archived input preserves original prices, cutoff and first retrieval without becoming a new forecast',()=>{
  const s=sample(),copy=Buffer.from(s.bytes),out=Input.decodeSourceInput(s.input,s.bytes);
  assert.deepEqual(out.source,s.source);assert.equal(out.firstRetrievedAt,s.envelope.firstRetrievedAt);
  assert.deepEqual(s.bytes,copy);
  const requested=Input.sourceRequest({...s.input,relative:'../arbitrary.json',alias:'unapproved'});
  assert.equal(requested.alias,'demo-lab');assert.equal(requested.relative,`ledger-cache/gold/demo-v1/sources/${Demo.hash(s.source.id)}.json`);
  assert.equal(requested.originalSha256,s.input.originalSha256);
});
test('valid file bytes alone cannot replace authoritative payload, market, ID, version or cutoff',()=>{
  const s=sample();const forged=modified(s,x=>{x.bars.m15[0][4]=4300;});
  assert.throws(()=>Input.decodeSourceInput({...forged.input,sourceHash:s.input.sourceHash},forged.bytes),/PAYLOAD_HASH_MISMATCH/);
  for(const change of [x=>{x.asset='btc';},x=>{x.symbol='BTCUSDT';},x=>{x.settings.market='spot';},
    x=>{x.id=x.id.replace('gold','btc');},x=>{x.version='future-version';},x=>{x.settings.now+=900000;}]) {
    const bad=modified(s,change);assert.throws(()=>Input.decodeSourceInput(bad.input,bad.bytes),/IDENTITY_MISMATCH/);
  }
  assert.throws(()=>Input.decodeSourceInput(s.input,Buffer.from(s.bytes.toString().replace('4186','4300'))),/FILE_HASH_MISMATCH/);
  assert.throws(()=>Input.sourceRequest({...s.input,snapshotId:'gold-../../input-'+Core.VERSION}),/ID_INVALID/);
  assert.throws(()=>Input.sourceRequest({...s.input,originalSha256:'unversioned'}),/EXACT_HASH_REQUIRED/);
  const unaligned=modified(s,x=>{x.bars.m15[0][0]++;x.id=`gold-${x.bars.m15[0][0]}-${Core.VERSION}`;x.settings.now++;});
  assert.throws(()=>Input.decodeSourceInput({...unaligned.input,snapshotId:JSON.parse(unaligned.bytes).original.id},unaligned.bytes),/IDENTITY_MISMATCH/);
});
test('archive reconstruction remains analysis-only with no local forecast/cache creation',async()=>{
  const gold=sample(),btc=sample('btc'),original=Archive.readExactBatch;
  let called=0;
  Archive.readExactBatch=async options=>{called++;assert.deepEqual(options.inputs,[gold,btc].map(s=>Input.sourceRequest(s.input)));
    return {verifiedRef:'a'.repeat(40),catalogManifests:1,catalogBytes:700,packFetches:1,returnedBytes:gold.bytes.length+btc.bytes.length,
      datasetCopiesWritten:0,gitWrites:0,values:[gold,btc].map(s=>({...Input.sourceRequest(s.input),data:s.bytes,manifestPath:'manifests/sample.json',manifestGitSha:'b'.repeat(40)}))};};
  try {
    const replay=await Input.analyzeArchivedSources([gold.input,btc.input]);
    assert.equal(called,1);assert.equal(replay.mode,'ARCHIVE_ANALYSIS_RECONSTRUCTION');
    assert.equal(replay.datasetCopiesWritten,0);assert.equal(replay.gitWrites,0);
    assert.match(replay.scope,/Not a new prospective forecast/);
    for(const [i,row] of replay.values.entries()){const s=[gold,btc][i];assert.deepEqual(row.source,s.source);
      assert.equal(row.firstRetrievedAt,s.envelope.firstRetrievedAt);assert.equal(row.analysis.generatedAt,s.source.settings.now);}
  } finally {Archive.readExactBatch=original;}
});
