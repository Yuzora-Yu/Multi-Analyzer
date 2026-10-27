#ifndef MA_P_DISPLAY_CORE
#define MA_P_DISPLAY_CORE
// Display ledger only. Never feeds MAFlow, MAMakePlan, costs or notifications.
struct MAPDisplayRecord {
 datetime source,confirmed,observedServer,observedUTC,displayBar;
 int side;
 double sourcePrice,displayPrice;
 bool delayed;
};
bool MAPDisplayEligible(const datetime source,const int seconds,const datetime baselineClose,const datetime observedServer,const datetime displayBar,const int side) {
 return seconds>=900&&source>0&&baselineClose>0&&(side==1||side==-1)&&
  source+seconds>baselineClose&&source+seconds<=observedServer&&
  displayBar>=source+seconds&&displayBar<=observedServer&&observedServer<displayBar+seconds;
}
int MAPDisplayFind(const MAPDisplayRecord &records[],const datetime source,const int side) {
 for(int i=ArraySize(records)-1;i>=0;i--) if(records[i].source==source&&records[i].side==side) return i;
 return -1;
}
bool MAPDisplayValid(const MAPDisplayRecord &r,const int seconds) {
 return seconds>=900&&r.source>0&&r.confirmed==r.source+seconds&&
  r.observedServer>=r.confirmed&&r.observedUTC>0&&r.displayBar>=r.confirmed&&
  r.displayBar<=r.observedServer&&r.observedServer<r.displayBar+seconds&&
  (r.side==1||r.side==-1)&&r.delayed==(r.displayBar>r.confirmed)&&
  r.sourcePrice>0&&r.displayPrice>0&&MathIsValidNumber(r.sourcePrice)&&MathIsValidNumber(r.displayPrice);
}
bool MAPDisplayRemember(MAPDisplayRecord &records[],const MAPDisplayRecord &r,const int seconds,const int limit) {
 if(limit<1||!MAPDisplayValid(r,seconds)||MAPDisplayFind(records,r.source,r.side)>=0) return false;
 int n=ArraySize(records);
 if(n>=limit) {for(int i=1;i<n;i++) records[i-1]=records[i];n--;ArrayResize(records,n);}
 ArrayResize(records,n+1);records[n]=r;return true;
}
#endif
