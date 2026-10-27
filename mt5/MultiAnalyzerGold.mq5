#property copyright "Multi-Analyzer"
#property link "https://yuzora-yu.github.io/Multi-Analyzer/"
#property version "1.130"
#property description "Multi-Analyzer MT5 1.1.0-preview.13. P source and first render candle trace. No trading."
#property indicator_chart_window
#property indicator_buffers 33
#property indicator_plots 26
#property indicator_label1 "EMA20"
#property indicator_type1 DRAW_LINE
#property indicator_color1 clrDodgerBlue
#property indicator_label2 "EMA50"
#property indicator_type2 DRAW_LINE
#property indicator_color2 clrOrange
#property indicator_label3 "BB middle"
#property indicator_type3 DRAW_LINE
#property indicator_color3 clrSlateGray
#property indicator_label4 "BB upper"
#property indicator_type4 DRAW_LINE
#property indicator_color4 clrSlateGray
#property indicator_label5 "BB lower"
#property indicator_type5 DRAW_LINE
#property indicator_color5 clrSlateGray
#property indicator_type20 DRAW_FILLING
#property indicator_color20 C'209,237,224',C'248,220,223'
#property indicator_type21 DRAW_FILLING
#property indicator_color21 C'209,237,224',C'248,220,223'
#property indicator_type22 DRAW_FILLING
#property indicator_color22 C'209,237,224',C'248,220,223'
#property indicator_type23 DRAW_FILLING
#property indicator_color23 C'209,237,224',C'248,220,223'
#property indicator_type24 DRAW_FILLING
#property indicator_color24 C'209,237,224',C'248,220,223'
#property indicator_type25 DRAW_FILLING
#property indicator_color25 C'209,237,224',C'248,220,223'
#property indicator_type26 DRAW_FILLING
#property indicator_color26 C'209,237,224',C'248,220,223'
#include "MAFlowCore.mqh"
#include "MAHistoryCore.mqh"
#include "MAResponseCore.mqh"
#include "MAVisualCore.mqh"
#include "MAInstrumentCore.mqh"
#include "MABrokerCost.mqh"
#include "MAZoneImportance.mqh"
#include "MAPDisplayCore.mqh"

input int HistoryBars=1000; // request 220..1500; price/SMC need60, EMA144 needs144, P still needs220
input bool InitialBands=true;
input bool InitialRetiredZones=true; // historical outlines, independently toggleable
input int RetiredZonesPerFrame=3; // 0..10 most recently retired zones per source timeframe
input bool InitialAllZoneFrames=false; // false: display timeframe and higher only
input bool InitialZoneLabels=true; // active callouts only; retired details remain in tooltips
input bool InitialBB=true;
input bool InitialRibbon=true;
input bool InitialCloud=true; // EMA5..144 fill, colored by the SAME ribbon as the Web chart
input bool InitialSignals=true;
input bool InitialPDisplayTrace=true; // second neutral P at the first render candle, not another signal
input int PDisplayTraceCount=20; // latest 1..40 recorded pairs; local ledger retains at most 256
input bool InitialDetails=false; // top-left data panel; independently remembered per chart
input MAVolumeMode VolumeBasis=MA_TICK_ACTIVITY; // tick counts are NOT exchange trade volume
input double AssumedRoundTripCostBps=7.0; // used only in legacy MA_FIXED_BPS mode
input MACostMode PCostMode=MA_BROKER_AUTO; // default: broker-recorded spread + commission rules; fixed bps is legacy only
input double MinimumNetRR=1.8;
input bool ManualBlackout=false; // no automatic economic calendar is available in this indicator
input bool ShowFrameDetails=false;
input string InstanceName="default";
double e20[],e50[],bm[],bu[],bl[];
double r5[],r8[],r13[],r21[],r34[],r55[],r89[],r144[],exitBuy[],exitSell[],pBuy[],pSell[],turnBuy[],turnSell[];
double cloud0a[],cloud0b[],cloud1a[],cloud1b[],cloud2a[],cloud2b[],cloud3a[],cloud3b[],cloud4a[],cloud4b[],cloud5a[],cloud5b[],cloud6a[],cloud6b[];
MqlRates chartRates[],m15Rates[],hourRates[];
MAFlowRow chartFlow[],m15Flow[],hourFlow[];
string prefix,key;
bool showBands=true,showBB=true,showRibbon=true,showSignals=true,showDetails=false,chartAvailable=false;
bool showCloud=true;
bool showRetired=true;
bool showAllZoneFrames=false,showZoneLabels=true;
bool showPDisplayTrace=true,pDisplayDirty=false,pDisplayStoreOK=true,pDisplayStoreWritable=true,pDisplayNeedsPaint=false;
datetime pDisplayBaseline=0,pDisplayNextSave=0;
string pDisplayScope="",pDisplayFile="";
int pDisplayLease=INVALID_HANDLE;
MAPDisplayRecord pDisplayRecords[];
int zoneLabelBuy=0,zoneLabelSell=0;
MALabelBox labelBoxes[];
struct MAExitGroup {int side,first,last,count;double firstPrice,atr;string times;};
int exitLabels=0,exitGroups=0;
string panelText="";
datetime lastM15=0,lastH1=0,lastH4=0,lastExec=0,lastMinute=0;
MAZone candidates[];
MAZone retiredCandidates[];
struct MAPriorityRecord {MAZone source;MAZonePriority importance;};
MAPriorityRecord importanceRecords[];
void CacheFrameImportance(const MqlRates &c[],const MAZone &zones[]) {
 MAImportanceFact facts[];if(!MAImportancePrepare(c,VolumeBasis,facts)) return;
 for(int i=0;i<ArraySize(zones);i++) {int n=ArraySize(importanceRecords);ArrayResize(importanceRecords,n+1);importanceRecords[n].source=zones[i];importanceRecords[n].importance=MAImportanceEvaluate(c,facts,zones[i]);}
}
MAZonePriority ImportanceFor(const MAZone &z) {
 for(int i=ArraySize(importanceRecords)-1;i>=0;i--) {
  MAZone original=importanceRecords[i].source;
  if(original.frame==z.frame&&original.formed==z.formed&&original.kind==z.kind&&original.side==z.side&&original.low==z.low&&original.high==z.high) return importanceRecords[i].importance;
 }
 MAZonePriority q;ZeroMemory(q);q.relativeVolume=EMPTY_VALUE;q.bodyATR=EMPTY_VALUE;return q;
}
int retiredPainted=0;
string quality="履歴の同期を待っています";
MASession weeklySessions[];
MqlRates lastRawRates[];
int historySeedStart=0,historyCopied=0;
bool retryHistory=true;
int visibleBands=0;
string zoneDrawError="";
MqlCommission brokerCommissionRules[];
int brokerCommissionCount=-1,brokerCommissionError=0;
datetime brokerCommissionObservedAt=0;
ulong nextCommissionRead=0;
string brokerCommissionKey="";
MACostMemo costMemos[];

void PruneCostMemos(const int seconds,const datetime oldest) {
 int write=0;
 for(int i=0;i<ArraySize(costMemos);i++) {
  if(costMemos[i].seconds==seconds&&costMemos[i].time<oldest) continue;
  if(write!=i) costMemos[write]=costMemos[i];write++;
 }
 ArrayResize(costMemos,write);
}

bool RefreshBrokerCommissions(const bool force=false) {
 if(PCostMode!=MA_BROKER_AUTO) return false;
 ulong now=GetTickCount64();if(!force&&now<nextCommissionRead) return false;
 int oldCount=brokerCommissionCount;string oldKey=brokerCommissionKey;
 ResetLastError();
 if(TerminalInfoInteger(TERMINAL_CONNECTED)) brokerCommissionCount=SymbolInfoCommissions(_Symbol,brokerCommissionRules);
 else {brokerCommissionCount=-1;ArrayResize(brokerCommissionRules,0);}
 brokerCommissionError=brokerCommissionCount<0?GetLastError():0;
 brokerCommissionObservedAt=TimeTradeServer();brokerCommissionKey=IntegerToString(brokerCommissionCount);
 for(int i=0;i<ArraySize(brokerCommissionRules);i++) {
  brokerCommissionKey+="|"+brokerCommissionRules[i].currency+":"+IntegerToString((int)brokerCommissionRules[i].mode_range)+":"+IntegerToString((int)brokerCommissionRules[i].mode_charge)+":"+IntegerToString((int)brokerCommissionRules[i].mode_entry)+":"+IntegerToString((int)brokerCommissionRules[i].mode_direction)+":"+IntegerToString((int)brokerCommissionRules[i].mode_profit);
  for(int j=0;j<ArraySize(brokerCommissionRules[i].tiers);j++) {
   MqlCommissionTier t=brokerCommissionRules[i].tiers[j];
   brokerCommissionKey+="/"+IntegerToString((int)t.mode)+":"+IntegerToString((int)t.volume_type)+":"+DoubleToString(t.value,12)+":"+DoubleToString(t.min_value,12)+":"+DoubleToString(t.max_value,12)+":"+DoubleToString(t.range_from,12)+":"+DoubleToString(t.range_to,12)+":"+t.currency;
  }
 }
 nextCommissionRead=now+(brokerCommissionCount<0?10000:60000);
 return oldCount!=brokerCommissionCount||oldKey!=brokerCommissionKey;
}
MACostRecord BrokerCost(const MqlRates &b,const int side,const bool live=false) {
 if(PCostMode==MA_FIXED_BPS) {MACostRecord fixed=MACostParts(b.close,b.close*AssumedRoundTripCostBps/10000,0,"MANUAL_FIXED_ROUND_TRIP_BPS");fixed.spreadPrice=EMPTY_VALUE;fixed.commissionPrice=EMPTY_VALUE;return fixed;}
 double spread=EMPTY_VALUE;
 if(live) {
  MqlTick t;
  if(SymbolInfoTick(_Symbol,t)&&TimeTradeServer()>=t.time&&TimeTradeServer()-t.time<120&&MASpreadBps(t.bid,t.ask)!=EMPTY_VALUE) spread=t.ask-t.bid;
 } else if(b.spread>0) spread=b.spread*_Point;
 MACostRecord cost=MABrokerRecord(b.close,spread,side,brokerCommissionCount,brokerCommissionRules,_Point,SymbolInfoDouble(_Symbol,SYMBOL_TRADE_CONTRACT_SIZE),SymbolInfoString(_Symbol,SYMBOL_CURRENCY_BASE),SymbolInfoString(_Symbol,SYMBOL_CURRENCY_PROFIT),MALinearProfitMode(SymbolInfoInteger(_Symbol,SYMBOL_TRADE_CALC_MODE)));
 cost.commissionObservedAt=brokerCommissionObservedAt;
 if(!MACostNumber(spread)) cost.reason=live?"現在のBid/Askが未取得・古いためP費用保留":"この確定足の記録spread未取得（0も不明扱い）";
 return cost;
}
MACostRecord SignalCost(const MqlRates &b,const int side,const int seconds,const bool latest) {
 int lo=0,hi=ArraySize(costMemos);
 while(lo<hi) {int mid=(lo+hi)/2;if(MACostMemoCompare(costMemos[mid],seconds,b.time,side)<0) lo=mid+1;else hi=mid;}
 bool found=lo<ArraySize(costMemos)&&MACostMemoCompare(costMemos[lo],seconds,b.time,side)==0;
 if(found&&costMemos[lo].close==b.close&&costMemos[lo].spread==b.spread&&costMemos[lo].point==_Point) return costMemos[lo].cost;
 MACostRecord cost=BrokerCost(b,side);
 datetime now=TimeTradeServer(),closed=b.time+seconds;
 if(PCostMode==MA_BROKER_AUTO&&latest&&now>=closed&&now-closed<=120) {
  MACostRecord quote=BrokerCost(b,side,true);
  if(!quote.ready) return quote;
  // Capture the first observed quote after close; never resample this bar later.
  double spread=MACostNumber(cost.spreadPrice)?MathMax(cost.spreadPrice,quote.spreadPrice):quote.spreadPrice;
  cost=MACostParts(b.close,spread,quote.commissionPrice,"FIRST_SEEN_QUOTE_MAX_RECORDED_SPREAD");
  cost.commissionObservedAt=brokerCommissionObservedAt;cost.observedAt=now;
 }
 if(!cost.ready) return cost;
 if(!found) {
  int n=ArraySize(costMemos);if(n>=24000) return cost;
  ArrayResize(costMemos,n+1);for(int i=n;i>lo;i--) costMemos[i]=costMemos[i-1];
 }
 MACostMemo memo;ZeroMemory(memo);memo.time=b.time;memo.seconds=seconds;memo.side=side;
 memo.close=b.close;memo.spread=b.spread;memo.point=_Point;memo.cost=cost;costMemos[lo]=memo;
 return cost;
}
MAPlan CostedPlan(const MqlRates &b,const MAFlowRow &r,const int seconds,const int bars,const bool blocked,MACostRecord &cost,const bool latest=false) {
 cost=SignalCost(b,r.direction,seconds,latest);
 MAPlan plan=MAMakePlan(b,r,seconds,bars,cost.ready?cost.bps:0,MinimumNetRR,blocked||!cost.ready,MAPlanDigits(_Digits));
 if(!cost.ready) {plan.totalCost=EMPTY_VALUE;plan.costRiskRatio=EMPTY_VALUE;plan.netRR=EMPTY_VALUE;plan.costOK=false;plan.pCandidate=false;}
 return plan;
}

