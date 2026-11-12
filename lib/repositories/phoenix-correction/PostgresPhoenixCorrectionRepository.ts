import 'server-only';
import {and,asc,eq,inArray,sql} from 'drizzle-orm';
import {db} from '@/lib/db';
import {tournaments,results,tournamentLateRegistration,appSettings,players,registrations,playerAchievements} from '@/lib/db/schema';
import {ACHIEVEMENTS_CATALOG,ACHIEVEMENT_METRIC} from '@/config/achievements';
import {runAchievementEngine} from '@/lib/achievement-engine';
import {PHOENIX_ID,PHOENIX_CORRECTION_KEY,PHOENIX_OWNER_CONFIRMATION,PHOENIX_APPROVED_REVISION,phoenixRevision,planPhoenixCorrection} from '@/lib/phoenix-correction';
type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export type PhoenixCorrectionActor={kind:'admin';playerId:string}|{kind:'owner-release';confirmation:string};
export class PostgresPhoenixCorrectionRepository {
 constructor(private approvedRevision=PHOENIX_APPROVED_REVISION){}
 private available(){if(process.env.DATABASE_PROVIDER!=='postgres')throw Error('PHOENIX requires PostgreSQL');}
 private async authorize(tx:Tx,actor:PhoenixCorrectionActor,lock=false){
  if(actor.kind==='owner-release'){if(actor.confirmation!==PHOENIX_OWNER_CONFIRMATION)throw Error('PHOENIX owner authorization required');return;}
  const query=tx.select({role:players.role,blocked:players.isBlocked,merged:players.mergedIntoPlayerId}).from(players).where(eq(players.id,actor.playerId));const [p]=await(lock?query.for('share'):query);
  if(!p||p.role!=='admin'||p.blocked||p.merged)throw Error('PHOENIX admin authorization required');
 }
 private async state(tx:Tx,lockedTournament?:typeof tournaments.$inferSelect){const [t]=lockedTournament?[lockedTournament]:await tx.select().from(tournaments).where(eq(tournaments.id,PHOENIX_ID));if(!t)throw Error('PHOENIX missing');const [snapshot]=await tx.select().from(tournamentLateRegistration).where(eq(tournamentLateRegistration.tournamentId,PHOENIX_ID));const rs=await tx.select().from(results).where(eq(results.tournamentId,PHOENIX_ID)).orderBy(asc(results.place));return {tournament:t,results:rs,snapshot:snapshot??null};}
 async preview(actor:PhoenixCorrectionActor){this.available();return db.transaction(async tx=>{await this.authorize(tx,actor);const before=await this.state(tx);const [audit]=await tx.select().from(appSettings).where(eq(appSettings.key,PHOENIX_CORRECTION_KEY));if(audit){const a=audit.value as {baselineRevision:string;afterRevision:string};if(a.baselineRevision!==this.approvedRevision||a.afterRevision!==phoenixRevision(before))throw Error('PHOENIX partial/stale corrected state');return {status:'already_applied' as const,revision:a.afterRevision,before};}const plan=planPhoenixCorrection(before);if(this.approvedRevision!=='UNSET'&&plan.revision!==this.approvedRevision)throw Error('PHOENIX stale approved baseline');return {status:'preview' as const,...plan,before};},{isolationLevel:'repeatable read',accessMode:'read only'});}
 async apply(actor:PhoenixCorrectionActor,revision:string){this.available();return db.transaction(async tx=>{
  // FIRST statement and serialization point; all ordinary edits/close share it.
  const [t]=await tx.select().from(tournaments).where(eq(tournaments.id,PHOENIX_ID)).for('update');if(!t)throw Error('PHOENIX missing');
  await this.authorize(tx,actor,true);
  const [audit]=await tx.select().from(appSettings).where(eq(appSettings.key,PHOENIX_CORRECTION_KEY)).for('update');
  const before=await this.state(tx,t);const currentRevision=phoenixRevision(before);
  if(revision!==this.approvedRevision)throw Error('PHOENIX unapproved revision');
  if(audit){const a=audit.value as {baselineRevision:string;afterRevision:string};if(a.baselineRevision===revision&&a.afterRevision===currentRevision)return {status:'no-op' as const,revision:currentRevision};throw Error('PHOENIX partial/stale corrected state');}
  if(currentRevision!==revision)throw Error('PHOENIX stale baseline');const plan=planPhoenixCorrection(before);
  const registrationBefore=await tx.select().from(registrations).where(eq(registrations.tournamentId,PHOENIX_ID)).orderBy(asc(registrations.id));
  const ids=before.results.filter((r,i)=>plan.afterResults[i].ratingPoints!==r.ratingPoints).map(r=>r.playerId);
  const definitions=ACHIEVEMENTS_CATALOG.filter(d=>'metric' in d && d.metric===ACHIEVEMENT_METRIC.RATING_POINTS);const codes=definitions.map(d=>d.code);
  const achievementBefore=await tx.select().from(playerAchievements).where(and(inArray(playerAchievements.playerId,ids),inArray(playerAchievements.achievementCode,codes))).orderBy(asc(playerAchievements.id)).for('update');
  await tx.update(tournaments).set({placementPointsMultiplier:1.5,ratingGuarantee:null,description:plan.afterTournament.description as string}).where(eq(tournaments.id,PHOENIX_ID));
  await tx.update(tournamentLateRegistration).set({ratingPlaces:plan.afterPlaces}).where(eq(tournamentLateRegistration.tournamentId,PHOENIX_ID));
  for(const r of plan.afterResults){const old=before.results.find(x=>x.id===r.id)!;if(old.ratingPoints===r.ratingPoints)continue;await tx.update(results).set({itmPoints:r.itmPoints,ratingPoints:r.ratingPoints}).where(and(eq(results.id,String(r.id)),eq(results.tournamentId,PHOENIX_ID)));}
  // Only genuinely persisted rating-metric rows need refresh. No other
  // achievement metric, grant, automatic flag or public activity is modified.
  for(const id of ids){const [total]=await tx.select({n:sql<number>`coalesce(sum(${results.ratingPoints}),0)`.mapWith(Number)}).from(results).where(eq(results.playerId,id));const progress=runAchievementEngine(definitions,{rating_points:total.n});for(const old of achievementBefore.filter(x=>x.playerId===id)){const p=progress.find(p=>p.code===old.achievementCode)!;await tx.update(playerAchievements).set({currentValue:p.currentValue,completedAt:old.completedAt??(p.completed?new Date():null)}).where(eq(playerAchievements.id,old.id));}}
  const after=await this.state(tx);const expected={tournament:plan.afterTournament,results:plan.afterResults,snapshot:{...before.snapshot!,ratingPlaces:plan.afterPlaces}};
  if(phoenixRevision(after)!==phoenixRevision(expected))throw Error('PHOENIX post-write invariant mismatch');
  const registrationAfter=await tx.select().from(registrations).where(eq(registrations.tournamentId,PHOENIX_ID)).orderBy(asc(registrations.id));if(phoenixRevision(registrationBefore)!==phoenixRevision(registrationAfter))throw Error('PHOENIX finance/registration drift');
  await tx.insert(appSettings).values({key:PHOENIX_CORRECTION_KEY,value:{version:1,target:PHOENIX_ID,actor,baselineRevision:revision,afterRevision:phoenixRevision(after),before,registrationBefore,achievementBefore,changedResultIds:before.results.filter(r=>ids.includes(r.playerId)).map(r=>r.id),appliedAt:new Date().toISOString()}});
  return {status:'applied' as const,revision:phoenixRevision(after),beforePool:809,afterPool:1182,changedPlayers:11};
 });}
}
