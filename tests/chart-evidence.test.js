const test=require('node:test'),assert=require('node:assert/strict'),E=require('../chart-evidence');
test('SMC context separates upper frames, current events, ribbon conflict and exit',()=>{
 const frame=n=>({ready:true,quality:{stale:false},flow:{latest:{structure:n}}});
 const a={h4:frame(-1),h1:frame(0),exec:{...frame(1),flow:{latest:{time:2000,structure:1,direction:-1,ribbon:1,exitShort:true}},smc:{location:'premium',events:[{time:1000,type:'BOS',side:'bull'}]}}};
 const c=E.context(a);assert.match(c.environment,/H4構造 下向き/);assert.match(c.confirmation,/不一致/);assert.match(c.exit,/売りEXIT/);assert.doesNotMatch(c.confirmation,/BOS/);
 a.exec.quality.stale=true;assert.equal(E.context(a).confirmation,'判定を保留');
});
test('a current confirmed CHoCH remains visible alongside a conflicting ribbon without changing the decision',()=>{
 const time=1800000,a={generatedAt:time+900000,state:'NO_TRADE',actionable:false,exec:{ready:true,intervalMinutes:15,quality:{stale:false},candles:[{time,close:102}],flow:{latest:{time,structure:-1,direction:-1,ribbon:1}},smc:{events:[{time,type:'CHoCH',side:'bull',price:100}]}}};
 const before=structuredClone(a),c=E.context(a);
 assert.match(c.confirmation,/最新確定足：上向き CHoCH 100\.00/);assert.match(c.confirmation,/保持方向とリボンが不一致/);assert.match(c.confirmation,/新規入場の成立は別/);assert.deepEqual(a,before);
});
test('current event text excludes old, future, unfinished and malformed events',()=>{
 const time=1800000,a={generatedAt:time+900000,exec:{intervalMinutes:15,quality:{stale:false},candles:[{time,close:102}],flow:{latest:{time}},smc:{events:[{time:time-900000,type:'BOS',side:'bull',price:100},{time:time+900000,type:'CHoCH',side:'bull',price:100},{time,type:'BOS',side:'unknown',price:100},{time,type:'ENTRY',side:'bull',price:100},{time,type:'SWEEP',side:'bear',price:103}]}}};
 assert.equal(E.currentEventsText(a),'下向き SWEEP 103.00');
 a.generatedAt--;assert.equal(E.currentEventsText(a),'');a.generatedAt++;a.exec.quality.stale=true;assert.equal(E.currentEventsText(a),'');
 a.exec.quality.stale=false;a.exec.candles[0].time+=900000;assert.equal(E.currentEventsText(a),'');
 a.exec.candles[0].time=time;delete a.generatedAt;assert.equal(E.currentEventsText(a),'');
});
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
test('viewport label layout restores explanations on zoom and does not let offscreen events suppress visible labels',()=>{
 const original=[{time:1,position:'aboveBar',text:'売 EXIT注意',shape:'circle',color:'yellow'},{time:2,position:'aboveBar',text:'方向転換 売 B',shape:'arrowDown',color:'red'},{time:3,position:'belowBar',text:'P 押し目条件',shape:'circle',color:'purple'}],before=JSON.stringify(original);
 const close=E.viewportLabels(original,t=>t*20,320,()=>80);
 assert.equal(close[0].text,'');assert.equal(close[1].text,original[1].text);assert.equal(close[2].text,original[2].text);
 const wide=E.viewportLabels(original,t=>t*100,390,()=>80);assert.deepEqual(wide,original);
 const historical=E.viewportLabels(original,t=>t===2?-5:50,320,()=>80);assert.equal(historical[0].text,original[0].text);assert.equal(historical[1].text,'');
 for(let i=0;i<original.length;i++){const {text,...a}=close[i],{text:unused,...b}=original[i];assert.deepEqual(a,b);}
 assert.equal(JSON.stringify(original),before);
 assert.ok(E.viewportLabels(original,()=>null,320,()=>80).every(m=>m.text===''));
});
test('app redraw restores labels from originals and skips identical marker writes',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),app=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const source=app.slice(app.indexOf('  function renderChartMarkerLabels()'),app.indexOf('  function applyChartRange()'));
 let multiplier=20,writes=[];
 const state={chart:{timeScale:()=>({width:()=>320,timeToCoordinate:t=>t*multiplier})},candleSeries:{setMarkers:m=>writes.push(m)},flowCanvas:{getContext:()=>({measureText:()=>({width:80})})},chartMarkers:[{time:1,position:'aboveBar',text:'売 EXIT注意'},{time:2,position:'aboveBar',text:'方向転換 売 B'}]};
 const original=JSON.stringify(state.chartMarkers),context={state,window:{MultiAnalyzerEvidence:E}};vm.createContext(context);
 vm.runInContext(source+';renderChartMarkerLabels();renderChartMarkerLabels()',context);assert.equal(writes.length,1);assert.equal(writes[0][0].text,'');
 multiplier=100;vm.runInContext('renderChartMarkerLabels()',context);assert.equal(writes.length,2);assert.equal(writes[1][0].text,'売 EXIT注意');assert.equal(JSON.stringify(state.chartMarkers),original);
});
