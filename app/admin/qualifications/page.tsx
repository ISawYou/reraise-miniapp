"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect,useState } from "react";
import { fetchAdminJson } from "@/lib/client-request";
import { KALININGRAD_EVENT } from "@/lib/qualification-config";
import { QualificationConfigForm,qButton } from "@/components/qualifications/config-form";
export default function QualificationsAdmin(){const router=useRouter();const [events,setEvents]=useState<{id:string;title:string;status:string}[]>([]),[config,setConfig]=useState({...KALININGRAD_EVENT}),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[allowed,setAllowed]=useState(false);
 useEffect(()=>{fetchAdminJson<{events:typeof events}>("/api/admin/qualifications",undefined,{retries:0}).then(x=>{setEvents(x.events);setAllowed(true);}).catch(e=>setError(e.message));},[]);
 async function create(){setBusy(true);setError(null);try{const result=await fetchAdminJson<{event:{id:string}}>("/api/admin/qualifications",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)},{retries:0});router.push(`/admin/qualifications/${result.event.id}`);}catch(e){setError(e instanceof Error?e.message:"Не удалось создать отбор");}finally{setBusy(false);}}
 return <main className="mx-auto max-w-lg px-4 py-5 pb-32 text-white"><Link className="inline-block min-h-10 text-sm text-white/65" href="/admin">← Админка</Link><h1 className="mb-5 text-2xl font-bold">Квалификации</h1>{error?<p role="alert" className="mb-4 text-sm text-red-200">{error}</p>:null}{events.map(e=><Link className="mb-3 block rounded-xl border border-white/15 p-4" key={e.id} href={`/admin/qualifications/${e.id}`}>{e.title}<span className="ml-2 text-xs text-white/60">{e.status}</span></Link>)}{allowed?<section className="mt-5 space-y-4 rounded-2xl border border-white/10 p-4"><h2 className="font-semibold">Новый отбор</h2><QualificationConfigForm value={config} onChange={setConfig}/><button className={qButton} disabled={busy} onClick={()=>void create()}>{busy?"Создаём…":"Создать черновик отбора"}</button></section>:null}</main>;
}
