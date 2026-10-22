// Native closed-OHLC port of flow-core.js and pullback-v1. Independently versioned.
// Tick counts are explicitly a broker activity proxy, never aggressor trade volume.
#ifndef MA_FLOW_CORE
#define MA_FLOW_CORE
#include "MAZoneCore.mqh"
enum MAVolumeMode { MA_TICK_ACTIVITY=0, MA_REAL_VOLUME=1, MA_NO_VOLUME=2 };
struct MAFlowRow {
 datetime time;
 double e5,e8,e13,e21,e34,e55,e89,e144,ema20,ema50;
 double atr,adx,widthATR,volumeRatio,lastHigh,lastLow;
 int direction,structure,ribbon,votes,pullback,badge,rank;
 bool ready,aligned,switched,intact,touched,reclaim,exitLong,exitShort,hourlyAligned,pullbackConfirmed;
};
struct MAPlan {
 int direction;
 double entry,stop,tp1,tp2,tp3,risk,totalCost,costRiskRatio,netRR;
 bool valid,costOK,pCandidate;
};
struct MAProfile {bool available;double poc,val,vah;};
MAProfile MAProfileLevels(const MqlRates &c[],const MAVolumeMode mode) {
 MAProfile result;ZeroMemory(result);int n=ArraySize(c),start=MathMax(0,n-96);if(n==0) return result;
 double low=c[start].low,high=c[start].high,bins[48];ArrayInitialize(bins,0);
 for(int i=start;i<n;i++) {low=MathMin(low,c[i].low);high=MathMax(high,c[i].high);}
 double step=(high-low)/48;if(step<=0) step=MathMax(low*.000001,.000001);
 for(int i=start;i<n;i++) {
  double volume=MAVolume(c[i],mode);if(volume<=0) continue;
  if(c[i].high==c[i].low) {int j=(int)MathMax(0,MathMin(47,MathFloor((c[i].close-low)/step)));bins[j]+=volume;continue;}
  for(int j=0;j<48;j++) bins[j]+=volume*MathMax(0,MathMin(c[i].high,low+(j+1)*step)-MathMax(c[i].low,low+j*step))/(c[i].high-c[i].low);
 }
 double total=0;int poc=0;for(int i=0;i<48;i++) {total+=bins[i];if(bins[i]>bins[poc]) poc=i;}
 if(total<=0) return result;int left=poc,right=poc;double area=bins[poc];
 while(area<total*.7&&(left>0||right<47)) {if(right<47&&(left==0||bins[right+1]>=bins[left-1])) area+=bins[++right];else area+=bins[--left];}
 result.available=true;result.poc=low+(poc+.5)*step;result.val=low+left*step;result.vah=low+(right+1)*step;return result;
}
double MARound(const double v,const int digits) {double p=MathPow(10,digits);return MathFloor(v*p+0.5)/p;}
double MAVolume(const MqlRates &b,const MAVolumeMode mode) {
 return mode==MA_TICK_ACTIVITY?(double)b.tick_volume:mode==MA_REAL_VOLUME?(double)b.real_volume:0;
}
string MAVolumeName(const MAVolumeMode mode) {
 return mode==MA_TICK_ACTIVITY?"XM tick activity (NOT traded quantity)":mode==MA_REAL_VOLUME?"broker real volume (zero = unavailable)":"volume unavailable / P withheld";
}
void MAEMA(const MqlRates &c[],const int period,double &out[]) {
 int n=ArraySize(c);ArrayResize(out,n);ArrayInitialize(out,EMPTY_VALUE);double sum=0,prev=0,k=2.0/(period+1);
 for(int i=0;i<n;i++) {
  if(i<period) {sum+=c[i].close;if(i==period-1) {prev=sum/period;out[i]=prev;}}
  else {prev=c[i].close*k+prev*(1-k);out[i]=prev;}
 }
}
void MAADX(const MqlRates &c[],double &out[]) {
 int n=ArraySize(c);ArrayResize(out,n);ArrayInitialize(out,0);
 double ts=0,ps=0,ms=0,tw=0,pw=0,mw=0,ds=0,dw=0;
 for(int i=0;i<n;i++) {
  double prev=i>0?c[i-1].close:c[i].close;
  double tr=MathMax(c[i].high-c[i].low,MathMax(MathAbs(c[i].high-prev),MathAbs(c[i].low-prev)));
  double up=i>0?c[i].high-c[i-1].high:0,down=i>0?c[i-1].low-c[i].low:0;
  double pd=up>down&&up>0?up:0,md=down>up&&down>0?down:0,dx=0;
  if(i<14) {ts+=tr;ps+=pd;ms+=md;if(i==13) {tw=ts/14;pw=ps/14;mw=ms/14;}}
  else {tw=(tw*13+tr)/14;pw=(pw*13+pd)/14;mw=(mw*13+md)/14;}
  if(i>=13&&tw>0) {double plus=100*pw/tw,minus=100*mw/tw;dx=plus+minus>0?100*MathAbs(plus-minus)/(plus+minus):0;}
  if(i<14) {ds+=dx;if(i==13) {dw=ds/14;out[i]=dw;}}
  else {dw=(dw*13+dx)/14;out[i]=dw;}
 }
}
bool MAFlow(const MqlRates &c[],const MAVolumeMode mode,MAFlowRow &out[]) {
 ArrayResize(out,0);if(!MAValid(c)) return false;
 int n=ArraySize(c);ArrayResize(out,n);
 double e5[],e8[],e13[],e21[],e34[],e55[],e89[],e144[],ema20Line[],ema50Line[],atr[],adx[];
 MAEMA(c,5,e5);MAEMA(c,8,e8);MAEMA(c,13,e13);MAEMA(c,21,e21);MAEMA(c,34,e34);
 MAEMA(c,55,e55);MAEMA(c,89,e89);MAEMA(c,144,e144);MAEMA(c,20,ema20Line);MAEMA(c,50,ema50Line);MAATR(c,atr);MAADX(c,adx);
 int hi=-1,hprev=-1,lo=-1,lprev=-1,direction=0,lastSwitch=-1000000,votes=0,pending=0;
 for(int i=0;i<n;i++) {
  int p=i-3;
  // Confirmation at i is available now, never at the original pivot candle p.
  if(p>=3) {if(MAPivot(c,p,true)) {hprev=hi;hi=p;}if(MAPivot(c,p,false)) {lprev=lo;lo=p;}}
  MAFlowRow r;ZeroMemory(r);r.time=c[i].time;r.volumeRatio=-1;r.widthATR=EMPTY_VALUE;
  r.e5=e5[i];r.e8=e8[i];r.e13=e13[i];r.e21=e21[i];r.e34=e34[i];r.e55=e55[i];r.e89=e89[i];r.e144=e144[i];r.ema20=ema20Line[i];r.ema50=ema50Line[i];
  r.atr=atr[i];r.adx=adx[i];r.ready=i>=143&&atr[i]>0;
  r.lastHigh=hi>=0?c[hi].high:0;r.lastLow=lo>=0?c[lo].low:0;
  if(hprev>=0&&lprev>=0) r.structure=c[hi].high>c[hprev].high&&c[lo].low>c[lprev].low?1:c[hi].high<c[hprev].high&&c[lo].low<c[lprev].low?-1:0;
  double values[]={e5[i],e8[i],e13[i],e21[i],e34[i],e55[i],e89[i],e144[i]};
  if(r.ready) {
   r.ribbon=e5[i]>e144[i]?1:e5[i]<e144[i]?-1:0;double low=values[0],high=values[0];r.aligned=true;
   for(int j=0;j<8;j++) {low=MathMin(low,values[j]);high=MathMax(high,values[j]);if(j>0&&!(r.ribbon>0?values[j-1]>values[j]:values[j-1]<values[j])) r.aligned=false;}
   r.widthATR=(high-low)/atr[i];
  }
  bool volumeReady=i>=21&&MAVolume(c[i],mode)>0;double volumeSum=0;
  if(i>=21) for(int j=i-21;j<i;j++) {double v=MAVolume(c[j],mode);if(v<=0) volumeReady=false;volumeSum+=v;}
  if(volumeReady&&volumeSum>0) r.volumeRatio=MAVolume(c[i],mode)/(volumeSum/21);
  bool eligible=r.ready&&r.structure!=0&&r.structure==r.ribbon&&adx[i]>=20&&r.widthATR>=.25&&i-lastSwitch>=5;
  if(eligible&&r.structure!=direction) {votes=pending==r.structure?votes+1:1;pending=r.structure;}else {votes=0;pending=0;}
  if(votes>=2) {direction=r.structure;lastSwitch=i;r.switched=true;votes=0;pending=0;}
  r.direction=direction;r.votes=votes;
  r.intact=r.ready&&(direction>0?e21[i]>e55[i]&&e55[i]>e144[i]&&r.ribbon>0:e21[i]<e55[i]&&e55[i]<e144[i]&&r.ribbon<0);
  if(i>4&&direction!=0&&r.ready) {
   for(int k=1;k<=4;k++) if(direction>0?c[i-k].low<=e21[i-k]&&c[i-k].close<e13[i-k]:c[i-k].high>=e21[i-k]&&c[i-k].close>e13[i-k]) r.touched=true;
   r.reclaim=direction>0?c[i-1].close<=e13[i-1]&&c[i].close>e13[i]&&c[i].close>c[i].open:c[i-1].close>=e13[i-1]&&c[i].close<e13[i]&&c[i].close<c[i].open;
  }
  if(i>4&&direction!=0&&!r.switched&&r.intact&&r.touched&&r.reclaim&&r.volumeRatio>=1) r.pullback=direction;
  r.badge=r.volumeRatio>=1.8&&MathAbs(c[i].close-c[i].open)>=atr[i]?2:r.volumeRatio>=1.3?1:0;
  r.rank=r.badge>0?1:0;
  r.exitLong=i>=2&&r.ready&&c[i-2].close>=e13[i-2]&&c[i-1].close<e13[i-1]&&c[i].close<e13[i];
  r.exitShort=i>=2&&r.ready&&c[i-2].close<=e13[i-2]&&c[i-1].close>e13[i-1]&&c[i].close>e13[i];
  out[i]=r;
 }
 return true;
}
void MAAlign(MAFlowRow &exec[],const int seconds,const MAFlowRow &hourly[]) {
 int j=-1;
 for(int i=0;i<ArraySize(exec);i++) {
  while(j+1<ArraySize(hourly)&&hourly[j+1].time+3600<=exec[i].time+seconds) j++;
  int h=j>=0?hourly[j].direction:0;
  exec[i].hourlyAligned=exec[i].direction!=0&&h==exec[i].direction;
  exec[i].rank=exec[i].badge>0?(exec[i].hourlyAligned?2:1):0;
  exec[i].pullbackConfirmed=seconds>=900&&exec[i].pullback!=0&&exec[i].hourlyAligned;
 }
}
MAPlan MAMakePlan(const MqlRates &b,const MAFlowRow &r,const int seconds,const int bars,
                   const double costBps=7,const double minRR=1.8,const bool blocked=false) {
 MAPlan p;ZeroMemory(p);p.direction=r.direction>0?1:-1;p.entry=MARound(b.close,6);
 if(!r.ready||r.atr<=0) return p;
 double stop=p.direction>0?MathMin(r.lastLow>0?r.lastLow-r.atr*.12:b.close-r.atr,b.close-r.atr*.75):MathMax(r.lastHigh>0?r.lastHigh+r.atr*.12:b.close+r.atr,b.close+r.atr*.75);
 double risk=MathAbs(b.close-stop),cost=b.close*costBps/10000;
 if(risk<=0) risk=MathMax(b.close*.004,r.atr);
 p.valid=true;p.stop=MARound(b.close-p.direction*risk,6);p.tp1=MARound(b.close+p.direction*risk,6);p.tp2=MARound(b.close+p.direction*risk*2.2,6);p.tp3=MARound(b.close+p.direction*risk*3.2,6);
 p.risk=MARound(risk,6);p.totalCost=MARound(cost,6);p.costRiskRatio=MARound(cost/risk,6);p.netRR=MARound((risk*2.2-cost)/(risk+cost),2);
 p.costOK=p.costRiskRatio<=.22&&p.netRR>=minRR;
 p.pCandidate=bars>=220&&seconds>=900&&r.pullbackConfirmed&&r.adx>=20&&p.costOK&&!blocked;
 return p;
}
bool MAFlowSelfTest() {
 MqlRates c[];ArrayResize(c,220);
 for(int i=0;i<220;i++) {ZeroMemory(c[i]);c[i].time=(datetime)(1700000100+i*900);c[i].open=100;c[i].high=101;c[i].low=99;c[i].close=100;c[i].tick_volume=100;}
 c[218].close=98;c[218].low=97;c[219].close=97;c[219].low=96;
 MAFlowRow r[];if(!MAFlow(c,MA_NO_VOLUME,r)||!r[219].exitLong||r[219].exitShort||r[219].volumeRatio!=-1) return false;
 // Equal close is not a cross; the condition is price-only even with missing volume.
 c[218].close=100;if(!MAFlow(c,MA_NO_VOLUME,r)||r[219].exitLong) return false;
 return true;
}
#endif
