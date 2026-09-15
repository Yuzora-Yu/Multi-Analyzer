const test=require('node:test'),assert=require('node:assert/strict');
const {archiveTargets}=require('../research-observer.cjs');
const S=900000;
test('archive recovery captures boundary drift gap beyond latest four without rewriting known IDs',()=>{
 const known=Array.from({length:8},(_,i)=>i*S);
 assert.deepEqual(archiveTargets(12*S,known),[12,11,10,9,8].map(i=>i*S));
 assert.deepEqual(archiveTargets(12*S,[...known,8*S,9*S,10*S,11*S,12*S]),[]);
});
test('archive requests stay within24 retained bars and initial collection remains four',()=>{
 assert.deepEqual(archiveTargets(40*S,[]),[40,39,38,37].map(i=>i*S));
 const targets=archiveTargets(40*S,[0]);assert.equal(targets.length,24);assert.equal(targets.at(-1),17*S);
});
