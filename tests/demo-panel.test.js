const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),D=require('../demo-panel');

const at=Date.UTC(2026,9,8,15,30);
function fixture(asset='gold'){
 return {schemaVersion:1,asset,market:asset==='gold'?'futures':'spot',symbol:asset==='gold'?'XAUUSDT':'BTCUSDT',status:'ACTIVE',registeredAt:at-900000,updatedAt:at+60000,lastClosedAt:at,lastSnapshotId:asset+'-fixed',protocol:{version:'demo-v1',initialEquity:10000,riskPct:0.25,costBps:7,sensitivityBps:[7,14,21]},coverage:{decisions:4,missingBars:1,delayedDecisions:2},books:['baseline','confirmation','reversion','trend'].map((id,i)=>({id,equity:10000+i,realizedNet:i,grossPnl:i+3,costs:3,closed:1,maxDrawdown:10,maxDrawdownPct:0.1,unrealizedGross:0,skipped:2,unfilled:1,incomplete:1,lastDecision:{action:'WAIT',reason:'現在は条件未成立',at,snapshotId:asset+'-fixed'},netByCost:{7:i,14:i-3,21:i-6},recentTrades:[]}))};
}
function harness(fetchJson){
 let clock=at+61000,ctx={asset:'gold',snapshotId:'gold-fixed'},exported;
 const root={innerHTML:'',querySelectorAll:()=>[],addEventListener:(type,listener)=>{root.listener=listener;}};
 const panel=D.create({root,fetchJson,getContext:()=>ctx,now:()=>clock,baseUrl:'https://example.test',download:value=>{exported=value;}});
 return {panel,root,advance:ms=>clock+=ms,setContext:value=>ctx=value,download:()=>{root.listener({target:{closest:selector=>selector==='[data-demo-export]'?{}:null}});return exported;}};
}

test('demo comparisons keep fixed persona order, hypothetical labels and separate times/costs',()=>{
 const payload=fixture(),before=structuredClone(payload),html=D.render(payload,{snapshotId:payload.lastSnapshotId,now:at+61000},{receivedAt:at+61000});
 assert.ok(html.indexOf('data-demo-book="trend"')<html.indexOf('data-demo-book="reversion"'));
 assert.ok(html.indexOf('data-demo-book="confirmation"')<html.indexOf('data-demo-book="baseline"'));
 assert.match(html,/P条件・未来始値/);assert.match(html,/既存Pの指値約定を再現する記録とは別/);
 assert.match(html,/確定した仮想損益/);assert.match(html,/最大DD（仮想USD）/);assert.match(html,/\$10\.00 \/ 0\.10%/);
 for(const label of ['実験登録','記録更新','最新15分足確定','この画面の取得','判定ID','7 bps','14 bps','21 bps'])assert.ok(html.includes(label),label);
 assert.match(html,/記録した判定 4/);assert.match(html,/Bybit元価格/);assert.doesNotMatch(html,/勝率|おすすめ|精度が向上/);
 assert.deepEqual(payload,before);
});

test('demo text is escaped and missing numeric records never become zero profits',()=>{
 const payload=fixture('btc');payload.books[0].lastDecision.reason='<img src=x onerror=alert(1)>';payload.books[0].realizedNet=null;payload.books[0].equity='10000';payload.lastSnapshotId='x<svg>&"';
 const html=D.render(payload,{now:at+61000});
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.match(html,/x&lt;svg&gt;&amp;&quot;/);assert.doesNotMatch(html,/<img|<svg/);
 const baseline=html.slice(html.indexOf('data-demo-book="baseline"'));
 assert.match(baseline,/確定した仮想損益<\/span><strong class="">—/);assert.match(baseline,/仮想残高<\/dt><dd class="">—/);
 assert.match(html,/BTC現物価格の仮想ショート/);assert.match(html,/借入費用は未取得/);
});

test('saved snapshots and CSV neither retrieve nor expose current demo results',async()=>{
 let requests=0;const h=harness(async()=>{requests++;return fixture();});await h.panel.refresh();assert.equal(requests,1);
 for(const mode of ['archived','offline']){
  h.setContext({asset:'gold',[mode]:true});h.advance(10000);await h.panel.refresh();
  assert.equal(requests,1);assert.match(h.root.innerHTML,/最新デモ記録を表示しません/);assert.doesNotMatch(h.root.innerHTML,/確定した仮想損益|data-demo-export/);assert.equal(h.download(),undefined);
 }
});

test('in-flight duplicates share one request and asset switches never label the previous asset as current',async()=>{
 let finish,requests=[];
 const h=harness(url=>{requests.push(url);return new Promise(resolve=>finish=resolve);});
 const first=h.panel.refresh(),duplicate=h.panel.refresh();await Promise.resolve();assert.equal(requests.length,1);
 h.setContext({asset:'btc'});h.panel.sync();assert.doesNotMatch(h.root.innerHTML,/GOLD・各担当/);
 finish(fixture());await Promise.all([first,duplicate]);assert.doesNotMatch(h.root.innerHTML,/XAUUSDT|GOLD・各担当/);
 const btc=h.panel.refresh();await Promise.resolve();assert.match(requests[1],/asset=btc$/);finish(fixture('btc'));await btc;
 assert.match(h.root.innerHTML,/BTC・各担当/);assert.doesNotMatch(h.root.innerHTML,/XAUUSDT/);
});

