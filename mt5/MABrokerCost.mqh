// broker-spread-v1: observed spread + current broker commission schedule.
// No accounts, positions, deals, orders, network requests or currency guesses.
#ifndef MA_BROKER_COST
#define MA_BROKER_COST
enum MACostMode { MA_BROKER_AUTO=0, MA_FIXED_BPS=1 };
struct MACostRecord {
 bool ready;
 double spreadPrice,commissionPrice,totalPrice,bps;
 string basis,reason;
 datetime commissionObservedAt,observedAt;
};
struct MACostMemo {datetime time;int seconds,side;double close,point;int spread;MACostRecord cost;};
int MACostMemoCompare(const MACostMemo &m,const int seconds,const datetime time,const int side) {
 if(m.seconds!=seconds) return m.seconds<seconds?-1:1;
 if(m.time!=time) return m.time<time?-1:1;
 return m.side==side?0:m.side<side?-1:1;
}
bool MACostNumber(const double v) {return MathIsValidNumber(v)&&v!=EMPTY_VALUE&&v>=0;}
MACostRecord MACostParts(const double price,const double spread,const double commission,const string basis) {
 MACostRecord c;ZeroMemory(c);c.basis=basis;c.bps=EMPTY_VALUE;c.totalPrice=EMPTY_VALUE;
 c.spreadPrice=spread;c.commissionPrice=commission;
 if(!MathIsValidNumber(price)||price<=0||!MACostNumber(spread)||!MACostNumber(commission)) {c.reason="費用の取得・解釈を待っています";return c;}
 c.totalPrice=spread+commission;c.bps=c.totalPrice/price*10000;c.ready=MACostNumber(c.bps);
 if(!c.ready) c.reason="費用値が不正です";
 return c;
}
int MACommissionLegs(const int entry,const int direction,const int side) {
 if((entry!=SYMBOL_COMMISSION_ENTRY_INOUT&&entry!=SYMBOL_COMMISSION_ENTRY_IN&&entry!=SYMBOL_COMMISSION_ENTRY_OUT)||(direction!=SYMBOL_COMMISSION_DIRECTION_BOTH&&direction!=SYMBOL_COMMISSION_DIRECTION_BUY&&direction!=SYMBOL_COMMISSION_DIRECTION_SELL)) return -1;
 int legs=0;
 if(entry!=SYMBOL_COMMISSION_ENTRY_OUT&&(direction==SYMBOL_COMMISSION_DIRECTION_BOTH||direction==(side>0?SYMBOL_COMMISSION_DIRECTION_BUY:SYMBOL_COMMISSION_DIRECTION_SELL))) legs++;
 if(entry!=SYMBOL_COMMISSION_ENTRY_IN&&(direction==SYMBOL_COMMISSION_DIRECTION_BOTH||direction==(side>0?SYMBOL_COMMISSION_DIRECTION_SELL:SYMBOL_COMMISSION_DIRECTION_BUY))) legs++;
 return legs;
}
double MACommissionTierPrice(const MqlCommissionTier &t,const string ruleCurrency,const double price,const double point,const double contract,const string base,const string profit,const bool linear) {
 if(t.mode==SYMBOL_COMMISSION_DISABLED) return 0;
 if(!MathIsValidNumber(t.min_value)||!MathIsValidNumber(t.max_value)||!MathIsValidNumber(t.range_from)||!MathIsValidNumber(t.range_to)||t.min_value<0||t.max_value<0||t.range_from<0||t.range_to<0) return EMPTY_VALUE;
 if(!MACostNumber(t.value)||t.min_value!=0||(t.max_value!=0&&t.max_value<DBL_MAX)||t.range_from!=0||(t.range_to!=0&&t.range_to<DBL_MAX)) return EMPTY_VALUE;
 if(t.value==0) return 0;
 // No lot-size or rolling-turnover assumption for nonlinear/tiered fees.
 if(t.mode==SYMBOL_COMMISSION_PERCENT&&t.volume_type==SYMBOL_COMMISSION_VOLUME_TYPE_TURNOVER) return price*t.value/100;
 if(t.volume_type!=SYMBOL_COMMISSION_VOLUME_TYPE_VOLUME) return EMPTY_VALUE;
 if(t.mode==SYMBOL_COMMISSION_PIPS) return point>0?t.value*point:EMPTY_VALUE;
 if(!linear||contract<=0) return EMPTY_VALUE;
 if(t.mode==SYMBOL_COMMISSION_MONEY_SYMBOL_PROFIT) return t.value/contract;
 if(t.mode==SYMBOL_COMMISSION_MONEY_SYMBOL_BASE) return t.value*price/contract;
 if(t.mode==SYMBOL_COMMISSION_MONEY_SPECIFIED) {
  string currency=t.currency!=""?t.currency:ruleCurrency;
  if(currency!=""&&currency==profit) return t.value/contract;
  if(currency!=""&&currency==base) return t.value*price/contract;
 }
 // Deposit-currency, cross-currency and profit-dependent fees are not guessed.
 return EMPTY_VALUE;
}
MACostRecord MABrokerRecord(const double price,const double spread,const int side,const int count,const MqlCommission &rules[],const double point,const double contract,const string base,const string profit,const bool linear) {
 if(count<0||count!=ArraySize(rules)) {MACostRecord c=MACostParts(price,spread,EMPTY_VALUE,"BROKER_COMMISSION_UNAVAILABLE");c.reason="業者の手数料規則を取得できずP保留";return c;}
 double total=0;
 for(int i=0;i<count;i++) {
  int legs=MACommissionLegs((int)rules[i].mode_entry,(int)rules[i].mode_direction,side);
  if(legs<0) {MACostRecord c=MACostParts(price,spread,EMPTY_VALUE,"BROKER_COMMISSION_UNSUPPORTED");c.reason="手数料の方向・課金時点を解釈できずP保留";return c;}
  if(legs==0) continue;
  if(rules[i].mode_charge!=SYMBOL_COMMISSION_CHARGE_INSTANT||rules[i].mode_profit!=SYMBOL_COMMISSION_PROFIT_ALL||ArraySize(rules[i].tiers)!=1) {
   MACostRecord c=MACostParts(price,spread,EMPTY_VALUE,"BROKER_COMMISSION_UNSUPPORTED");c.reason="段階・期間集計・条件付き手数料のためP保留";return c;
  }
  double fee=MACommissionTierPrice(rules[i].tiers[0],rules[i].currency,price,point,contract,base,profit,linear);
  if(!MACostNumber(fee)) {MACostRecord c=MACostParts(price,spread,EMPTY_VALUE,"BROKER_COMMISSION_UNSUPPORTED");c.reason="手数料の通貨・数量条件を換算できずP保留";return c;}
  total+=fee*legs;
 }
 return MACostParts(price,spread,total,count==0?"BROKER_SPREAD_NO_COMMISSION_RULES_REPORTED":"BROKER_SPREAD_AND_COMMISSION_RULES");
}
bool MALinearProfitMode(const long mode) {
 return mode==SYMBOL_CALC_MODE_FOREX||mode==SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE||mode==SYMBOL_CALC_MODE_CFD||mode==SYMBOL_CALC_MODE_CFDLEVERAGE||mode==SYMBOL_CALC_MODE_EXCH_STOCKS;
}
#endif
