'use strict';
const fs=require('node:fs'),path=require('node:path');
const {verify,hash}=require('./release-tools.cjs');
async function publish({root,repo,tag,commit,token,fetcher=fetch}){
 const meta=verify(root);
 if(repo!=='Yuzora-Yu/Multi-Analyzer'||tag!=='mt5-v'+meta.version||!/^[a-f0-9]{40}$/.test(commit)||!token)throw Error('INVALID_RELEASE_TARGET');
 const base='https://api.github.com/repos/'+repo,headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};
 async function request(url,options={}){const r=await fetcher(url,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(30000)});return r;}
 async function json(url,options={}){const r=await request(url,options);if(!r.ok)throw Error('RELEASE_HTTP_'+r.status);return r.json();}
 let r=await request(base+'/releases/tags/'+encodeURIComponent(tag)),release;
 if(r.status===404)release=await json(base+'/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,target_commitish:commit,name:'MT5 Multi-Analyzer '+meta.version,draft:true,prerelease:true,body:`Windows版MT5の検証版です。\n\n${meta.scope}\n\n${meta.runtimeVerification}。自動売買は行いません。\n\nZIP SHA256: ${meta.sha256}\n\n導入・更新: https://yuzora-yu.github.io/Multi-Analyzer/mt5.html`})});
 else{if(!r.ok)throw Error('RELEASE_LOOKUP_HTTP_'+r.status);release=await r.json();}
 if(!Number.isSafeInteger(release.id)||release.tag_name!==tag||!Array.isArray(release.assets))throw Error('INVALID_RELEASE_IDENTITY');
 const assets=[{name:meta.file,bytes:fs.readFileSync(path.join(root,'downloads',meta.file)),type:'application/zip'},{name:'mt5-'+meta.version+'.json',bytes:fs.readFileSync(path.join(root,'downloads/mt5-latest.json')),type:'application/json'}];
 for(const a of assets){let asset=release.assets.find(x=>x.name===a.name);
  if(!asset){if(!release.draft)throw Error('PUBLISHED_RELEASE_MISSING_ASSET_NO_MUTATION');asset=await json(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(a.name)}`,{method:'POST',headers:{'Content-Type':a.type},body:a.bytes});}
  if(!Number.isSafeInteger(asset.id)||asset.size!==a.bytes.length)throw Error('RELEASE_ASSET_IDENTITY_MISMATCH');
  const received=await request(base+'/releases/assets/'+asset.id,{headers:{Accept:'application/octet-stream'}});if(!received.ok)throw Error('RELEASE_READBACK_HTTP_'+received.status);
  if(hash(Buffer.from(await received.arrayBuffer()))!==hash(a.bytes))throw Error('RELEASE_READBACK_HASH_MISMATCH_NO_OVERWRITE');
 }
 if(release.draft)await json(base+'/releases/'+release.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:false,prerelease:true})});
 return {version:meta.version,verifiedAssets:assets.length,url:'https://github.com/'+repo+'/releases/tag/'+tag};
}
module.exports={publish};
if(require.main===module)publish({root:path.resolve(__dirname,'..'),repo:process.env.GITHUB_REPOSITORY,tag:process.env.GITHUB_REF_NAME,commit:process.env.GITHUB_SHA,token:process.env.GITHUB_TOKEN}).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});
