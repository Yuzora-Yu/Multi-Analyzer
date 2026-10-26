const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {load}=require('../mt5/tests/load-response.cjs');const V=load();
test('higher-frame view hides intraday clutter and all-frames restores every source',()=>{
 const frames=[60,300,900,3600,14400,86400,604800];
 assert.deepEqual(frames.filter(s=>V.frameVisible(s,14400,false)),[14400,86400,604800]);
 assert.deepEqual(frames.filter(s=>V.frameVisible(s,86400,false)),[86400,604800]);
 assert.deepEqual(frames.filter(s=>V.frameVisible(s,14400,true)),frames);
 assert.equal(V.frameVisible(0,14400,true),false);
});
test('crowded callouts reject collisions, chart controls, price line and offscreen space at narrow and wide sizes',()=>{
 for(const width of [440,648,1838])for(const minTop of [80,144]){
  const height=600,boxes=[{left:0,right:width,top:390,bottom:410}],w=260,h=18,left=width-w-8;
  for(const target of [400,400,401,402]){
   let top;
   for(let i=0;i<31;i++){const offset=i===0?0:Math.floor((i+1)/2)*22*(i%2===1?1:-1),y=target-h/2+offset;
    if(V.labelFits(left,y,w,h,width,height,minTop,boxes)){top=y;break;}}
   assert.notEqual(top,undefined);assert(top>=minTop&&top+h<=height);
   for(const b of boxes)assert(left>=b.right+5||left+w<=b.left-5||top>=b.bottom+3||top+h<=b.top-3);
   boxes.push({left,right:left+w,top,bottom:top+h});
  }
  assert.equal(V.labelFits(-1,200,w,h,width,height,minTop,[]),false);
  assert.equal(V.labelFits(left,20,w,h,width,height,minTop,[]),false);
  assert.equal(V.labelFits(left,200,w,h,width,height,height,[]),false);
 }
});
test('zone, response, history and P/EXIT rules retain their released implementation',()=>{
 const expected={'MAZoneCore.mqh':'878b328cc1e0f8fe1f39b8e5c72b8a17af93f13d7a50213ebc004b9089d1f464','MAFlowCore.mqh':'306ada4dc5297e406f9f443e2bc2153e06b7f321e5ffecb063fda8a3205ed2b5','MAHistoryCore.mqh':'46bff12e6dde4c851d9d6ec8479f318731f40962a86cb9a204ee487b777a02f0','MAResponseCore.mqh':'7d4d35274c485caaf5e2d65230bdd58896732c5626c59a32da3761f66e622d29'};
 for(const [file,hash] of Object.entries(expected)){
  let bytes=fs.readFileSync(path.join(__dirname,'../mt5',file),'utf8').replace(/\r\n/g,'\n');
  // The sole Flow changes are the broker label and optional price rounding precision.
  // Undo only those exact additions: the original rules must still hash identically.
  if(file==='MAFlowCore.mqh')bytes=bytes.replace('broker tick activity','XM tick activity')
   .replace(',const int priceDigits=6','').replaceAll(',priceDigits)',',6)');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),hash,file);
 }
});
