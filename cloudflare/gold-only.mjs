import fixedWorker, { MarketMonitor as FixedMarketMonitor } from './monitor.mjs';
import { scopeMonitor, scopedFetch } from './gold-only-policy.mjs';
export class MarketMonitor extends scopeMonitor(FixedMarketMonitor) {}
export default {fetch(request,env,ctx){return scopedFetch(request,env,ctx,fixedWorker);}};
