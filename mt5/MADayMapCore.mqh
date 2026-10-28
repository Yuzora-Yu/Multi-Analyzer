// Previous native D1 map. Read-only context; original zone bounds never move.
#ifndef MA_DAY_MAP_CORE
#define MA_DAY_MAP_CORE
#include "MAZoneImportance.mqh"
#include "MAHistoryCore.mqh"
#define MA_DAY_MAP_HISTORY 220
struct MADayEntry {MAZone zone;MAZonePriority importance;double distance;int status,visits;datetime changedAt,through;};
double MADayDistance(const double low,const double high,const double midpoint) {return MathMax(low-midpoint,MathMax(midpoint-high,0));}
void MADayCollect(const MqlRates &c[],const datetime cutoff,const int seconds,const string frame,const double midpoint,const double range,const MAVolumeMode mode,MADayEntry &all[]) {
 if(ArraySize(c)!=MA_DAY_MAP_HISTORY||!MAValid(c)||c[ArraySize(c)-1].time+seconds>cutoff) return;
 MAZone zones[];MAAnalyze(c,seconds,frame,zones);MAImportanceFact facts[];if(!MAImportancePrepare(c,mode,facts)) return;
 for(int i=0;i<ArraySize(zones);i++) {
  MAZone z=zones[i];if(!z.active||z.formed>cutoff) continue;
  double distance=MADayDistance(z.low,z.high,midpoint);if(distance>2*range) continue;
  int n=ArraySize(all);ArrayResize(all,n+1);ZeroMemory(all[n]);all[n].zone=z;
  all[n].importance=MAImportanceEvaluate(c,facts,z);all[n].distance=distance;all[n].through=cutoff;
 }
}
void MADaySelect(const MADayEntry &all[],MADayEntry &selected[]) {
 ArrayResize(selected,0);
 for(int role=3;role>=1;role--) for(int side=1;side>=-1;side-=2) {
  int best=-1;
  for(int i=0;i<ArraySize(all);i++) {
   if(all[i].zone.side!=side||all[i].importance.role!=role) continue;
   if(best<0||all[i].distance<all[best].distance||
     (all[i].distance==all[best].distance&&all[i].zone.seconds>all[best].zone.seconds)||
     (all[i].distance==all[best].distance&&all[i].zone.seconds==all[best].zone.seconds&&all[i].importance.score>all[best].importance.score)) best=i;
  }
  if(best>=0) {int n=ArraySize(selected);ArrayResize(selected,n+1);selected[n]=all[best];}
 }
}
bool MADayBarValid(const MqlRates &b) {
 return b.time>0&&MathIsValidNumber(b.open)&&MathIsValidNumber(b.high)&&MathIsValidNumber(b.low)&&MathIsValidNumber(b.close)&&b.low>0&&b.high>=MathMax(b.open,b.close)&&b.low<=MathMin(b.open,b.close);
}
bool MADayRetired(const MAZone &z,const MqlRates &b) {
 return (z.side>0?b.close<z.low:b.close>z.high)||(z.kind==1&&(z.side>0?b.low<=z.low:b.high>=z.high));
}
void MADayObserve(MADayEntry &entry,const MqlRates &c[],const datetime cutoff,const datetime now,const MASession &sessions[]) {
 entry.status=0;entry.visits=0;entry.changedAt=0;entry.through=cutoff;
 bool inside=false,missing=false;MAZone z=entry.zone;
 for(int i=0;i<ArraySize(c);i++) {
  MqlRates b=c[i];datetime close=b.time+z.seconds;
  if(!MADayBarValid(b)||(i>0&&b.time<=c[i-1].time)) {missing=true;continue;}if(close<=cutoff||close>now) continue;
  if(b.time>entry.through&&MAHistorySessionOverlap(entry.through,b.time,sessions)) missing=true;
  entry.through=close;
  if(MADayRetired(z,b)) {entry.status=2;entry.changedAt=close;return;}
  bool touch=b.low<=z.high&&b.high>=z.low;
  if(touch&&!inside) {entry.status=1;entry.visits++;entry.changedAt=close;}inside=touch;
 }
 datetime expected=(datetime)((long)now/z.seconds*z.seconds);
 if(expected>entry.through&&MAHistorySessionOverlap(entry.through,expected,sessions)) missing=true;
 if(missing) entry.status=3;
}
string MADayStatus(const int status) {return status==2?"解消":status==3?"追跡不足":status==1?"接触":"未接触";}
#endif
