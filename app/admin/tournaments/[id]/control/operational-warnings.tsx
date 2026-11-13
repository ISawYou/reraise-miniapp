import type {Row} from "./table";
import type {Operations} from "./operation-cells";
export function OperationalWarnings({rows,operations,type}:{rows:Row[];operations:Operations[];type:string}){
 const roster=rows.filter(r=>['registered','attended'].includes(r.status)),arrived=roster.filter(r=>r.arrived),issues:string[]=[];
 for(const r of roster){const op=operations.find(o=>o.playerId===r.id);if(r.entriesKnown!==false&&op?.freeReentries!=null&&op.freeReentries>Math.max(0,r.rebuys-1))issues.push(`${r.name}: бесплатные re-entry ${op.freeReentries}, повторные входы ${Math.max(0,r.rebuys-1)}. Сверьте фактическое использование.`);
 if(r.attendanceKnown===false)issues.push(`${r.name}: нет записи о приходе.`);
 if(r.entriesKnown===false||r.arrived&&r.rebuys<1)issues.push(`${r.name}: приход ${r.arrived?'да':'нет'}, входы ${r.rebuys}; проверьте учёт входов.`);
 const place=r.eliminated?r.derivedPlace:op?.place;
 if(place==null)issues.push(`${r.name}: место не определено${r.eliminated?' каноническим порядком выбытия':''}.`);
 if(r.eliminated&&!r.time)issues.push(`${r.name}: отсутствует время выбытия; проверьте порядок в редакторе выбытий.`);
 if(place!=null){const others=roster.filter(other=>other.id!==r.id&&(other.eliminated?other.derivedPlace:operations.find(o=>o.playerId===other.id)?.place)===place);if(others.length)issues.push(`${r.name}: место ${place} совпадает с ${others.map(o=>o.name).join(', ')}.`);}
 }
 const values=arrived.map(r=>({name:r.name,...operations.find(o=>o.playerId===r.id)}));const ko=values.reduce((s,o)=>s+(o.knockouts??0),0),entries=arrived.reduce((s,r)=>s+r.rebuys,0);
 if(arrived.every(r=>r.entriesKnown!==false)&&['bounty','boss_bounty'].includes(type)&&ko>Math.max(0,entries-1))issues.push(`Известные KO ${ko} при ${entries} входах требуют сверки. ${values.filter(o=>(o.knockouts??0)>0).map(o=>`${o.name}: KO ${o.knockouts}, Boss KO ${o.bossKnockouts??'?'}`).join('; ')}. Boss KO показаны отдельно; проверьте официальный учёт нокаутов.`);
 const provisional=arrived.length>0&&arrived.every(r=>r.eliminated)?arrived.find(r=>r.derivedPlace===1):undefined;
 if(provisional)issues.unshift(`Все ${arrived.length} пришедших отмечены выбывшими. Предварительное место 1: ${provisional.name}. Подтвердите официального победителя и порядок; статусы автоматически не меняются.`);
 if(!issues.length)return null;
 return <details className="max-w-5xl text-xs text-amber-200"><summary>{provisional?`Все выбыли · предварительное место 1: ${provisional.name} · требуется подтверждение`:`Сверка данных: ${issues.length} предупреждений`}</summary><ul className="max-h-36 list-disc overflow-auto pl-5">{issues.map((issue,index)=><li key={index} className="my-1">{issue}</li>)}</ul></details>;
}
