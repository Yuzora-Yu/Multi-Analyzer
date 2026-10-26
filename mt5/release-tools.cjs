'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const SOURCE_FILES=['MultiAnalyzerGold.mq5','MAZoneCore.mqh','MAFlowCore.mqh','MAHistoryCore.mqh','MAResponseCore.mqh','MAVisualCore.mqh','MAInstrumentCore.mqh','README_JA.txt','CHANGELOG.md'];
const validVersion=v=>typeof v==='string'&&/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(v);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validate(meta){
 if(!validVersion(meta.version)||meta.file!==`MultiAnalyzerGold-${meta.version}.zip`||!/^[0-9a-f]{64}$/.test(meta.sha256)||!Number.isSafeInteger(meta.bytes)||meta.bytes<=0)throw Error('INVALID_MT5_RELEASE');
 if(meta.stage!=='preview'||!meta.runtimeVerification)throw Error('MT5_VERIFICATION_SCOPE_REQUIRED');
 if(!meta.sources||JSON.stringify(Object.keys(meta.sources).sort())!==JSON.stringify([...SOURCE_FILES].sort())||Object.values(meta.sources).some(v=>!/^[0-9a-f]{64}$/.test(v))||!/^[0-9a-f]{64}$/.test(meta.compiledSha256)||meta.compiler?.errors!==0||meta.compiler?.warnings!==0)throw Error('INVALID_MT5_BUILD_EVIDENCE');
 return meta;
}
function page(m){
 validate(m);
 const values={...m,bytes:m.bytes.toLocaleString('en-US')};
 const template=fs.readFileSync(path.join(__dirname,'download-page.html'),'utf8').replace(/\r\n/g,'\n');
 return template.replace(/\{\{(\w+)\}\}/g,(_,key)=>{if(!Object.hasOwn(values,key))throw Error('UNKNOWN_MT5_PAGE_FIELD');return escape(values[key]);});
}
function verify(root){const m=validate(JSON.parse(fs.readFileSync(path.join(root,'downloads/mt5-latest.json'))));const b=fs.readFileSync(path.join(root,'downloads',m.file));if(hash(b)!==m.sha256||b.length!==m.bytes)throw Error('MT5_ARCHIVE_HASH_MISMATCH');const c=JSON.parse(fs.readFileSync(path.join(root,'mt5/release-config.json')));if(c.version!==m.version||c.mqlVersion!==m.mqlVersion||JSON.stringify(c.sourceFiles)!==JSON.stringify(SOURCE_FILES))throw Error('MT5_VERSION_MISMATCH');for(const [name,expected] of Object.entries(m.sources)){const b=Buffer.from(fs.readFileSync(path.join(root,'mt5',name),'utf8').replace(/\r\n/g,'\n'));if(hash(b)!==expected)throw Error('MT5_SOURCE_HASH_MISMATCH_'+name);}if(!fs.readFileSync(path.join(root,'mt5/MultiAnalyzerGold.mq5'),'utf8').includes(`#property version "${m.mqlVersion}"`))throw Error('MT5_MQL_VERSION_MISMATCH');const html=fs.readFileSync(path.join(root,'index.html'),'utf8');if(!html.includes(`href="downloads/${m.file}"`))throw Error('MT5_APP_LINK_MISMATCH');if(fs.readFileSync(path.join(root,'mt5.html'),'utf8').replace(/\r\n/g,'\n')!==page(m))throw Error('MT5_PAGE_MISMATCH');return m;}
module.exports={hash,validate,page,verify,SOURCE_FILES,validVersion};
if(require.main===module)console.log(JSON.stringify({verified:true,version:verify(path.resolve(__dirname,'..')).version}));
