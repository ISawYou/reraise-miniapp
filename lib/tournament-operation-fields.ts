import type {TournamentType} from "@/types/domain";
export type OperationFields = {
  paid: boolean | null;
  paymentMethod: "cash" | "card" | "mixed" | null;
  comment: string | null;
  freeReentries: number | null;
  knockouts: number | null;
  bossKnockouts: number | null;
  mysteryPoints: number | null;
  mysteryEnvelopesWon: number | null;
  place: number | null;
};
// Missing values mean unknown, not a confirmed zero/payment.
export function parseOperationPatch(value: unknown): Partial<OperationFields> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Некорректные поля");
  const patch = value as Record<string, unknown>;
  const allowed = ["paid", "paymentMethod", "comment", "freeReentries", "knockouts", "bossKnockouts", "mysteryPoints", "mysteryEnvelopesWon", "place"];
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) throw Error("Неизвестное или пустое поле");
  for (const [key, v] of Object.entries(patch)) {
    if (v === null) continue;
    if (key === "paid") { if (typeof v !== "boolean") throw Error("Оплата должна быть логическим значением"); }
    else if (key === "comment") { if (typeof v !== "string" || v.length > 1000) throw Error("Комментарий должен быть текстом не длиннее 1000 символов"); }
    else if (key === "paymentMethod") { if (!["cash", "card", "mixed"].includes(String(v))) throw Error("Неизвестный способ оплаты"); }
    else if (typeof v !== "number" || !Number.isSafeInteger(v) || v < (key === "place" ? 1 : 0) || v > 2147483647) throw Error("Введите допустимое целое число");
  }
  return patch as Partial<OperationFields>;
}
export function operationFieldsFor(type:TournamentType): (keyof OperationFields)[]{
 if(type==="qualification_final")return ["comment"];
 return ["paid","freeReentries","place",...(type==="bounty"?["knockouts" as const]:type==="boss_bounty"?["knockouts" as const,"bossKnockouts" as const]:type==="mystery_bounty"?["mysteryEnvelopesWon" as const,"mysteryPoints" as const]:[]),"comment"];
}
export function validateFormatPatch(type:TournamentType,patch:Partial<OperationFields>){
 const allowed=operationFieldsFor(type);
 if(Object.keys(patch).some(key=>!allowed.includes(key as keyof OperationFields)))throw Error("Поле недоступно для этого формата турнира");
}
export function validateMysteryAllocation(rows:Partial<OperationFields>[],snapshot:{envelope_count:number;mystery_pool:number}|null){
 if(!snapshot)throw Error("Mystery: сначала зафиксируйте пул и конверты");
 if(rows.some(r=>r.mysteryEnvelopesWon==null||r.mysteryPoints==null))throw Error("Mystery: заполните конверты и очки каждого участника; неизвестное значение не равно нулю");
 const envelopes=rows.reduce((s,r)=>s+r.mysteryEnvelopesWon!,0),points=rows.reduce((s,r)=>s+r.mysteryPoints!,0);
 if(envelopes!==snapshot.envelope_count)throw Error(`Mystery: распределено ${envelopes} конвертов из ${snapshot.envelope_count}`);
 if(points!==snapshot.mystery_pool)throw Error(`Mystery: распределено ${points} очков из ${snapshot.mystery_pool}`);
}
