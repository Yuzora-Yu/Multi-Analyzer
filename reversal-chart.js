/* Visual projection only; no extra market requests, price-scale expansion or pointer handlers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerReversalChart=api;})(globalThis,function(){
  'use strict';
  function visibleBands(context){
    if(!context?.available)return [];
    return ['LONG','SHORT'].flatMap(d=>(context.candidates||[]).filter(c=>c.direction===d&&!c.withdrawnAt&&!c.filledAt&&Number.isFinite(c.formedAt)&&c.low>0&&c.high>c.low).slice(0,3));
  }
  function draw(canvas,chart,series,candles,context,visible=true){
    if(!canvas)return;
    const width=canvas.parentElement.clientWidth,height=canvas.parentElement.clientHeight,dpr=globalThis.devicePixelRatio||1;
    canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.width=width+'px';canvas.style.height=height+'px';
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
    if(!visible||!chart||!series||!candles?.length)return;
    const right=Math.max(0,width-74),bottom=Math.max(0,height-30),labels=[];
    ctx.save();ctx.beginPath();ctx.rect(0,0,right,bottom);ctx.clip();
    for(const z of visibleBands(context)){
      // Paint only from the confirmation boundary, never back to the origin candle.
      const first=candles.find(b=>b.time>=z.formedAt);if(!first)continue;
      const x=chart.timeScale().timeToCoordinate(Math.floor(first.time/1000)),top=series.priceToCoordinate(z.high),low=series.priceToCoordinate(z.low);
      if(x==null||top==null||low==null||![x,top,low].every(Number.isFinite)||x>=right||low<0||top>bottom)continue;
      const left=Math.max(0,x),long=z.direction==='LONG',color=long?'#5bc4ee':'#ed985a';
      ctx.fillStyle=long?'rgba(65,165,220,.13)':'rgba(235,140,65,.13)';ctx.fillRect(left,top,right-left,Math.max(1,low-top));
      ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash(z.kind==='SWEEP'?[5,4]:[2,3]);
      for(const y of [top,low]){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();}ctx.setLineDash([]);
      const text=`${long?'買反転':'売反転'} ${z.frame} ${z.kind==='SWEEP'?'掃い':z.kind} ${z.low.toFixed(2)}–${z.high.toFixed(2)}`;
      ctx.font='10px sans-serif';let y=Math.max(13,Math.min(bottom-3,top-3));while(labels.some(t=>Math.abs(t-y)<15)&&y+15<bottom)y+=15;labels.push(y);
      const w=Math.min(right-4,ctx.measureText(text).width+8);if(w<=20)continue;
      // A recent band may begin at the right edge; keep its current annotation
      // readable while the price rectangle still starts only after confirmation.
      const labelX=Math.max(2,Math.min(left+2,right-w-2));
      ctx.fillStyle='#0b141ef0';ctx.fillRect(labelX,y-11,w,14);ctx.fillStyle=color;ctx.fillText(text,labelX+3,y,Math.max(0,w-6));
    }
    ctx.restore();
  }
  return {visibleBands,draw};
});
