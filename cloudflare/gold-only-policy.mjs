// Operational scope only. The fixed Gold engine and ledger are unchanged.
import { timingSafeEqual } from 'node:crypto';
const STOP_KEY = 'operation:btc-stopped';
const headers = {'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
const stopped = () => Response.json({error:'ASSET_STOPPED',state:'USER_STOPPED'}, {status:410,headers});
const authorized = (request,env) => {
  const got=request.headers.get('Authorization')||'',want=`Bearer ${env.ADMIN_TOKEN}`;
  return Boolean(env.ADMIN_TOKEN&&Buffer.byteLength(got)===Buffer.byteLength(want)&&timingSafeEqual(Buffer.from(got),Buffer.from(want)));
};
export function scopeMonitor(FixedMonitor) {
  return class extends FixedMonitor {
    async stoppedStatus() {
      const record=await this.ctx.storage.get(STOP_KEY),prior=await this.ctx.storage.get('status');
      return {asset:'btc',state:'USER_STOPPED',stoppedAt:record?.stoppedAt??null,
        nextRunAt:await this.ctx.storage.getAlarm(),collectionEnabled:false,emailEnabled:false,
        demoEvaluationEnabled:false,lastSnapshotId:prior?.snapshotId??null};
    }
    async stopBtc() {
      if(await this.ctx.storage.get('asset')!=='btc')throw new Error('STOP_PARTITION_MISMATCH');
      if(!await this.ctx.storage.get(STOP_KEY))await this.ctx.storage.put(STOP_KEY,{stoppedAt:Date.now(),reason:'USER_GOLD_ONLY'});
      await this.ctx.storage.deleteAlarm();
      return this.stoppedStatus();
    }
    async start(asset) {return asset==='btc'?this.stopBtc():super.start(asset);}
    async tick(asset,dryRun=false) {return asset==='btc'?this.stopBtc():super.tick(asset,dryRun);}
    async perform(asset,dryRun) {return asset==='btc'?this.stopBtc():super.perform(asset,dryRun);}
    async alarm() {
      if(await this.ctx.storage.get('asset')==='btc')return this.stopBtc();
      return super.alarm();
    }
    async status() {
      return await this.ctx.storage.get('asset')==='btc'?this.stoppedStatus():super.status();
    }
  };
}
export async function scopedFetch(request,env,ctx,fixedWorker) {
  const url=new URL(request.url);
  if(url.pathname==='/ops/stop-btc') {
    if(!authorized(request,env))return new Response('Not found',{status:404});
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    return Response.json(await env.MONITOR.getByName('btc').stopBtc(),{headers});
  }
  if(url.searchParams.get('asset')==='btc'||url.searchParams.get('id')?.startsWith('btc-'))return stopped();
  if(request.method==='GET'&&url.pathname==='/api/monitor') {
    const gold=await env.MONITOR.getByName('gold').status(),assets={gold};
    return Response.json({updatedAt:gold.updatedAt||0,channels:env.ALERTS_ENABLED==='true'?['Email']:[],
      assets,error:gold.error||null,summary:`gold: ${gold.state}`,source:'Bybit / 1分間隔監視・15分確定足 / 画面と同一判定'},{headers});
  }
  return fixedWorker.fetch(request,env,ctx);
}
