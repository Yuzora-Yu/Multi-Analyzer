const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I=require('../zone-importance');
const START=Date.UTC(2026,9,20),STEP=60000;
function candles(){return Array.from({length:70},(_,i)=>({time:START+i*STEP,open:100,high:101,low:99,close:100,volume:100}));}
function fixture(){const c=candles();c[30].high=103;Object.assign(c[40],{open:100,high:105,low:100,close:104.5,volume:200});Object.assign(c[41],{open:104.5,high:106,low:104,close:105});for(const b of c.slice(42))Object.assign(b,{open:105,high:106,low:104.5,close:105});return {c,z:{kind:'FVG',direction:'LONG',low:101,high:104},index:41};}
const evaluate=(f,minutes=1,at=Infinity)=>I.evaluate(I.prepare(f.c,minutes),f.z,f.index,{observedAt:at});
test('formation uses the displacement candle and previous21 only, never confirmation or future volume',()=>{
 const f=fixture(),before=JSON.stringify(f),q=evaluate(f);assert.equal(q.formation.relativeVolume,2);assert.equal(q.formation.displacementClosedAt,f.c[40].time+STEP);assert.equal(q.formation.structureBreak,true);assert.equal(JSON.stringify(f),before);
 f.c[41].volume=100000;for(const b of f.c.slice(42))b.volume=100000;assert.deepEqual(evaluate(f).formation,q.formation);
 const prefix={...f,c:f.c.slice(0,42)};assert.deepEqual(evaluate(prefix).formation,q.formation);assert.equal(evaluate(f,1,f.c[41].time+STEP-1).available,false);
});
test('greater relative formation activity increases observation score without creating a zone or entry',()=>{
 const f=fixture();f.c[40].volume=100;const low=evaluate(f);f.c[40].volume=300;const high=evaluate(f);assert(high.score>low.score);assert.equal(high.role.label,'短期');assert(!('actionable' in high));assert.deepEqual(f.z,{kind:'FVG',direction:'LONG',low:101,high:104});
});
test('parent and timing roles stay distinct even if a rich M1 score exceeds a worn H1 score',()=>{
 const strong={importance:{...I.points(1,3,2,true,0),role:I.role(1)},minutes:1,distance:0};
 const worn={importance:{...I.points(60,.5,.5,false,5),role:I.role(60)},minutes:60,distance:5};
 assert(strong.importance.score>worn.importance.score);assert.deepEqual([strong,worn].sort(I.compare),[worn,strong]);assert.equal(I.role(15).label,'波');
});
test('revisits are episodes, and formation facts do not gain retrospective structure evidence',()=>{
 const f=fixture();Object.assign(f.c[44],{low:103});Object.assign(f.c[45],{low:103});Object.assign(f.c[48],{low:103});
 const q=evaluate(f);assert.equal(q.current.visits,2);const original={...f,c:f.c.slice(0,42)};assert.deepEqual(q.formation,evaluate(original).formation);assert(q.score<evaluate(original).score);
});
test('missing/zero volume remains unknown with partial flag, not a measured zero ratio',()=>{
 for(const mutate of [f=>f.c[40].volume=0,f=>delete f.c[31].volume,f=>f.c[39].volume=NaN]){const f=fixture();mutate(f);const q=evaluate(f);assert.equal(q.formation.relativeVolume,null);assert(q.partial);assert.match(I.summary(q),/形成量 未取得/);}
 const f=fixture();assert.equal(I.evaluate(I.prepare(f.c.slice(0,10),1),f.z,9).formation.relativeVolume,null);
});
test('a full fill or close break retires observation, and later recovery cannot restore it',()=>{
 const f=fixture();f.c[44].low=101;const q=evaluate(f);assert(q.retired);assert.equal(q.current.observedThrough,f.c[44].time+STEP);assert.equal(q.current.visits,0);
});
test('pivot confirmation at the breakout close is unavailable as prior structural evidence',()=>{
 const c=candles();c[30].high=103;Object.assign(c[33],{open:100,high:104,close:103.5});const p=I.prepare(c,1);assert.equal(p.breaks[33],0);
});
test('observation text distinguishes unknowns and does not render untrusted basis HTML',()=>{
 const f=fixture(),q=I.evaluate(I.prepare(f.c,1,{volumeBasis:'<script>x</script>'}),f.z,f.index);assert.match(I.html(q),/&lt;script&gt;/);assert(!I.html(q).includes('<script>'));assert.match(I.html(q),/反発確率・P・売買成立ではありません/);assert.match(I.summary(q),/短期/);
});
test('per-zone evidence expansion has stable escaped identity, separate from history expansion',()=>{
 const q=evaluate(fixture()),html=I.html(q,{id:'zone"<id>',expanded:true});assert.match(html,/data-importance-zone="zone&quot;&lt;id&gt;" open/);assert(!I.html(q,{id:'other'}).includes(' open'));
});
function nativeScoring(){
 const text=fs.readFileSync(require.resolve('../mt5/MAZoneImportance.mqh'),'utf8'),ctx=vm.createContext({EMPTY_VALUE:Number.MAX_VALUE,MathMin:Math.min,MathMax:Math.max});
 for(const name of ['MAImportanceRole','MAImportanceTimePoints','MAImportanceScore','MAMoreImportant']){
  const match=new RegExp('(?:int|void|bool) '+name+'\\(([^)]*)\\) \\{').exec(text);assert(match,name);let end=match.index+match[0].length,depth=1,start=end;while(depth){if(text[end]==='{')depth++;if(text[end]==='}')depth--;end++;}
  const args=match[1].split(',').map(s=>s.match(/([A-Za-z_]\w*)$/)[1]);let body=text.slice(start,end-1).replace(/\(int\)/g,'');vm.runInContext(`function ${name}(${args.join(',')}){${body}}`,ctx);
 }
 return ctx;
}
test('MT5 source scoring exactly matches Web tiers, missing activity, volume and repeated touches',()=>{
 const n=nativeScoring();for(const minutes of [1,5,15,60,240,1440])for(const ratio of [null,.7,1,1.3,1.8,3])for(const body of [null,.5,1,2])for(const structure of [false,true])for(const visits of [0,1,2,5]){
  const q={relativeVolume:ratio??Number.MAX_VALUE,bodyATR:body??Number.MAX_VALUE,structure,visits};n.MAImportanceScore(minutes,q);const web=I.points(minutes,ratio,body,structure,visits);
  assert.equal(q.score,web.score);assert.equal(q.role,I.role(minutes).order);assert.equal(q.grade,web.grade==='high'?2:web.grade==='medium'?1:0);assert.equal(q.freshPoints,web.parts.freshness);
 }
});
test('MT5 source formation metrics match Web activity, prior ATR and causal pivot breaks',()=>{
 const ctx=vm.createContext({EMPTY_VALUE:Number.MAX_VALUE,MA_TICK_ACTIVITY:0,MA_REAL_VOLUME:1,MathAbs:Math.abs,MathMax:Math.max,MathMin:Math.min,
  ArraySize:a=>a.length,ArrayResize:(a,n)=>{while(a.length<n)a.push(0);a.length=n;},ArrayInitialize:(a,v)=>a.fill(v),MAValid:c=>c.length>=60});
 for(const [file,names] of [['MAZoneCore.mqh',['MAPivot','MAATR']],['MAFlowCore.mqh',['MAVolume']],['MAZoneImportance.mqh',['MAImportancePrepare']]]){
  const src=fs.readFileSync(require.resolve('../mt5/'+file),'utf8');
  for(const name of names){const m=new RegExp('(?:void|bool|double) '+name+'\\(([^)]*)\\) \\{').exec(src);assert(m,name);let end=m.index+m[0].length,start=end,depth=1;while(depth){if(src[end]==='{')depth++;if(src[end]==='}')depth--;end++;}
   const args=m[1].split(',').map(x=>x.match(/([A-Za-z_]\w*)(?:\[\])?$/)[1]);const body=src.slice(start,end-1).replace(/MAImportanceFact r;/g,'let r={};').replace(/double atr\[\];/g,'let atr=[];').replace(/\b(?:const\s+)?(?:int|bool|double|datetime)\s+/g,'let ').replace(/\((?:double|int)\)/g,'');vm.runInContext(`function ${name}(${args.join(',')}){${body}}`,ctx);
  }
 }
 for(const missing of [false,true]){const f=fixture();if(missing)f.c[31].volume=0;const native=[];assert(ctx.MAImportancePrepare(f.c.map(b=>({...b,tick_volume:b.volume,real_volume:0})),0,native));const web=I.prepare(f.c,1);
  for(let i=0;i<f.c.length;i++){assert.equal(native[i].breakSide,web.breaks[i]);const q=I.evaluate(web,{kind:'OB',side:1,low:90,high:95},i,{observedAt:f.c[i].time+STEP});assert.equal(native[i].relativeVolume===Number.MAX_VALUE?null:native[i].relativeVolume,q.formation.relativeVolume);assert.equal(native[i].bodyATR===Number.MAX_VALUE?null:native[i].bodyATR,q.formation.bodyATR);}
 }
});
test('per-frame AI evidence keeps canonical source immutable and refuses stale, gapped or forming facts',()=>{
 const f=fixture(),tf={ready:true,intervalMinutes:1,quality:{gaps:0,stale:false},candles:f.c,smc:{zones:[{type:'FVG',side:'bull',index:f.index,time:f.c[f.index].time,low:101,high:104,status:'active'}]}},before=JSON.stringify(tf),at=f.c.at(-1).time+STEP;
 const out=I.forFrame(tf,at);assert.equal(out.version,I.VERSION);assert.equal(out.zones[0].importance.formation.relativeVolume,2);assert.equal(JSON.stringify(tf),before);assert.equal(I.forFrame({...tf,quality:{gaps:1}},at),null);assert.equal(I.forFrame({...tf,quality:{gaps:0,stale:true}},at),null);assert.equal(I.forFrame(tf,f.c[f.index].time).zones[0].importance.available,false);
});
test('actual reversal selection preserves a distant parent and a nearer separate timing zone',()=>{
 const R=require('../reversal-context'),now=Date.UTC(2026,9,22,4),base=fixture();
 function tf(minutes,offset=0){const candles=base.c.slice(0,65).map((b,i)=>({...b,time:now-(65-i)*minutes*60000,open:b.open+offset,high:b.high+offset,low:b.low+offset,close:b.close+offset}));return {ready:true,intervalMinutes:minutes,quality:{gaps:0,stale:false},candles,trend:'range',structure:{trend:'range'},values:{atr:2,close:candles.at(-1).close},series:{atr14:candles.map(()=>2)},swings:{highs:[],lows:[]},smc:{events:[],zones:[{type:'FVG',side:'bull',index:41,time:candles[41].time,low:101+offset,high:104+offset,status:'active'}]}};}
 const a={generatedAt:now,m15:tf(15),exec:tf(1),h1:tf(60,-5)};a.m15.smc.zones=[];const before=JSON.stringify(a),r=R.describe(a,{now:now+1000});assert.equal(r.available,true);assert.equal(r.candidates[0].frame,'1H');assert(r.candidates.some(x=>x.frame==='1m'));assert.equal(JSON.stringify(a),before);
 const primary=r.candidates[0];assert.match(R.html(r,{expandedImportance:[primary.id]}),/data-importance-zone="[^"]+" open/);
});
