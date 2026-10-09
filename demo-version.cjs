'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const files=['demo-trading.cjs','cloudflare/demo-store.mjs','cloudflare/monitor.mjs',
  'strategy-core.js','flow-core.js','smc-core.js','market-feed.js'];
function identity(root=__dirname){
  const hashes=Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n')).digest('hex')]));
  return {files:hashes,hash:crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex')};
}
if(require.main===module){
  const expected=identity(),target=path.join(__dirname,'cloudflare/demo-code-version.mjs');
  if(process.argv.includes('--write')){
    fs.writeFileSync(target,'// LF-normalized SHA256 of the fixed demo runtime dependencies.\n'+
      `export const DEMO_CODE_HASH = '${expected.hash}';\n`,'utf8');
    console.log(JSON.stringify(expected));
  }else{
    const actual=fs.readFileSync(target,'utf8').match(/DEMO_CODE_HASH = '([a-f0-9]{64})'/)?.[1];
    if(actual!==expected.hash)throw new Error('Demo code identity changed; freeze a new version before publication');
    const sourceAudit=require('./demo-source-audit.cjs').audit(__dirname,actual);
    if(!sourceAudit.valid)throw new Error('Demo source supplement changed: '+sourceAudit.issues.map(x=>x.code+(x.file?':'+x.file:'')).join(', '));
    console.log(JSON.stringify({verified:true,hash:actual,sourceAudit}));
  }
}
module.exports={identity,files};
