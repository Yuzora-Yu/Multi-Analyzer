import fixedWorker, { MarketMonitor as FixedMarketMonitor } from './monitor.mjs';
import { scopeMonitor, scopedFetch } from './gold-only-policy.mjs';
import { pOnlyMonitor } from './p-only-mail.mjs';
export class MarketMonitor extends scopeMonitor(pOnlyMonitor(FixedMarketMonitor)) {}
export default {fetch(request,env,ctx){return scopedFetch(request,env,ctx,fixedWorker);}};
