// Symbol-independent helpers. No market, account, file or network access.
#ifndef MA_INSTRUMENT_CORE
#define MA_INSTRUMENT_CORE
int MAPlanDigits(const int digits) {return (int)MathMax(6,MathMin(12,digits));}
string MAFileSymbol(const string symbol) {
 string out="";
 for(int i=0;i<StringLen(symbol);i++) {
  ushort ch=StringGetCharacter(symbol,i);
  if((ch>=65&&ch<=90)||(ch>=97&&ch<=122)||(ch>=48&&ch<=57)||ch==95) out+=StringSubstr(symbol,i,1);
  else out+="~"+StringFormat("%04X",(int)ch);
 }
 return out==""?"UNKNOWN":out;
}
string MAJsonEscape(string value) {
 string out="";
 for(int i=0;i<StringLen(value);i++) {
  ushort ch=StringGetCharacter(value,i);
  if(ch<32) out+="\\u"+StringFormat("%04X",(int)ch);
  else if(ch==34||ch==92) out+="\\"+StringSubstr(value,i,1);
  else out+=StringSubstr(value,i,1);
 }
 return out;
}
double MASpreadBps(const double bid,const double ask) {
 if(!MathIsValidNumber(bid)||!MathIsValidNumber(ask)||bid<=0||ask<bid) return EMPTY_VALUE;
 return (ask-bid)/bid*10000;
}
#endif