test('a failed or older refresh leaves prior statistics explicitly dated and exports the failure',async()=>{
 let response=fixture(),fail=false;const h=harness(async()=>{if(fail)throw new Error('network unavailable');return response;});await h.panel.refresh();
 h.advance(10000);fail=true;await h.panel.refresh();assert.match(h.root.innerHTML,/デモ記録を更新できません/);assert.match(h.root.innerHTML,/前回取得分/);
 const exported=h.download();assert.equal(exported.refreshError,true);assert.equal(exported.receivedAt,at+61000);assert.equal(exported.data.updatedAt,at+60000);assert.equal(exported.kind,'DEMO_DISPLAY_RECORD');assert.equal(exported.context.chartSnapshotId,'gold-fixed');
 h.advance(10000);fail=false;response={...fixture(),updatedAt:at-1};await h.panel.refresh();
 assert.match(h.root.innerHTML,/前回取得分/);assert.equal(h.download().data.updatedAt,at+60000);
});

test('Gold closure does not fetch and delayed or mismatched records retain explicit context',async()=>{
 let requests=0;const h=harness(async()=>{requests++;return fixture();});await h.panel.refresh();h.setContext({asset:'gold',marketClosed:true});h.advance(10000);await h.panel.refresh();
 assert.equal(requests,1);assert.match(h.root.innerHTML,/GOLD休場・最後のデモ記録/);assert.match(h.root.innerHTML,/新しい価格の収集とデモ判断を停止/);
 const payload=fixture();assert.match(D.render(payload,{now:at+21*60000}),/最新デモ記録の更新が遅延/);
 assert.match(D.render(payload,{snapshotId:'different',now:at+60000}),/最新判定IDが異なります/);
 assert.match(D.render({...payload,status:'DATA_ERROR'},{now:at+60000}),/データ不備・デモ判断を保留/);
});

test('wrong asset, duplicate personas and unknown statuses cannot silently replace valid demo data',async()=>{
 assert.throws(()=>D.validate(fixture('btc'),'gold'),/INVALID_RESPONSE/);
 const duplicate=fixture();duplicate.books.push(duplicate.books[0]);assert.throws(()=>D.validate(duplicate,'gold'),/INVALID_BOOK/);
 assert.throws(()=>D.validate({...fixture(),status:'PROFITABLE'},'gold'),/INVALID_STATUS/);
 const h=harness(async()=>fixture('btc'));await h.panel.refresh();assert.match(h.root.innerHTML,/成績は未取得/);assert.doesNotMatch(h.root.innerHTML,/data-demo-book/);
});

test('fixed stops, targets and future entry times remain separate from unrealized marks',()=>{
 const payload=fixture();payload.books[3].pending={direction:'SHORT',entryAfter:at+900000,stop:4200,target:4100};payload.books[2].position={direction:'LONG',entry:4150,stop:4130,target:4190,openedAt:at};payload.books[2].unrealizedGross=22;
 const html=D.render(payload,{now:at+60000});
 assert.match(html,/仮想保有 1方式・予約待ち 1方式/);assert.match(html,/未来足の始値で判定/);assert.match(html,/固定ストップ/);assert.match(html,/4,200\.00/);assert.match(html,/含み損益（費用前）/);assert.match(html,/実注文ではありません/);
});

test('app demo hooks preserve CSV/archive isolation and six tabs keep phone chart controls',()=>{
 const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),html=fs.readFileSync(require.resolve('../index.html'),'utf8'),css=fs.readFileSync(require.resolve('../styles.css'),'utf8'),source=fs.readFileSync(require.resolve('../demo-panel.js'),'utf8');
 const context={state:{instrumentId:'gold',offlineCsv:true,snapshot:{id:'old'}},INITIAL_PARAMS:new URLSearchParams('snapshot=old'),Feed:{collectionPolicy:()=>({allowed:false})}};vm.createContext(context);
 const fn=app.slice(app.indexOf('  function demoContext()'),app.indexOf('\n',app.indexOf('  function demoContext()')));
 const actual=vm.runInContext(fn+';demoContext()',context);assert.equal(actual.offline,true);assert.equal(actual.archived,true);assert.equal(actual.marketClosed,true);assert.equal(actual.snapshotId,'old');
 assert.equal((html.match(/data-insight-tab=/g)||[]).length,6);assert.match(html,/demo-panel\.js/);assert.ok(html.indexOf('demo-panel.js')<html.indexOf('app.js'));
 assert.match(css,/\.insight-tabs \{[^}]*display: flex[^}]*overflow-x: auto/);assert.match(css,/\.chart-container\{[^}]*touch-action:none/);assert.match(app,/pinch: true/);
 assert.doesNotMatch(source,/setInterval|all画像|ZIPにする/);
});
