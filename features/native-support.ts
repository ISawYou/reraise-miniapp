import "server-only";
import {resolveCurrentServerActor} from "@/lib/admin-auth";
import {isStaff} from "@/lib/roles";
import {nativeSupportRepository as repository} from "@/lib/repositories/native-support";
import {NativeSupportError,supportUuid,supportText} from "@/lib/native-support";
import {sendNativeSupportTelegramNotification} from "@/lib/telegram-bot-notify";
export async function supportActor(staff=false){const p=await resolveCurrentServerActor();if(!p)throw new NativeSupportError("Войдите в аккаунт на главной странице",401);if(staff&&(!isStaff(p.role)||p.is_blocked))throw new NativeSupportError("Недостаточно прав",403);return p;}
function threadId(id:string){if(!supportUuid(id))throw new NativeSupportError("Обращение не найдено",404);return id;}
function input(body:unknown){const b=body as {text?:unknown;clientId?:unknown};if(!b||!supportUuid(b.clientId))throw new NativeSupportError("Нужен идентификатор сообщения");return {text:supportText(b.text),clientId:b.clientId};}
export async function ownSupport(cursor?:{before?:number;after?:number}){const p=await supportActor();return {...await repository.history(p.id,undefined,cursor),viewerId:p.id,blocked:!!p.is_blocked};}
export async function writeOwnSupport(body:unknown){const p=await supportActor(),i=input(body);return repository.write(p,i.text,i.clientId);}
export async function reopenOwnSupport(){const p=await supportActor();await repository.state(p,"reopen");return {ok:true};}
export async function staffSupportInbox(offset=0,summary=false){await supportActor(true);if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new NativeSupportError("Некорректная страница");return repository.inbox(offset,summary);}
export async function staffSupportHistory(id:string,cursor?:{before?:number;after?:number}){const p=await supportActor(true);return {...await repository.history(null,threadId(id),cursor),viewerId:p.id};}
export async function writeStaffSupport(id:string,body:unknown){const p=await supportActor(true),i=input(body);return repository.write(p,i.text,i.clientId,threadId(id));}
export async function stateStaffSupport(id:string,action:unknown){const p=await supportActor(true);if(action!=="close"&&action!=="reopen")throw new NativeSupportError("Неизвестное действие");await repository.state(p,action,threadId(id));return {ok:true};}
export async function readStaffSupport(id:string,throughId:unknown){await supportActor(true);if(typeof throughId!=="number"||!Number.isSafeInteger(throughId)||throughId<0)throw new NativeSupportError("Некорректная отметка прочтения");await repository.read(threadId(id),throughId);return {ok:true};}
export async function dispatchSupportNotices(limit=10){
 if(!process.env.TELEGRAM_BOT_TOKEN)return {attempted:0,sent:0};let attempted=0,sent=0;
 for(let i=0;i<Math.min(limit,20);i++){
  const n=await repository.claimNotice();if(!n)break;if(!n.telegramId)continue;attempted++;
  const ok=await sendNativeSupportTelegramNotification({telegramId:n.telegramId,threadId:n.threadId});await repository.finishNotice(n,ok);if(ok)sent++;
 }
 return {attempted,sent};
}
export async function maintainNativeSupport(dryRun:boolean,limit:number){if(!Number.isInteger(limit)||limit<1||limit>100)throw new NativeSupportError("Лимит от 1 до 100");const cleanup=await repository.maintenance(dryRun,limit);const notices=dryRun?{attempted:0,sent:0}:await dispatchSupportNotices(20).catch(()=>({attempted:0,sent:0}));return {dryRun,...cleanup,notices};}
