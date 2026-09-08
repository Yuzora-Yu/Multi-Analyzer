/* Price-coordinate overlay, redrawn on viewport changes. No signal calculations. */
window.MultiAnalyzerOverlay={
  draw(canvas,chart,series,candles,flow){
    if(!flow||!candles.length)return;
    const width=canvas.parentElement.clientWidth,height=canvas.parentElement.clientHeight,dpr=devicePixelRatio||1;
    canvas.width=width*dpr;canvas.height=height*dpr;canvas.style.width=width+'px';canvas.style.height=height+'px';
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
    const right=width-72,bottom=height-30;
    ctx.save();ctx.beginPath();ctx.rect(0,0,right,bottom);ctx.clip();
    const x=t=>chart.timeScale().timeToCoordinate(Math.floor(t/1000)),y=p=>series.priceToCoordinate(p);
    const periods=flow.periods;
    for(let i=Math.max(144,candles.length-150);i<candles.length;i++){
      const xx=x(candles[i].time),prev=x(candles[i-1].time);if(xx==null||prev==null)continue;
      const direction=flow.history[i]?.ribbon||0;
      for(let k=0;k<periods.length-1;k++){
        const a=flow.lines[periods[k]],b=flow.lines[periods[k+1]];
        const points=[[prev,y(a[i-1])],[xx,y(a[i])],[xx,y(b[i])],[prev,y(b[i-1])]];
        if(points.some(p=>p[1]==null))continue;
        ctx.beginPath();points.forEach((p,j)=>j?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();
        ctx.fillStyle=direction>0?'rgba(40,220,160,.25)':direction<0?'rgba(255,85,110,.26)':'rgba(240,190,70,.25)';ctx.fill();
        ctx.strokeStyle=direction>0?'#40d9a777':'#ff667777';ctx.lineWidth=.6;ctx.beginPath();ctx.moveTo(...points[0]);ctx.lineTo(...points[1]);ctx.stroke();
      }
    }
    const p=flow.profile;
    if(p){
      const max=Math.max(...p.bins.map(b=>b.volume)),span=Math.min(145,width*.22);
      p.bins.forEach((b,i)=>{const top=y(b.high),bot=y(b.low);if(top==null||bot==null)return;const w=max?span*b.volume/max:0;
        ctx.fillStyle=i===p.pocIndex?'#ffcd46dd':b.valueArea?'#92a9bd77':'#61708266';
        ctx.fillRect(right-w,top,w,Math.max(1,bot-top-1));
      });
      for(const [label,price] of [['POC',p.poc],['VAH',p.vah],['VAL',p.val]]){
        const yy=y(price);if(yy==null||yy<12||yy>bottom)continue;
        ctx.strokeStyle=label==='POC'?'#ffcd46':'#9bb7cb';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(right-span,yy);ctx.lineTo(right,yy);ctx.stroke();ctx.setLineDash([]);
        ctx.font='10px sans-serif';ctx.fillStyle='#0c1117ee';ctx.fillRect(right-span,yy-13,87,12);ctx.fillStyle=label==='POC'?'#ffcd46':'#afc9d9';ctx.fillText(label+' '+price.toFixed(2),right-span+2,yy-3);
      }
    }
    ctx.restore();
  }
};
