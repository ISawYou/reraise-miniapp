import "server-only";
import {createHash} from "node:crypto";
import {and,eq,gt,lt,lte,gte,isNull,isNotNull,inArray,asc,desc,sql,count} from "drizzle-orm";
import {db} from "@/lib/db";
import {players,supportThreads as threads,supportMessages as messages,supportNoticeOutbox as outbox} from "@/lib/db/schema";
import {NativeSupportError,type NativeSupportActor,type NativeSupportHistory,type NativeSupportThread} from "@/lib/native-support";
import type {NativeSupportRepository} from "./NativeSupportRepository";
const staff=(role:string)=>role==="admin"||role==="operator";
const unread=sql<boolean>`${threads.lastPlayerId}>${threads.staffReadThrough}`;
function mapThread(t:typeof threads.$inferSelect,name:string):NativeSupportThread{return {...t,playerName:name,lastActivityAt:t.lastActivityAt.toISOString(),closedAt:t.closedAt?.toISOString()??null,purgedAt:t.purgedAt?.toISOString()??null,unread:t.lastPlayerId>t.staffReadThrough,unanswered:t.lastPlayerId>t.lastStaffId};}
export class PostgresNativeSupportRepository implements NativeSupportRepository {
 private available(){if(process.env.DATABASE_PROVIDER!=="postgres")throw new NativeSupportError("Поддержка временно недоступна",503);}
 async history(ownerId:string|null,threadId?:string,cursor:{before?:number;after?:number}={}):Promise<NativeSupportHistory>{
  this.available();if(!ownerId&&!threadId)throw new NativeSupportError("Обращение не найдено",404);return db.transaction(async tx=>{
   const [row]=await tx.select({t:threads,name:players.displayName}).from(threads).innerJoin(players,eq(players.id,threads.playerId)).where(and(threadId?eq(threads.id,threadId):undefined,ownerId?eq(threads.playerId,ownerId):undefined)).limit(1);
   if(!row){if(threadId)throw new NativeSupportError("Обращение не найдено",404);return {thread:null,messages:[],hasOlder:false,hasNewer:false};}
   const forward=cursor.after!==undefined;
   const list=await tx.select().from(messages).where(and(eq(messages.threadId,row.t.id),cursor.before!==undefined?lt(messages.id,cursor.before):undefined,forward?gt(messages.id,cursor.after!):undefined)).orderBy(forward?asc(messages.id):desc(messages.id)).limit(51);
   const more=list.length>50;const slice=list.slice(0,50);if(!forward)slice.reverse();
   return {thread:mapThread(row.t,row.name),messages:slice.map(m=>({id:m.id,clientId:m.clientId,senderName:m.senderName,senderKind:m.senderKind,body:m.body,createdAt:m.createdAt.toISOString()})),hasOlder:!forward&&more,hasNewer:forward&&more};
  },{isolationLevel:"repeatable read",accessMode:"read only"});
 }
 async inbox(offset:number,summary=false){
  this.available();return db.transaction(async tx=>{
   const [c]=await tx.select({n:count()}).from(threads).where(unread);
   const rows=summary?[]:await tx.select({t:threads,name:players.displayName,previewAt:sql<string|null>`(select to_json(sm.created_at) from support_messages sm where sm.thread_id=${threads.id} order by sm.id desc limit 1)`,preview:sql<string|null>`(select body from support_messages sm where sm.thread_id=${threads.id} order by sm.id desc limit 1)`}).from(threads).innerJoin(players,eq(players.id,threads.playerId)).orderBy(desc(unread),desc(sql`${threads.status}='open'`),desc(threads.lastActivityAt),desc(threads.id)).offset(offset).limit(31);
   return {unreadCount:c.n,threads:rows.slice(0,30).map(r=>({...mapThread(r.t,r.name),preview:r.preview,previewAt:r.previewAt})),hasMore:rows.length>30};
  },{isolationLevel:"repeatable read",accessMode:"read only"});
 }
 async write(actor:NativeSupportActor,text:string,clientId:string,threadId?:string){
  this.available();return db.transaction(async tx=>{
   const [current]=await tx.select().from(players).where(eq(players.id,actor.id)).for("no key update");
   if(!current||current.mergedIntoPlayerId)throw new NativeSupportError("Обновите авторизацию",409);
   if(threadId&&(!staff(current.role)||current.isBlocked))throw new NativeSupportError("Недостаточно прав",403);
   if(!threadId)await tx.insert(threads).values({playerId:actor.id}).onConflictDoNothing({target:threads.playerId});
   const [t]=await tx.select().from(threads).where(threadId?eq(threads.id,threadId):eq(threads.playerId,actor.id)).for("update");
   if(!t)throw new NativeSupportError("Обращение не найдено",404);
   const kind=threadId?"staff":"player",hash=createHash("sha256").update(text).digest("hex");
   const [existing]=await tx.select().from(messages).where(and(eq(messages.threadId,t.id),eq(messages.clientId,clientId)));
   if(existing){if(existing.senderId!==actor.id||existing.bodyHash!==hash||existing.senderKind!==kind)throw new NativeSupportError("Идентификатор сообщения уже использован",409);return {threadId:t.id,messageId:existing.id,duplicate:true};}
   const [rate]=await tx.select({n:count()}).from(messages).where(and(eq(messages.senderId,actor.id),gte(messages.createdAt,new Date(Date.now()-60000))));
   if(rate.n>=(threadId?30:10))throw new NativeSupportError("Слишком много сообщений. Подождите минуту",429);
   const [m]=await tx.insert(messages).values({threadId:t.id,senderId:actor.id,senderName:current.displayName,senderKind:kind,clientId,body:text,bodyHash:hash}).returning();const now=new Date();
   const newInteraction=kind==="player"&&t.lastPlayerId<=t.lastStaffId;const generation=t.generation+(newInteraction?1:0);
   await tx.update(threads).set({status:"open",closedAt:null,purgedAt:null,lastActivityAt:now,generation,...(kind==="player"?{lastPlayerId:m.id}:{lastStaffId:m.id,staffReadThrough:t.lastPlayerId})}).where(eq(threads.id,t.id));
   if(newInteraction){
    const recipients=await tx.select({id:players.id}).from(players).where(and(inArray(players.role,["admin","operator"]),eq(players.isBlocked,false),isNull(players.mergedIntoPlayerId),isNotNull(players.telegramId)));
    if(recipients.length)await tx.insert(outbox).values(recipients.map(p=>({threadId:t.id,generation,recipientId:p.id}))).onConflictDoNothing();
   }
   return {threadId:t.id,messageId:m.id,duplicate:false};
  });
 }
 async state(actor:NativeSupportActor,action:"close"|"reopen",threadId?:string){
  this.available();await db.transaction(async tx=>{
   const [current]=await tx.select().from(players).where(eq(players.id,actor.id)).for("no key update");if(!current||current.mergedIntoPlayerId)throw new NativeSupportError("Обновите авторизацию",409);
   if(threadId&&(!staff(current.role)||current.isBlocked)||!threadId&&action==="close")throw new NativeSupportError("Недостаточно прав",403);
   const [t]=await tx.select().from(threads).where(threadId?eq(threads.id,threadId):eq(threads.playerId,actor.id)).for("update");if(!t)throw new NativeSupportError("Обращение не найдено",404);
   if(action==="close"&&t.lastPlayerId>t.lastStaffId)throw new NativeSupportError("Сначала ответьте игроку",409);
   if((action==="close")===(t.status==="closed"))return;
   await tx.update(threads).set({status:action==="close"?"closed":"open",closedAt:action==="close"?new Date():null,purgedAt:null,lastActivityAt:new Date()}).where(eq(threads.id,t.id));
  });
 }
 async read(threadId:string,throughId:number){this.available();await db.update(threads).set({staffReadThrough:sql`greatest(${threads.staffReadThrough},least(${threads.lastPlayerId},${throughId}))`}).where(eq(threads.id,threadId));}
 async maintenance(dryRun:boolean,limit:number){
  this.available();return db.transaction(async tx=>{
   const now=new Date(),closeDate=new Date(now.getTime()-14*86400000),purgeDate=new Date(now.getTime()-30*86400000);
   const closeQ=tx.select().from(threads).where(and(eq(threads.status,"open"),lte(threads.lastActivityAt,closeDate),gt(threads.lastStaffId,0),sql`${threads.lastStaffId}>=${threads.lastPlayerId}`)).orderBy(asc(threads.lastActivityAt)).limit(limit);
   const close=dryRun?await closeQ:await closeQ.for("update",{skipLocked:true});
   if(!dryRun&&close.length)await tx.update(threads).set({status:"closed",closedAt:now}).where(inArray(threads.id,close.map(t=>t.id)));
   const purgeQ=tx.select().from(threads).where(and(eq(threads.status,"closed"),lte(threads.closedAt,purgeDate),isNull(threads.purgedAt),sql`${threads.lastStaffId}>=${threads.lastPlayerId}`)).orderBy(asc(threads.closedAt)).limit(limit);
   const purge=dryRun?await purgeQ:await purgeQ.for("update",{skipLocked:true});let purgedMessages=0,purgedThreads=0;
   if(purge.length){const rows=await tx.select({id:messages.id,threadId:messages.threadId}).from(messages).where(and(inArray(messages.threadId,purge.map(t=>t.id)),isNotNull(messages.body))).orderBy(asc(messages.id)).limit(1000);purgedMessages=rows.length;
    if(!dryRun&&rows.length)await tx.update(messages).set({body:null}).where(inArray(messages.id,rows.map(m=>m.id)));
    for(const t of purge){const [left]=await tx.select({n:count()}).from(messages).where(and(eq(messages.threadId,t.id),isNotNull(messages.body)));if(left.n-(dryRun?rows.filter(m=>m.threadId===t.id).length:0)===0){purgedThreads++;if(!dryRun)await tx.update(threads).set({purgedAt:now}).where(eq(threads.id,t.id));}}
   }
   return {closed:close.length,purgedMessages,purgedThreads};
  },dryRun?{accessMode:"read only"}:undefined);
 }
 async claimNotice(){
  this.available();return db.transaction(async tx=>{
   // A crashed sender is not blindly retried: it may already have sent the optional alert.
   const stale=await tx.select().from(outbox).where(and(eq(outbox.status,"sending"),lt(outbox.claimedAt,new Date(Date.now()-60000)))).limit(20).for("update",{skipLocked:true});
   for(const o of stale)await tx.update(outbox).set({status:"failed"}).where(and(eq(outbox.threadId,o.threadId),eq(outbox.generation,o.generation),eq(outbox.recipientId,o.recipientId)));
   const [n]=await tx.select({o:outbox,t:threads,p:players}).from(outbox).innerJoin(threads,eq(threads.id,outbox.threadId)).innerJoin(players,eq(players.id,outbox.recipientId)).where(and(eq(outbox.status,"pending"),lte(outbox.availableAt,new Date()))).orderBy(asc(outbox.availableAt)).limit(1).for("update",{of:outbox,skipLocked:true});
   if(!n)return null;
   const key=and(eq(outbox.threadId,n.o.threadId),eq(outbox.generation,n.o.generation),eq(outbox.recipientId,n.o.recipientId));
   if(!staff(n.p.role)||n.p.isBlocked||n.p.mergedIntoPlayerId||!n.p.telegramId||n.t.status!=="open"||n.t.lastPlayerId<=n.t.lastStaffId||n.t.generation!==n.o.generation){await tx.update(outbox).set({status:"skipped"}).where(key);return {threadId:n.o.threadId,generation:n.o.generation,recipientId:n.o.recipientId,telegramId:0};}
   await tx.update(outbox).set({status:"sending",attempts:n.o.attempts+1,claimedAt:new Date()}).where(key);
   return {threadId:n.o.threadId,generation:n.o.generation,recipientId:n.o.recipientId,telegramId:n.p.telegramId};
  });
 }
 async finishNotice(n:{threadId:string;generation:number;recipientId:string},sent:boolean){this.available();await db.update(outbox).set({status:sent?"sent":sql`case when ${outbox.attempts}<3 then 'pending' else 'failed' end`,availableAt:new Date(Date.now()+300000)}).where(and(eq(outbox.threadId,n.threadId),eq(outbox.generation,n.generation),eq(outbox.recipientId,n.recipientId),eq(outbox.status,"sending")));}
}
