export const KALININGRAD_EVENT = {
  slug:"put-v-kaliningrad-2026",title:"Путь в Калининград",timezone:"Europe/Moscow",bestResultsCount:3,finalDate:"2026-11-14",
  rules:"Сумма трёх лучших сохранённых рейтинговых результатов. Победитель отбора проходит в сборную напрямую; места 2–19 получают приглашения в бесплатный финал. Трое оставшихся в игре финалистов и назначенный администратором капитан дополняют сборную из пяти человек.",
  dates:["2026-11-06","2026-11-07","2026-11-08","2026-11-11","2026-11-12","2026-11-13"],
};
export type QualificationConfig = typeof KALININGRAD_EVENT;
export class QualificationError extends Error {
  constructor(message:string,public status=409){super(message);}
}
export const qualificationUuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function validateQualificationConfig(input:QualificationConfig){
  if(!input||typeof input.slug!=="string"||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug)||input.slug.length>100||typeof input.title!=="string"||input.title.trim().length<2||input.title.length>120||typeof input.rules!=="string"||input.rules.length>8000||!Number.isInteger(input.bestResultsCount)||input.bestResultsCount<1||input.bestResultsCount>6)throw new QualificationError("Проверьте название, slug, правила и число лучших результатов",400);
  if(typeof input.timezone!=="string"||!input.timezone||input.timezone.length>100)throw new QualificationError("Некорректный часовой пояс",400);
  try{new Intl.DateTimeFormat("en",{timeZone:input.timezone}).format();}catch{throw new QualificationError("Некорректный часовой пояс",400);}
  const validDate=(d:unknown)=>typeof d==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  if(!Array.isArray(input.dates)||input.dates.length!==6||new Set(input.dates).size!==6||!input.dates.every(validDate)||!validDate(input.finalDate)||input.dates.some(d=>d>=input.finalDate)||input.dates.some((d,i)=>i>0&&d<=input.dates[i-1]))throw new QualificationError("Нужны шесть разных дат отбора перед датой финала",400);
}