double ChartQuote(const MqlTick &tick) {
 return SymbolInfoInteger(_Symbol,SYMBOL_CHART_MODE)==SYMBOL_CHART_MODE_LAST?tick.last:tick.bid;
}
string ChartBasis() {return SymbolInfoInteger(_Symbol,SYMBOL_CHART_MODE)==SYMBOL_CHART_MODE_LAST?"LAST":"BID";}
string LiveCostSummary() {
 if(PCostMode==MA_FIXED_BPS) return "P費用: 手動固定 "+DoubleToString(AssumedRoundTripCostBps,2)+"bps（旧方式）";
 int j=ArraySize(m15Rates)-1;if(j<0||j>=ArraySize(m15Flow)) return "P費用: 自動 / M15履歴待ち";
 MACostRecord cost=BrokerCost(m15Rates[j],m15Flow[j].direction,true);
 if(!cost.ready) return "P費用: 自動 / "+cost.reason+" / API error "+IntegerToString(brokerCommissionError);
 MAPlan now=MAMakePlan(m15Rates[j],m15Flow[j],900,j+1,cost.bps,MinimumNetRR,false,MAPlanDigits(_Digits));
 return "P費用 自動: 現在spread "+DoubleToString(cost.spreadPrice/_Point,1)+"pt + 手数料換算 "+DoubleToString(cost.commissionPrice,_Digits)+" = "+DoubleToString(cost.bps,2)+"bps\n元M15プランの現在費用条件 "+(now.costOK?"OK":"未達")+" / 将来の滑り・持越し未算入";
}
datetime witnessFrom[],witnessTo[];
int nativeGapChecks=0;

int NativeGapWitness(const datetime from,const datetime to,const int seconds) {
 for(int k=0;k<ArraySize(witnessFrom);k++) if(witnessFrom[k]==from&&witnessTo[k]==to) return 1;
 ENUM_TIMEFRAMES lower=seconds<=14400?PERIOD_M1:seconds<=86400?PERIOD_H1:PERIOD_D1;
 if(PeriodSeconds(lower)>=seconds) return 0;
 MqlRates w[];ArraySetAsSeries(w,false);ResetLastError();
 int copied=CopyRates(_Symbol,lower,(datetime)(from-seconds),(datetime)(to+seconds-1),w);
 if(copied<=0 || !SeriesInfoInteger(_Symbol,lower,SERIES_SYNCHRONIZED)) return 0;
 int status=MAHistoryWitnessStatus(w,from,to,seconds);
 if(status==1) {
  int n=ArraySize(witnessFrom);if(n>=256) {ArrayResize(witnessFrom,0);ArrayResize(witnessTo,0);n=0;}
  ArrayResize(witnessFrom,n+1);ArrayResize(witnessTo,n+1);witnessFrom[n]=from;witnessTo[n]=to;
 }
 return status;
}
int NativeHistoryStart(const MqlRates &rates[],const int seconds) {
 int start=0;nativeGapChecks=0;
 for(int i=1;i<ArraySize(rates);i++) {
  if(rates[i].time-rates[i-1].time<seconds) return -1;
  datetime from=rates[i-1].time+seconds,to=rates[i].time;
  if(to<=from || !MAHistorySessionOverlap(from,to,weeklySessions)) continue;
  // Today's weekly trading hours cannot establish a historical quote calendar.
  // Reconcile disputed gaps against the terminal's actual lower-timeframe bars.
  if(NativeGapWitness(from,to,seconds)==1) nativeGapChecks++;
  else start=i; // unknown or contradictory gaps still require a fresh suffix
 }
 return start;
}

