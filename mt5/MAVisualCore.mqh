#ifndef MA_VISUAL_CORE
#define MA_VISUAL_CORE
struct MALabelBox {int left,right,top,bottom;};
bool MAZoneFrameVisible(const int seconds,const int displaySeconds,const bool allFrames) {
 return seconds>0&&displaySeconds>0&&(allFrames||seconds>=displaySeconds);
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
