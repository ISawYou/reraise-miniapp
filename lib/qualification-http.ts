import { NextResponse } from "next/server";
import { QualificationError } from "@/lib/qualification-config";
import { ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";
export function qualificationFailure(error:unknown){
  if(error instanceof SyntaxError)return NextResponse.json({error:"Некорректный JSON"},{status:400});
  if(error instanceof UnauthorizedActionError)return NextResponse.json({error:error.message},{status:401});
  if(error instanceof ForbiddenActionError)return NextResponse.json({error:error.message},{status:403});
  if(error instanceof QualificationError)return NextResponse.json({error:error.message},{status:error.status});
  const e=error as {code?:string;cause?:{code?:string}};const code=e?.code??e?.cause?.code;
  if(code==="42P01"||code==="42883")return NextResponse.json({error:"Система отбора ещё не активирована: требуется подготовленная миграция"},{status:503});
  if(["23505","23503","23514","40001","40P01"].includes(code??""))return NextResponse.json({error:"Конфликт данных или ограничений отбора. Обновите страницу и проверьте участников и турниры."},{status:409});
  console.error("[qualification] database operation failed");return NextResponse.json({error:"Не удалось выполнить операцию отбора. Обновите страницу перед повторной попыткой."},{status:500});
}
