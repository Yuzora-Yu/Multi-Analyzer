// zone-importance-v1: observation priority only; no P/EXIT or zone-lifecycle changes.
#ifndef MA_ZONE_IMPORTANCE
#define MA_ZONE_IMPORTANCE
#include "MAFlowCore.mqh"
struct MAImportanceFact {double relativeVolume,bodyATR;int breakSide;};
struct MAZonePriority {
 bool available,partial,structure;
 int role,minutes,score,grade,visits,baselineBars,tfPoints,volPoints,bodyPoints,structurePoints,freshPoints;
 double relativeVolume,bodyATR;
 datetime formationAt,displacementAt,observedThrough;
};
int MAImportanceRole(const int minutes) {return minutes>=60?3:minutes>=15?2:1;}
string MAImportanceRoleLabel(const int role) {return role==3?"大局":role==2?"波":"短期";}
int MAImportanceTimePoints(const int m) {return m>=1440?46:m>=240?38:m>=60?28:m>=15?18:m>=5?10:4;}
void MAImportanceScore(const int minutes,MAZonePriority &q) {
 q.minutes=minutes;q.role=MAImportanceRole(minutes);q.tfPoints=MAImportanceTimePoints(minutes);
 q.volPoints=q.relativeVolume==EMPTY_VALUE?0:q.relativeVolume>=1.8?8:q.relativeVolume>=1.3?5:q.relativeVolume>=1?2:0;
 q.bodyPoints=q.bodyATR==EMPTY_VALUE?0:q.bodyATR>=1.5?5:q.bodyATR>=1?3:q.bodyATR>=.8?1:0;
 q.structurePoints=q.structure?8:0;
 q.freshPoints=q.visits==0?6:q.visits==1?3:-(int)MathMin(q.visits-1,4)*3;
 q.score=(int)MathMax(0,q.tfPoints+q.volPoints+q.bodyPoints+q.structurePoints+q.freshPoints);
 q.grade=q.score>=34?2:q.score>=18?1:0;
}
bool MAImportancePrepare(const MqlRates &c[],const MAVolumeMode mode,MAImportanceFact &out[]) {
 ArrayResize(out,0);if(!MAValid(c)) return false;
 int n=ArraySize(c);ArrayResize(out,n);double atr[];MAATR(c,atr);
 int hi=-1,lo=-1,usedHi=-1,usedLo=-1;
 for(int i=0;i<n;i++) {
  MAImportanceFact r;r.relativeVolume=EMPTY_VALUE;r.bodyATR=EMPTY_VALUE;r.breakSide=0;
  if(i>0&&atr[i-1]>0) r.bodyATR=MathAbs(c[i].close-c[i].open)/atr[i-1];
  bool volumeReady=i>=21&&MAVolume(c[i],mode)>0;double sum=0;
  if(i>=21) for(int j=i-21;j<i;j++) {double v=MAVolume(c[j],mode);if(v<=0) volumeReady=false;sum+=v;}
  if(volumeReady&&sum>0) r.relativeVolume=MAVolume(c[i],mode)/(sum/21);
  if(i>0&&hi>=0&&usedHi!=hi&&c[i-1].close<=c[hi].high&&c[i].close>c[hi].high) {r.breakSide=1;usedHi=hi;}
  if(i>0&&lo>=0&&usedLo!=lo&&c[i-1].close>=c[lo].low&&c[i].close<c[lo].low) {r.breakSide=-1;usedLo=lo;}
  int pivot=i-3;
  if(pivot>=3) {if(MAPivot(c,pivot,true)) hi=pivot;if(MAPivot(c,pivot,false)) lo=pivot;}
  out[i]=r;
 }
 return true;
}
MAZonePriority MAImportanceEvaluate(const MqlRates &c[],const MAImportanceFact &facts[],const MAZone &z) {
 MAZonePriority q;ZeroMemory(q);q.relativeVolume=EMPTY_VALUE;q.bodyATR=EMPTY_VALUE;
 int i=z.index,middle=z.kind==1?i-1:i,n=ArraySize(c);
 if(i<0||i>=n||i>=ArraySize(facts)||middle<0||(z.kind==1&&i<2)) return q;
 q.available=true;q.relativeVolume=facts[middle].relativeVolume;q.bodyATR=facts[middle].bodyATR;
 q.baselineBars=middle>=21?21:0;
 q.structure=facts[i].breakSide==z.side||(z.kind==1&&facts[middle].breakSide==z.side);
 q.visits=z.visits;q.formationAt=z.formed;q.displacementAt=c[middle].time+z.seconds;
 q.observedThrough=z.retiredAt>0?z.retiredAt:c[n-1].time+z.seconds;
 q.partial=q.relativeVolume==EMPTY_VALUE||q.bodyATR==EMPTY_VALUE;
 MAImportanceScore(z.seconds/60,q);return q;
}
bool MAMoreImportant(const MAZonePriority &q,const double distance,const MAZonePriority &other,const double otherDistance) {
 if(q.available!=other.available) return q.available;
 if(q.role!=other.role) return q.role>other.role;
 if(q.score!=other.score) return q.score>other.score;
 if(q.minutes!=other.minutes) return q.minutes>other.minutes;
 return distance<otherDistance;
}
string MAImportanceLabel(const MAZonePriority &q) {return !q.available?"未評価":MAImportanceRoleLabel(q.role)+"・"+(q.grade==2?"高":q.grade==1?"中":"補助")+(q.partial?"*":"");}
string MAImportanceText(const MAZonePriority &q,const MAVolumeMode mode) {
 if(!q.available) return "重要度 未評価";
 return "重要度 "+MAImportanceLabel(q)+" | 形成量 "+(q.relativeVolume==EMPTY_VALUE?"未取得":DoubleToString(q.relativeVolume,2)+"倍")+
  "（直前21本比・時間帯補正なし / "+MAVolumeName(mode)+"） | 形成時突破 "+(q.structure?"あり":"未確認")+
  " | 再訪 "+IntegerToString(q.visits)+"回 | 変位 "+(q.bodyATR==EMPTY_VALUE?"未評価":DoubleToString(q.bodyATR,2)+" ATR")+
  " | 大局→波→短期。同じ役割内で重要度を比較。反発確率・P・入場成立ではありません。*は一部未評価。";
}
#endif
