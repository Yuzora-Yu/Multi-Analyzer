const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../mt5/MultiAnalyzerGold.mq5'),'utf8');
test('graphical cleanup namespaces cannot erase any control button',()=>{
 const buttons=[...source.matchAll(/Button\("([^"]+)"/g)].map(m=>m[1]);
 const groups=[...source.matchAll(/ObjectsDeleteAll\(0,prefix\+"([^"]+)"\)/g)].map(m=>m[1]);
 assert(buttons.includes('signals'));assert(groups.length>=3);
 for(const group of groups)for(const name of buttons)assert(!name.startsWith(group),`${group} would erase ${name}`);
});
test('indicator and local audit code have no account, order, mail or external transport access',()=>{
 for(const name of ['MultiAnalyzerGold.mq5','MAFlowCore.mqh','tests/NativeFlowAudit.mq5']){
  const text=fs.readFileSync(path.join(__dirname,'../mt5',name),'utf8');
  assert(!/\b(?:OrderSend|OrderSendAsync|AccountInfo\w*|PositionGet\w*|HistoryDeal\w*|SendMail|SendNotification|WebRequest)\s*\(/.test(text),name);
 }
});
test('indicator rendering never overwrites the user chart properties',()=>{
 assert(!/\b(?:ChartSetInteger|ChartSetDouble|ChartSetString|ChartApplyTemplate|ChartSetSymbolPeriod|ChartNavigate)\s*\(/.test(source));
});