string FrameName(ENUM_TIMEFRAMES tf) {
 if(tf==PERIOD_M1) return "M1"; if(tf==PERIOD_M5) return "M5";
 if(tf==PERIOD_M15) return "M15"; if(tf==PERIOD_H1) return "H1";
 if(tf==PERIOD_H4) return "H4"; if(tf==PERIOD_D1) return "D1";return StringSubstr(EnumToString(tf),7);
}
bool LightChart() {
 long bg=ChartGetInteger(0,CHART_COLOR_BACKGROUND);
 return (bg&255)+((bg>>8)&255)+((bg>>16)&255)>384;
}
color ExitColor() {return LightChart()?C'58,78,118':C'155,190,235';}
color BuyColor() {return LightChart()?C'0,103,92':clrAqua;}
color SellColor() {return LightChart()?C'155,56,29':clrOrange;}
int ControlColumns() {return MathMax(1,MathMin(11,(int)(ChartGetInteger(0,CHART_WIDTH_IN_PIXELS)-20)/100));}
int PanelTop() {return 28+((11+ControlColumns()-1)/ControlColumns())*32;}
void ApplyPalette() {
 color light[]={C'19,85,166',C'166,79,0',C'91,107,126',C'91,107,126',C'91,107,126',
  C'0,108,128',C'0,106,161',C'19,85,166',C'46,69,157',C'102,58,151',C'141,46,134',C'164,80,0',C'174,49,28',
  C'138,87,0',C'138,87,0',C'0,103,60',C'170,42,42',C'0,105,113',C'160,31,102'};
 color dark[]={clrDodgerBlue,clrOrange,clrSlateGray,clrSlateGray,clrSlateGray,
  clrCyan,clrDeepSkyBlue,clrDodgerBlue,clrRoyalBlue,clrMediumPurple,clrViolet,clrOrange,clrOrangeRed,
  clrGold,clrGold,clrLimeGreen,clrTomato,clrAqua,clrDeepPink};
 for(int i=0;i<19;i++) PlotIndexSetInteger(i,PLOT_LINE_COLOR,LightChart()?light[i]:dark[i]);
 PlotIndexSetInteger(13,PLOT_LINE_COLOR,ExitColor());PlotIndexSetInteger(14,PLOT_LINE_COLOR,ExitColor());
 for(int i=19;i<26;i++) {
  // Reserve both DRAW_FILLING colors before assigning the downward color.
  PlotIndexSetInteger(i,PLOT_COLOR_INDEXES,2);
  PlotIndexSetInteger(i,PLOT_LINE_COLOR,0,LightChart()?C'209,237,224':C'24,67,53');
  PlotIndexSetInteger(i,PLOT_LINE_COLOR,1,LightChart()?C'248,220,223':C'80,34,46');
 }
}
void Button(const string name,const string text,const int x,const bool on) {
 string id=prefix+name;
 if(ObjectFind(0,id)<0) ObjectCreate(0,id,OBJ_BUTTON,0,0,0);
 int slot=(x-12)/100,columns=ControlColumns();
 ObjectSetInteger(0,id,OBJPROP_XDISTANCE,12+(slot%columns)*100); ObjectSetInteger(0,id,OBJPROP_YDISTANCE,22+(slot/columns)*32);
 ObjectSetInteger(0,id,OBJPROP_XSIZE,96); ObjectSetInteger(0,id,OBJPROP_YSIZE,28);
 ObjectSetInteger(0,id,OBJPROP_CORNER,CORNER_LEFT_UPPER);
 ObjectSetInteger(0,id,OBJPROP_COLOR,LightChart()?(on?C'19,64,114':C'71,85,105'):(on?clrGold:clrSilver));
 ObjectSetInteger(0,id,OBJPROP_BGCOLOR,LightChart()?(on?C'225,237,250':C'245,247,250'):clrBlack);
 ObjectSetInteger(0,id,OBJPROP_BORDER_COLOR,LightChart()?C'148,163,184':clrSlateGray);ObjectSetInteger(0,id,OBJPROP_STATE,false);
 ObjectSetString(0,id,OBJPROP_FONT,"Meiryo"); ObjectSetString(0,id,OBJPROP_TEXT,text+(on?" ON":" OFF"));
}
void Controls() {
 Button("toggle","反転帯",12,showBands);Button("bb","BB",112,showBB);Button("ribbon","リボン",212,showRibbon);
 Button("signals","P / EXIT",312,showSignals);Button("details","詳細",412,showDetails);Button("export","AI保存",512,true);
 Button("cloud","トレンド雲",612,showCloud);
 Button("retired","解消帯",712,showRetired);
 Button("frameScope","下位足も",812,showAllZoneFrames);Button("bandText","帯文字",912,showZoneLabels);
 Button("pDisplay","P表示足",1012,showPDisplayTrace);
 ObjectSetString(0,prefix+"pDisplay",OBJPROP_TOOLTIP,"元のP → 初回描画処理時の足を灰色の表示Pと線で表示。別サインではありません。過去の未記録時刻は推定しません。");
 ObjectSetString(0,prefix+"frameScope",OBJPROP_TOOLTIP,"OFF: 表示足以上の帯 / ON: 下位足も表示。判定・AI保存は不変。");
 ObjectSetString(0,prefix+"bandText",OBJPROP_TOOLTIP,"有効帯の説明文字だけを切替。解消帯は点線とツールチップを保持。");
}
void Panel(const string text) {
 panelText=text;ObjectsDeleteAll(0,prefix+"panel");if(!showDetails) return;
 string display=text;StringReplace(display,"{LIVE_COST}",LiveCostSummary());
 string source[];int count=StringSplit(display,'\n',source);string lines[];int n=0;
 int width=(int)MathMax(100,ChartGetInteger(0,CHART_WIDTH_IN_PIXELS)-40);
 for(int i=0;i<count;i++) {
  string line="";int used=0;
  for(int j=0;j<StringLen(source[i]);j++) {
   int pixels=StringGetCharacter(source[i],j)>255?12:7;
   if(used+pixels>width && StringLen(line)>0) {ArrayResize(lines,n+1);lines[n++]=line;line="";used=0;}
   line+=StringSubstr(source[i],j,1);used+=pixels;
  }
  ArrayResize(lines,n+1);lines[n++]=line;
 }
 int top=PanelTop();string box=prefix+"panel.background";ObjectCreate(0,box,OBJ_RECTANGLE_LABEL,0,0,0);
 ObjectSetInteger(0,box,OBJPROP_XDISTANCE,8);ObjectSetInteger(0,box,OBJPROP_YDISTANCE,top-4);
 ObjectSetInteger(0,box,OBJPROP_XSIZE,width+16);ObjectSetInteger(0,box,OBJPROP_YSIZE,n*17+8);
 ObjectSetInteger(0,box,OBJPROP_BGCOLOR,LightChart()?C'248,250,252':C'20,28,38');
 ObjectSetInteger(0,box,OBJPROP_BORDER_COLOR,LightChart()?C'203,213,225':clrSlateGray);
 ObjectSetInteger(0,box,OBJPROP_BACK,false);ObjectSetInteger(0,box,OBJPROP_SELECTABLE,false);
 for(int i=0;i<n;i++) {
  string id=prefix+"panel"+IntegerToString(i);ObjectCreate(0,id,OBJ_LABEL,0,0,0);
  ObjectSetInteger(0,id,OBJPROP_XDISTANCE,16); ObjectSetInteger(0,id,OBJPROP_YDISTANCE,top+i*17);
  ObjectSetInteger(0,id,OBJPROP_COLOR,LightChart()?C'30,41,59':clrGainsboro); ObjectSetInteger(0,id,OBJPROP_FONTSIZE,9);
  ObjectSetString(0,id,OBJPROP_FONT,"Meiryo"); ObjectSetString(0,id,OBJPROP_TEXT,lines[i]);
 }
}
bool ReadSessions() {
 ArrayResize(weeklySessions,0);
 for(int day=0;day<7;day++) for(uint n=0;n<16;n++) {
  datetime from,to;
  if(!SymbolInfoSessionTrade(_Symbol,(ENUM_DAY_OF_WEEK)day,n,from,to)) break;
  MAAppendSession(weeklySessions,day,from,to);
 }
 return ArraySize(weeklySessions)>0;
}
bool SessionOpen(const datetime t) {return MAHistorySessionOverlap(t,t+1,weeklySessions);}
bool FrameRates(ENUM_TIMEFRAMES tf,MqlRates &rates[],const int count,const int minimum=60) {
 quality="OK";historySeedStart=0;historyCopied=0;ArrayResize(lastRawRates,0);
 ArraySetAsSeries(rates,false);
 ResetLastError();
 int n=CopyRates(_Symbol,tf,1,count,rates); // bar0 is NEVER a confirmed analysis input
 int copyError=GetLastError();historyCopied=MathMax(0,n);ArrayCopy(lastRawRates,rates);
 if(n<=0) {quality="取得待ち / CopyRates error "+IntegerToString(copyError);return false;}
 if(n<minimum) {quality="取得済 "+IntegerToString(n)+"本 / 価格計算に必要 "+IntegerToString(minimum)+"本";return false;}
 if(!SeriesInfoInteger(_Symbol,tf,SERIES_SYNCHRONIZED)) {quality="取得済 "+IntegerToString(n)+"本 / 同期確認中";return false;}
 if(!MAValid(rates)) {quality="取得済 / OHLC・時系列不整合";return false;}
 int seconds=PeriodSeconds(tf);PruneCostMemos(seconds,rates[0].time); datetime now=TimeCurrent();
 if(rates[n-1].time+seconds>now) {quality="取得済 / 足終了時刻が業者時計より未来";return false;}
 if(tf==PERIOD_M15 && now-rates[n-1].time-seconds>1200) {quality="取得済 / M15更新遅延";return false;}
 if(ArraySize(weeklySessions)==0) {quality="取得済 / 業者セッション未取得";return false;}
 historySeedStart=NativeHistoryStart(rates,seconds);
 if(historySeedStart<0) {historySeedStart=0;quality="取得済 / 足時刻の重複・重なり";return false;}
 if(historySeedStart>0) {
  int usable=n-historySeedStart;
  quality="空白後から再構築 "+IntegerToString(usable)+"/"+IntegerToString(n)+"本 / 起点 "+TimeToString(rates[historySeedStart].time,TIME_DATE|TIME_MINUTES);
  if(usable<minimum) {quality+=" / 必要 "+IntegerToString(minimum)+"本";return false;}
  // Do not infer historical holidays, ignore the gap, or fabricate replacement candles.
  MqlRates suffix[];ArrayCopy(suffix,rates,0,historySeedStart,usable);ArraySwap(rates,suffix);
 }
 if(nativeGapChecks>0) quality+=(quality=="OK"?" / ":" / ")+"下位の業者足と空白照合 "+IntegerToString(nativeGapChecks)+"件（休場理由未確認）";
 if(ArraySize(rates)<220) quality+=" / P準備に220本必要";
 return true;
}
string Arrow(const int direction) {return direction>0?"UP":direction<0?"DOWN":"WAIT";}
bool SignalText(const string kind,const datetime time,const double price,const string text,const color col,const string extra="") {
 int x,y;if(!ChartTimePriceToXY(0,0,time,price,x,y)) return false;
 int width=(int)ChartGetInteger(0,CHART_WIDTH_IN_PIXELS)-82,height=(int)ChartGetInteger(0,CHART_HEIGHT_IN_PIXELS)-26;
 if(x<0||x>width||y<0||y>height) return false;
 int w=StringLen(text)*8+8,h=16,dx[]={0,36,-36,72,-72},dy[]={0,18,-18,36,-36,54,-54,72,-72};
 bool placed=false;int px=x,py=y;
 for(int a=0;a<ArraySize(dy)&&!placed;a++) for(int b=0;b<ArraySize(dx)&&!placed;b++) {
  int left=x+dx[b],bottom=y+dy[a];
  if(MALabelFits(left,bottom-h,w,h,width,height,showDetails?height:PanelTop()+20,labelBoxes)) {int n=ArraySize(labelBoxes);ArrayResize(labelBoxes,n+1);labelBoxes[n].left=left;labelBoxes[n].right=left+w;labelBoxes[n].top=bottom-h;labelBoxes[n].bottom=bottom;px=left;py=bottom;placed=true;}
 }
 if(!placed) return false; // Every original event dot and JSON row still remains.
 int window=0;datetime labelTime;double labelPrice;
 if(!ChartXYToTimePrice(0,px,py,window,labelTime,labelPrice)||window!=0) return false;
 string name=prefix+"mark."+kind+IntegerToString((long)time);
 if(!ObjectCreate(0,name,OBJ_TEXT,0,labelTime,labelPrice)||!ObjectSetString(0,name,OBJPROP_TEXT,text)) return false;
 ObjectSetInteger(0,name,OBJPROP_ANCHOR,ANCHOR_LEFT_LOWER);
 ObjectSetString(0,name,OBJPROP_FONT,"Meiryo");ObjectSetInteger(0,name,OBJPROP_FONTSIZE,8);
 ObjectSetInteger(0,name,OBJPROP_COLOR,col);ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
 ObjectSetString(0,name,OBJPROP_TOOLTIP,text+" | confirmed "+TimeToString(time+PeriodSeconds())+" broker | "+extra+" | "+MAVolumeName(VolumeBasis)+(kind=="xb"||kind=="xs"?" | EXIT is NOT a reversal entry":""));
 if(px!=x||py!=y) {
  string lead=name+".leader";ObjectCreate(0,lead,OBJ_TREND,0,time,price,labelTime,labelPrice);
  ObjectSetInteger(0,lead,OBJPROP_COLOR,LightChart()?C'148,163,184':clrSlateGray);ObjectSetInteger(0,lead,OBJPROP_RAY_RIGHT,false);ObjectSetInteger(0,lead,OBJPROP_RAY_LEFT,false);ObjectSetInteger(0,lead,OBJPROP_SELECTABLE,false);
 }
 return true;
}
// Only records future render passes after the first successful history baseline.
// Startup/recalculated history is NEVER stamped with the attachment time.
void EnsurePDisplayBaseline() {
 if(pDisplayBaseline>0||!chartAvailable||ArraySize(chartRates)==0) return;
 pDisplayBaseline=chartRates[ArraySize(chartRates)-1].time+PeriodSeconds();
}
string PDisplayLine(const MAPDisplayRecord &r) {
 return IntegerToString((long)r.source)+"|"+IntegerToString((long)r.confirmed)+"|"+IntegerToString((long)r.observedServer)+"|"+IntegerToString((long)r.observedUTC)+"|"+IntegerToString((long)r.displayBar)+"|"+IntegerToString(r.side)+"|"+DoubleToString(r.sourcePrice,12)+"|"+DoubleToString(r.displayPrice,12)+"|"+(r.delayed?"1":"0");
}
void LoadPDisplayTrace() {
 ArrayResize(pDisplayRecords,0);pDisplayBaseline=0;pDisplayDirty=false;pDisplayStoreOK=true;pDisplayStoreWritable=true;
 pDisplayScope="p-display-v1|"+IntegerToString(ChartID())+"|"+MAFileSymbol(InstanceName)+"|"+MAFileSymbol(_Symbol)+"|"+IntegerToString(PeriodSeconds())+"|"+IntegerToString(HistoryBars)+"|"+IntegerToString((int)VolumeBasis)+"|"+IntegerToString((int)PCostMode)+"|"+DoubleToString(AssumedRoundTripCostBps,8)+"|"+DoubleToString(MinimumNetRR,8)+"|"+(ManualBlackout?"1":"0");
 uint hash=2166136261;for(int i=0;i<StringLen(pDisplayScope);i++) hash=(hash^(uint)StringGetCharacter(pDisplayScope,i))*16777619;
 pDisplayFile="MultiAnalyzerGold/PDisplayTrace/"+IntegerToString(ChartID())+"-"+StringFormat("%08X",hash)+".txt";
 // A duplicate indicator with the same chart/input scope must not overwrite the first writer.
 pDisplayLease=FileOpen(pDisplayFile+".lease",FILE_READ|FILE_WRITE|FILE_BIN);
 if(pDisplayLease==INVALID_HANDLE) {pDisplayStoreOK=false;pDisplayStoreWritable=false;Print("P display ledger unavailable or another matching instance is writing; memory only.");}
 if(!FileIsExist(pDisplayFile)) return;
 int f=FileOpen(pDisplayFile,FILE_READ|FILE_TXT|FILE_ANSI,0,CP_UTF8);
 bool valid=f!=INVALID_HANDLE;MAPDisplayRecord loaded[];
 if(valid) {
  valid=FileSize(f)<131072&&FileReadString(f)==pDisplayScope;bool ended=false;
  while(valid&&!FileIsEnding(f)) {
   string line=FileReadString(f);if(line==""&&FileIsEnding(f)) break;
   if(line=="END|"+IntegerToString(ArraySize(loaded))) {ended=FileIsEnding(f);if(!ended) valid=false;break;}
   string v[];if(StringSplit(line,'|',v)!=9) {valid=false;break;}
   MAPDisplayRecord r;ZeroMemory(r);
   r.source=(datetime)StringToInteger(v[0]);r.confirmed=(datetime)StringToInteger(v[1]);r.observedServer=(datetime)StringToInteger(v[2]);r.observedUTC=(datetime)StringToInteger(v[3]);r.displayBar=(datetime)StringToInteger(v[4]);r.side=(int)StringToInteger(v[5]);r.sourcePrice=StringToDouble(v[6]);r.displayPrice=StringToDouble(v[7]);r.delayed=v[8]=="1";
   valid=ArraySize(loaded)<256&&PDisplayLine(r)==line&&MAPDisplayRemember(loaded,r,PeriodSeconds(),256);
  }
  valid=valid&&ended;FileClose(f);
 }
 if(valid) ArrayCopy(pDisplayRecords,loaded);
 else {pDisplayStoreOK=false;pDisplayStoreWritable=false;Print("P display ledger unreadable/scope mismatch. Preserved without overwrite; new observations remain in memory.");}
}
void SavePDisplayTrace() {
 if(!pDisplayDirty||!pDisplayStoreWritable||TimeLocal()<pDisplayNextSave) return;
 pDisplayNextSave=TimeLocal()+10;
 string temp=pDisplayFile+"."+IntegerToString((long)GetMicrosecondCount())+".tmp";
 int f=FileOpen(temp,FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);bool ok=f!=INVALID_HANDLE;
 if(ok) {
  ok=FileWriteString(f,pDisplayScope+"\r\n")>0;
  for(int i=0;i<ArraySize(pDisplayRecords)&&ok;i++) ok=FileWriteString(f,PDisplayLine(pDisplayRecords[i])+"\r\n")>0;
  if(ok) ok=FileWriteString(f,"END|"+IntegerToString(ArraySize(pDisplayRecords))+"\r\n")>0;
  ResetLastError();FileFlush(f);if(GetLastError()!=0) ok=false;FileClose(f);
  if(ok) ok=FileMove(temp,0,pDisplayFile,FILE_REWRITE);
  if(!ok) FileDelete(temp);
 }
 if(ok) {pDisplayDirty=false;pDisplayStoreOK=true;}
 else {if(pDisplayStoreOK) Print("P display ledger save failed; will retry. In-memory observation retained.");pDisplayStoreOK=false;}
}
void RecordPDisplay(const MqlRates &b,const MAFlowRow &r) {
 if(!showSignals||!chartAvailable||MQLInfoInteger(MQL_TESTER)||MAPDisplayFind(pDisplayRecords,b.time,r.direction)>=0) return;
 datetime now=TimeTradeServer(),displayBar=iTime(_Symbol,_Period,0);int seconds=PeriodSeconds();
 MqlTick tick;ZeroMemory(tick);
 if(!TerminalInfoInteger(TERMINAL_CONNECTED)||!SymbolInfoTick(_Symbol,tick)||tick.time>now||now-tick.time>120||
    !MAPDisplayEligible(b.time,seconds,pDisplayBaseline,now,displayBar,r.direction)) return;
 MAPDisplayRecord entry;ZeroMemory(entry);entry.source=b.time;entry.confirmed=b.time+seconds;
 entry.observedServer=now;entry.observedUTC=TimeGMT();entry.displayBar=displayBar;entry.side=r.direction;
 entry.sourcePrice=r.direction>0?b.low-r.atr*.2:b.high+r.atr*.2;
 entry.displayPrice=ChartQuote(tick)+(r.direction>0?-1:1)*r.atr*.35;entry.delayed=displayBar>entry.confirmed;
 if(MAPDisplayRemember(pDisplayRecords,entry,seconds,256)) {pDisplayDirty=true;pDisplayNeedsPaint=true;}
}
string PDisplayTip(const MAPDisplayRecord &r) {
 return "表示P（別の売買サインではありません）\n元足 "+TimeToString(r.source,TIME_DATE|TIME_MINUTES)+" / 確定 "+TimeToString(r.confirmed,TIME_DATE|TIME_MINUTES)+" broker\n初回描画処理 "+TimeToString(r.observedServer,TIME_DATE|TIME_SECONDS)+" broker\n"+
  TimeToString(r.observedUTC,TIME_DATE|TIME_SECONDS)+" UTC / "+TimeToString(r.observedUTC+9*3600,TIME_DATE|TIME_SECONDS)+" JST（PC時計由来・時計精度未検証）\n表示足 "+TimeToString(r.displayBar,TIME_DATE|TIME_MINUTES)+" broker"+(r.delayed?" / 遅れて初表示":"")+
  "\n元の描画位置と初回観測価格を保持。閲覧・配信・約定時刻の証明ではありません。"+(!pDisplayStoreOK||pDisplayDirty?"\n未保存の記録あり":"");
}
void PaintPDisplayTrace() {
 pDisplayNeedsPaint=false;ObjectsDeleteAll(0,prefix+"ptrace.");if(!showSignals||!showPDisplayTrace) return;
 int n=ArraySize(pDisplayRecords);color col=LightChart()?C'71,85,105':C'180,193,210';
 MALabelBox boxes[];ArrayCopy(boxes,labelBoxes);
 for(int i=MathMax(0,n-PDisplayTraceCount);i<n;i++) {
  MAPDisplayRecord r=pDisplayRecords[i];string id=prefix+"ptrace."+IntegerToString((long)r.source)+"."+IntegerToString(r.side),tip=PDisplayTip(r);
  // Preserve the first observed anchors even if historical re-calculation later changes P.
  ObjectCreate(0,id+".line",OBJ_TREND,0,r.source,r.sourcePrice,r.displayBar,r.displayPrice);
  ObjectSetInteger(0,id+".line",OBJPROP_COLOR,col);ObjectSetInteger(0,id+".line",OBJPROP_STYLE,STYLE_DOT);ObjectSetInteger(0,id+".line",OBJPROP_WIDTH,1);
  ObjectSetInteger(0,id+".line",OBJPROP_RAY_LEFT,false);ObjectSetInteger(0,id+".line",OBJPROP_RAY_RIGHT,false);
  ObjectSetInteger(0,id+".line",OBJPROP_SELECTABLE,false);ObjectSetString(0,id+".line",OBJPROP_TOOLTIP,tip);
  string dots[]={".source",".shown"};datetime times[]={r.source,r.displayBar};double prices[]={r.sourcePrice,r.displayPrice};
  for(int d=0;d<2;d++) {
   ObjectCreate(0,id+dots[d],OBJ_ARROW,0,times[d],prices[d]);ObjectSetInteger(0,id+dots[d],OBJPROP_ARROWCODE,159);
   ObjectSetInteger(0,id+dots[d],OBJPROP_COLOR,col);ObjectSetInteger(0,id+dots[d],OBJPROP_WIDTH,1);ObjectSetInteger(0,id+dots[d],OBJPROP_SELECTABLE,false);ObjectSetString(0,id+dots[d],OBJPROP_TOOLTIP,tip+"\nこの点は保存された初回描画位置。現在のP再成立を意味しません。");
  }
  int x,y,width=(int)ChartGetInteger(0,CHART_WIDTH_IN_PIXELS)-82,height=(int)ChartGetInteger(0,CHART_HEIGHT_IN_PIXELS)-26;
  if(showDetails||!ChartTimePriceToXY(0,0,r.displayBar,r.displayPrice,x,y)) continue;
  int left=x+4;if(left+48>width) left=x-48;int top=0;bool placed=false;
  for(int step=0;step<9&&!placed;step++) {
   int dy=(step==0?0:((step+1)/2)*20*(step%2==1?1:-1)),candidate=y+(r.side>0?4:-20)+dy;
   if(MALabelFits(left,candidate,48,16,width,height,PanelTop()+20,boxes)) {top=candidate;placed=true;}
  }
  if(!placed) continue; // Both dots and the exact candle connector remain.
  int k=ArraySize(boxes);ArrayResize(boxes,k+1);boxes[k].left=left;boxes[k].right=left+48;boxes[k].top=top;boxes[k].bottom=top+16;
  ObjectCreate(0,id+".label",OBJ_LABEL,0,0,0);ObjectSetString(0,id+".label",OBJPROP_TEXT,"表示P");
  ObjectSetInteger(0,id+".label",OBJPROP_CORNER,CORNER_LEFT_UPPER);ObjectSetInteger(0,id+".label",OBJPROP_XDISTANCE,left);ObjectSetInteger(0,id+".label",OBJPROP_YDISTANCE,top);
  ObjectSetString(0,id+".label",OBJPROP_FONT,"Meiryo");ObjectSetInteger(0,id+".label",OBJPROP_FONTSIZE,8);ObjectSetInteger(0,id+".label",OBJPROP_COLOR,col);
  ObjectSetInteger(0,id+".label",OBJPROP_ANCHOR,ANCHOR_LEFT_UPPER);ObjectSetInteger(0,id+".label",OBJPROP_SELECTABLE,false);ObjectSetString(0,id+".label",OBJPROP_TOOLTIP,tip);
 }
}
string PDisplayJson() {
 string out="{\"version\":\"p-display-v1\",\"scope\":\"chart-symbol-timeframe-inputs\",\"frame\":\""+FrameName(_Period)+"\",\"baselineCloseServerTime\":"+IntegerToString((long)pDisplayBaseline)+",\"retentionLimit\":256,\"persisted\":"+JBool(pDisplayStoreOK&&!pDisplayDirty)+",\"utcClockBasis\":\"PC_TIMEGMT_NOT_INDEPENDENTLY_VERIFIED\",\"meaning\":\"FIRST_INDICATOR_RENDER_PASS_NOT_DELIVERY_OR_VIEWING_PROOF; HISTORICAL_UNKNOWN_TIMES_NOT_INFERRED; RECORDED_P_MAY_DIFFER_FROM_CURRENT_RECALCULATION\",\"records\":[";
 for(int i=0;i<ArraySize(pDisplayRecords);i++) {
  MAPDisplayRecord r=pDisplayRecords[i];if(i>0) out+=",";
  out+="{\"sourceBarServerTime\":"+IntegerToString((long)r.source)+",\"confirmedServerTime\":"+IntegerToString((long)r.confirmed)+",\"firstRenderServerTime\":"+IntegerToString((long)r.observedServer)+",\"firstRenderUTC\":"+IntegerToString((long)r.observedUTC)+",\"displayBarServerTime\":"+IntegerToString((long)r.displayBar)+",\"side\":"+IntegerToString(r.side)+",\"sourceMarkerPrice\":"+JNumber(r.sourcePrice)+",\"displayMarkerPrice\":"+JNumber(r.displayPrice)+",\"delayed\":"+JBool(r.delayed)+"}";
 }
 return out+"]}";
}
void PaintSignals() {
 ObjectsDeleteAll(0,prefix+"mark.");exitLabels=0;exitGroups=0;
 EnsurePDisplayBaseline();if(!showSignals||!chartAvailable) {PaintPDisplayTrace();return;}
 int n=ArraySize(chartFlow);
 MAExitGroup groups[];
 for(int i=MathMax(143,n-160);i<n;i++) {
  MAFlowRow r=chartFlow[i];MqlRates b=chartRates[i];double pad=r.atr*.45;
  if(r.switched) SignalText("turn",b.time,r.direction>0?b.low-r.atr*.65:b.high+r.atr*.65,r.direction>0?"TURN 上":"TURN 下",r.direction>0?BuyColor():SellColor());
  MACostRecord cost;MAPlan p=CostedPlan(b,r,PeriodSeconds(),i+1,ManualBlackout&&i==n-1,cost,i==n-1);
  if(p.pCandidate) {
   int trace=MAPDisplayFind(pDisplayRecords,b.time,r.direction);
   string displayInfo=trace<0?"初回表示時刻は未記録（足終了時刻と表示時刻は別）":"初回描画 "+TimeToString(pDisplayRecords[trace].observedServer,TIME_DATE|TIME_SECONDS)+" broker / 表示Pへ接続";
   if(SignalText("p",b.time,r.direction>0?b.low-pad:b.high+pad,"P "+(VolumeBasis==MA_TICK_ACTIVITY?"tick ":"")+Arrow(r.direction),r.direction>0?(LightChart()?C'0,103,60':clrLimeGreen):(LightChart()?C'170,42,42':clrTomato),displayInfo)) RecordPDisplay(b,r);
  }
  if(r.exitLong||r.exitShort) {
   int side=r.exitLong?1:-1,g=-1;
   if(MAExitRange(r.adx,r.e13,r.e21,r.atr)) for(int k=ArraySize(groups)-1;k>=0;k--) {
    if(groups[k].side==side&&MAExitRange(chartFlow[groups[k].first].adx,chartFlow[groups[k].first].e13,chartFlow[groups[k].first].e21,groups[k].atr)&&MAExitGroupable(groups[k].first,groups[k].last,i,groups[k].firstPrice,b.close,groups[k].atr)) {g=k;break;}
   }
   if(g<0) {g=ArraySize(groups);ArrayResize(groups,g+1);groups[g].side=side;groups[g].first=i;groups[g].count=0;groups[g].firstPrice=b.close;groups[g].atr=r.atr;groups[g].times="";}
   groups[g].last=i;groups[g].count++;groups[g].times+=TimeToString(b.time+PeriodSeconds(),TIME_DATE|TIME_MINUTES)+" ";
  }
 }
 for(int k=ArraySize(groups)-1;k>=0;k--) {
  MAExitGroup g=groups[k];MqlRates b=chartRates[g.last];double pad=chartFlow[g.last].atr*.45;
  string text=(g.side>0?"買EXIT":"売EXIT")+(g.count>1?" ×"+IntegerToString(g.count):"");
  if(SignalText(g.side>0?"xb":"xs",b.time,g.side>0?b.high+pad:b.low-pad,text,ExitColor(),"元の確定時刻 "+g.times+" / 近接ラベルの表示集約のみ。各点・判定・保存は全件維持")) exitLabels++;
  if(g.count>1) exitGroups++;
 }
 PaintPDisplayTrace();SavePDisplayTrace();
}
void PaintProfile() {
 ObjectsDeleteAll(0,prefix+"profile");if(!showBands||!chartAvailable) return;
 MAProfile p=MAProfileLevels(chartRates,VolumeBasis);if(!p.available) return;
 double prices[]={p.poc,p.vah,p.val};string labels[]={"POC","VAH","VAL"};
 for(int i=0;i<3;i++) {
  string name=prefix+"profile"+labels[i];ObjectCreate(0,name,OBJ_HLINE,0,0,prices[i]);
  ObjectSetInteger(0,name,OBJPROP_COLOR,i==0?(LightChart()?C'138,87,0':clrGold):(LightChart()?C'91,107,126':clrSlateGray));ObjectSetInteger(0,name,OBJPROP_STYLE,STYLE_DOT);ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
  ObjectSetString(0,name,OBJPROP_TOOLTIP,labels[i]+" "+DoubleToString(prices[i],_Digits)+" | last96 candles range-distribution APPROXIMATION | "+MAVolumeName(VolumeBasis)+" | not actual price-level executions");
 }
}
void BeginLabelLayout() {
 ArrayResize(labelBoxes,0);zoneLabelBuy=0;zoneLabelSell=0;
 int x,y;MqlTick tick;
 if(SymbolInfoTick(_Symbol,tick)&&ChartTimePriceToXY(0,0,TimeCurrent(),ChartQuote(tick),x,y)) {
  ArrayResize(labelBoxes,1);labelBoxes[0].left=0;labelBoxes[0].right=(int)ChartGetInteger(0,CHART_WIDTH_IN_PIXELS);
  labelBoxes[0].top=y-10;labelBoxes[0].bottom=y+10;
 }
}
void ZoneCallout(const MAZone &z,const string id,const string info) {
 if(!showZoneLabels||showDetails||(z.side>0?zoneLabelBuy:zoneLabelSell)>=2) return;
 int width=(int)ChartGetInteger(0,CHART_WIDTH_IN_PIXELS)-82,height=(int)ChartGetInteger(0,CHART_HEIGHT_IN_PIXELS,0)-20;
 int x,y;if(!ChartTimePriceToXY(0,0,z.formed,(z.low+z.high)*.5,x,y)||x>width||y<0||y>height) return;
 MAZonePriority priority=ImportanceFor(z);
 string label=(z.side>0?"買":"売")+IntegerToString((z.side>0?zoneLabelBuy:zoneLabelSell)+1)+" "+z.frame+" "+MAKind(z.kind)+" ["+MAImportanceLabel(priority)+"] "+DoubleToString(z.low,_Digits)+"–"+DoubleToString(z.high,_Digits);
 int w=StringLen(label)*8+12,h=18,left=width-w-8,top=0;bool placed=false;
 for(int i=0;i<31&&!placed;i++) {
  int offset=i==0?0:((i+1)/2)*22*(i%2==1?1:-1),candidate=y-h/2+offset;
  if(MALabelFits(left,candidate,w,h,width,height,PanelTop()+20,labelBoxes)) {top=candidate;placed=true;}
 }
 if(!placed) return;
 int n=ArraySize(labelBoxes);ArrayResize(labelBoxes,n+1);labelBoxes[n].left=left;labelBoxes[n].right=left+w;labelBoxes[n].top=top;labelBoxes[n].bottom=top+h;
 ObjectCreate(0,id+"text",OBJ_LABEL,0,0,0);ObjectSetInteger(0,id+"text",OBJPROP_CORNER,CORNER_LEFT_UPPER);
 ObjectSetInteger(0,id+"text",OBJPROP_ANCHOR,ANCHOR_LEFT_UPPER);ObjectSetInteger(0,id+"text",OBJPROP_XDISTANCE,left);ObjectSetInteger(0,id+"text",OBJPROP_YDISTANCE,top);
 ObjectSetInteger(0,id+"text",OBJPROP_COLOR,z.side>0?BuyColor():SellColor());ObjectSetInteger(0,id+"text",OBJPROP_FONTSIZE,8);
 ObjectSetInteger(0,id+"text",OBJPROP_SELECTABLE,false);ObjectSetString(0,id+"text",OBJPROP_FONT,"Meiryo");ObjectSetString(0,id+"text",OBJPROP_TEXT,label);ObjectSetString(0,id+"text",OBJPROP_TOOLTIP,info);
 int window=0;datetime t1,t2;double p1,p2;
 if(ChartXYToTimePrice(0,width-4,y,window,t1,p1)&&window==0&&ChartXYToTimePrice(0,left+w,top+h/2,window,t2,p2)&&window==0&&t1>=z.formed) {
  ObjectCreate(0,id+"leader",OBJ_TREND,0,t1,(z.low+z.high)*.5,t2,p2);
  ObjectSetInteger(0,id+"leader",OBJPROP_COLOR,LightChart()?C'148,163,184':clrSlateGray);ObjectSetInteger(0,id+"leader",OBJPROP_RAY_RIGHT,false);ObjectSetInteger(0,id+"leader",OBJPROP_RAY_LEFT,false);ObjectSetInteger(0,id+"leader",OBJPROP_SELECTABLE,false);
 }
 if(z.side>0) zoneLabelBuy++;else zoneLabelSell++;
}
bool PaintZone(const MAZone &z,const int index) {
 string id=prefix+"zone"+IntegerToString(index);
  MAZonePriority importance=ImportanceFor(z);
 datetime end=TimeCurrent()+PeriodSeconds((ENUM_TIMEFRAMES)_Period)*5;
 color col=LightChart()?(z.side>0?C'221,236,249':C'250,225,212'):(z.side>0?clrDarkSlateGray:clrSaddleBrown);
 ResetLastError();
 if(!ObjectCreate(0,id,OBJ_RECTANGLE,0,z.formed,z.low,end,z.high)) {zoneDrawError="帯オブジェクト作成失敗 "+IntegerToString(GetLastError());return false;}
 double bottom=ChartGetDouble(0,CHART_PRICE_MIN),top=ChartGetDouble(0,CHART_PRICE_MAX);
 if(z.high>=bottom&&z.low<=top) visibleBands++;
 ObjectSetInteger(0,id,OBJPROP_COLOR,col); ObjectSetInteger(0,id,OBJPROP_FILL,true);
 ObjectSetInteger(0,id,OBJPROP_BACK,true); ObjectSetInteger(0,id,OBJPROP_SELECTABLE,false);
  if(importance.available&&importance.grade==2) {
   ObjectCreate(0,id+"outline",OBJ_RECTANGLE,0,z.formed,z.low,end,z.high);
   ObjectSetInteger(0,id+"outline",OBJPROP_FILL,false);ObjectSetInteger(0,id+"outline",OBJPROP_WIDTH,2);
   ObjectSetInteger(0,id+"outline",OBJPROP_COLOR,z.side>0?BuyColor():SellColor());
   ObjectSetInteger(0,id+"outline",OBJPROP_BACK,true);ObjectSetInteger(0,id+"outline",OBJPROP_SELECTABLE,false);
  }
 string label=z.frame+" "+(z.side>0?"買反転 ":"売反転 ")+MAKind(z.kind)+" "+DoubleToString(z.low,_Digits)+"–"+DoubleToString(z.high,_Digits);
 string info=label+" | 形成 "+TimeToString(z.formed)+" (broker) | 再訪 "+IntegerToString(z.visits)+
  " | "+z.frame+"終値が "+DoubleToString(z.side>0?z.low:z.high,_Digits)+(z.side>0?"未満":"超")+"で撤回。反転成立・入場ではありません。";
 if(z.kind==1) info+=" FVGは全充足でも失効。";
  info+=" | "+MAImportanceText(importance,VolumeBasis);
  if(ObjectFind(0,id+"outline")>=0) ObjectSetString(0,id+"outline",OBJPROP_TOOLTIP,info);
 ObjectSetString(0,id,OBJPROP_TOOLTIP,info);ZoneCallout(z,id,info);
 return true;
}
void AppendRetiredZones(const MAZone &zones[],const datetime asof,const int maxAge) {
 for(int i=0;i<ArraySize(zones);i++) {
  MAZone z=zones[i];
  if(!MARetiredEligible(z.active,z.low,z.high,z.formed,z.retiredAt,asof,z.seconds,maxAge)) continue;
  int n=ArraySize(retiredCandidates);ArrayResize(retiredCandidates,n+1);retiredCandidates[n]=z;
 }
}
bool PaintRetiredZone(const MAZone &z,const int index) {
 string id=prefix+"retired."+IntegerToString(index);
 // Stop at the recorded source-bar close; never project a retired band forward.
 if(!ObjectCreate(0,id,OBJ_RECTANGLE,0,z.formed,z.low,z.retiredAt,z.high)) {
  zoneDrawError="解消帯オブジェクト作成失敗 "+IntegerToString(GetLastError());return false;
 }
 color col=LightChart()?(z.side>0?C'126,139,154':C'156,132,123'):(z.side>0?C'122,145,166':C'174,143,130');
 ObjectSetInteger(0,id,OBJPROP_COLOR,col);ObjectSetInteger(0,id,OBJPROP_FILL,false);
 ObjectSetInteger(0,id,OBJPROP_STYLE,STYLE_DOT);ObjectSetInteger(0,id,OBJPROP_WIDTH,1);
 ObjectSetInteger(0,id,OBJPROP_BACK,true);ObjectSetInteger(0,id,OBJPROP_SELECTABLE,false);
 string label="解消 "+z.frame+" "+(z.side>0?"買":"売")+MAKind(z.kind);
 string reason=z.retiredReason==2?"FVG全充足":"形成元終値の撤回";
 string info=label+" "+DoubleToString(z.low,_Digits)+"–"+DoubleToString(z.high,_Digits)+
  " | 形成 "+TimeToString(z.formed)+" / 解消 "+TimeToString(z.retiredAt)+" (broker) | "+reason+
  " | 現在の有効帯ではありません。取得した確定履歴からの再構築です。";
 ObjectSetString(0,id,OBJPROP_TOOLTIP,info);
 return true; // Historical rectangles and their exact tooltips remain; no permanent text pile.
}
void RenderRetiredZones() {
 ObjectsDeleteAll(0,prefix+"retired.");retiredPainted=0;
 if(!showBands||!showRetired||RetiredZonesPerFrame==0) return;
 string frames[];
 for(int i=0;i<ArraySize(retiredCandidates);i++) {
  bool seen=false;for(int j=0;j<ArraySize(frames);j++) if(frames[j]==retiredCandidates[i].frame) {seen=true;break;}
  if(!seen) {int n=ArraySize(frames);ArrayResize(frames,n+1);frames[n]=retiredCandidates[i].frame;}
 }
 for(int f=0;f<ArraySize(frames);f++) {
  datetime before=LONG_MAX;int beforeIndex=INT_MAX;
  for(int slot=0;slot<RetiredZonesPerFrame;slot++) {
   int best=-1;
   for(int i=0;i<ArraySize(retiredCandidates);i++) {
    MAZone z=retiredCandidates[i];if(z.frame!=frames[f]||z.retiredAt>before||(z.retiredAt==before&&i>=beforeIndex)) continue;
    if(!MAZoneFrameVisible(z.seconds,PeriodSeconds(),showAllZoneFrames)) continue;
    if(best<0||z.retiredAt>retiredCandidates[best].retiredAt||(z.retiredAt==retiredCandidates[best].retiredAt&&i>best)) best=i;
   }
   if(best<0) break;
   if(PaintRetiredZone(retiredCandidates[best],retiredPainted)) retiredPainted++;
   before=retiredCandidates[best].retiredAt;beforeIndex=best;
  }
 }
}
int RenderCandidates() {
 ObjectsDeleteAll(0,prefix+"zone");
 BeginLabelLayout();
 visibleBands=0;zoneDrawError="";
 RenderRetiredZones();
 if(!showBands) return 0;
 int picked[]; ArrayResize(picked,0);
 MqlTick tick;if(!SymbolInfoTick(_Symbol,tick)) return 0;
 double price=ChartQuote(tick);if(price<=0) return 0;
 // Preserve native ranges. Same extreme across frames is one observation.
 for(int i=0;i<ArraySize(candidates);i++) {
  if(!MAZoneFrameVisible(candidates[i].seconds,PeriodSeconds(),showAllZoneFrames)) continue;
  bool duplicate=false;
  for(int j=0;j<ArraySize(picked);j++) {
   int k=picked[j]; if(candidates[i].kind!=2 || candidates[k].kind!=2 || candidates[i].side!=candidates[k].side) continue;
   double x=candidates[i].side>0?candidates[i].low:candidates[i].high;
   double y=candidates[k].side>0?candidates[k].low:candidates[k].high;
   if(MathAbs(x-y)<_Point*.5) {
    duplicate=true;
     if(candidates[i].seconds>candidates[k].seconds || (candidates[i].seconds==candidates[k].seconds&&candidates[i].formed<candidates[k].formed)) picked[j]=i;
    break;
   }
  }
  if(!duplicate) {int n=ArraySize(picked);ArrayResize(picked,n+1);picked[n]=i;}
 }
 int painted=0;
 for(int side=-1;side<=1;side+=2) {
  int active=-1; double distance=DBL_MAX;
  for(int j=0;j<ArraySize(picked);j++) {
   int i=picked[j]; if(candidates[i].side!=side || candidates[i].kind==2) continue;
   double d=MathMax(candidates[i].low-price,MathMax(price-candidates[i].high,0));
   MAZonePriority candidatePriority=ImportanceFor(candidates[i]),bestPriority;ZeroMemory(bestPriority);
   if(active>=0) bestPriority=ImportanceFor(candidates[active]);
   if(active<0||MAMoreImportant(candidatePriority,d,bestPriority,distance)) {distance=d; active=i;}
  }
  int count=0; if(active>=0) {if(PaintZone(candidates[active],painted)) painted++;count++;}
  int second=-1;double secondDistance=DBL_MAX;
  for(int j=0;j<ArraySize(picked)&&active>=0;j++) {
   int i=picked[j];if(candidates[i].side!=side||candidates[i].kind==2||candidates[i].frame==candidates[active].frame) continue;
   if(candidates[i].low<=candidates[active].high&&candidates[i].high>=candidates[active].low) continue;
   double d=MathMax(candidates[i].low-price,MathMax(price-candidates[i].high,0));if(d<secondDistance) {secondDistance=d;second=i;}
  }
  if(second>=0) {if(PaintZone(candidates[second],painted)) painted++;count++;}
  // Pick recent distinct sweeps; no probability ranking.
  datetime before=LONG_MAX; int beforeIndex=INT_MAX;
  while(count<3) {
   int best=-1;
   for(int j=0;j<ArraySize(picked);j++) {
    int i=picked[j]; if(candidates[i].kind!=2 || candidates[i].side!=side) continue;
    bool olderOverlap=false;
    for(int k=0;k<ArraySize(picked);k++) {
     int q=picked[k];if(q==i || candidates[q].kind!=2 || candidates[q].side!=side) continue;
     if(candidates[q].formed>candidates[i].formed && candidates[q].low<=candidates[i].high && candidates[q].high>=candidates[i].low) {olderOverlap=true;break;}
    }
    if(olderOverlap) continue;
    if(candidates[i].formed>before || (candidates[i].formed==before && i>=beforeIndex)) continue;
    if(best<0 || candidates[i].formed>candidates[best].formed || (candidates[i].formed==candidates[best].formed && i>best)) best=i;
   }
   if(best<0) break;
   if(PaintZone(candidates[best],painted)) painted++;count++;before=candidates[best].formed;beforeIndex=best;
  }
 }
 return painted;
}
void AppendFrameZones(const MqlRates &c[],const int seconds,const string frame,const int maxAge,const double atr,const double reference) {
 MAZone zs[];MAAnalyze(c,seconds,frame,zs);int n=ArraySize(c);
  CacheFrameImportance(c,zs);
 if(n>0) AppendRetiredZones(zs,c[n-1].time+seconds,maxAge);
 for(int z=0;z<ArraySize(zs);z++) if(zs[z].active&&n-1-zs[z].index<=maxAge) {
  if(atr>0&&MathMax(zs[z].low-reference,MathMax(reference-zs[z].high,0))>atr*8) continue;
  int size=ArraySize(candidates);ArrayResize(candidates,size+1);candidates[size]=zs[z];
 }
}
void BandCaption(const int painted) {
 if(!showBands||showDetails) return;
 string id=prefix+"zone.caption";ObjectCreate(0,id,OBJ_LABEL,0,0,0);
 ObjectSetInteger(0,id,OBJPROP_XDISTANCE,12);ObjectSetInteger(0,id,OBJPROP_YDISTANCE,PanelTop());
 ObjectSetInteger(0,id,OBJPROP_COLOR,LightChart()?C'71,85,105':clrSilver);ObjectSetInteger(0,id,OBJPROP_FONTSIZE,8);
 ObjectSetInteger(0,id,OBJPROP_SELECTABLE,false);ObjectSetString(0,id,OBJPROP_FONT,"Meiryo");
 ObjectSetString(0,id,OBJPROP_TEXT,(showAllZoneFrames?"全足":FrameName((ENUM_TIMEFRAMES)_Period)+"以上")+" 有効"+IntegerToString(painted)+"帯 / 解消"+IntegerToString(retiredPainted)+"帯");
 ObjectSetString(0,id,OBJPROP_TOOLTIP,"0帯は現在の範囲・履歴内に表示対象がない状態です。下位足もONで範囲を切替。詳細ONで取得・品質の保留を確認。");
}
string ResponseLine(const MqlRates &c[],const MAFlowRow &rows[],const int seconds,const string frame) {
 MAResponseRow rs[];MAResponse(c,rows,seconds,rs);int n=ArraySize(rs);if(n==0) return frame+" 短期圧力・経過は保留";
 MAResponseRow r=rs[n-1];string line=frame+" 短期圧力 "+Arrow(r.pressure)+" / 保持 "+Arrow(r.held);
 if(r.pressure!=0&&r.held!=0&&r.pressure!=r.held) line+="（不一致）";
 if(r.side!=0) line+=" / 元水準 "+DoubleToString(r.reference,_Digits)+" "+MAResponsePhase(r);
 return line+" [同足の確定・観察用]";
}
void Refresh(const bool force=false) {
 bool costChanged=RefreshBrokerCommissions();
 MqlTick tick;
 if(!ReadSessions()) {
  ObjectsDeleteAll(0,prefix+"zone");ObjectsDeleteAll(0,prefix+"retired.");retiredPainted=0;retryHistory=true;
  Panel("MT5 1.1.0-preview.13 | "+_Symbol+" | 業者セッションを取得できず新規判定を保留\n接続・休場とは区別。セッション不明のまま営業中と推定しません。");return;
 }
 bool live=TerminalInfoInteger(TERMINAL_CONNECTED) && SymbolInfoTick(_Symbol,tick) && ChartQuote(tick)>0 && TimeTradeServer()>=tick.time && TimeTradeServer()-tick.time<120;
 if(!live || !SessionOpen(TimeCurrent())) {
  ObjectsDeleteAll(0,prefix+"zone");ObjectsDeleteAll(0,prefix+"retired.");retiredPainted=0;lastM15=0;
  retryHistory=true;
  Panel("MT5 1.1.0-preview.13 | "+_Symbol+" | 休場・未接続・価格更新待ち\n新規判定停止。過去サインは確定履歴。EXITは反転エントリーではありません。"); return;
 }
 datetime m=iTime(_Symbol,PERIOD_M15,1),h=iTime(_Symbol,PERIOD_H1,1),q=iTime(_Symbol,PERIOD_H4,1);
 datetime x=iTime(_Symbol,(ENUM_TIMEFRAMES)_Period,1),minute=iTime(_Symbol,PERIOD_M1,1);
 if(!force && !costChanged && !retryHistory && m==lastM15 && h==lastH1 && q==lastH4 && x==lastExec && minute==lastMinute) return;
 retryHistory=false;
 lastM15=m;lastH1=h;lastH4=q;lastExec=x;lastMinute=minute;ArrayResize(candidates,0);ArrayResize(retiredCandidates,0);ArrayResize(importanceRecords,0);
 ArrayResize(m15Flow,0);ArrayResize(hourFlow,0);ArrayResize(chartFlow,0);chartAvailable=false;
 ENUM_TIMEFRAMES frames[]={PERIOD_M15,PERIOD_H1,PERIOD_H4};
 string status="",holds="",historyNotes="";double nearATR=0,reference=0;
 for(int f=0;f<3;f++) {
  MqlRates c[]; ENUM_TIMEFRAMES tf=frames[f];
  if(!FrameRates(tf,c,HistoryBars)) {holds+=FrameName(tf)+" "+quality+"\n";retryHistory=true;continue;}
  if(quality!="OK") historyNotes+=FrameName(tf)+" "+quality+"\n";
  if(f==0) {ArrayCopy(m15Rates,c);MAFlow(c,VolumeBasis,m15Flow);}
  if(f==1) {ArrayCopy(hourRates,c);MAFlow(c,VolumeBasis,hourFlow);}
  MAZone zs[]; MAAnalyze(c,PeriodSeconds(tf),FrameName(tf),zs);
  CacheFrameImportance(c,zs);
  int n=ArraySize(c),maxAge=f==0?32:f==1?24:12;
  AppendRetiredZones(zs,c[n-1].time+PeriodSeconds(tf),maxAge);
  if(f==0) {double atr[];MAATR(c,atr);nearATR=atr[n-1];reference=c[n-1].close;}
  for(int z=0;z<ArraySize(zs);z++) if(zs[z].active && n-1-zs[z].index<=maxAge) {
   if(nearATR>0 && MathMax(zs[z].low-reference,MathMax(reference-zs[z].high,0))>nearATR*8) continue;
   int size=ArraySize(candidates);ArrayResize(candidates,size+1);candidates[size]=zs[z];
  }
  status+=FrameName(tf)+" 確定 "+TimeToString(c[n-1].time+PeriodSeconds(tf),TIME_DATE|TIME_MINUTES)+"  "+DoubleToString(c[n-1].close,_Digits)+"\n";
 }
 // A held frame never erases valid, independently calculated zones from another frame.
 MqlRates micro[];MAFlowRow microRows[];string response="";
 if(FrameRates(PERIOD_M5,micro,HistoryBars)) {
  AppendFrameZones(micro,300,"M5",96,nearATR,reference);MAFlow(micro,VolumeBasis,microRows);response=ResponseLine(micro,microRows,300,"M5");
 } else {holds+="M5 "+quality+"\n";retryHistory=true;}
 ENUM_TIMEFRAMES extra[]={PERIOD_M1,PERIOD_M5,PERIOD_D1};
 for(int k=0;k<3;k++) {
  MqlRates r[];
  if(CopyRates(_Symbol,extra[k],1,1,r)==1) status+=FrameName(extra[k])+" 確定 "+TimeToString(r[0].time+PeriodSeconds(extra[k]),TIME_DATE|TIME_MINUTES)+"  "+DoubleToString(r[0].close,_Digits)+"\n";
  else status+=FrameName(extra[k])+" 履歴待ち\n";
 }
 // Additional higher-frame pools are presentation only, never P/EXIT inputs.
 if(PeriodSeconds()>=3600) {
  ENUM_TIMEFRAMES higher[]={PERIOD_D1,PERIOD_W1};
  for(int k=0;k<2;k++) if(PeriodSeconds(higher[k])>PeriodSeconds()) {
   MqlRates r[];
   if(FrameRates(higher[k],r,HistoryBars)) AppendFrameZones(r,PeriodSeconds(higher[k]),FrameName(higher[k]),12,nearATR,reference);
   else {holds+=FrameName(higher[k])+" 帯表示: "+quality+"\n";retryHistory=true;}
  }
 }
 if(ArraySize(hourFlow)>0) MAAlign(m15Flow,900,hourFlow);
 if(FrameRates((ENUM_TIMEFRAMES)_Period,chartRates,HistoryBars)) {
  chartAvailable=MAFlow(chartRates,VolumeBasis,chartFlow);MAAlign(chartFlow,PeriodSeconds(),hourFlow);
  if(_Period!=PERIOD_M5&&_Period!=PERIOD_M15&&_Period!=PERIOD_H1&&_Period!=PERIOD_H4) AppendFrameZones(chartRates,PeriodSeconds(),FrameName((ENUM_TIMEFRAMES)_Period),_Period==PERIOD_M1?480:12,nearATR,reference);
  if(_Period!=PERIOD_M5) response+="\n"+ResponseLine(chartRates,chartFlow,PeriodSeconds(),FrameName((ENUM_TIMEFRAMES)_Period));
 } else {holds+=FrameName((ENUM_TIMEFRAMES)_Period)+" 表示足: "+quality+"\n";retryHistory=true;}
 int painted=RenderCandidates();
 string current="表示足保留: "+quality,entry="M15 P: 履歴・品質の確認待ち",volume="出来高未確認";
 if(chartAvailable) {
  int i=ArraySize(chartFlow)-1;MAFlowRow r=chartFlow[i];
  current=FrameName((ENUM_TIMEFRAMES)_Period)+" 確定 "+TimeToString(r.time+PeriodSeconds(),TIME_DATE|TIME_MINUTES)+" | 保持 "+Arrow(r.direction)+" / リボン "+Arrow(r.ribbon)+" / ADX "+DoubleToString(r.adx,1);
  current+="\nEXIT: "+(!r.ready?"再構築144本待ち":r.exitLong?"買い保有の警告":r.exitShort?"売り保有の警告":"この確定足なし")+" | EMA13 "+DoubleToString(r.e13,_Digits)+" | 反転入場とは別";
  if(quality!="OK") historyNotes+=FrameName((ENUM_TIMEFRAMES)_Period)+" 表示足: "+quality+"\n";
  volume=VolumeBasis==MA_TICK_ACTIVITY?"出来高: 業者ティック数（約定数量ではない）":VolumeBasis==MA_REAL_VOLUME?"出来高: broker real volume（0は未取得）":"出来高: 使用しない・Pは保留";
  volume+=" / 倍率 "+(r.volumeRatio>=0?DoubleToString(r.volumeRatio,2):"未取得");
 }
 int j=ArraySize(m15Flow)-1;
 if(j>=0) {
  MAFlowRow r=m15Flow[j];MACostRecord cost;MAPlan p=CostedPlan(m15Rates[j],r,900,j+1,ManualBlackout||ArraySize(hourFlow)<220,cost,true);
  entry="M15 P確定足: "+(j+1<220?"M15再構築220本待ち":ArraySize(hourFlow)<220?"H1再構築220本待ち":p.pCandidate?"条件成立 "+Arrow(p.direction):"WAIT")+" / H1一致 "+(r.hourlyAligned?"YES":"NO")+" / 費用後RR "+(cost.ready?DoubleToString(p.netRR,2):"未取得");
  if(!cost.ready) entry+=" / "+cost.reason;
  else {entry+=" / 判定費用 "+DoubleToString(cost.bps,2)+"bps";if(!p.costOK) entry+=" / 費用・RR条件未達";}
  if(p.pCandidate) entry+=" / SL "+DoubleToString(p.stop,_Digits)+" / TP2 "+DoubleToString(p.tp2,_Digits);
 }
 string quote="観測 "+TimeToString(tick.time,TIME_SECONDS)+" Bid "+DoubleToString(tick.bid,_Digits)+" / Ask "+DoubleToString(tick.ask,_Digits)+" / spread "+DoubleToString((tick.ask-tick.bid)/_Point,1)+"pt";
 string bandState=!showBands?"反転帯 OFF":"反転帯 "+IntegerToString(painted)+"件 / 価格範囲内 "+IntegerToString(visibleBands)+"件（形成元 M5/M15/H1/H4・表示足）";
 if(showBands && painted==0) bandState+=holds!=""?" / 取得・品質の保留あり":" / 有効な近接候補なし";
 if(showBands && nearATR<=0) bandState+=" / M15距離選別は保留";
 bandState+="\n解消帯 "+(!showBands||!showRetired?"OFF":IntegerToString(retiredPainted)+"件 / 各足直近最大"+IntegerToString(RetiredZonesPerFrame)+"件・点線は解消時刻まで");
 if(zoneDrawError!="") holds+=zoneDrawError+"\n";
 BandCaption(painted);PaintSignals();PaintProfile();
 Panel("MT5 1.1.0-preview.13 | "+_Symbol+" | broker時刻 / 銘柄別独立版 "+ChartBasis()+"\n"+current+"\n"+response+"\n"+entry+"\n"+volume+"\n"+quote+"\n{LIVE_COST}\n"+bandState+"\nEXIT表示 "+IntegerToString(exitLabels)+"組 / 停滞中の集約 "+IntegerToString(exitGroups)+"組（点・保存は全件）\n"+holds+historyNotes+"ニュース自動判定なし / "+(ManualBlackout?"手動P停止中":"Pは研究条件・注文なし")+(ShowFrameDetails?"\n"+status:""));
 ChartRedraw();
}
void SetPlots() {
 for(int i=2;i<5;i++) PlotIndexSetInteger(i,PLOT_DRAW_TYPE,showBB?DRAW_LINE:DRAW_NONE);
 for(int i=5;i<13;i++) PlotIndexSetInteger(i,PLOT_DRAW_TYPE,showRibbon?DRAW_LINE:DRAW_NONE);
 for(int i=13;i<19;i++) PlotIndexSetInteger(i,PLOT_DRAW_TYPE,showSignals?DRAW_ARROW:DRAW_NONE);
}
void FillCloud() {
 int n=ArraySize(e20);
 for(int i=0;i<n;i++) {
  int side=showCloud&&r5[i]!=EMPTY_VALUE&&r144[i]!=EMPTY_VALUE?(r5[i]>r144[i]?1:r5[i]<r144[i]?-1:0):0;
  MACloudPair(r5[i],r8[i],side,cloud0a[i],cloud0b[i]);MACloudPair(r8[i],r13[i],side,cloud1a[i],cloud1b[i]);
  MACloudPair(r13[i],r21[i],side,cloud2a[i],cloud2b[i]);MACloudPair(r21[i],r34[i],side,cloud3a[i],cloud3b[i]);
  MACloudPair(r34[i],r55[i],side,cloud4a[i],cloud4b[i]);MACloudPair(r55[i],r89[i],side,cloud5a[i],cloud5b[i]);
  MACloudPair(r89[i],r144[i],side,cloud6a[i],cloud6b[i]);
 }
}
// Writes only this symbol's market data and derived calculations to local MQL5/Files.
// No account, position, login, external request or mail access.
string JNumber(const double v) {return v==EMPTY_VALUE||!MathIsValidNumber(v)?"null":DoubleToString(v,12);}
string JBool(const bool b) {return b?"true":"false";}
string CostJson(const MACostRecord &cost) {
 return "{\"available\":"+JBool(cost.ready)+",\"basis\":\""+cost.basis+"\",\"spreadPrice\":"+JNumber(cost.spreadPrice)+",\"commissionPrice\":"+JNumber(cost.commissionPrice)+",\"totalBps\":"+JNumber(cost.bps)+",\"observedServerTime\":"+IntegerToString((long)cost.observedAt)+",\"commissionObservedServerTime\":"+IntegerToString((long)cost.commissionObservedAt)+",\"reason\":\""+MAJsonEscape(cost.reason)+"\"}";
}
string ResponseJson(const MAResponseRow &r) {
 return "{\"version\":\"closed-response-v1\",\"pressure\":"+IntegerToString(r.pressure)+",\"heldDirection\":"+IntegerToString(r.held)+",\"ribbon\":"+IntegerToString(r.ribbon)+",\"side\":"+IntegerToString(r.side)+",\"phase\":"+IntegerToString(r.phase)+",\"reference\":"+(r.side!=0?JNumber(r.reference):"null")+",\"fixedPad\":"+(r.side!=0?JNumber(r.pad):"null")+",\"brokenServerTime\":"+IntegerToString((long)r.brokenAt)+",\"changedServerTime\":"+IntegerToString((long)r.changedAt)+",\"expiresServerTime\":"+IntegerToString((long)r.expiresAt)+",\"closedServerTime\":"+IntegerToString((long)r.closedAt)+",\"observationOnly\":true}";
}
string ImportanceJson(const MAZonePriority &q) {
 if(!q.available) return "{\"version\":\"zone-importance-v1\",\"available\":false}";
 return "{\"version\":\"zone-importance-v1\",\"available\":true,\"role\":{\"order\":"+IntegerToString(q.role)+",\"label\":\""+MAImportanceRoleLabel(q.role)+"\"},\"score\":"+IntegerToString(q.score)+",\"grade\":\""+(q.grade==2?"high":q.grade==1?"medium":"support")+"\",\"partial\":"+JBool(q.partial)+
  ",\"parts\":{\"timeframe\":"+IntegerToString(q.tfPoints)+",\"volume\":"+IntegerToString(q.volPoints)+",\"displacement\":"+IntegerToString(q.bodyPoints)+",\"structure\":"+IntegerToString(q.structurePoints)+",\"freshness\":"+IntegerToString(q.freshPoints)+"},\"formation\":{\"confirmedServerTime\":"+IntegerToString((long)q.formationAt)+",\"displacementClosedServerTime\":"+IntegerToString((long)q.displacementAt)+",\"relativeVolume\":"+JNumber(q.relativeVolume)+",\"volumeBasis\":\""+MAVolumeName(VolumeBasis)+"\",\"baselinePeriod\":21,\"baselineBars\":"+IntegerToString(q.baselineBars)+",\"bodyATR\":"+JNumber(q.bodyATR)+",\"structureBreak\":"+JBool(q.structure)+"},\"current\":{\"observedThroughServerTime\":"+IntegerToString((long)q.observedThrough)+",\"visits\":"+IntegerToString(q.visits)+"},\"observationOnly\":true,\"sessionNormalized\":false}";
}
void ExportFrameContext(const int file,const MqlRates &c[],const MAFlowRow &rows[],const bool ready,const ENUM_TIMEFRAMES tf) {
 MAResponseRow rs[];if(ready) MAResponse(c,rows,PeriodSeconds(tf),rs);int n=ArraySize(rs);
 FileWriteString(file,",\"response\":"+(n>0?ResponseJson(rs[n-1]):"null")+",\"responseEvents\":[");
 int written=0;
 for(int i=0;i<n;i++) if(rs[i].side!=0&&(i==0||rs[i].changedAt!=rs[i-1].changedAt)) {if(written++>0) FileWriteString(file,",");FileWriteString(file,ResponseJson(rs[i]));}
 FileWriteString(file,"],\"zones\":[");MAZone zs[];MAImportanceFact facts[];if(ready) {MAAnalyze(c,PeriodSeconds(tf),FrameName(tf),zs);MAImportancePrepare(c,VolumeBasis,facts);}
 for(int i=0;i<ArraySize(zs);i++) {
  MAZone z=zs[i];if(i>0) FileWriteString(file,",");
  MAZonePriority priority=MAImportanceEvaluate(c,facts,z);
  string id=z.frame+":"+MAKind(z.kind)+":"+IntegerToString(z.side)+":"+IntegerToString((long)z.formed)+":"+DoubleToString(z.low,_Digits)+":"+DoubleToString(z.high,_Digits);
  FileWriteString(file,"{\"id\":\""+id+"\",\"kind\":\""+MAKind(z.kind)+"\",\"side\":"+IntegerToString(z.side)+",\"frame\":\""+z.frame+"\",\"seconds\":"+IntegerToString(z.seconds)+",\"low\":"+JNumber(z.low)+",\"high\":"+JNumber(z.high)+",\"formedServerTime\":"+IntegerToString((long)z.formed)+",\"active\":"+JBool(z.active)+",\"visits\":"+IntegerToString(z.visits)+",\"retiredServerTime\":"+IntegerToString((long)z.retiredAt)+",\"retiredReason\":"+IntegerToString(z.retiredReason)+",\"withdrawalClose\":"+JNumber(z.side>0?z.low:z.high)+",\"importance\":"+ImportanceJson(priority)+"}");
 }
 FileWriteString(file,"],\"contextBasis\":\"RECONSTRUCTED_FROM_THIS_EXPORT_CLOSED_BARS_NOT_A_CONTEMPORANEOUS_SIGNAL_LEDGER\"");
}
void ExportAnalysis() {
 RefreshBrokerCommissions();
 string folder="MultiAnalyzerGold";FolderCreate(folder);
 string name=folder+"/MT5-"+MAFileSymbol(_Symbol)+"-"+IntegerToString((long)TimeLocal())+"-"+IntegerToString((long)GetMicrosecondCount())+".json";
 int file=FileOpen(name,FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);if(file==INVALID_HANDLE) {Print("Market export could not open local file");return;}
 string symbol=MAJsonEscape(_Symbol);
 MqlTick quote;ZeroMemory(quote);bool quoted=SymbolInfoTick(_Symbol,quote);
 FileWriteString(file,"{\"version\":\"1.1.0-preview.13\",\"symbol\":\""+symbol+"\",\"clock\":\"BROKER_WALL_CLOCK_NOT_UTC\",\"exportedServerTime\":"+IntegerToString((long)TimeTradeServer())+",\"connected\":"+JBool((bool)TerminalInfoInteger(TERMINAL_CONNECTED))+",\"bid\":"+(quoted?JNumber(quote.bid):"null")+",\"ask\":"+(quoted?JNumber(quote.ask):"null")+",\"quoteTime\":"+(quoted?IntegerToString((long)quote.time):"null")+",\"assumedCostBps\":"+(PCostMode==MA_FIXED_BPS?JNumber(AssumedRoundTripCostBps):"null")+",\"volumeBasis\":\""+MAVolumeName(VolumeBasis)+"\",\"aggressorDelta\":null,\"cvd\":null,\"sessions\":[");
 for(int s=0;s<ArraySize(weeklySessions);s++) {
  if(s>0) FileWriteString(file,",");
  FileWriteString(file,"{\"weekday\":"+IntegerToString(weeklySessions[s].weekday)+",\"startSeconds\":"+IntegerToString(weeklySessions[s].start)+",\"stopSeconds\":"+IntegerToString(weeklySessions[s].stop)+"}");
 }
 FileWriteString(file,"],\"digits\":"+IntegerToString(_Digits)+",\"point\":"+JNumber(_Point)+",\"tickSize\":"+JNumber(SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE))+",\"chartPriceBasis\":\""+ChartBasis()+"\",\"baseCurrency\":\""+MAJsonEscape(SymbolInfoString(_Symbol,SYMBOL_CURRENCY_BASE))+"\",\"profitCurrency\":\""+MAJsonEscape(SymbolInfoString(_Symbol,SYMBOL_CURRENCY_PROFIT))+"\",\"spreadBpsNow\":"+(quoted?JNumber(MASpreadBps(quote.bid,quote.ask)):"null")+",\"costModel\":\""+(PCostMode==MA_BROKER_AUTO?"broker-spread-v1":"manual-fixed-bps-v1")+"\",\"commissionRulesReported\":"+IntegerToString(brokerCommissionCount)+",\"commissionObservedServerTime\":"+IntegerToString((long)brokerCommissionObservedAt)+",\"commissionApiError\":"+IntegerToString(brokerCommissionError)+",\"commissionSchedule\":\""+MAJsonEscape(brokerCommissionKey)+"\",\"historicalCommissionScheduleKnown\":false,\"costLimitations\":\"Recorded bar spread for confirmed P; current commission schedule reconstructed, not historical proof. Future slippage, exit spread and swaps unknown.\",\"planPriceDigits\":"+IntegerToString(MAPlanDigits(_Digits))+",\"frames\":[");
 ENUM_TIMEFRAMES frames[]={PERIOD_M1,PERIOD_M5,PERIOD_M15,PERIOD_H1,PERIOD_H4,PERIOD_D1};
 for(int f=0;f<6;f++) {
  if(f>0) FileWriteString(file,",");MqlRates c[];MAFlowRow rows[];
  bool ready=FrameRates(frames[f],c,HistoryBars,60);MqlRates raw[];ArrayCopy(raw,lastRawRates);int seed=historySeedStart;
  if(ready) {ready=MAFlow(c,VolumeBasis,rows);MAAlign(rows,PeriodSeconds(frames[f]),hourFlow);}
  MAProfile profile;ZeroMemory(profile);if(ready) profile=MAProfileLevels(c,VolumeBasis);
  FileWriteString(file,"{\"frame\":\""+FrameName(frames[f])+"\",\"seconds\":"+IntegerToString(PeriodSeconds(frames[f]))+",\"ready\":"+JBool(ready)+",\"quality\":\""+quality+"\",\"requestedBars\":"+IntegerToString(HistoryBars)+",\"copiedBars\":"+IntegerToString(historyCopied)+",\"seedStartIndex\":"+IntegerToString(seed)+",\"calculationBars\":"+IntegerToString(ready?ArraySize(c):0)+",\"rangeProfileApproximation\":["+(profile.available?JNumber(profile.poc)+","+JNumber(profile.val)+","+JNumber(profile.vah):"null,null,null")+"],\"bars\":[");
  int written=0;
  for(int i=0;i<ArraySize(raw);i++) {
   if(raw[i].time+PeriodSeconds(frames[f])>TimeCurrent()) continue;
   if(written++>0) FileWriteString(file,",");MAFlowRow r;ZeroMemory(r);r.e13=EMPTY_VALUE;r.e21=EMPTY_VALUE;
   int index=i-seed;bool derived=ready&&index>=0&&index<ArraySize(rows);
   if(derived) r=rows[index];MAPlan p;ZeroMemory(p);MACostRecord cost;ZeroMemory(cost);cost.bps=EMPTY_VALUE;cost.spreadPrice=EMPTY_VALUE;cost.commissionPrice=EMPTY_VALUE;if(derived) p=CostedPlan(raw[i],r,PeriodSeconds(frames[f]),index+1,ManualBlackout&&i==ArraySize(raw)-1,cost,i==ArraySize(raw)-1);
   FileWriteString(file,"{\"cost\":"+CostJson(cost)+",");
   FileWriteString(file,"\"time\":"+IntegerToString((long)raw[i].time)+",\"open\":"+JNumber(raw[i].open)+",\"high\":"+JNumber(raw[i].high)+",\"low\":"+JNumber(raw[i].low)+",\"close\":"+JNumber(raw[i].close)+",\"volume\":"+JNumber(MAVolume(raw[i],VolumeBasis))+",\"tickVolume\":"+IntegerToString(raw[i].tick_volume)+",\"realVolume\":"+IntegerToString(raw[i].real_volume)+",\"spreadPoints\":"+IntegerToString(raw[i].spread)+",\"derivedAvailable\":"+JBool(derived)+",\"flowReady\":"+(derived?JBool(r.ready):"null")+",\"ema13\":"+JNumber(r.e13)+",\"ema21\":"+JNumber(r.e21)+",\"atr\":"+(derived?JNumber(r.atr):"null")+",\"adx\":"+(derived?JNumber(r.adx):"null")+",\"direction\":"+(derived&&r.ready?IntegerToString(r.direction):"null")+",\"ribbon\":"+(derived&&r.ready?IntegerToString(r.ribbon):"null")+",\"exitLong\":"+(derived&&r.ready?JBool(r.exitLong):"null")+",\"exitShort\":"+(derived&&r.ready?JBool(r.exitShort):"null")+",\"pullbackConfirmed\":"+(derived&&r.ready?JBool(r.pullbackConfirmed):"null")+",\"pCandidate\":"+(derived&&r.ready?JBool(p.pCandidate):"null")+",\"plan\":"+(derived&&r.ready?"{\"stop\":"+JNumber(p.stop)+",\"tp2\":"+JNumber(p.tp2)+",\"netRR\":"+JNumber(p.netRR)+"}":"null")+"}");
  }
  FileWriteString(file,"]");ExportFrameContext(file,c,rows,ready,frames[f]);FileWriteString(file,"}");
 }
 SavePDisplayTrace();FileWriteString(file,"],\"pDisplayTrace\":"+PDisplayJson()+"}\n");FileFlush(file);FileClose(file);
 Print("Market local analysis export: MQL5/Files/",name);
 ObjectSetString(0,prefix+"export",OBJPROP_TOOLTIP,"保存済み: MQL5/Files/"+name+"。このJSONをチャットへ添付できます。外部送信なし。");
}
void FillPlots(const int total,const datetime &time[]) {
 ArrayInitialize(e20,EMPTY_VALUE);ArrayInitialize(e50,EMPTY_VALUE);ArrayInitialize(bm,EMPTY_VALUE);ArrayInitialize(bu,EMPTY_VALUE);ArrayInitialize(bl,EMPTY_VALUE);
 ArrayInitialize(r5,EMPTY_VALUE);ArrayInitialize(r8,EMPTY_VALUE);ArrayInitialize(r13,EMPTY_VALUE);ArrayInitialize(r21,EMPTY_VALUE);ArrayInitialize(r34,EMPTY_VALUE);ArrayInitialize(r55,EMPTY_VALUE);ArrayInitialize(r89,EMPTY_VALUE);ArrayInitialize(r144,EMPTY_VALUE);
 ArrayInitialize(exitBuy,EMPTY_VALUE);ArrayInitialize(exitSell,EMPTY_VALUE);ArrayInitialize(pBuy,EMPTY_VALUE);ArrayInitialize(pSell,EMPTY_VALUE);ArrayInitialize(turnBuy,EMPTY_VALUE);ArrayInitialize(turnSell,EMPTY_VALUE);
 FillCloud(); // all ribbon buffers were cleared, so gaps/forming bars remain zero/zero
 if(!chartAvailable) return;
 int j=0,n=ArraySize(chartFlow);
 for(int i=0;i<total;i++) {
  while(j<n&&chartFlow[j].time<time[i]) j++;if(j>=n) break;if(chartFlow[j].time!=time[i]) continue;
  MAFlowRow r=chartFlow[j];MqlRates b=chartRates[j];e20[i]=r.ema20;e50[i]=r.ema50;
  r5[i]=r.e5;r8[i]=r.e8;r13[i]=r.e13;r21[i]=r.e21;r34[i]=r.e34;r55[i]=r.e55;r89[i]=r.e89;r144[i]=r.e144;
  if(j>=19) {double sum=0,sd=0;for(int k=j-19;k<=j;k++) sum+=chartRates[k].close;double mean=sum/20;for(int k=j-19;k<=j;k++) sd+=MathPow(chartRates[k].close-mean,2);sd=MathSqrt(sd/20);bm[i]=mean;bu[i]=mean+2*sd;bl[i]=mean-2*sd;}
  if(r.exitLong) exitBuy[i]=b.high+r.atr*.2;if(r.exitShort) exitSell[i]=b.low-r.atr*.2;
  MACostRecord cost;MAPlan p=CostedPlan(b,r,PeriodSeconds(),j+1,ManualBlackout&&j==n-1,cost,j==n-1);
  if(p.pCandidate) {if(r.direction>0) pBuy[i]=b.low-r.atr*.2;else pSell[i]=b.high+r.atr*.2;RecordPDisplay(b,r);}
  if(r.switched) {if(r.direction>0) turnBuy[i]=b.low-r.atr*.65;else turnSell[i]=b.high+r.atr*.65;}
 }
 FillCloud();
 SavePDisplayTrace();if(pDisplayNeedsPaint) PaintPDisplayTrace();
}
int OnInit() {
 ArrayResize(costMemos,0);nextCommissionRead=0;
 if(!MACoreSelfTest()||!MAFlowSelfTest()||!MAHistorySelfTest()) {Print("Multi-Analyzer core self-test failed");return INIT_FAILED;}
 if(_Point<=0 || _Digits<0 || _Digits>12) {Print("銘柄の価格仕様を取得できません");return INIT_FAILED;}
 if(HistoryBars<220 || HistoryBars>1500 || RetiredZonesPerFrame<0 || RetiredZonesPerFrame>10 || PDisplayTraceCount<1 || PDisplayTraceCount>40 || StringLen(InstanceName)>24||AssumedRoundTripCostBps<0||AssumedRoundTripCostBps>100||MinimumNetRR<=0) return INIT_PARAMETERS_INCORRECT;
 prefix="MAGold_"+IntegerToString(ChartID())+"_"+IntegerToString(GetMicrosecondCount())+"_";
 key="MAGold.1.1.preview."+IntegerToString(ChartID())+"."+InstanceName;
 showBands=GlobalVariableCheck(key+".z")?GlobalVariableGet(key+".z")>0:InitialBands;
 showBB=GlobalVariableCheck(key+".b")?GlobalVariableGet(key+".b")>0:InitialBB;
 showRibbon=GlobalVariableCheck(key+".r")?GlobalVariableGet(key+".r")>0:InitialRibbon;
 showCloud=GlobalVariableCheck(key+".c")?GlobalVariableGet(key+".c")>0:InitialCloud;
 showRetired=GlobalVariableCheck(key+".h")?GlobalVariableGet(key+".h")>0:InitialRetiredZones;
 showSignals=GlobalVariableCheck(key+".s")?GlobalVariableGet(key+".s")>0:InitialSignals;
 showDetails=GlobalVariableCheck(key+".d")?GlobalVariableGet(key+".d")>0:InitialDetails;
 showAllZoneFrames=GlobalVariableCheck(key+".af")?GlobalVariableGet(key+".af")>0:InitialAllZoneFrames;
 showZoneLabels=GlobalVariableCheck(key+".zt")?GlobalVariableGet(key+".zt")>0:InitialZoneLabels;
 showPDisplayTrace=GlobalVariableCheck(key+".pt")?GlobalVariableGet(key+".pt")>0:InitialPDisplayTrace;
 LoadPDisplayTrace();
 SetIndexBuffer(0,e20,INDICATOR_DATA);SetIndexBuffer(1,e50,INDICATOR_DATA);
 SetIndexBuffer(2,bm,INDICATOR_DATA);SetIndexBuffer(3,bu,INDICATOR_DATA);SetIndexBuffer(4,bl,INDICATOR_DATA);
 SetIndexBuffer(5,r5,INDICATOR_DATA);SetIndexBuffer(6,r8,INDICATOR_DATA);SetIndexBuffer(7,r13,INDICATOR_DATA);SetIndexBuffer(8,r21,INDICATOR_DATA);SetIndexBuffer(9,r34,INDICATOR_DATA);SetIndexBuffer(10,r55,INDICATOR_DATA);SetIndexBuffer(11,r89,INDICATOR_DATA);SetIndexBuffer(12,r144,INDICATOR_DATA);
 SetIndexBuffer(13,exitBuy,INDICATOR_DATA);SetIndexBuffer(14,exitSell,INDICATOR_DATA);SetIndexBuffer(15,pBuy,INDICATOR_DATA);SetIndexBuffer(16,pSell,INDICATOR_DATA);SetIndexBuffer(17,turnBuy,INDICATOR_DATA);SetIndexBuffer(18,turnSell,INDICATOR_DATA);
 SetIndexBuffer(19,cloud0a,INDICATOR_DATA);SetIndexBuffer(20,cloud0b,INDICATOR_DATA);SetIndexBuffer(21,cloud1a,INDICATOR_DATA);SetIndexBuffer(22,cloud1b,INDICATOR_DATA);
 SetIndexBuffer(23,cloud2a,INDICATOR_DATA);SetIndexBuffer(24,cloud2b,INDICATOR_DATA);SetIndexBuffer(25,cloud3a,INDICATOR_DATA);SetIndexBuffer(26,cloud3b,INDICATOR_DATA);
 SetIndexBuffer(27,cloud4a,INDICATOR_DATA);SetIndexBuffer(28,cloud4b,INDICATOR_DATA);SetIndexBuffer(29,cloud5a,INDICATOR_DATA);SetIndexBuffer(30,cloud5b,INDICATOR_DATA);SetIndexBuffer(31,cloud6a,INDICATOR_DATA);SetIndexBuffer(32,cloud6b,INDICATOR_DATA);
 for(int i=19;i<26;i++) {PlotIndexSetInteger(i,PLOT_DRAW_TYPE,DRAW_FILLING);PlotIndexSetDouble(i,PLOT_EMPTY_VALUE,EMPTY_VALUE);PlotIndexSetInteger(i,PLOT_SHOW_DATA,false);PlotIndexSetString(i,PLOT_LABEL,"EMA ribbon cloud");}
 string labels[]={"EMA5","EMA8","EMA13","EMA21","EMA34","EMA55","EMA89","EMA144","Buy holding EXIT","Sell holding EXIT","P buy (volume basis in panel)","P sell (volume basis in panel)","TURN up","TURN down"};
 color colors[]={clrCyan,clrDeepSkyBlue,clrDodgerBlue,clrRoyalBlue,clrMediumPurple,clrViolet,clrOrange,clrOrangeRed,clrGold,clrGold,clrLimeGreen,clrTomato,clrAqua,clrDeepPink};
 for(int i=0;i<19;i++) {PlotIndexSetDouble(i,PLOT_EMPTY_VALUE,EMPTY_VALUE);if(i>=5) {PlotIndexSetString(i,PLOT_LABEL,labels[i-5]);PlotIndexSetInteger(i,PLOT_LINE_COLOR,colors[i-5]);PlotIndexSetInteger(i,PLOT_LINE_WIDTH,i>=13?2:1);if(i>=13) PlotIndexSetInteger(i,PLOT_ARROW,i<=14?159:i==16||i==18?234:233);}}
 IndicatorSetInteger(INDICATOR_DIGITS,_Digits);
 IndicatorSetString(INDICATOR_SHORTNAME,"Multi-Analyzer 1.1.0-preview.13 "+_Symbol+" "+(VolumeBasis==MA_TICK_ACTIVITY?"tick":"real/off"));
 ApplyPalette();Controls();SetPlots();
 EventSetTimer(2);Refresh(true);return INIT_SUCCEEDED;
}
int OnCalculate(const int rates_total,const int prev_calculated,const datetime &time[],const double &open[],const double &high[],const double &low[],const double &close[],const long &tick_volume[],const long &volume[],const int &spread[]) {
 ArraySetAsSeries(time,false);Refresh();FillPlots(rates_total,time);return rates_total;
}
void OnTimer() {Refresh();SavePDisplayTrace();if(showDetails) Panel(panelText);}
void OnChartEvent(const int id,const long &lparam,const double &dparam,const string &sparam) {
 if(id==CHARTEVENT_CHART_CHANGE) {ApplyPalette();Controls();int painted=RenderCandidates();BandCaption(painted);PaintSignals();PaintProfile();Panel(panelText);ChartRedraw();return;}
 if(id!=CHARTEVENT_OBJECT_CLICK) return;
 if(sparam==prefix+"toggle") {showBands=!showBands;GlobalVariableSet(key+".z",showBands?1:0);Button("toggle","反転帯",12,showBands);Refresh(true);}
 if(sparam==prefix+"bb") {showBB=!showBB;GlobalVariableSet(key+".b",showBB?1:0);Button("bb","BB",112,showBB);SetPlots();ChartRedraw();}
 if(sparam==prefix+"ribbon") {showRibbon=!showRibbon;GlobalVariableSet(key+".r",showRibbon?1:0);Button("ribbon","リボン",212,showRibbon);SetPlots();ChartRedraw();}
 if(sparam==prefix+"cloud") {showCloud=!showCloud;GlobalVariableSet(key+".c",showCloud?1:0);Button("cloud","トレンド雲",612,showCloud);FillCloud();ChartRedraw();}
 if(sparam==prefix+"retired") {showRetired=!showRetired;GlobalVariableSet(key+".h",showRetired?1:0);Button("retired","解消帯",712,showRetired);Refresh(true);}
 if(sparam==prefix+"frameScope") {showAllZoneFrames=!showAllZoneFrames;GlobalVariableSet(key+".af",showAllZoneFrames?1:0);Controls();Refresh(true);}
 if(sparam==prefix+"bandText") {showZoneLabels=!showZoneLabels;GlobalVariableSet(key+".zt",showZoneLabels?1:0);Controls();Refresh(true);}
 if(sparam==prefix+"pDisplay") {showPDisplayTrace=!showPDisplayTrace;GlobalVariableSet(key+".pt",showPDisplayTrace?1:0);Controls();PaintPDisplayTrace();ChartRedraw();}
 if(sparam==prefix+"signals") {showSignals=!showSignals;GlobalVariableSet(key+".s",showSignals?1:0);Button("signals","P / EXIT",312,showSignals);SetPlots();Refresh(true);}
 if(sparam==prefix+"details") {showDetails=!showDetails;GlobalVariableSet(key+".d",showDetails?1:0);Button("details","詳細",412,showDetails);Refresh(true);}
 if(sparam==prefix+"export") {ExportAnalysis();ObjectSetInteger(0,prefix+"export",OBJPROP_STATE,false);}
}
void OnDeinit(const int reason) {
 EventKillTimer();pDisplayNextSave=0;SavePDisplayTrace();if(pDisplayLease!=INVALID_HANDLE) FileClose(pDisplayLease);if(StringLen(prefix)>0) ObjectsDeleteAll(0,prefix);
}
