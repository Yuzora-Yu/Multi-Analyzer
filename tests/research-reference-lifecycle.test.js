'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../research-reference-lifecycle.cjs');
const STEP=900000;
const identity={asset:'btc',market:'spot',symbol:'BTCUSDT',engineVersion:'test',codeHash:'code',configurationHash:'config'};
function fixture(){
 const p={id:'seed/P-reference',scope:'research-only',phase:'pending',direction:'SHORT',originBarAt:0,plannedAtLocal:STEP+1000,planningExchangeUpper:STEP+1000,entryAt:2*STEP,expiresAt:50*STEP,stop:110,target:80,entry:null};
 const row={id:'seed',barAt:0,identity,controls:{P:true},status:'verified',eligible:true,guard:true,journalSha256:'seed-proof',journalPublishedAt:STEP+1100,position:p,events:[{type:'P-reference-planned',referenceId:p.id}],intents:[]};
 return {p,row};
}
function next(row,p,barAt=STEP){return {...row,id:'next-'+barAt,barAt,guard:false,journalSha256:'proof-'+barAt,journalPublishedAt:barAt+STEP+1200,position:p,controls:{P:false},events:[]};}
test('same pending reference in repeated confirmed rows is one proposal and no fill, distinct from EXIT intents',()=>{
 const {p,row}=fixture(),later=next(row,p),input=[later,row,row],before=structuredClone(input);
 const r=summarize(input,{asOf:3*STEP});assert.deepEqual(input,before);assert.equal(r.summary.uniqueProposals,1);assert.equal(r.summary.guardedProposals,1);assert.equal(r.summary.statusCounts.pending,1);assert.equal(r.summary.hypotheticalFillsObserved,0);assert.equal(r.summary.duplicateRows,1);assert.equal(r.references[0].timeline.length,2);assert.equal(r.partitions[0].nextConsecutiveSourceClosedAt,3*STEP);
});
test('causal future-open fill and frozen-stop closure are tracked once, without treating them as actual orders or wins',()=>{
 const {p,row}=fixture(),held={...p,phase:'held',entry:100,fillAssumedAt:2*STEP,fillObservedAt:3*STEP+1000},closed={...held,phase:'closed',reason:'frozen-stop',closedBarAt:3*STEP,exitPrice:110,closureObservedAt:4*STEP+1000};
 const r=summarize([row,next(row,p),next(row,held,2*STEP),next(row,closed,3*STEP),next(row,closed,4*STEP)],{asOf:6*STEP});assert.equal(r.summary.uniqueProposals,1);assert.equal(r.summary.hypotheticalFillsObserved,1);assert.equal(r.summary.statusCounts.closed,1);assert.deepEqual(r.references[0].issues,[]);assert.equal(r.references[0].latestPosition.exitPrice,110);assert.equal(r.references[0].timeline.length,5);
});
test('publication cutoff, missing original seed and later unverified evidence cannot certify an active reference',()=>{
 const {p,row}=fixture();const later=next(row,{...p,phase:'held',entry:100,fillAssumedAt:2*STEP,fillObservedAt:3*STEP+1000},2*STEP);
 const early=summarize([row,later],{asOf:2*STEP});assert.equal(early.summary.statusCounts.pending,1);assert.equal(early.summary.hypotheticalFillsObserved,0);assert.equal(early.summary.unpublishedRows,1);
 const missing=summarize([next(row,p)],{asOf:3*STEP});assert.equal(missing.summary.statusCounts.unsupported,1);assert.ok(missing.references[0].issues.includes('original-P-proposal-not-verified'));
 const unsupported=summarize([row,{...later,eligible:false,status:'unverified'}],{asOf:4*STEP});assert.equal(unsupported.summary.statusCounts.unsupported,1);assert.equal(unsupported.summary.hypotheticalFillsObserved,0);assert.equal(unsupported.references[0].latestPosition.phase,'pending');
});
test('missed proposal guard, no-fill and incomplete states remain separate from held/closed references',()=>{
 const {p,row}=fixture(),missed=summarize([{...row,guard:false}],{asOf:2*STEP});assert.equal(missed.summary.statusCounts['guard-missed'],1);assert.equal(missed.summary.guardedProposals,0);
 for(const phase of ['no-fill','incomplete']){const r=summarize([row,next(row,{...p,phase,reason:'missing-or-cancelled'})],{asOf:3*STEP});assert.equal(r.summary.statusCounts[phase],1);assert.equal(r.summary.hypotheticalFillsObserved,0);assert.equal(r.references[0].latestPosition.entry,null);}
});
test('changed fixed bounds, unsupported early fill and rewritten terminal result fail closed',()=>{
 const {p,row}=fixture();const changed=summarize([row,next(row,{...p,stop:120})],{asOf:3*STEP});assert.equal(changed.summary.statusCounts.unsupported,1);assert.ok(changed.references[0].issues.includes('frozen-reference-fields-changed'));
 const early=summarize([row,next(row,{...p,phase:'held',entry:100,fillAssumedAt:2*STEP,fillObservedAt:2*STEP+1000},2*STEP)],{asOf:4*STEP});assert.equal(early.summary.hypotheticalFillsObserved,0);assert.ok(early.references[0].issues.includes('hypothetical-fill-not-supported'));
 const nofill={...p,phase:'no-fill',reason:'pre-entry-stop-touch'};const rewrite=summarize([row,next(row,nofill),next(row,{...nofill,reason:'pre-entry-target-touch'},2*STEP)],{asOf:4*STEP});assert.ok(rewrite.references[0].issues.includes('terminal-reference-rewritten'));
});
test('markets, versions and configurations remain separate; contradictory same-bar proofs are rejected',()=>{
 const {row}=fixture(),other={...row,identity:{...identity,market:'futures'}};const r=summarize([row,other],{asOf:2*STEP});assert.equal(r.summary.uniqueProposals,2);assert.equal(r.partitions.length,2);
 assert.throws(()=>summarize([row,{...row,journalSha256:'different'}],{asOf:2*STEP}),/Conflicting/);assert.throws(()=>summarize([row]),/cutoff/);
});
