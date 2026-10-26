const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {load}=require('../mt5/tests/load-cost.cjs');
const tier=(c,patch={})=>({mode:c.SYMBOL_COMMISSION_MONEY_SYMBOL_PROFIT,volume_type:c.SYMBOL_COMMISSION_VOLUME_TYPE_VOLUME,value:5,min_value:0,max_value:0,range_from:0,range_to:0,currency:'USD',...patch});
const rule=(c,t,patch={})=>({currency:'USD',mode_entry:c.SYMBOL_COMMISSION_ENTRY_INOUT,mode_direction:c.SYMBOL_COMMISSION_DIRECTION_BOTH,mode_charge:c.SYMBOL_COMMISSION_CHARGE_INSTANT,mode_profit:c.SYMBOL_COMMISSION_PROFIT_ALL,tiers:[t],...patch});
const record=(c,r,spread=.5,side=1)=>c.MABrokerRecord(4000,spread,side,r.length,r,.01,100,'XAU','USD',true);
test('server zero-rule result differs from an unavailable commission response and adds one full spread',()=>{
 const c=load(),zero=record(c,[]);assert(zero.ready);assert.equal(zero.totalPrice,.5);assert.equal(zero.bps,1.25);
 const failed=c.MABrokerRecord(4000,.5,1,-1,[],.01,100,'XAU','USD',true);assert(!failed.ready);assert.equal(failed.bps,Number.MAX_VALUE);
 assert.equal(record(c,[],0).bps,0,'a valid observed zero spread is permitted');
});
test('flat per-lot, base-currency, points and percentage rules have explicit quote-price units',()=>{
 const c=load();let r=record(c,[rule(c,tier(c))]);assert(r.ready);assert(Math.abs(r.commissionPrice-.1)<1e-12);assert.equal(r.totalPrice,.6);
 r=record(c,[rule(c,tier(c,{mode:c.SYMBOL_COMMISSION_MONEY_SYMBOL_BASE,value:.001}))]);assert.equal(r.commissionPrice,.08);
 r=record(c,[rule(c,tier(c,{mode:c.SYMBOL_COMMISSION_PIPS,value:2}))]);assert.equal(r.commissionPrice,.04);
 r=record(c,[rule(c,tier(c,{mode:c.SYMBOL_COMMISSION_PERCENT,volume_type:c.SYMBOL_COMMISSION_VOLUME_TYPE_TURNOVER,value:.005}))]);assert.equal(r.commissionPrice,.4);
 r=record(c,[rule(c,tier(c,{mode:c.SYMBOL_COMMISSION_MONEY_SPECIFIED,currency:'USD'}))]);assert(r.ready);assert.equal(r.commissionPrice,.1);
});
test('entry, exit, direction and additive rules never double an already one-leg fee',()=>{
 const c=load(),t=tier(c);assert.equal(record(c,[rule(c,t,{mode_entry:c.SYMBOL_COMMISSION_ENTRY_IN})]).commissionPrice,.05);
 assert.equal(record(c,[rule(c,t,{mode_direction:c.SYMBOL_COMMISSION_DIRECTION_BUY})]).commissionPrice,.05);
 assert.equal(record(c,[rule(c,t,{mode_entry:c.SYMBOL_COMMISSION_ENTRY_OUT,mode_direction:c.SYMBOL_COMMISSION_DIRECTION_BUY})],.5,1).commissionPrice,0);
 assert.equal(record(c,[rule(c,t),rule(c,t)]).commissionPrice,.2);
});
test('unknown currencies, per-trade fees, tiers, minimums, profit-conditional and period fees fail closed',()=>{
 const c=load();for(const t of [tier(c,{mode:c.SYMBOL_COMMISSION_MONEY_DEPOSIT}),tier(c,{mode:c.SYMBOL_COMMISSION_MONEY_SPECIFIED,currency:'JPY'}),tier(c,{volume_type:c.SYMBOL_COMMISSION_VOLUME_TYPE_TRADE}),tier(c,{min_value:1}),tier(c,{max_value:8}),tier(c,{range_from:1}),tier(c,{range_to:10}),tier(c,{range_to:NaN}),tier(c,{value:-1})])assert(!record(c,[rule(c,t)]).ready);
 for(const patch of [{mode_charge:c.SYMBOL_COMMISSION_CHARGE_DAILY},{mode_profit:c.SYMBOL_COMMISSION_PROFIT_PROFIT},{tiers:[]},{tiers:[tier(c),tier(c)]},{mode_entry:999},{mode_direction:999}])assert(!record(c,[rule(c,tier(c),patch)]).ready);
 assert(record(c,[rule(c,tier(c,{mode:c.SYMBOL_COMMISSION_DISABLED}))]).ready);
});
test('historical P uses recorded bar points; later quote spread cannot repaint a captured signal',()=>{
 const c=load(),b={time:0,close:4000,spread:40};c.clock=930;c.tick={bid:4000,ask:4000.8,time:930};
 const historical=c.SignalCost(b,1,900,false);assert.equal(historical.spreadPrice,.4);assert.equal(historical.observedAt,0);
 c.tick.ask=4005;assert.equal(c.SignalCost(b,1,900,true).spreadPrice,.4,'already reconstructed historical record retains its basis');
 const next={...b,time:900};c.clock=1830;c.tick={bid:4000,ask:4000.8,time:1830};const first=c.SignalCost(next,1,900,true);assert(Math.abs(first.spreadPrice-.8)<1e-9);assert.equal(first.observedAt,1830);
 c.tick.ask=4008;assert.equal(c.SignalCost(next,1,900,true).bps,first.bps);
 c.brokerCommissionRules=[rule(c,tier(c))];c.brokerCommissionCount=1;c.brokerCommissionObservedAt=1840;
 assert.equal(c.SignalCost(next,1,900,true).commissionPrice,0,'a later fee schedule cannot repaint the captured record');
 const corrected=c.SignalCost({...next,spread:50},1,900,false);assert.equal(corrected.spreadPrice,.5);assert.equal(corrected.commissionPrice,.1,'changed source input is reconstructed with its new provenance');
 assert.equal(c.BrokerCost(next,1,true).spreadPrice,8,'current fee display still sees the widened spread');
 c.PruneCostMemos(900,900);assert.equal(c.costMemos.length,1);assert.equal(c.costMemos[0].time,900);
});

