// Price-only SMC context, independently versioned from the frozen web engine.
#ifndef MA_ZONE_CORE
#define MA_ZONE_CORE
struct MAZone {
 int kind; // 0 OB, 1 FVG, 2 sweep/return
 int side; // +1 buy hypothesis, -1 sell hypothesis
 int index;
 double low,high;
 datetime formed;
 int seconds;
 bool active,inside;
 int visits;
 string frame;
};
void MAAppend(MAZone &zones[],const int kind,const int side,const int index,
              const double low,const double high,const datetime formed,const int seconds,const string frame) {
 if(low<=0 || high<=low) return;
 int n=ArraySize(zones); ArrayResize(zones,n+1);
 zones[n].kind=kind; zones[n].side=side; zones[n].index=index;
 zones[n].low=low; zones[n].high=high; zones[n].formed=formed;
 zones[n].seconds=seconds; zones[n].frame=frame;
 zones[n].active=true; zones[n].inside=false; zones[n].visits=0;
}
bool MAPivot(const MqlRates &c[],const int p,const bool high) {
 if(p<3 || p+3>=ArraySize(c)) return false;
 for(int j=p-3;j<=p+3;j++) {
  if(j==p) continue;
  if(high ? c[j].high>=c[p].high : c[j].low<=c[p].low) return false;
 }
 return true;
}
bool MAValid(const MqlRates &c[]) {
 for(int i=0;i<ArraySize(c);i++) {
  if(c[i].time<=0 || (i>0 && c[i].time<=c[i-1].time)) return false;
  if(!MathIsValidNumber(c[i].open) || !MathIsValidNumber(c[i].high) ||
     !MathIsValidNumber(c[i].low) || !MathIsValidNumber(c[i].close)) return false;
  if(c[i].low<=0 || c[i].high<MathMax(c[i].open,c[i].close) ||
     c[i].low>MathMin(c[i].open,c[i].close)) return false;
 }
 return ArraySize(c)>=60;
}
void MAATR(const MqlRates &c[],double &atr[]) {
 int n=ArraySize(c); ArrayResize(atr,n); ArrayInitialize(atr,0);
 double sum=0;
 for(int i=0;i<n;i++) {
  double prev=(i>0?c[i-1].close:c[i].close);
  double tr=MathMax(c[i].high-c[i].low,MathMax(MathAbs(c[i].high-prev),MathAbs(c[i].low-prev)));
  if(i<14) {sum+=tr; if(i==13) atr[i]=sum/14;}
  else atr[i]=(atr[i-1]*13+tr)/14;
 }
}
void MAAnalyze(const MqlRates &c[],const int seconds,const string frame,MAZone &zones[]) {
 ArrayResize(zones,0);
 if(!MAValid(c)) return;
 double atr[]; MAATR(c,atr); int n=ArraySize(c);
 int hi=-1,lo=-1,usedHi=-1,usedLo=-1;
 for(int i=2;i<n;i++) {
  for(int z=0;z<ArraySize(zones);z++) {
   if(!zones[z].active) continue;
   bool broken=zones[z].side>0?c[i].close<zones[z].low:c[i].close>zones[z].high;
   bool filled=zones[z].kind==1 && (zones[z].side>0?c[i].low<=zones[z].low:c[i].high>=zones[z].high);
   if(broken || filled) {zones[z].active=false; continue;}
   bool touch=c[i].low<=zones[z].high && c[i].high>=zones[z].low;
   if(touch && !zones[z].inside) zones[z].visits++;
   zones[z].inside=touch;
  }
  double a=atr[i-1];
  bool bull=hi>=0 && usedHi!=hi && c[i-1].close<=c[hi].high && c[i].close>c[hi].high;
  bool bear=lo>=0 && usedLo!=lo && c[i-1].close>=c[lo].low && c[i].close<c[lo].low;
  if(bull) usedHi=hi;
  if(bear) usedLo=lo;
  if(a>0 && ((bull && c[i].close-c[i].open>a*.8) || (bear && c[i].open-c[i].close>a*.8))) {
   int side=bull?1:-1;
   for(int j=i-1;j>=MathMax(0,i-8);j--) {
    if(side>0?c[j].close<c[j].open:c[j].close>c[j].open) {
     MAAppend(zones,0,side,i,c[j].low,c[j].high,c[i].time+seconds,seconds,frame); break;
    }
   }
  }
  // Swing is updated only AFTER the current closed candle has been processed.
  if(lo>=0 && c[i].low<c[lo].low && c[i].close>c[lo].low)
   MAAppend(zones,2,1,i,c[i].low,c[lo].low,c[i].time+seconds,seconds,frame);
  if(hi>=0 && c[i].high>c[hi].high && c[i].close<c[hi].high)
   MAAppend(zones,2,-1,i,c[hi].high,c[i].high,c[i].time+seconds,seconds,frame);
  if(a>0 && MathAbs(c[i-1].close-c[i-1].open)>a*.8) {
   if(c[i].low-c[i-2].high>a*.1) MAAppend(zones,1,1,i,c[i-2].high,c[i].low,c[i].time+seconds,seconds,frame);
   if(c[i-2].low-c[i].high>a*.1) MAAppend(zones,1,-1,i,c[i].high,c[i-2].low,c[i].time+seconds,seconds,frame);
  }
  int p=i-3;
  if(p>=3) {if(MAPivot(c,p,true)) hi=p; if(MAPivot(c,p,false)) lo=p;}
 }
}
string MAKind(const int kind) {return kind==0?"OB":kind==1?"FVG":"SWEEP";}
// Executed locally on initialization, before reading broker data or drawing.
bool MACoreSelfTest() {
 MqlRates c[];ArrayResize(c,85);
 for(int i=0;i<85;i++) {ZeroMemory(c[i]);c[i].time=(datetime)(1700000000+i*900);c[i].open=100;c[i].close=100;c[i].high=101;c[i].low=99;}
 c[20].high=105;c[35].low=95;c[80].high=107;c[80].close=104;
 MAZone zs[];MAAnalyze(c,900,"TEST",zs);bool found=false;
 for(int i=0;i<ArraySize(zs);i++) if(zs[i].kind==2 && zs[i].side==-1 && zs[i].low==105 && zs[i].high==107) {
  found=zs[i].active && zs[i].formed==c[80].time+900;
 }
 if(!found) return false;
 c[81].high=109;c[81].close=108;c[82].high=106;c[82].close=104;
 MAAnalyze(c,900,"TEST",zs);
 for(int i=0;i<ArraySize(zs);i++) if(zs[i].kind==2 && zs[i].low==105 && zs[i].high==107 && zs[i].active) return false;
 // A fully filled FVG cannot become active again on a later recovery.
 c[80].open=105;c[80].high=106;c[80].low=105;c[80].close=105.5;
 c[79].open=100;c[79].high=104;c[79].close=104;
 c[81].open=104;c[81].low=100;c[81].close=104;
 MAAnalyze(c,900,"TEST",zs);found=false;
 for(int i=0;i<ArraySize(zs);i++) if(zs[i].kind==1 && zs[i].low==101 && zs[i].high==105) {found=true;if(zs[i].active) return false;}
 return found;
}
#endif
