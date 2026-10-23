const test=require('node:test'),assert=require('node:assert/strict');
const now=Date.parse('2026-10-23T08:40:00Z'),bar=Date.parse('2026-10-23T08:15:00Z');
function analysis(patch={}){return {entryModel:'pullback-v1',actionable:true,direction:'SHORT',state:'SHORT',generatedAt:bar+900001,exec:{candles:[{time:bar}]},plan:{entry:4015,stop:4020,tp1:4010,tp2:4004,tp3:3999},positionDecision:{action:'EXIT_LONG',reasons:['old exit']},marketMap:{valid:true},...patch};}
function snapshot(){return {asset:'gold',id:'gold-test',version:'4.3.4',settings:{executionMinutes:15}};}
test('only actionable canonical P produces mail, even when old zone and EXIT branches coexist',async()=>{
 const {pMailEvent}=await import('../cloudflare/p-only-mail.mjs');const a=analysis(),before=structuredClone(a),s=snapshot();const e=pMailEvent(a,s,now);
 assert.equal(e.kind,'P');assert.match(e.title,/P 売り/);assert(!e.text.includes('old exit'));assert.deepEqual(a,before);
 for(const patch of [{actionable:false},{entryModel:'other'},{direction:'WAIT'}])assert.equal(pMailEvent(analysis(patch),s,now),null);
 assert.equal(pMailEvent(a,{...s,asset:'btc'},now),null);assert.equal(pMailEvent(a,{...s,settings:{executionMinutes:5}},now),null);
 assert.equal(pMailEvent(a,s,bar+899999),null);assert.equal(pMailEvent(a,s,now+1200000),null);
 assert.equal(pMailEvent(a,s,Date.parse('2026-10-24T00:00:00+09:00')),null);
});
test('legacy sends disabled, deployment baseline quiet, next P sent once and snapshot retained',async()=>{
 const {pOnlyMonitor}=await import('../cloudflare/p-only-mail.mjs');let a=analysis({actionable:false});const data=new Map([['snapshot',snapshot()],['state',{paperPosition:{original:true},alertIds:[]}],['demo:original',{untouched:true}]]),sent=[];
 const ctx={storage:{get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k)}};
 class Fixed{constructor(c,e){this.ctx=c;this.env=e;}async perform(){assert.equal(this.env.ALERTS_ENABLED,'false');return{state:'NO_TRADE',snapshotId:'gold-test'};}async status(){return{state:'NO_TRADE'};}}
 const M=pOnlyMonitor(Fixed,{analyze:()=>a,clock:()=>now}),m=new M(ctx,{ALERTS_ENABLED:'true',EMAIL_TO:'synthetic@example.test',EMAIL:{send:async e=>sent.push(e)}});
 await m.perform('gold',true);assert.equal(data.has('operation:p-only-email-v1'),false);
 await m.perform('gold');assert.equal(sent.length,0);a=analysis();await m.perform('gold');await m.perform('gold');
 assert.equal(sent.length,1);assert.equal(data.get('alert:gold-test').id,'gold-test');assert.deepEqual(data.get('state').paperPosition,{original:true});assert.deepEqual(data.get('demo:original'),{untouched:true});assert.equal((await m.status()).notificationMode,'P_ONLY');
 a=analysis({actionable:false});await m.perform('gold');assert.equal(sent.length,1);
});
test('P present at first activation is not backfilled as a new event',async()=>{
 const {pOnlyMonitor}=await import('../cloudflare/p-only-mail.mjs');const data=new Map([['snapshot',snapshot()]]);let sends=0;
 class Fixed{constructor(c,e){this.ctx=c;this.env=e;}async perform(){return{state:'SHORT',snapshotId:'gold-test'};}}
 const M=pOnlyMonitor(Fixed,{analyze:()=>analysis(),clock:()=>now}),m=new M({storage:{get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)}},{ALERTS_ENABLED:'true',EMAIL:{send:async()=>sends++}});
 await m.perform('gold');await m.perform('gold');assert.equal(sends,0);
});
test('storage work crossing JST weekend cannot release a weekday P email',async()=>{
 const {pOnlyMonitor}=await import('../cloudflare/p-only-mail.mjs');const fri=Date.parse('2026-10-23T23:59:59+09:00'),sat=fri+2000;
 const a=analysis({exec:{candles:[{time:fri-1000000}]} }),s=snapshot(),data=new Map([['snapshot',s],['state',{alertIds:[]}],['operation:p-only-email-v1',{delivered:{},lastEmail:null}]]);let t=fri,sent=0;
 class Fixed{constructor(c,e){this.ctx=c;this.env=e;}async perform(){return{state:'SHORT',snapshotId:s.id};}}
 const M=pOnlyMonitor(Fixed,{analyze:()=>a,clock:()=>t}),m=new M({storage:{get:async k=>data.get(k),put:async(k,v)=>{data.set(k,v);if(k.startsWith('alert:'))t=sat;},delete:async k=>data.delete(k)}},{ALERTS_ENABLED:'true',EMAIL:{send:async()=>sent++}});
 await m.perform('gold');assert.equal(sent,0);assert.deepEqual(data.get('operation:p-only-email-v1').delivered,{});
});
