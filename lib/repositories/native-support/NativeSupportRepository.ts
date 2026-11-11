import type {NativeSupportActor,NativeSupportHistory} from "@/lib/native-support";
export interface NativeSupportRepository {
 history(ownerId:string|null,threadId?:string,cursor?:{before?:number;after?:number}):Promise<NativeSupportHistory>;
 inbox(offset:number,summary?:boolean):Promise<unknown>;
 write(actor:NativeSupportActor,text:string,clientId:string,threadId?:string):Promise<{threadId:string;messageId:number;duplicate:boolean}>;
 state(actor:NativeSupportActor,action:"close"|"reopen",threadId?:string):Promise<void>;
 read(threadId:string,throughId:number):Promise<void>;
 maintenance(dryRun:boolean,limit:number):Promise<{closed:number;purgedMessages:number;purgedThreads:number}>;
 claimNotice():Promise<{threadId:string;generation:number;recipientId:string;telegramId:number}|null>;
 finishNotice(notice:{threadId:string;generation:number;recipientId:string},sent:boolean):Promise<void>;
}
