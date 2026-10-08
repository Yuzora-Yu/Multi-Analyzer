import Demo from '../demo-trading.cjs';
import { DEMO_CODE_HASH } from './demo-code-version.mjs';

const KEY='demo:'+Demo.PROTOCOL.version;
const PREFIX=KEY+':journal:';
const sequenceKey=n=>PREFIX+String(n).padStart(10,'0');
const sha256=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

async function persist(tx,lab,record,source,sourceHash) {
  const sequence=lab.sequence+1;
  const payload={...record,sequence,previousHash:lab.chain,codeHash:DEMO_CODE_HASH,
    protocol:lab.protocol,asset:lab.asset,market:lab.market,symbol:lab.symbol,sourceHash};
  const hash=await sha256(JSON.stringify(payload));
  lab.sequence=sequence;lab.chain=hash;lab.codeHash=DEMO_CODE_HASH;
  // Snapshot, journal and account state commit together; none are stored in Git.
  const writes={[KEY]:lab,[sequenceKey(sequence)]:{...payload,hash}};
  if(source)writes[KEY+':source:'+source.id]=source;
  await tx.put(writes);
}

export async function observeDemo(storage,snapshot,analysis,now,allowed) {
  const sourceHash=await sha256(JSON.stringify(snapshot));
  await storage.transaction(async tx=>{
    const old=await tx.get(KEY);
    if(old?.codeHash && old.codeHash!==DEMO_CODE_HASH)throw new Error('DEMO_CODE_CHANGE_REQUIRES_NEW_VERSION');
    const {lab,record}=Demo.advance(old,snapshot,analysis,now,allowed);
    if(record)await persist(tx,lab,record,snapshot,sourceHash);
  });
  // A real completion acknowledgement, not a timestamp guessed before a write.
  await storage.sync();
  const durableAt=Date.now();
  await storage.transaction(async tx=>{
    const old=await tx.get(KEY);
    if(!old)return;
    const {lab,record}=Demo.acknowledge(old,snapshot.id,durableAt);
    if(record)await persist(tx,lab,record,null,sourceHash);
  });
}

export async function demoView(storage,asset,now,monitorState) {
  const lab=await storage.get(KEY);
  const view=Demo.publicView(lab,now,monitorState);
  return {...view,asset,market:asset==='gold'?'futures':'spot',symbol:asset==='gold'?'XAUUSDT':'BTCUSDT'};
}

export async function demoJournal(storage,cursor=0,limit=100) {
  const rows=await storage.list({prefix:PREFIX,startAfter:sequenceKey(cursor),limit});
  const records=[...rows.values()];
  return {schemaVersion:1,protocolVersion:Demo.PROTOCOL.version,records,
    nextCursor:records.length===limit?records.at(-1).sequence:null};
}
export async function demoSource(storage,id){return storage.get(KEY+':source:'+id);}
