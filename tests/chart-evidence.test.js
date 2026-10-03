const test=require('node:test'),assert=require('node:assert/strict'),E=require('../chart-evidence');
test('label spacing preserves transition explanations over nearby exit notices without removing markers',()=>{
 const m=[{time:1,text:'リボン ↓'},{time:2,text:'売 EXIT注意'},{time:20,text:'方向転換 売 B'}];
 E.spaceLabels(m,5);assert.equal(m.length,3);assert.equal(m[0].text,'リボン ↓');assert.equal(m[1].text,'');assert.equal(m[2].text,'方向転換 売 B');
});
test('ribbon and direction events stay at recognition bars when future data is appended',()=>{
 const h=[{time:1000,ribbon:1},{time:2000,ribbon:-1,direction:1},{time:3000,ribbon:-1,direction:-1,switched:true,rank:'B'},{time:4000,ribbon:-1,exitShort:true}];
 assert.deepEqual(E.markers(h.slice(0,3),0),E.markers(h,0).filter(x=>x.time<=3));
 assert.equal(E.markers(h,0)[0].time,2);assert.match(E.markers(h,0)[1].text,/方向転換 売 B/);
 assert.match(E.markers(h,0)[2].text,/売 EXIT注意/);
 assert.equal(E.markers(h,3000).length,2);
});
test('H1 references exclude unclosed, stale, invalidated and non-OB zones',()=>{
 const h={candles:[{time:0}],quality:{stale:false},smc:{zones:[{time:0,type:'OB',status:'active',side:'bear',low:100,high:102},{time:0,type:'OB',status:'invalidated',low:90,high:92},{time:0,type:'FVG',status:'active',low:80,high:82}]}};
 assert.equal(E.hourlyZones(h,3599999).length,0);assert.equal(E.hourlyZones(h,3600000).length,1);
 h.quality.stale=true;assert.equal(E.hourlyZones(h,3600000).length,0);
});
