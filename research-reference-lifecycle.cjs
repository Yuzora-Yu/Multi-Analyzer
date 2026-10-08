/* Descriptive lifecycle counts from causally verified journals; no execution or returns. */
'use strict';
const STEP=900000;
const FROZEN=['id','scope','direction','originBarAt','plannedAtLocal','planningExchangeUpper','entryAt','expiresAt','stop','target'];
const PHASES=['pending','held','closed','no-fill','incomplete'];
const STATUS=[...PHASES,'guard-missed','unsupported'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const frozen=p=>Object.fromEntries(FROZEN.map(k=>[k,p[k]]));
function summarize(rows,{asOf}={}){
  if(!Number.isFinite(asOf))throw Error('Finite lifecycle cutoff required');
  const references=new Map(),seen=new Map(),partitions=new Map();let duplicateRows=0,unverifiedRows=0,unpublishedRows=0;
  const published=rows.filter(r=>{const valid=Number.isFinite(r.journalPublishedAt)&&r.journalPublishedAt<=asOf;if(!valid)unpublishedRows++;return valid;});
  for(const row of [...published].sort((a,b)=>a.barAt-b.barAt||String(a.id).localeCompare(String(b.id)))){
    const partition=JSON.stringify(row.identity),observationKey=partition+'/'+row.barAt;
    if(seen.has(observationKey)){if(!equal(seen.get(observationKey),row))throw Error('Conflicting lifecycle observation');duplicateRows++;continue;}
    seen.set(observationKey,row);
    if(row.eligible!==true||row.status!=='verified'){
      unverifiedRows++;
      for(const ref of references.values())if(ref.partition===partition&&['pending','held'].includes(ref.latestPosition.phase))ref.issues.push('later-journal-unverified');
      continue;
    }
    if(!row.identity||!Number.isFinite(row.barAt)||row.barAt%STEP||!row.journalSha256)throw Error('Verified lifecycle row lacks identity/bar/proof');
    partitions.set(partition,{identity:structuredClone(row.identity),lastVerifiedClosedAt:row.barAt+STEP,lastJournalPublishedAt:row.journalPublishedAt});
    const p=row.position;if(!p)continue;
    // A later journal's guard belongs to its new future decision, not this reference's saved proposal.
    const key=partition+'/'+p.id,seed=(row.events||[]).some(e=>e.type==='P-reference-planned'&&e.referenceId===p.id);
    let ref=references.get(key);
    if(!ref){
      ref={id:p.id,identity:structuredClone(row.identity),partition,original:frozen(p),originProof:{sourceId:row.id,journalSha256:row.journalSha256,publishedAt:row.journalPublishedAt,guard:row.guard===true},latestPosition:structuredClone(p),timeline:[],issues:[]};
      if(!seed||row.controls?.P!==true||p.phase!=='pending'||p.originBarAt!==row.barAt||p.plannedAtLocal>row.journalPublishedAt)ref.issues.push('original-P-proposal-not-verified');
      if(p.scope!=='research-only'||!['LONG','SHORT'].includes(p.direction)||!FROZEN.filter(k=>!['id','scope','direction'].includes(k)).every(k=>Number.isFinite(p[k]))||p.entryAt%STEP||p.stop<=0||p.target<=0||p.expiresAt<=p.entryAt)ref.issues.push('invalid-original-reference');
      references.set(key,ref);
    }else if(!equal(ref.original,frozen(p)))ref.issues.push('frozen-reference-fields-changed');
    if(!PHASES.includes(p.phase))ref.issues.push('unknown-reference-phase');
    if(p.phase==='pending'&&p.entry!==null)ref.issues.push('pending-reference-has-entry');
    if(p.entry!==null&&(!Number.isFinite(p.entry)||p.entry<=0||p.fillAssumedAt!==ref.original.entryAt||!Number.isFinite(p.fillObservedAt)||p.fillObservedAt<p.fillAssumedAt+STEP||p.fillObservedAt>row.journalPublishedAt||ref.originProof.guard!==true))ref.issues.push('hypothetical-fill-not-supported');
    if(['held','closed'].includes(p.phase)&&p.entry===null)ref.issues.push('filled-phase-without-entry');
    if(ref.timeline.length&&['closed','no-fill','incomplete'].includes(ref.latestPosition.phase)&&!equal(ref.latestPosition,p))ref.issues.push('terminal-reference-rewritten');
    ref.latestPosition=structuredClone(p);
    ref.timeline.push({sourceId:row.id,barAt:row.barAt,closedAt:row.barAt+STEP,journalSha256:row.journalSha256,publishedAt:row.journalPublishedAt,phase:p.phase,reason:p.reason??null});
  }
  const cases=[...references.values()].map(({partition,...ref})=>{
    ref.issues=[...new Set(ref.issues)];const phase=ref.latestPosition.phase;
    return {...ref,status:ref.issues.length?'unsupported':!ref.originProof.guard&&phase==='pending'?'guard-missed':phase,
      hypotheticalFillObserved:ref.issues.length===0&&ref.originProof.guard&&Number.isFinite(ref.latestPosition.entry),
      note:'Unique reference lifecycle, not an independent trade or executable LIMIT_RETEST fill. Terminal incomplete/no-fill records are retained.'};
  });
  const summary={uniqueProposals:cases.length,guardedProposals:cases.filter(c=>c.originProof.guard).length,missedProposalGuards:cases.filter(c=>!c.originProof.guard).length,
    hypotheticalFillsObserved:cases.filter(c=>c.hypotheticalFillObserved).length,statusCounts:Object.fromEntries(STATUS.map(k=>[k,cases.filter(c=>c.status===k).length])),duplicateRows,unverifiedRows,unpublishedRows,
    note:'Repeated state snapshots count once. P references and post-EXIT reversal intents are separate. These counts provide no win rate, realized P&L, statistical independence or predictive-accuracy claim.'};
  return {asOf,summary,references:cases,partitions:[...partitions.values()].map(p=>({...p,nextConsecutiveSourceClosedAt:p.lastVerifiedClosedAt+STEP,evidenceAgeMs:asOf-p.lastVerifiedClosedAt,
    note:'Latest verified evidence only; an absent later observation does not retrospectively fill or close a reference.'}))};
}
module.exports={summarize};
