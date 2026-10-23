// Display-only closed-candle observations. Not a P/EXIT or execution condition.
#ifndef MA_RESPONSE_CORE
#define MA_RESPONSE_CORE
#include "MAFlowCore.mqh"
struct MAResponseRow {
 int side,phase,index,pressure,held,ribbon;
 double reference,pad;
 datetime brokenAt,changedAt,expiresAt,time,closedAt;
};
void MAResponse(const MqlRates &c[],const MAFlowRow &rows[],const int seconds,MAResponseRow &out[]) {
 ArrayResize(out,0);int n=ArraySize(c);if(n!=ArraySize(rows)||seconds<=0||!MAValid(c)) return;
 ArrayResize(out,n);int hi=-1,lo=-1,usedHi=-1,usedLo=-1,start=0;
 MAResponseRow state;ZeroMemory(state);state.index=-1;
 for(int i=0;i<n;i++) {
  bool gap=i>0&&c[i].time-c[i-1].time!=seconds;
  if(gap) {if(state.side!=0&&state.phase<=2) {state.phase=5;state.changedAt=c[i].time+seconds;}hi=-1;lo=-1;usedHi=-1;usedLo=-1;start=i;}
  if(!gap&&state.side!=0&&state.phase<=2&&i>state.index) {
   bool reclaimed=state.side>0?c[i].close<state.reference:c[i].close>state.reference;
   if(reclaimed) {state.phase=3;state.changedAt=c[i].time+seconds;}
   else if(i-state.index>12) {state.phase=4;state.changedAt=c[i].time+seconds;}
   else if(state.phase==1&&(state.side>0?c[i].low<=state.reference+state.pad&&c[i].close>state.reference+state.pad:c[i].high>=state.reference-state.pad&&c[i].close<state.reference-state.pad)) {state.phase=2;state.changedAt=c[i].time+seconds;}
  }
  bool bull=hi>=start&&usedHi!=hi&&i>0&&c[i-1].close<=c[hi].high&&c[i].close>c[hi].high;
  bool bear=lo>=start&&usedLo!=lo&&i>0&&c[i-1].close>=c[lo].low&&c[i].close<c[lo].low;
  if((bull||bear)&&i>0&&rows[i-1].atr>0) {
   if(bull) usedHi=hi;else usedLo=lo;
   state.side=bull?1:-1;state.phase=1;state.reference=bull?c[hi].high:c[lo].low;state.pad=rows[i-1].atr*.15;
   state.brokenAt=c[i].time+seconds;state.changedAt=state.brokenAt;state.expiresAt=c[i].time+seconds*13;state.index=i;
  }
  int p=i-3;
  if(p>=start+3) {if(MAPivot(c,p,true)) hi=p;if(MAPivot(c,p,false)) lo=p;}
  state.pressure=0;
  if(rows[i].e13!=EMPTY_VALUE&&rows[i].e21!=EMPTY_VALUE&&MathIsValidNumber(rows[i].e13)&&MathIsValidNumber(rows[i].e21))
   state.pressure=c[i].close>rows[i].e13&&rows[i].e13>rows[i].e21?1:c[i].close<rows[i].e13&&rows[i].e13<rows[i].e21?-1:0;
  state.time=c[i].time;state.closedAt=c[i].time+seconds;state.held=rows[i].direction;state.ribbon=rows[i].ribbon;out[i]=state;
 }
}
string MAResponsePhase(const MAResponseRow &r) {
 if(r.phase==1) return "突破・後続足待ち";
 if(r.phase==2) return r.side>0?"後続足で押し支え":"後続足で戻り失敗";
 if(r.phase==3) return "元水準を奪回され撤回";
 if(r.phase==4) return "観察期限終了";
 if(r.phase==5) return "足の空白・経過不明";
 return "基準待ち";
}
#endif
