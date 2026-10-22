#property script_show_inputs
#property description "One-shot local market/math audit. No accounts, positions, orders, mail, DLL or network access."
#include "MAFlowCore.mqh"
input bool OpenVerificationChart=true;
string directory;
int casesWritten=0,rowsWritten=0;
string N(const double v) {return v==EMPTY_VALUE||!MathIsValidNumber(v)?"null":DoubleToString(v,12);}
bool WriteCase(const string name,const MqlRates &c[],const int seconds,const MAVolumeMode mode,const MAFlowRow &hourly[]) {
 MAFlowRow rows[];if(!MAFlow(c,mode,rows)) return false;MAAlign(rows,seconds,hourly);
 int file=FileOpen(directory+"/"+name+".csv",FILE_WRITE|FILE_CSV|FILE_ANSI,',',CP_UTF8);if(file==INVALID_HANDLE) return false;
 FileWrite(file,"time","open","high","low","close","volume","e5","e8","e13","e21","e34","e55","e89","e144","atr","adx","direction","structure","ribbon","votes","switched","aligned","intact","touched","reclaim","pullback","badge","rank","hourlyAligned","pullbackConfirmed","exitLong","exitShort","lastHigh","lastLow","costRiskRatio","netRR","stop","tp2","pCandidate","seconds","mode");
 for(int i=0;i<ArraySize(c);i++) {
  MAFlowRow r=rows[i];MAPlan p=MAMakePlan(c[i],r,seconds,i+1);
  FileWrite(file,(long)c[i].time,N(c[i].open),N(c[i].high),N(c[i].low),N(c[i].close),N(MAVolume(c[i],mode)),N(r.e5),N(r.e8),N(r.e13),N(r.e21),N(r.e34),N(r.e55),N(r.e89),N(r.e144),N(r.atr),N(r.adx),r.direction,r.structure,r.ribbon,r.votes,(int)r.switched,(int)r.aligned,(int)r.intact,(int)r.touched,(int)r.reclaim,r.pullback,r.badge,r.rank,(int)r.hourlyAligned,(int)r.pullbackConfirmed,(int)r.exitLong,(int)r.exitShort,N(r.lastHigh),N(r.lastLow),N(p.costRiskRatio),N(p.netRR),N(p.stop),N(p.tp2),(int)p.pCandidate,seconds,(int)mode);
 }
 FileFlush(file);FileClose(file);
 MAProfile profile=MAProfileLevels(c,mode);int pf=FileOpen(directory+"/profiles.jsonl",FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);
 if(pf==INVALID_HANDLE) return false;FileSeek(pf,0,SEEK_END);
 FileWriteString(pf,"{\"case\":\""+name+"\",\"available\":"+(profile.available?"true":"false")+",\"poc\":"+(profile.available?N(profile.poc):"null")+",\"val\":"+(profile.available?N(profile.val):"null")+",\"vah\":"+(profile.available?N(profile.vah):"null")+"}\n");FileClose(pf);
 casesWritten++;rowsWritten+=ArraySize(c);return true;
}
void Synthetic(MqlRates &c[],const int seconds,const int variant) {
 ArrayResize(c,900);
 for(int i=0;i<900;i++) {
  ZeroMemory(c[i]);c[i].time=(datetime)(1700002800+i*seconds);
  double base=400+(i<450?i*.3:270-i*.3),wave=MathSin(i*.24)*8;
  c[i].close=base+wave;c[i].open=i>0?c[i-1].close:c[i].close;
  c[i].high=MathMax(c[i].open,c[i].close)+.3+(i*7%11)*.02;c[i].low=MathMin(c[i].open,c[i].close)-.3-(i*3%13)*.02;
  c[i].tick_volume=(long)(100+MathAbs(MathSin(i*.19))*160);c[i].real_volume=variant==1?0:c[i].tick_volume*3;
  if(variant>=2&&i%41==0) {c[i].tick_volume=0;c[i].real_volume=0;}
 }
}
void OnStart() {
 string symbol=_Symbol;StringToUpper(symbol);if(StringFind(symbol,"GOLD")<0&&StringFind(symbol,"XAU")<0) {Print("Gold chart required");return;}
 directory="MultiAnalyzerGoldAudit/"+IntegerToString((long)TimeLocal())+"-"+IntegerToString((long)GetMicrosecondCount());FolderCreate("MultiAnalyzerGoldAudit");FolderCreate(directory);
 bool selfTest=MACoreSelfTest()&&MAFlowSelfTest(),success=selfTest;
 for(int variant=0;variant<4;variant++) {
  MAVolumeMode mode=variant==3?MA_TICK_ACTIVITY:(MAVolumeMode)variant;
  MqlRates c[];Synthetic(c,3600,variant);MAFlowRow hourly[];MAFlow(c,mode,hourly);
  if(!WriteCase("synthetic-"+IntegerToString(variant),c,3600,mode,hourly)) success=false;
 }
 MqlRates h[];ArraySetAsSeries(h,false);int hn=CopyRates(_Symbol,PERIOD_H1,1,1000,h);
 for(int retry=0;hn<220&&retry<5;retry++) {Sleep(500);hn=CopyRates(_Symbol,PERIOD_H1,1,1000,h);}
 MAFlowRow hourly[];if(hn>=220) MAFlow(h,MA_TICK_ACTIVITY,hourly);else success=false;
 if(hn>=220&&!WriteCase("XM-H1-base",h,3600,MA_TICK_ACTIVITY,hourly)) success=false;
 ENUM_TIMEFRAMES frames[]={PERIOD_M1,PERIOD_M5,PERIOD_M15,PERIOD_H1,PERIOD_H4,PERIOD_D1};
 string labels[]={"M1","M5","M15","H1","H4","D1"};
 for(int f=0;f<6;f++) {
  MqlRates c[];ArraySetAsSeries(c,false);int n=CopyRates(_Symbol,frames[f],1,1000,c);
  for(int retry=0;n<60&&retry<5;retry++) {Sleep(500);n=CopyRates(_Symbol,frames[f],1,1000,c);}
  if(n<60||!SeriesInfoInteger(_Symbol,frames[f],SERIES_SYNCHRONIZED)||c[n-1].time+PeriodSeconds(frames[f])>TimeCurrent()) {success=false;continue;}
  if(!WriteCase("XM-"+labels[f],c,PeriodSeconds(frames[f]),MA_TICK_ACTIVITY,hourly)) success=false;
 }
 long chart=0;int handle=INVALID_HANDLE;bool attached=false;
 if(success&&OpenVerificationChart) {
  chart=ChartOpen(_Symbol,PERIOD_M15);
  if(chart>0) {
   handle=iCustom(_Symbol,PERIOD_M15,"MultiAnalyzerGold\\1.1.0-preview.1\\MultiAnalyzerGold");
   if(handle!=INVALID_HANDLE) {attached=ChartIndicatorAdd(chart,0,handle);ChartRedraw(chart);}
  }
 }
 int file=FileOpen(directory+"/result.json",FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);
 if(file!=INVALID_HANDLE) {FileWriteString(file,"{\"selfTests\":"+(selfTest?"true":"false")+",\"success\":"+(success?"true":"false")+",\"cases\":"+IntegerToString(casesWritten)+",\"rows\":"+IntegerToString(rowsWritten)+",\"chartOpened\":"+(chart>0?"true":"false")+",\"indicatorAttached\":"+(attached?"true":"false")+",\"chartId\":"+IntegerToString(chart)+",\"symbol\":\""+_Symbol+"\",\"serverTime\":\""+TimeToString(TimeCurrent(),TIME_DATE|TIME_SECONDS)+"\",\"volumeBasis\":\"broker tick count; not trade quantity\",\"noAccountOrTradeAccess\":true}\n");FileClose(file);}
 Print("Multi-Analyzer one-shot audit complete: MQL5/Files/",directory);
}
