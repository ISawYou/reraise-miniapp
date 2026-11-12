import {createHash} from 'node:crypto';
import {applyPlacementPointsMultiplier,calculateRatingPointsV2} from '@/features/rating-v2';
export const PHOENIX_ID='5ed13107-c1fa-4b7b-8e6f-48cb38006aa2';
export const PHOENIX_CORRECTION_KEY='historical_correction:phoenix:20261111:placement150:v1';
export const PHOENIX_OWNER_CONFIRMATION='APPLY-PHOENIX-20261111-PLACEMENT150';
export const PHOENIX_APPROVED_REVISION='6263ed0df65c213f178367801b94010d36164c007813e7ce59bc208be981142b';
export const PHOENIX_TARGET_DESCRIPTION='PHOENIX — премиальный рейтинговый турнир РЕРЕЙЗ.\n\nВход — 1 500 ₽. Стартовый стек — 50 000 фишек. Допускается один Re-entry за 1 500 ₽ со стеком 50 000 фишек. Без Add-on и бесплатных входов.\n\nПовышенный рейтинг ×1,5: очки за места в рейтинговой зоне начисляются с коэффициентом 1,5. Стандартные 2 очка за участие остаются неизменными.\n\n11 ноября — четвёртая квалификация проекта «Путь в Калининград».';
export function canonicalJson(value:unknown):string {const normalized=JSON.parse(JSON.stringify(value));const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;return JSON.stringify(sort(normalized));}
export function phoenixRevision(value:unknown){return createHash('sha256').update(canonicalJson(value)).digest('hex');}
export function planPhoenixCorrection(state: {tournament:Record<string,unknown>;results:Record<string,unknown>[];snapshot:Record<string,unknown>|null}) {
 const t=state.tournament,s=state.snapshot,rows=state.results;
 const reject=(message:string):never=>{throw new Error('PHOENIX STOP: '+message);};
 if(t.id!==PHOENIX_ID||t.status!=='completed'||t.tournamentType!=='phoenix'||t.ratingFormulaVersion!=='v2'||new Date(t.startAt as string).toISOString()!=='2026-11-11T16:00:00.000Z'||t.isFinal||t.ratingGuarantee!==null||Number(t.placementPointsMultiplier)!==1||t.startingStack!==50000)reject('identity/configuration drift');
 if(!s||s.tournamentId!==PHOENIX_ID||s.arrivedPlayersCount!==35||s.initialStacksCount!==35||s.totalEntriesCount!==49||s.rebuysCount!==14||s.addonsCount!==0||s.ratingGuarantee!==null||s.ratingFormulaVersion!=='v2'||s.tournamentType!=='phoenix')reject('frozen volume drift');
 if(rows.length!==35||new Set(rows.map(r=>r.id)).size!==35||new Set(rows.map(r=>r.playerId)).size!==35||new Set(rows.map(r=>r.place)).size!==35||rows.some((r,i)=>r.place!==i+1||r.arrived!==true||r.addons!==0||r.freeReentries!==0||Number(r.reentries)<1||Number(r.reentries)>2||r.knockouts!==0||r.bossKnockouts!==0||r.mysteryBountyPoints!==0||r.participationPoints!==2||r.knockoutPoints!==0||r.bossBountyPoints!==0))reject('frozen result facts drift');
 if(rows.reduce((sum,r)=>sum+Number(r.reentries),0)!==49)reject('entries drift');
 const natural=calculateRatingPointsV2(rows.map(r=>({player_id:String(r.playerId),place:Number(r.place),arrived:true,entries:Number(r.reentries),addons:0,knockouts:0})),'phoenix',{ratingGuarantee:null,placementPointsMultiplier:1});
 const naturalPlaces=natural.results.filter(r=>r.itm_points>0).map((r,i)=>({place:i+1,points:r.itm_points}));
 if(canonicalJson(s!.ratingPlaces)!==canonicalJson(naturalPlaces)||naturalPlaces.length!==11||rows.some(r=>{const n=natural.results.find(n=>n.player_id===r.playerId)!;return n.rating_points!==r.ratingPoints||n.itm_points!==r.itmPoints;})||rows.reduce((sum,r)=>sum+Number(r.ratingPoints),0)!==809||rows[0].ratingPoints!==192)reject('natural baseline mismatch');
 const after: (Record<string,unknown>&{itmPoints:number;ratingPoints:number})[]=rows.map(r=>({...r,itmPoints:applyPlacementPointsMultiplier(Number(r.itmPoints),1.5),ratingPoints:2+applyPlacementPointsMultiplier(Number(r.itmPoints),1.5)}));
 const expected=calculateRatingPointsV2(rows.map(r=>({player_id:String(r.playerId),place:Number(r.place),arrived:true,entries:Number(r.reentries),addons:0,knockouts:0})),'phoenix',{ratingGuarantee:null,placementPointsMultiplier:1.5});
 if(after.some(r=>expected.results.find(n=>n.player_id===r.playerId)?.rating_points!==r.ratingPoints)||after.reduce((sum,r)=>sum+r.ratingPoints,0)!==1182||after[0].ratingPoints!==287||after.filter((r,i)=>r.ratingPoints!==rows[i].ratingPoints).length!==11)reject('expected1182/287 invariants');
 return {revision:phoenixRevision(state),beforePool:809,afterPool:1182,delta:373,afterResults:after,afterPlaces:after.slice(0,11).map(r=>({place:Number(r.place),points:r.itmPoints})),afterTournament:{...t,placementPointsMultiplier:1.5,ratingGuarantee:null,description:PHOENIX_TARGET_DESCRIPTION}};
}
