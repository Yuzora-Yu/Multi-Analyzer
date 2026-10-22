#property copyright "Multi-Analyzer"
#property link "https://yuzora-yu.github.io/Multi-Analyzer/"
#property version "1.000"
#property description "XM Gold price-context preview 1.0.0-preview.1. No P/EXIT or automated trading."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots 5
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
#include "MAZoneCore.mqh"

input int HistoryBars=500; // 200..1500 closed broker candles per frame
input bool InitialBands=true;
input bool InitialBB=true;
input string InstanceName="default";
double e20[],e50[],bm[],bu[],bl[];
int ema20=INVALID_HANDLE,ema50=INVALID_HANDLE,bands=INVALID_HANDLE;
string prefix,key;
bool showBands=true,showBB=true;
datetime lastM15=0,lastH1=0,lastH4=0;
MAZone candidates[];
string quality="履歴の同期を待っています";

string FrameName(ENUM_TIMEFRAMES tf) {
 if(tf==PERIOD_M1) return "M1"; if(tf==PERIOD_M5) return "M5";
 if(tf==PERIOD_M15) return "M15"; if(tf==PERIOD_H1) return "H1";
 if(tf==PERIOD_H4) return "H4"; return "D1";
}
void Button(const string name,const string text,const int x,const bool on) {
 string id=prefix+name;
 if(ObjectFind(0,id)<0) ObjectCreate(0,id,OBJ_BUTTON,0,0,0);
 ObjectSetInteger(0,id,OBJPROP_XDISTANCE,x); ObjectSetInteger(0,id,OBJPROP_YDISTANCE,22);
 ObjectSetInteger(0,id,OBJPROP_XSIZE,100); ObjectSetInteger(0,id,OBJPROP_YSIZE,28);
 ObjectSetInteger(0,id,OBJPROP_CORNER,CORNER_LEFT_UPPER);
 ObjectSetInteger(0,id,OBJPROP_COLOR,on?clrGold:clrSilver);
 ObjectSetInteger(0,id,OBJPROP_BGCOLOR,clrBlack); ObjectSetInteger(0,id,OBJPROP_STATE,false);
 ObjectSetString(0,id,OBJPROP_FONT,"Meiryo"); ObjectSetString(0,id,OBJPROP_TEXT,text+(on?" ON":" OFF"));
}
void Panel(const string text) {
 ObjectsDeleteAll(0,prefix+"panel");string lines[];int n=StringSplit(text,'\n',lines);
 for(int i=0;i<n;i++) {
  string id=prefix+"panel"+IntegerToString(i);ObjectCreate(0,id,OBJ_LABEL,0,0,0);
  ObjectSetInteger(0,id,OBJPROP_XDISTANCE,12); ObjectSetInteger(0,id,OBJPROP_YDISTANCE,58+i*17);
  ObjectSetInteger(0,id,OBJPROP_COLOR,clrSilver); ObjectSetInteger(0,id,OBJPROP_FONTSIZE,9);
  ObjectSetString(0,id,OBJPROP_FONT,"Meiryo"); ObjectSetString(0,id,OBJPROP_TEXT,lines[i]);
 }
}
bool SessionOpen(const datetime t) {
 MqlDateTime p; TimeToStruct(t,p); int clock=p.hour*3600+p.min*60+p.sec;
 for(uint n=0;n<16;n++) {
  datetime from,to;
  if(!SymbolInfoSessionTrade(_Symbol,(ENUM_DAY_OF_WEEK)p.day_of_week,n,from,to)) break;
  int a=(int)(from%86400),b=(int)(to%86400);
  if(a==b || (a<b?clock>=a && clock<b:clock>=a || clock<b)) return true;
 }
 return false;
}
bool FrameRates(ENUM_TIMEFRAMES tf,MqlRates &rates[],const int count) {
 ArraySetAsSeries(rates,false);
 int n=CopyRates(_Symbol,tf,1,count,rates); // bar0 is NEVER a confirmed analysis input
 if(n<200 || !SeriesInfoInteger(_Symbol,tf,SERIES_SYNCHRONIZED) || !MAValid(rates)) return false;
 int seconds=PeriodSeconds(tf); datetime now=TimeCurrent();
 if(rates[n-1].time+seconds>now) return false;
 if(tf==PERIOD_M15 && now-rates[n-1].time-seconds>1200) return false;
 // Native broker sessions, no UTC/Bybit session conversion and no fabricated bars.
 for(int i=1;i<n;i++) {
  if(rates[i].time-rates[i-1].time<seconds) return false;
  for(datetime t=rates[i-1].time+seconds;t<rates[i].time;t+=seconds) {
   for(int k=0;k<seconds;k+=60) if(SessionOpen(t+k)) return false;
  }
 }
 return true;
}
void PaintZone(const MAZone &z,const int index) {
 string id=prefix+"zone"+IntegerToString(index);
 datetime end=TimeCurrent()+PeriodSeconds((ENUM_TIMEFRAMES)_Period)*5;
 color col=z.side>0?clrDarkSlateGray:clrSaddleBrown;
 ObjectCreate(0,id,OBJ_RECTANGLE,0,z.formed,z.low,end,z.high);
 ObjectSetInteger(0,id,OBJPROP_COLOR,col); ObjectSetInteger(0,id,OBJPROP_FILL,true);
 ObjectSetInteger(0,id,OBJPROP_BACK,true); ObjectSetInteger(0,id,OBJPROP_SELECTABLE,false);
 ObjectCreate(0,id+"text",OBJ_TEXT,0,end,z.side>0?z.low:z.high);
 ObjectSetInteger(0,id+"text",OBJPROP_ANCHOR,ANCHOR_RIGHT_LOWER);
 ObjectSetInteger(0,id+"text",OBJPROP_COLOR,z.side>0?clrAqua:clrOrange);
 ObjectSetInteger(0,id+"text",OBJPROP_FONTSIZE,8);
 ObjectSetInteger(0,id+"text",OBJPROP_SELECTABLE,false); ObjectSetString(0,id+"text",OBJPROP_FONT,"Meiryo");
 string label=z.frame+" "+(z.side>0?"買反転 ":"売反転 ")+MAKind(z.kind)+" "+DoubleToString(z.low,_Digits)+"–"+DoubleToString(z.high,_Digits);
 ObjectSetString(0,id+"text",OBJPROP_TEXT,label);
 string info=label+" | 形成 "+TimeToString(z.formed)+" (broker) | 再訪 "+IntegerToString(z.visits)+
  " | "+z.frame+"終値が "+DoubleToString(z.side>0?z.low:z.high,_Digits)+(z.side>0?"未満":"超")+"で撤回。反転成立・入場ではありません。";
 ObjectSetString(0,id,OBJPROP_TOOLTIP,info); ObjectSetString(0,id+"text",OBJPROP_TOOLTIP,info);
}
void RenderCandidates() {
 ObjectsDeleteAll(0,prefix+"zone");
 if(!showBands) return;
 int picked[]; ArrayResize(picked,0);
 MqlRates base[]; if(CopyRates(_Symbol,PERIOD_M15,1,1,base)!=1) return;
 double price=base[0].close;
 // Preserve native ranges. Same extreme across frames is one observation.
 for(int i=0;i<ArraySize(candidates);i++) {
  bool duplicate=false;
  for(int j=0;j<ArraySize(picked);j++) {
   int k=picked[j]; if(candidates[i].kind!=2 || candidates[k].kind!=2 || candidates[i].side!=candidates[k].side) continue;
   double x=candidates[i].side>0?candidates[i].low:candidates[i].high;
   double y=candidates[k].side>0?candidates[k].low:candidates[k].high;
   if(MathAbs(x-y)<_Point*.5) {
    duplicate=true;
    if(candidates[i].formed<candidates[k].formed || (candidates[i].formed==candidates[k].formed && candidates[i].high-candidates[i].low<candidates[k].high-candidates[k].low)) picked[j]=i;
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
   if(d<distance) {distance=d; active=i;}
  }
  int count=0; if(active>=0) {PaintZone(candidates[active],painted++);count++;}
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
   PaintZone(candidates[best],painted++);count++;before=candidates[best].formed;beforeIndex=best;
  }
 }
}
void Refresh(const bool force=false) {
 MqlTick tick;
 bool live=TerminalInfoInteger(TERMINAL_CONNECTED) && SymbolInfoTick(_Symbol,tick) && TimeTradeServer()>=tick.time && TimeTradeServer()-tick.time<120;
 if(!live || !SessionOpen(TimeCurrent())) {
  ObjectsDeleteAll(0,prefix+"zone");lastM15=0;
  Panel("MT5 1.0.0-preview.1 検証版 | "+_Symbol+" | 休場・未接続・価格更新待ち。新規の反転帯は停止"); return;
 }
 datetime m=iTime(_Symbol,PERIOD_M15,1),h=iTime(_Symbol,PERIOD_H1,1),q=iTime(_Symbol,PERIOD_H4,1);
 if(!force && m==lastM15 && h==lastH1 && q==lastH4) return;
 lastM15=m;lastH1=h;lastH4=q;ArrayResize(candidates,0);
 ENUM_TIMEFRAMES frames[]={PERIOD_M15,PERIOD_H1,PERIOD_H4};
 string status="";bool ok=true;double nearATR=0,reference=0;
 for(int f=0;f<3;f++) {
  MqlRates c[]; ENUM_TIMEFRAMES tf=frames[f];
  if(!FrameRates(tf,c,HistoryBars)) {status+=FrameName(tf)+" 履歴待ち / ";ok=false;continue;}
  MAZone zs[]; MAAnalyze(c,PeriodSeconds(tf),FrameName(tf),zs);
  int n=ArraySize(c),maxAge=f==0?32:f==1?24:12;
  if(f==0) {double atr[];MAATR(c,atr);nearATR=atr[n-1];reference=c[n-1].close;}
  for(int z=0;z<ArraySize(zs);z++) if(zs[z].active && n-1-zs[z].index<=maxAge) {
   if(nearATR<=0 || MathMax(zs[z].low-reference,MathMax(reference-zs[z].high,0))>nearATR*8) continue;
   int size=ArraySize(candidates);ArrayResize(candidates,size+1);candidates[size]=zs[z];
  }
  status+=FrameName(tf)+" 確定 "+TimeToString(c[n-1].time+PeriodSeconds(tf),TIME_DATE|TIME_MINUTES)+"  "+DoubleToString(c[n-1].close,_Digits)+"\n";
 }
 if(!ok) {ArrayResize(candidates,0);ObjectsDeleteAll(0,prefix+"zone");lastM15=0;}
 else RenderCandidates();
 ENUM_TIMEFRAMES extra[]={PERIOD_M1,PERIOD_M5,PERIOD_D1};
 for(int k=0;k<3;k++) {
  MqlRates r[];
  if(CopyRates(_Symbol,extra[k],1,1,r)==1) status+=FrameName(extra[k])+" 確定 "+TimeToString(r[0].time+PeriodSeconds(extra[k]),TIME_DATE|TIME_MINUTES)+"  "+DoubleToString(r[0].close,_Digits)+"\n";
  else status+=FrameName(extra[k])+" 履歴待ち\n";
 }
 Panel("MT5 1.0.0-preview.1 検証版 | "+_Symbol+" | broker時刻\n"+status+"価格型SMCのみ。元P/EXIT・実出来高判定は未移植。");
 ChartRedraw();
}
void SetBB() {for(int i=2;i<5;i++) PlotIndexSetInteger(i,PLOT_DRAW_TYPE,showBB?DRAW_LINE:DRAW_NONE);}
int OnInit() {
 if(!MACoreSelfTest()) {Print("Multi-Analyzer core self-test failed");return INIT_FAILED;}
 string symbol=_Symbol;StringToUpper(symbol);
 if(StringFind(symbol,"GOLD")<0 && StringFind(symbol,"XAU")<0) {Print("Goldチャート専用です");return INIT_PARAMETERS_INCORRECT;}
 if(HistoryBars<200 || HistoryBars>1500 || StringLen(InstanceName)>24) return INIT_PARAMETERS_INCORRECT;
 prefix="MAGold_"+IntegerToString(ChartID())+"_"+IntegerToString(GetMicrosecondCount())+"_";
 key="MAGold.1.preview."+IntegerToString(ChartID())+"."+InstanceName;
 showBands=GlobalVariableCheck(key+".z")?GlobalVariableGet(key+".z")>0:InitialBands;
 showBB=GlobalVariableCheck(key+".b")?GlobalVariableGet(key+".b")>0:InitialBB;
 SetIndexBuffer(0,e20,INDICATOR_DATA);SetIndexBuffer(1,e50,INDICATOR_DATA);
 SetIndexBuffer(2,bm,INDICATOR_DATA);SetIndexBuffer(3,bu,INDICATOR_DATA);SetIndexBuffer(4,bl,INDICATOR_DATA);
 ema20=iMA(_Symbol,PERIOD_CURRENT,20,0,MODE_EMA,PRICE_CLOSE);
 ema50=iMA(_Symbol,PERIOD_CURRENT,50,0,MODE_EMA,PRICE_CLOSE);
 bands=iBands(_Symbol,PERIOD_CURRENT,20,0,2,PRICE_CLOSE);
 if(ema20==INVALID_HANDLE || ema50==INVALID_HANDLE || bands==INVALID_HANDLE) return INIT_FAILED;
 IndicatorSetString(INDICATOR_SHORTNAME,"Multi-Analyzer Gold 1.0.0-preview.1 PREVIEW");
 Button("toggle","反転帯",12,showBands);Button("bb","BB",120,showBB);SetBB();
 EventSetTimer(2);Refresh(true);return INIT_SUCCEEDED;
}
int OnCalculate(const int rates_total,const int prev_calculated,const datetime &time[],const double &open[],const double &high[],const double &low[],const double &close[],const long &tick_volume[],const long &volume[],const int &spread[]) {
 if(CopyBuffer(ema20,0,0,rates_total,e20)<rates_total || CopyBuffer(ema50,0,0,rates_total,e50)<rates_total ||
    CopyBuffer(bands,0,0,rates_total,bm)<rates_total || CopyBuffer(bands,1,0,rates_total,bu)<rates_total || CopyBuffer(bands,2,0,rates_total,bl)<rates_total) return prev_calculated;
 Refresh();return rates_total;
}
void OnTimer() {Refresh();}
void OnChartEvent(const int id,const long &lparam,const double &dparam,const string &sparam) {
 if(id!=CHARTEVENT_OBJECT_CLICK) return;
 if(sparam==prefix+"toggle") {showBands=!showBands;GlobalVariableSet(key+".z",showBands?1:0);Button("toggle","反転帯",12,showBands);Refresh(true);}
 if(sparam==prefix+"bb") {showBB=!showBB;GlobalVariableSet(key+".b",showBB?1:0);Button("bb","BB",120,showBB);SetBB();ChartRedraw();}
}
void OnDeinit(const int reason) {
 EventKillTimer();if(StringLen(prefix)>0) ObjectsDeleteAll(0,prefix);
 if(ema20!=INVALID_HANDLE) IndicatorRelease(ema20);
 if(ema50!=INVALID_HANDLE) IndicatorRelease(ema50);
 if(bands!=INVALID_HANDLE) IndicatorRelease(bands);
}
