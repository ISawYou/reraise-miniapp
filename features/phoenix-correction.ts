import 'server-only';
import {assertServerActorRole} from '@/lib/admin-auth';
import {PostgresPhoenixCorrectionRepository} from '@/lib/repositories/phoenix-correction/PostgresPhoenixCorrectionRepository';
const repository=new PostgresPhoenixCorrectionRepository();
export async function previewPhoenixCorrection(){const actor=await assertServerActorRole(['admin']);return repository.preview({kind:'admin',playerId:actor.id});}
export async function applyPhoenixCorrection(revision:string){const actor=await assertServerActorRole(['admin']);return repository.apply({kind:'admin',playerId:actor.id},revision);}