test('FX and CFD costs preserve native quote units without a Gold-specific price or contract',()=>{
 const c=load(),r=rule(c,tier(c,{value:350,currency:'JPY'}));r.currency='JPY';
 const yen=c.MABrokerRecord(150,.015,1,1,[r],.001,100000,'USD','JPY',true);
 assert(yen.ready);assert.equal(yen.commissionPrice,.007);assert(Math.abs(yen.bps-(.022/150*10000))<1e-12);
 const btc=c.MABrokerRecord(65000,12,1,1,[rule(c,tier(c,{mode:c.SYMBOL_COMMISSION_PERCENT,volume_type:c.SYMBOL_COMMISSION_VOLUME_TYPE_TURNOVER,value:.01}))],.01,1,'BTC','USD',true);
 assert.equal(btc.commissionPrice,13);assert.equal(btc.totalPrice,25);
 const tiny=c.MABrokerRecord(.00001234,.00000002,1,0,[],1e-8,1,'ABC','USD',true);
 assert(tiny.ready);assert(Math.abs(tiny.bps-16.20745542949757)<1e-10);
});
test('missing bar spread or failed fee query blocks P but keeps reference geometry and known-zero handling separate',()=>{
 const c=load(),b={time:0,close:4000,spread:0},r={direction:1,ready:true,atr:10,lastLow:3990,lastHigh:4010,pullbackConfirmed:true,adx:25},cost={};
 const p=c.CostedPlan(b,r,900,220,false,cost,false);assert(p.valid);assert(!p.pCandidate);assert.equal(p.netRR,Number.MAX_VALUE);
 c.PCostMode=c.MA_FIXED_BPS;const old=c.CostedPlan(b,r,900,220,false,{},false),expected=c.MAMakePlan(b,r,900,220,7,1.8,false,6);assert.equal(old.pCandidate,expected.pCandidate);assert.equal(old.netRR,expected.netRR);
 c.PCostMode=c.MA_BROKER_AUTO;c.costMemos=[];c.brokerCommissionCount=-1;assert(!c.CostedPlan({...b,spread:40},r,900,220,false,{},false).pCandidate);
});
test('actual export string expressions produce valid JSON in automatic and legacy modes',()=>{
 const c=load(),s=fs.readFileSync(path.join(__dirname,'../mt5/MultiAnalyzerGold.mq5'),'utf8');
 const expressions=s.split('\n').filter(l=>l.trim().startsWith('FileWriteString(file,')).map(l=>l.trim().slice('FileWriteString(file,'.length,-2));
 const header=expressions.find(x=>x.includes('exportedServerTime')),meta=expressions.find(x=>x.includes('commissionSchedule')),costExpr=expressions.find(x=>x.startsWith('"{\\"cost')),barExpr=expressions.find(x=>x.startsWith('"\\"time'));
 assert(header&&meta&&costExpr&&barExpr);
 Object.assign(c,{symbol:'GOLD',TERMINAL_CONNECTED:1,TerminalInfoInteger:()=>true,quote:{bid:4000,ask:4000.5,time:1000},quoted:true,MAVolumeName:()=> 'broker tick activity',VolumeBasis:0,brokerCommissionKey:'0',brokerCommissionError:0,JNumber:v=>!Number.isFinite(v)||v===Number.MAX_VALUE?'null':String(v),MAVolume:b=>b.tick_volume,
  raw:[{time:0,open:4000,high:4001,low:3999,close:4000,tick_volume:10,real_volume:0,spread:40}],i:0,r:{ready:true,e13:4000,e21:4000,atr:2,adx:25,direction:1,ribbon:1,exitLong:false,exitShort:false,pullbackConfirmed:true},p:{stop:3990,tp2:4022,netRR:2,pCandidate:true},derived:true,cost:c.MACostParts(4000,.4,0,'BROKER_SPREAD_NO_COMMISSION_RULES_REPORTED')});
 c.ChartBasis=()=> 'BID';const evaluate=x=>vm.runInContext(x.replace(/\((?:long|bool)\)/g,''),c);
 for(const mode of [c.MA_BROKER_AUTO,c.MA_FIXED_BPS]){c.PCostMode=mode;const text=evaluate(header)+evaluate(meta)+'{"bars":['+evaluate(costExpr)+evaluate(barExpr)+']}]}' ;const parsed=JSON.parse(text);assert.equal(parsed.symbol,'GOLD');assert.equal(parsed.frames[0].bars[0].cost.available,true);assert.equal(parsed.assumedCostBps,mode===c.MA_FIXED_BPS?7:null);}
});
