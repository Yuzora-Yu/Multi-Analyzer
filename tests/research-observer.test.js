const test=require('node:test'),assert=require('node:assert/strict');
const {outcome}=require('../research-observer.cjs');
test('outcome begins at next open and requires every intervening bar',()=>{
 const sample={bar:0},bars=new Map([[0,{open:10,close:200,high:200,low:1}],[900000,{open:100,close:101,high:102,low:99}],[1800000,{open:101,close:103,high:104,low:100}]]);
 const r=outcome(sample,bars,2);assert.equal(r.entry,100);assert.equal(r.exit,103);assert.ok(Math.abs(r.longNetBps-293)<1e-9);assert.ok(Math.abs(r.shortNetBps+307)<1e-9);
 bars.delete(900000);assert.equal(outcome(sample,bars,2).status,'pending-or-missing');
});
