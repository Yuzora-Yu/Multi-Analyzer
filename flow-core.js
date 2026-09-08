/* Causal OHLCV research features. These are disclosed hypotheses, not whale detection. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerFlow=api;})(globalThis,function(){
  'use strict';
  const PERIODS=Object.freeze([5,8,13,21,34,55,89,144]);
  const PARAMETERS=Object.freeze({adx:20,widthATR:.25,cooldown:5,votes:2,volume:1.3,strongVolume:1.8,displacementATR:1});
  function profile(candles,count=48,lookback=96){
    const c=candles.slice(-lookback);
    if(!c.length||!c.some(b=>b.volume>0))return null;
    const low=Math.min(...c.map(b=>b.low)),high=Math.max(...c.map(b=>b.high));
    const step=(high-low)/count||Math.max(low*1e-6,1e-6),bins=Array(count).fill(0);
    // Spread each candle's volume uniformly over its high-low range. This is an
    // explicit approximation, never a claim to know actual price-level trades.
    for(const b of c){
      if(!(b.volume>0))continue;
      if(b.high===b.low){bins[Math.min(count-1,Math.max(0,Math.floor((b.close-low)/step)))]+=b.volume;continue;}
      for(let i=0;i<count;i++)bins[i]+=b.volume*Math.max(0,Math.min(b.high,low+(i+1)*step)-Math.max(b.low,low+i*step))/(b.high-b.low);
    }
    const total=bins.reduce((s,x)=>s+x,0),pocIndex=bins.indexOf(Math.max(...bins));
    let left=pocIndex,right=pocIndex,area=bins[pocIndex];
    while(area<total*.7&&(left>0||right<count-1)){
      if(right<count-1&&(left===0||bins[right+1]>=bins[left-1]))area+=bins[++right];else area+=bins[--left];
    }
    return {low,high,step,total,poc:low+(pocIndex+.5)*step,val:low+left*step,vah:low+(right+1)*step,pocIndex,start:c[0].time,end:c.at(-1).time,method:'OHLCV_RANGE_APPROXIMATION',bins:bins.map((volume,i)=>({low:low+i*step,high:low+(i+1)*step,volume,valueArea:i>=left&&i<=right}))};
  }
  function analyze(c,ema,atr,adx,swings){
    const lines=Object.fromEntries(PERIODS.map(n=>[n,ema(c.map(b=>b.close),n)]));
    const highAt=new Map(swings.highs.map(s=>[s.confirmIndex,s.price])),lowAt=new Map(swings.lows.map(s=>[s.confirmIndex,s.price]));
    const highs=[],lows=[],history=[],events=[];let direction=0,lastSwitch=-Infinity,votes=0,pending=0,cvd=0;
    for(let i=0;i<c.length;i++){
      if(highAt.has(i))highs.push(highAt.get(i));if(lowAt.has(i))lows.push(lowAt.get(i));
      const b=c[i],a=atr[i],values=PERIODS.map(p=>lines[p][i]),ready=values.every(Number.isFinite)&&a>0;
      const structure=highs.length>=2&&lows.length>=2?(highs.at(-1)>highs.at(-2)&&lows.at(-1)>lows.at(-2)?1:highs.at(-1)<highs.at(-2)&&lows.at(-1)<lows.at(-2)?-1:0):0;
      const ribbon=ready?Math.sign(values[0]-values.at(-1)):0,widthATR=ready?(Math.max(...values)-Math.min(...values))/a:null;
      const prior=c.slice(Math.max(0,i-21),i),volumeReady=prior.length===21&&prior.every(x=>x.volume>0)&&b.volume>0;
      const volumeRatio=volumeReady?b.volume/(prior.reduce((s,x)=>s+x.volume,0)/21):null;
      const aligned=ready&&values.every((x,j)=>j===0||(ribbon>0?values[j-1]>x:values[j-1]<x));
      const eligible=ready&&structure!==0&&structure===ribbon&&adx[i]>=PARAMETERS.adx&&widthATR>=PARAMETERS.widthATR&&i-lastSwitch>=PARAMETERS.cooldown;
      if(eligible&&structure!==direction){votes=pending===structure?votes+1:1;pending=structure;}else{votes=0;pending=0;}
      let switched=false;
      if(votes>=PARAMETERS.votes){direction=structure;lastSwitch=i;switched=true;votes=0;pending=0;events.push({time:b.time,type:'TURN',direction});}
      let pullback=0;
      const intact=ready&&(direction>0?lines[21][i]>lines[55][i]&&lines[55][i]>lines[144][i]&&ribbon>0:lines[21][i]<lines[55][i]&&lines[55][i]<lines[144][i]&&ribbon<0);
      if(i>4&&direction!==0&&!switched&&intact){
        const touched=[1,2,3,4].some(k=>direction>0?c[i-k].low<=lines[21][i-k]&&c[i-k].close<lines[13][i-k]:c[i-k].high>=lines[21][i-k]&&c[i-k].close>lines[13][i-k]);
        const reclaim=direction>0?c[i-1].close<=lines[13][i-1]&&b.close>lines[13][i]&&b.close>b.open:c[i-1].close>=lines[13][i-1]&&b.close<lines[13][i]&&b.close<b.open;
        if(touched&&reclaim&&volumeRatio>=1)pullback=direction;
      }
      const badge=volumeRatio>=PARAMETERS.strongVolume&&Math.abs(b.close-b.open)>=a*PARAMETERS.displacementATR?'VR':volumeRatio>=PARAMETERS.volume?'V':null;
      const absorption=volumeRatio>=PARAMETERS.strongVolume&&b.high-b.low<=a*.8&&Math.abs(b.close-b.open)<=a*.25;
      const delta=Number.isFinite(b.takerBuyVolume)&&b.volume>0?2*b.takerBuyVolume-b.volume:null;
      // Never estimate aggressor delta from candle colour. Reset at missing data.
      cvd=delta==null?0:cvd+delta;
      const exitLong=i>=2&&ready&&c[i-2].close>=lines[13][i-2]&&c[i-1].close<lines[13][i-1]&&b.close<lines[13][i];
      const exitShort=i>=2&&ready&&c[i-2].close<=lines[13][i-2]&&c[i-1].close>lines[13][i-1]&&b.close>lines[13][i];
      history.push({time:b.time,direction,structure,ribbon,widthATR,aligned,switched,votes,requiredVotes:PARAMETERS.votes,volumeRatio,badge,pullback,absorption,delta,cvd:delta==null?null:cvd,exitLong,exitShort});
    }
    return {parameters:PARAMETERS,periods:PERIODS,lines,history,events,latest:history.at(-1)||null,profile:profile(c)};
  }
  // Each higher timeframe candle must already be closed at the execution close.
  function align(exec,h1,minutes){
    if(!exec?.flow||!h1?.flow)return;
    const hh=h1.flow.history;let j=-1;
    for(const row of exec.flow.history){
      while(j+1<hh.length&&hh[j+1].time+3600000<=row.time+minutes*60000)j++;
      const hourly=j>=0?hh[j].direction:0;
      row.hourlyAligned=row.direction!==0&&hourly===row.direction;
      row.rank=row.badge?(row.hourlyAligned?'S':'A'):'B';
      row.pullbackConfirmed=minutes>=15&&row.pullback!==0&&row.hourlyAligned;
    }
  }
  return {PERIODS,PARAMETERS,profile,analyze,align};
});
