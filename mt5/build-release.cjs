'use strict';
// Existing local MetaEditor only. No installation, credentials, market fetch or terminal launch.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {hash,page,validate,SOURCE_FILES,validVersion}=require('./release-tools.cjs');
const root=path.resolve(__dirname,'..'),config=JSON.parse(fs.readFileSync(path.join(__dirname,'release-config.json')));
const compiler=process.env.MT5_METAEDITOR||'C:\\Program Files\\XMTrading MT5\\MetaEditor64.exe';
if(!validVersion(config.version)||config.stage!=='preview'||JSON.stringify(config.sourceFiles)!==JSON.stringify(SOURCE_FILES))throw Error('INVALID_RELEASE_CONFIG');
const file=`MultiAnalyzerGold-${config.version}.zip`,target=path.join(root,'downloads',file);
if(fs.existsSync(target))throw Error('RELEASE_ALREADY_EXISTS_USE_NEW_VERSION');
if(!fs.existsSync(compiler))throw Error('EXISTING_METAEDITOR_REQUIRED');
const stage=path.join(root,'.runtime','mt5-build',config.version,crypto.randomUUID());fs.mkdirSync(stage,{recursive:true});
const sources={};for(const name of config.sourceFiles){if(!/^[A-Za-z0-9_.-]+$/.test(name))throw Error('INVALID_SOURCE_PATH');const b=Buffer.from(fs.readFileSync(path.join(__dirname,name),'utf8').replace(/\r\n/g,'\n'));sources[name]=hash(b);fs.writeFileSync(path.join(stage,name),b,{flag:'wx'});}
const source=path.join(stage,'MultiAnalyzerGold.mq5');
if(!fs.readFileSync(source,'utf8').includes(`#property version "${config.mqlVersion}"`))throw Error('MQL_VERSION_MISMATCH');
const result=cp.spawnSync(compiler,[`/compile:${source}`,'/log'],{windowsHide:true,timeout:120000});
const logFile=path.join(stage,'MultiAnalyzerGold.log');if(!fs.existsSync(logFile))throw Error('COMPILER_LOG_MISSING');const log=fs.readFileSync(logFile).toString('utf16le');
if(!/Result: 0 errors, 0 warnings,/.test(log))throw Error('COMPILER_NOT_CLEAN_SEE_LOCAL_LOG');
const binary=fs.readFileSync(path.join(stage,'MultiAnalyzerGold.ex5'));
const manifest={version:config.version,mqlVersion:config.mqlVersion,stage:config.stage,compiler:{errors:0,warnings:0},runtimeVerification:config.runtimeVerification,files:{...sources,'MultiAnalyzerGold.ex5':hash(binary)}};
fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const names=[...config.sourceFiles,'MultiAnalyzerGold.ex5','manifest.json'];
fs.mkdirSync(path.dirname(target),{recursive:true});
const python=`import sys,zipfile,pathlib\np=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2])\nwith zipfile.ZipFile(out,'x',compression=zipfile.ZIP_DEFLATED) as z:\n for name in sys.argv[3:]:\n  i=zipfile.ZipInfo(name,(2026,1,1,0,0,0));i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,(p/name).read_bytes())\nwith zipfile.ZipFile(out) as z:\n assert z.testzip() is None\n`;
const zip=cp.spawnSync('python',['-c',python,stage,target,...names],{encoding:'utf8',windowsHide:true});if(zip.status!==0)throw Error('ZIP_BUILD_FAILED');
const bytes=fs.readFileSync(target),meta=validate({...config,file,bytes:bytes.length,sha256:hash(bytes),sources,compiledSha256:hash(binary),compiler:{errors:0,warnings:0}});
fs.writeFileSync(path.join(root,'downloads/mt5-latest.json'),JSON.stringify(meta,null,2)+'\n');fs.writeFileSync(path.join(root,'mt5.html'),page(meta));
const index=path.join(root,'index.html');let html=fs.readFileSync(index,'utf8');const link=`<a class="ghost-button" data-mt5-download href="downloads/${file}" download title="Windows用MT5・検証版 ${config.version}">MT5版 ↓</a>`;
if(/<a\b[^>]*data-mt5-download[^>]*>[^<]*<\/a>/.test(html))html=html.replace(/<a\b[^>]*data-mt5-download[^>]*>[^<]*<\/a>/,link);else html=html.replace('      <span>15分＝共通判定',`      ${link}\n      <a class="mt5-guide-link" href="mt5.html">導入・更新履歴</a>\n      <span>15分＝共通判定`);
fs.writeFileSync(index,html);console.log(JSON.stringify({version:meta.version,compiled:true,compilerErrors:0,compilerWarnings:0,zip:file,bytes:meta.bytes,sha256:meta.sha256,runtimeVerification:meta.runtimeVerification}));
