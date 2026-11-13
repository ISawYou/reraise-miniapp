export type OperationFields = {
  paid: boolean | null;
  paymentMethod: "cash" | "card" | "mixed" | null;
  freeReentries: number | null;
  knockouts: number | null;
  bossKnockouts: number | null;
  mysteryPoints: number | null;
  place: number | null;
};
// Missing values mean unknown, not a confirmed zero/payment.
export function parseOperationPatch(value: unknown): Partial<OperationFields> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Некорректные поля");
  const patch = value as Record<string, unknown>;
  const allowed = ["paid", "paymentMethod", "freeReentries", "knockouts", "bossKnockouts", "mysteryPoints", "place"];
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) throw Error("Неизвестное или пустое поле");
  for (const [key, v] of Object.entries(patch)) {
    if (v === null) continue;
    if (key === "paid") { if (typeof v !== "boolean") throw Error("Оплата должна быть логическим значением"); }
    else if (key === "paymentMethod") { if (!["cash", "card", "mixed"].includes(String(v))) throw Error("Неизвестный способ оплаты"); }
    else if (typeof v !== "number" || !Number.isSafeInteger(v) || v < (key === "place" ? 1 : 0) || v > 2147483647) throw Error("Введите допустимое целое число");
  }
  return patch as Partial<OperationFields>;
}
