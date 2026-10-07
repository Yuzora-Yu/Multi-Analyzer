// Public candle responses only. Never retain URLs, response text or retMsg.
export const DIAGNOSTICS_VERSION='bybit-response-v1';
class MarketResponseError extends Error {
  constructor(code,diagnostic){super(code);this.name='MarketResponseError';this.diagnostic=diagnostic;}
}
export async function fetchBybitCandles(url,get,{asset,interval}){
  const startedAt=Date.now();
  const context={version:DIAGNOSTICS_VERSION,asset:['gold','btc'].includes(asset)?asset:null,interval:[15,60,240].includes(interval)?interval:null,startedAt};
  const fail=(kind,fields={})=>{throw new MarketResponseError(kind,{...context,kind,finishedAt:Date.now(),...fields});};
  let response;
  try{response=await get(url);}catch(error){fail(error?.name==='TimeoutError'?'TIMEOUT':error?.name==='AbortError'?'ABORTED':'NETWORK_ERROR');}
  const httpStatus=Number.isInteger(response.status)?response.status:null;
  if(!response.ok)fail('HTTP_ERROR',{httpStatus});
  if(!response.body)fail('EMPTY_BODY',{httpStatus});
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>500000){try{await reader.cancel();}catch{}fail('BODY_TOO_LARGE',{httpStatus});}chunks.push(value);
    }
  }catch(error){if(error instanceof MarketResponseError)throw error;fail('BODY_READ_ERROR',{httpStatus});}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let raw;
  try{raw=JSON.parse(new TextDecoder().decode(bytes));}catch{fail('INVALID_JSON',{httpStatus});}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Number.isInteger(raw.retCode)||Math.abs(raw.retCode)>2147483647)fail('INVALID_ENVELOPE',{httpStatus});
  if(raw.retCode!==0)fail('BYBIT_RET_CODE',{httpStatus,bybitCode:raw.retCode});
  if(!Array.isArray(raw.result?.list))fail('MISSING_CANDLE_LIST',{httpStatus,bybitCode:0});
  return raw;
}
export function responseDiagnostic(error){
  return error instanceof MarketResponseError?error.diagnostic:null;
}
