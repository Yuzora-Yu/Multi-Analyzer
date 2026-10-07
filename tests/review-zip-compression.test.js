'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib'),R=require('../review-pack');
async function unpack(blob){const bytes=Buffer.from(await blob.arrayBuffer()),end=bytes.length-22;assert.equal(bytes.readUInt32LE(end),0x06054b50);let p=bytes.readUInt32LE(end+16);const entries=[];
 for(let i=0;i<bytes.readUInt16LE(end+10);i++){assert.equal(bytes.readUInt32LE(p),0x02014b50);const method=bytes.readUInt16LE(p+10),length=bytes.readUInt16LE(p+28),local=bytes.readUInt32LE(p+42),size=bytes.readUInt32LE(p+20),name=bytes.subarray(p+46,p+46+length).toString(),start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28),stored=bytes.subarray(start,start+size),data=method===8?zlib.inflateRawSync(stored):stored;
   assert.equal(bytes.readUInt32LE(local),0x04034b50);assert.equal(bytes.readUInt16LE(local+8),method);assert.equal(bytes.readUInt32LE(local+18),size);assert.equal(bytes.readUInt32LE(local+22),data.length);assert.equal(bytes.readUInt32LE(p+24),data.length);assert.equal(R.crc32(data),bytes.readUInt32LE(p+16));assert.equal(bytes.readUInt32LE(local+14),bytes.readUInt32LE(p+16));entries.push({name,data,method});p+=46+length+bytes.readUInt16LE(p+30)+bytes.readUInt16LE(p+32);}
 assert.equal(p,end);return{entries,bytes};}
test('native raw deflate preserves Japanese JSON/text and binary entries byte-for-byte',async()=>{
 const files=[{name:'manifest.json',data:JSON.stringify({bars:Array(1000).fill({close:123.45,note:'確定足・原本は維持'})})},{name:'consult-ai.txt',data:'保存した候補条件\n'.repeat(1000)},{name:'chart.png',data:new Uint8Array([137,80,78,71,0,255])},{name:'empty.txt',data:''}],before=JSON.stringify(files),result=await unpack(await R.zipCompressed(files));
 assert.equal(result.entries[0].method,8);assert.equal(result.entries[1].method,8);assert.equal(result.entries[2].method,0);assert.equal(result.entries[3].method,0);
 result.entries.forEach((r,i)=>{assert.equal(r.name,files[i].name);assert.deepEqual(r.data,Buffer.from(files[i].data));});assert.ok(result.bytes.length<(await R.zip(files).arrayBuffer()).byteLength/5);assert.equal(JSON.stringify(files),before);
});
test('unsupported or asynchronously failing compressor falls back to identical STORE archive',async()=>{
 const files=[{name:'manifest.json',data:'原本'.repeat(500)},{name:'chart.png',data:new Uint8Array([0,1,255])}],original=Buffer.from(await R.zip(files).arrayBuffer());
 class Unsupported{constructor(){throw Error('unsupported');}}
 class Failed{constructor(){const stream=new TransformStream({transform(){throw Error('compression failed');}});this.readable=stream.readable;this.writable=stream.writable;}}
 for(const C of [null,Unsupported,Failed]){const result=await unpack(await R.zipCompressed(files,{CompressionStreamClass:C}));assert.deepEqual(result.bytes,original);assert.ok(result.entries.every(r=>r.method===0));}
});
test('larger compression is discarded and unsafe names still fail before publication',async()=>{
 const f=[{name:'tiny.txt',data:'x'}],r=await unpack(await R.zipCompressed(f));assert.equal(r.entries[0].method,0);assert.equal(r.entries[0].data.toString(),'x');
 await assert.rejects(R.zipCompressed([{name:'../unsafe.json',data:'x'}]),/Unsafe/);
 const fs=require('node:fs'),source=fs.readFileSync(require.resolve('../review-pack'),'utf8');assert.match(source,/archive=await zipCompressed\(files\)/);assert.match(source,/URL\.createObjectURL\(archive\)/);
});
