#ifndef MA_VISUAL_CORE
#define MA_VISUAL_CORE
struct MALabelBox {int left,right,top,bottom;};
bool MAZoneFrameVisible(const int seconds,const int displaySeconds,const bool allFrames) {
 return seconds>0&&displaySeconds>0&&(allFrames||seconds>=displaySeconds);
}
// Display eligibility is not source withdrawal. Old active OB/FVG remain candidates.
bool MAActiveZoneEligible(const bool active,const int kind,const int age,const int maxAge) {
 return active&&age>=0&&maxAge>=0&&(kind==0||kind==1||(kind==2&&age<=maxAge));
}
// One nearby, on-screen OB and FVG per higher frame and side. Separate slots keep
// an off-screen OB from hiding its adjacent FVG; ranges are never merged.
void MAContextZoneSelection(const int &seconds[],const int &kinds[],const int &sides[],const double &lows[],const double &highs[],const datetime &formed[],const double price,const double bottom,const double top,int &selected[]) {
 ArrayResize(selected,0);
 int n=ArraySize(seconds);
 if(ArraySize(kinds)!=n||ArraySize(sides)!=n||ArraySize(lows)!=n||ArraySize(highs)!=n||ArraySize(formed)!=n) return;
 if(!MathIsValidNumber(price)||!MathIsValidNumber(bottom)||!MathIsValidNumber(top)||price<=0||bottom<=0||top<=bottom) return;
 for(int i=0;i<n;i++) {
  if(seconds[i]<3600||(kinds[i]!=0&&kinds[i]!=1)||(sides[i]!=-1&&sides[i]!=1)) continue;
  if(!MathIsValidNumber(lows[i])||!MathIsValidNumber(highs[i])||lows[i]<=0||highs[i]<=lows[i]||highs[i]<bottom||lows[i]>top) continue;
  int slot=-1;
  for(int j=0;j<ArraySize(selected);j++) {
   int k=selected[j];
   if(seconds[k]==seconds[i]&&kinds[k]==kinds[i]&&sides[k]==sides[i]) {slot=j;break;}
  }
  if(slot<0) {int size=ArraySize(selected);ArrayResize(selected,size+1);selected[size]=i;continue;}
  int k=selected[slot];
  double distance=MathMax(lows[i]-price,MathMax(price-highs[i],0));
  double priorDistance=MathMax(lows[k]-price,MathMax(price-highs[k],0));
  if(distance<priorDistance||(distance==priorDistance&&formed[i]>formed[k])) selected[slot]=i;
 }
}
bool MALabelFits(const int left,const int top,const int w,const int h,const int width,const int height,const int minTop,const MALabelBox &boxes[]) {
 if(left<4||top<minTop||w<=0||h<=0||left+w>width||top+h>height) return false;
 for(int i=0;i<ArraySize(boxes);i++)
  if(left<boxes[i].right+5&&left+w>boxes[i].left-5&&top<boxes[i].bottom+3&&top+h>boxes[i].top-3) return false;
 return true;
}
// DRAW_FILLING must use zero/zero at missing bars: EMPTY_VALUE joins gaps.
void MACloudPair(const double a,const double b,const int side,double &first,double &second) {
 first=0;second=0;
 if(side==0||a==EMPTY_VALUE||b==EMPTY_VALUE||!MathIsValidNumber(a)||!MathIsValidNumber(b)) return;
 first=side>0?MathMax(a,b):MathMin(a,b);second=side>0?MathMin(a,b):MathMax(a,b);
}
bool MAExitRange(const double adx,const double fast,const double slow,const double atr) {
 return atr>0&&(adx<20||MathAbs(fast-slow)<atr*.15);
}
bool MAExitGroupable(const int first,const int last,const int index,const double firstPrice,const double price,const double atr) {
 return index-first<=12&&index-last<=8&&atr>0&&MathAbs(firstPrice-price)<=atr;
}
// Presentation only: age is measured from retirement, never from formation.
bool MARetiredEligible(const bool active,const double low,const double high,const datetime formed,const datetime retired,const datetime asof,const int seconds,const int maxAge) {
 return !active&&MathIsValidNumber(low)&&MathIsValidNumber(high)&&low>0&&high>low&&
  formed>0&&retired>formed&&retired<=asof&&seconds>0&&maxAge>=0&&
  (double)(asof-retired)/(double)seconds<=maxAge;
}
#endif
