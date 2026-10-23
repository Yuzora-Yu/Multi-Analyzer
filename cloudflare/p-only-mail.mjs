// Delivery policy only. Never edit the fixed analyzer, snapshot, demo ledger or history.
import Core from '../strategy-core.js';
import Events from '../alert-event.js';
import Feed from '../market-feed.js';
const KEY='operation:p-only-email-v1';
const NOTE='Bybit XAUUSDT無期限先物の15分確定足による研究条件です。XMのGOLD/USDとは価格・契約条件が異なります。P成立は利益・約定の保証ではありません。実際の保有や注文は取得していません。';
const escapeHtml=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function pMailEvent(analysis,snapshot,now) {
 const bar=analysis?.exec?.candles?.at(-1)?.time;
 if(snapshot?.asset!=='gold'||snapshot.version!==Core.VERSION||snapshot.settings?.executionMinutes!==15||analysis?.entryModel!=='pullback-v1'||
    analysis.actionable!==true||!['LONG','SHORT'].includes(analysis.direction)||!Number.isFinite(bar)||
    bar+900000>now||now-bar-900000>1200000||!Events.alertPolicy('gold',now,bar).allowed||!Feed.collectionPolicy('gold',now).allowed) return null;
 // Reuse the fixed entry formatter, bypassing its old zone/EXIT notification branches only.
 const event=Events.eventFor({...analysis,marketMap:null,positionDecision:null},'gold',null,
  {now,symbol:'XAUUSDT',snapshot:snapshot.id,version:snapshot.version,note:NOTE});
 if(event?.kind!=='ENTRY') return null;
 return {...event,key:`gold:P:${analysis.direction}:${bar}`,kind:'P',
  title:`Multi-Analyzer｜Gold｜P ${analysis.direction==='LONG'?'買い':'売り'}条件成立（15分確定）`};
}
export function pOnlyMonitor(FixedMonitor,{analyze=s=>Core.analyzeMarket(Feed.input(s),s.settings),clock=()=>Date.now()}={}) {
 return class extends FixedMonitor {
  constructor(ctx,env) {
   // All legacy zone/EXIT sends are disabled, including through inherited alarm/tick paths.
   super(ctx,{...env,ALERTS_ENABLED:'false'});this.pDeliveryEnv=env;
  }
  async pMailStatus(status) {
   const record=await this.ctx.storage.get(KEY),now=clock();
   return {...status,notificationMode:'P_ONLY',mailPolicyVersion:'p-only-v1',
    emailEnabled:this.pDeliveryEnv.ALERTS_ENABLED==='true'&&Events.alertPolicy('gold',now).allowed&&Feed.collectionPolicy('gold',now).allowed,
    ...(record?.lastEmail?{lastEmail:record.lastEmail}:{}),deliveryError:record?.error||null};
  }
  async status() {return this.pMailStatus(await super.status());}
  async perform(asset,dryRun=false) {
   const status=await super.perform(asset,dryRun);
   if(asset!=='gold'||dryRun||status.error||status.state==='MARKET_CLOSED') return this.pMailStatus(status);
   const snapshot=await this.ctx.storage.get('snapshot');
   if(!snapshot||snapshot.id!==status.snapshotId) return this.pMailStatus(status);
   const analysis=analyze(snapshot),event=pMailEvent(analysis,snapshot,clock());
   let record=await this.ctx.storage.get(KEY);
   if(!record) {
    // Establish a baseline on deployment: do not mail a P already present before this policy started.
    record={version:'p-only-v1',startedAt:clock(),delivered:event?{[event.key]:clock()}:{},lastEmail:null,error:null};
    await this.ctx.storage.put(KEY,record);return this.pMailStatus(status);
   }
   if(!event||record.delivered[event.key]||this.pDeliveryEnv.ALERTS_ENABLED!=='true') return this.pMailStatus(status);
   const sendNow=clock();
   if(!pMailEvent(analysis,snapshot,sendNow)) return this.pMailStatus(status);
   try {
    await this.ctx.storage.put('alert:'+snapshot.id,snapshot);
    const state=await this.ctx.storage.get('state');
    if(state){state.alertIds=state.alertIds||[];if(!state.alertIds.includes(snapshot.id))state.alertIds.push(snapshot.id);
     while(state.alertIds.length>100)await this.ctx.storage.delete('alert:'+state.alertIds.shift());await this.ctx.storage.put('state',state);}
    // Recheck after storage work; do not send across a closure/weekend boundary.
    const acceptedAt=clock();if(!pMailEvent(analysis,snapshot,acceptedAt)) return this.pMailStatus(status);
    await this.pDeliveryEnv.EMAIL.send({from:'alerts@yu-zora.com',to:this.pDeliveryEnv.EMAIL_TO,subject:event.title,text:event.text,
     html:'<div style="white-space:pre-wrap">'+escapeHtml(event.text)+'</div><p><a href="'+event.url+'">公開チャートを開く</a></p>'});
    record.delivered[event.key]=acceptedAt;record.delivered=Object.fromEntries(Object.entries(record.delivered).sort((a,b)=>b[1]-a[1]).slice(0,200));
    record.lastEmail={acceptedAt,asset:'gold',snapshotId:snapshot.id,title:event.title,kind:'P'};record.error=null;
   } catch {record.error='P_EMAIL_DELIVERY_ERROR';}
   await this.ctx.storage.put(KEY,record);return this.pMailStatus(status);
  }
 };
}
