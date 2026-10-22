// Native broker-wall-clock history checks. No invented candles or UTC conversion.
#ifndef MA_HISTORY_CORE
#define MA_HISTORY_CORE
struct MASession {int weekday;int start;int stop;};
bool MAAppendSession(MASession &sessions[],const int weekday,const datetime from,const datetime to) {
 int start=(int)(from%86400),stop=(int)(to%86400);
 // A zero-length placeholder is not a full trading day. Preserve an explicit 24h span.
 if(to-from>=86400) stop=start+86400;
 else if(start==stop) return false;
 else if(stop<start) stop+=86400;
 int n=ArraySize(sessions);ArrayResize(sessions,n+1);
 sessions[n].weekday=weekday;sessions[n].start=start;sessions[n].stop=stop;return true;
}
bool MAHistorySessionOverlap(const datetime from,const datetime to,const MASession &sessions[]) {
 if(to<=from) return false;
 // Include the prior day so an overnight session belongs to its starting weekday.
 datetime first=(datetime)(MathFloor((double)from/86400.0)*86400)-86400;
 for(datetime day=first;day<to;day+=86400) {
  int weekday=(int)(day/86400+4)%7;
  for(int i=0;i<ArraySize(sessions);i++) {
   if(sessions[i].weekday!=weekday) continue;
   if(MathMax(from,day+sessions[i].start)<MathMin(to,day+sessions[i].stop)) return true;
  }
 }
 return false;
}
int MARecentHistoryStart(const MqlRates &rates[],const int seconds,const MASession &sessions[]) {
 int start=0;
 for(int i=1;i<ArraySize(rates);i++) {
  if(rates[i].time-rates[i-1].time<seconds) return -1;
  if(rates[i].time-rates[i-1].time>seconds &&
     MAHistorySessionOverlap(rates[i-1].time+seconds,rates[i].time,sessions)) start=i;
 }
 // Restart after the LAST unexplained gap. Every subsequent bar must pass its own checks.
 return start;
}
// 1 = the native lower timeframe brackets the gap and has no bars within it.
// 0 = the witness is not ready/does not cover both neighbours; -1 = contradiction.
// This establishes native-series consistency, NOT a historical holiday calendar.
int MAHistoryWitnessStatus(const MqlRates &lower[],const datetime from,const datetime to,const int seconds) {
 bool before=false,after=false;
 for(int i=0;i<ArraySize(lower);i++) {
  datetime t=lower[i].time;
  if(t>=from && t<to) return -1;
  if(t>=from-seconds && t<from) before=true;
  if(t>=to && t<to+seconds) after=true;
 }
 return before&&after?1:0;
}
bool MAHistorySelfTest() {
 MASession sessions[];
 if(MAAppendSession(sessions,0,0,0) || ArraySize(sessions)!=0) return false;
 if(!MAAppendSession(sessions,1,3600,86400)) return false;
 datetime monday=1792368000;
 if(MAHistorySessionOverlap(monday,monday+3600,sessions)) return false;
 if(!MAHistorySessionOverlap(monday+3600,monday+3660,sessions)) return false;
 MASession overnight[];MAAppendSession(overnight,5,22*3600,2*3600);
 datetime saturday=monday+5*86400;
 if(!MAHistorySessionOverlap(saturday+3600,saturday+3660,overnight)) return false;
 if(MAHistorySessionOverlap(saturday+7200,saturday+7260,overnight)) return false;
 MASession full[];if(!MAAppendSession(full,1,0,86400)) return false;
 return MAHistorySessionOverlap(monday,monday+60,full);
}
#endif
