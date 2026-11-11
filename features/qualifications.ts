import "server-only";
import { qualificationRepository as repository } from "@/lib/repositories/qualification";
import { assertServerActorRole, resolveCurrentServerActor, UnauthorizedActionError, ForbiddenActionError } from "@/lib/admin-auth";
import { QualificationError, qualificationUuid, type QualificationConfig } from "@/lib/qualification-config";
import type { QualificationCommand } from "@/lib/repositories/qualification";

export const listQualifications=()=>repository.list();
export const getPublicQualification=(slug:string)=>repository.read(slug);
export async function listAdminQualifications(){await assertServerActorRole(["admin"]);return repository.list(true);}
export async function getAdminQualification(id:string,previewFinalDate?:string){await assertServerActorRole(["admin"]);return repository.read(id,true,previewFinalDate);}
export async function searchQualificationPlayers(q:string){await assertServerActorRole(["admin"]);return repository.searchPlayers(q);}
export async function createQualification(config:QualificationConfig){const actor=await assertServerActorRole(["admin"]);return repository.create(config,actor.id);}
export async function mutateQualification(id:string,command:QualificationCommand){
  const actor=await assertServerActorRole(["admin"]);
  if(!qualificationUuid(id)||!command||!Number.isInteger(command.version)||command.version<1)throw new QualificationError("Нужны ID и актуальная версия отбора",400);
  return repository.mutate(id,command,actor.id);
}
export async function getOwnQualificationInvitation(slug:string){const actor=await resolveCurrentServerActor();if(!actor)throw new UnauthorizedActionError();return repository.ownInvitation(slug,actor.id);}
export async function respondToQualificationInvitation(slug:string,input:{eventId:string;invitationId:string;version:number;accept:boolean}){
  const actor=await resolveCurrentServerActor();if(!actor)throw new UnauthorizedActionError();if(actor.is_blocked)throw new ForbiddenActionError();
  if(!input||!qualificationUuid(input.eventId)||!qualificationUuid(input.invitationId)||!Number.isInteger(input.version)||typeof input.accept!=="boolean")throw new QualificationError("Некорректный ответ на приглашение",400);
  const own=await repository.ownInvitation(slug,actor.id);if(own.eventId!==input.eventId)throw new QualificationError("Приглашение другого отбора",404);
  return repository.respond(own.eventId,input.invitationId,actor.id,input.version,input.accept);
}
