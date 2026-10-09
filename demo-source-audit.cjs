'use strict';
// Offline supplement: never rewrites the registered v1 execution identity.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const baseline=require('./demo-source-baseline.json');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function audit(root=__dirname,legacyHash,manifest=baseline){
  const issues=[],actual={};
  if(manifest?.schemaVersion!==1||manifest.protocolVersion!=='demo-v1'||!hex(manifest.legacyExecutionHash)||
    !manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files)||!Object.keys(manifest.files).length)
    return {valid:false,issues:[{code:'INVALID_SOURCE_BASELINE'}]};
  if(legacyHash!==manifest.legacyExecutionHash)issues.push({code:'REGISTERED_IDENTITY_MISMATCH'});
  const base=fs.realpathSync(root),prefix=base+path.sep;
  for(const file of Object.keys(manifest.files).sort()){
    if(!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:js|cjs|mjs)$/.test(file)||!hex(manifest.files[file])){
      issues.push({code:'INVALID_SOURCE_ENTRY',file});continue;
    }
    try{
      const target=fs.realpathSync(path.join(base,file));
      if(!target.startsWith(prefix)){issues.push({code:'SOURCE_OUTSIDE_ROOT',file});continue;}
      actual[file]=digest(fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n'));
      if(actual[file]!==manifest.files[file])issues.push({code:'SOURCE_CONTENT_CHANGED',file});
    }catch{issues.push({code:'SOURCE_UNAVAILABLE',file});}
  }
  const expected=Object.fromEntries(Object.keys(manifest.files).sort().map(file=>[file,manifest.files[file]]));
  return {valid:issues.length===0,kind:manifest.kind,legacyHash,sourceHash:digest(JSON.stringify(actual)),
    expectedSourceHash:digest(JSON.stringify(expected)),fileCount:Object.keys(actual).length,
    observedAt:manifest.observedAt,referenceCommit:manifest.referenceCommit,scope:manifest.scope,issues};
}
if(require.main===module){
  const result=audit(__dirname,require('./demo-version.cjs').identity().hash);
  console.log(JSON.stringify(result));if(!result.valid)process.exitCode=1;
}
module.exports={audit,baseline};
