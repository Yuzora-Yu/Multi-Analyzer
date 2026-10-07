'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const Reference=require('../research-reference.cjs'),Forward=require('../research-forward.cjs'),Core=require('../strategy-core'),Ledger=require('../research-retest-outcomes.cjs');
const {replay,extract}=require('../research-reference-audit.cjs');
const STEP=900000,hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ma-ref-audit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const closed=Date.UTC(2026,9,7);let now=closed-STEP;
 t.mock.method(Date,'now',()=>now);const study=path.join(root,'study'),registration=Reference.register(study),rows=[];
 for(let n=0;n<3;n++){
  const at=closed+n*STEP;now=at+1200;const bars=m=>{const end=Math.floor(at/(m*60000))*m*60000;return Array.from({length:300},(_,i)=>[end-(300-i)*m*60000,100+i/10,102+i/10,99+i/10,101+i/10,10]);};
  const s={asset:'btc',version:Core.VERSION,symbol:'BTCUSDT',createdAt:at+100,settings:{now:at+1,market:'spot'},bars:{m15:bars(15),h1:bars(60),h4:bars(240)}};s.id=`btc-${s.bars.m15.at(-1)[0]}-${s.version}`;
  const r=Forward.prepare(s,{requestedAt:at+1000,receivedAt:at+1100},{requestedAt:at+1100,receivedAt:at+1150,serverTime:at+23150},now),source=Forward.persist(path.join(root,'forward'),r).directory;
  rows.push(Reference.readJournal(Reference.ingest(study,source).directory));
 }
 return {root,registration,rows,asOf:now+1};
}
test('complete real engine/source replay verifies journals without treating no-sign as trades',t=>{
 const f=setup(t),r=replay(f.rows,f.registration,{asOf:f.asOf});assert.equal(r.length,3);assert.ok(r.every(row=>row.eligible));assert.ok(r.every(row=>row.controls.noSign));assert.equal(extract(r).length,0);
});
test('altered state fails even when an altered file and receipt have matching hashes',t=>{
 const f=setup(t);f.rows[1].journal.state.position={phase:'held',stop:1};const h=hash(JSON.stringify(f.rows[1].journal,null,2));f.rows[1].sha256=h;f.rows[1].receipt.sha256=h;f.rows[2].journal.previous.sha256=h;
 const r=replay(f.rows,f.registration,{asOf:f.asOf});assert.ok(r[1].issues.includes('reference-state-differs-from-causal-replay'));assert.equal(r[2].eligible,false);assert.ok(r[2].issues.includes('inherited-unverified-reference-state'));
});
test('unsupported timestamps, guard flags and missing publication remain explicitly ineligible',t=>{
 const f=setup(t);f.rows[0].receipt.futureGuardPassed=false;const r=replay(f.rows,f.registration,{asOf:f.asOf});assert.ok(r[0].issues.includes('guard-flag-not-supported-by-times'));
 const fresh=setup(t);fresh.rows[0].receipt={};const missing=replay(fresh.rows,fresh.registration,{asOf:fresh.asOf});assert.equal(missing[0].status,'not-published-at-cutoff');assert.equal(missing[0].eligible,false);assert.ok(missing[1].issues.includes('previous-link-mismatch'));
});
test('later publication cannot leak into an earlier cutoff',t=>{
 const f=setup(t),r=replay(f.rows,f.registration,{asOf:f.rows[0].receipt.publishedAt});assert.equal(r[0].eligible,true);assert.equal(r[1].status,'not-published-at-cutoff');assert.equal(r[2].status,'not-published-at-cutoff');
});
test('changed original sources fail replay and poison dependent reference state',t=>{
 const f=setup(t);fs.appendFileSync(path.join(f.rows[0].journal.source.directory,'prediction.json'),' ');const r=replay(f.rows,f.registration,{asOf:f.asOf});assert.ok(r[0].issues.some(i=>i.startsWith('source-replay-failed')));assert.ok(r.every(row=>!row.eligible));
});
test('extraction preserves missed entry guards and deduplicates exact journal intents',()=>{
 const plan={episodeId:'episode',arm:'choch-retest',confirmedBarAt:0,entryAt:2*STEP,stop:110,direction:'SHORT'},row={eligible:true,guard:false,journalSha256:'proof',journalPublishedAt:STEP+1,identity:{asset:'btc',market:'spot',symbol:'BTCUSDT'},intents:[plan,plan]};
 const r=extract([row]);assert.equal(r.length,1);assert.equal(r[0].eligibility.eligible,false);assert.deepEqual(r[0].candidate.plan,plan);assert.equal(extract([{...row,eligible:false}]).length,0);
});
