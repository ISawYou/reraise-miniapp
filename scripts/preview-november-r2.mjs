// Usage: node scripts/preview-november-r2.mjs <sanitized-readonly-snapshot.jsonl>
// Uses existing dev tooling. No DB connection, bind/listen, write or apply mode.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
const input=process.argv[2];if(!input)throw new Error("Укажите read-only snapshot JSONL");
const rows=readFileSync(input,"utf8").trim().split("\n").map(s=>JSON.parse(s));
const tournaments=rows.find(r=>r.tournaments)?.tournaments,events=rows.find(r=>r.events)?.events,slots=rows.find(r=>r.slots)?.slots;
if(!Array.isArray(tournaments)||events?.length!==1||!Array.isArray(slots)||slots.length!==6)throw new Error("Нужны inventory, одно событие и шесть слотов");
const server=await createServer({configFile:false,resolve:{alias:{"@":resolve(".")}},server:{middlewareMode:true,hmr:false,ws:false},logLevel:"error"});
try{const {previewNovemberR2}=await server.ssrLoadModule("/lib/november-r2-schedule.ts");console.log(JSON.stringify(previewNovemberR2(tournaments,events[0],slots),null,2));}finally{await server.close();}
