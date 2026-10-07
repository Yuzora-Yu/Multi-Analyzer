const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const S=require('../research-zone-window-summary.cjs'),W=require('../research-zone-windows.cjs'),T=require('../research-zone-trades.cjs'),STEP=900000;
function fixture(){const report={asOf:STEP*100,registration:{spec:W.SPEC},rows:[]};
 for(let i=0;i<3;i++){const from=(i*16+1)*STEP,c={id:'s'+i+'/z',sourceId:'s'+i,from,primary:true,rank:0,identity:{asset:'gold',market:'futures',symbol:'XAUUSDT',codeHash:'c',configurationHash:'q'},zone:{id:'z',direction:'LONG'},eligibility:{eligible:true},flags:{P:false,EXIT_LONG:false,EXIT_SHORT:false,noSign:true}};
 const closed=(arm,exit)=>{const grossBps=(exit/100-1)*10000;return {arm,status:'closed',entry:100,exit,entryAt:from,exitAt:from+STEP,grossBps,costs:T.SPEC.costBps.map(costBps=>({costBps,assumedNetBps:grossBps-costBps}))};};
 report.rows.push({forecast:c,outcomes:[{horizon:16,from,until:from+16*STEP,status:'resolved',nonOverlapping:true}],repeatedZoneKey:'gold/futures/XAUUSDT/z',coverage:{receiptComplete:true},eligible:true,arms:[closed(T.SPEC.arms[0],99),i===0?closed(T.SPEC.arms[1],100.5):{arm:T.SPEC.arms[1],status:'no-fill'}]});}
 return report;
}
test('repeat zones stay visible, no-fill windows and executed-trade denominators remain separate',()=>{
 const f=fixture(),before=JSON.stringify(f),r=S.summarize(f),p=r.partitions[0],arm=p.costs[0].arms[1];assert.equal(p.uniqueEvaluatedZoneKeys,1);assert.equal(p.repeatEvaluatedZoneWindows,2);assert.equal(arm.perEligibleWindow.count,3);assert.equal(arm.perExecutedHypotheticalTrade.count,1);assert.equal(arm.perEligibleWindow.meanBps,arm.perExecutedHypotheticalTrade.meanBps/3);assert.equal(p.costs[0].arms[0].perEligibleWindow.maxConsecutiveNegative,3);assert.equal(JSON.stringify(f),before);
});
test('missing outcomes never become zero returns, empty statistics remain null',()=>{
 const f=fixture();for(const r of f.rows){r.eligible=false;r.outcomes[0].status='missing';r.coverage.receiptComplete=false;delete r.arms;}const p=S.summarize(f).partitions[0];assert.equal(p.evaluated,0);assert.equal(p.excludedOrPending,3);assert.equal(p.costs[0].arms[0].perEligibleWindow.meanBps,null);assert.equal(p.costs[0].arms[0].perEligibleWindow.additiveDrawdownBps,null);
});
test('tampered costs, future complete windows and missing arms fail',()=>{
 for(const mutate of [f=>f.rows[0].arms[0].costs[0].assumedNetBps++,f=>f.rows[0].arms.pop(),f=>f.asOf=STEP*5,f=>f.rows[1].outcomes[0].nonOverlapping=false]){const f=fixture();mutate(f);assert.throws(()=>S.summarize(f));}
});
test('market and configuration partitions do not pool correlated decisions',()=>{
 const f=fixture(),r=f.rows[2];r.forecast.identity={asset:'btc',market:'spot',symbol:'BTCUSDT',codeHash:'c',configurationHash:'q'};r.repeatedZoneKey='btc/spot/BTCUSDT/z';const s=S.summarize(f);assert.equal(s.partitions.length,2);assert.equal(s.partitions.reduce((n,p)=>n+p.evaluated,0),3);
});
test('actual offline replay binds registration and complete control population before statistics',t=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'window-summary-')),root=path.join(base,'study');t.after(()=>fs.rmSync(base,{recursive:true,force:true}));fs.mkdirSync(path.join(base,'research-forward/predictions'),{recursive:true});W.register(root,Date.now()-1);const output=W.run({base,root}),report=JSON.parse(fs.readFileSync(path.join(output.directory,'report.json'))),manifest=JSON.parse(fs.readFileSync(path.join(output.directory,'manifest.json'))),read=f=>fs.readFileSync(f);assert.equal(S.replay(report,manifest,read).replayMatched,true);assert.deepEqual(S.summarize(report).partitions,[]);
 const changed=structuredClone(report);changed.registration.registeredAt--;assert.throws(()=>S.replay(changed,manifest,read),/registration changed/);const dropped=structuredClone(report);dropped.controls.push({id:'invented'});assert.throws(()=>S.replay(dropped,manifest,read),/population changed/);assert.throws(()=>S.replay(report,{sources:[...manifest.sources,...manifest.sources]},read),/Duplicate/);
 let calls=0;const raw=read(manifest.sources[0].file);assert.throws(()=>S.replay(report,manifest,()=>++calls===1?raw:Buffer.concat([raw,Buffer.from(' ')])),/Source changed/);
});
