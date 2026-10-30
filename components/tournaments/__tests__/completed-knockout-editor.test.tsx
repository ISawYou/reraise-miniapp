import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const h=vi.hoisted(()=>({request:vi.fn(),saved:vi.fn()}));
vi.mock("@/lib/client-request",()=>({fetchAdminJson:h.request}));
const {CompletedKnockoutEditor}=await import("../completed-knockout-editor");
let el:HTMLDivElement,root:Root;
const snapshot={player_id:"p",knockouts:2,boss_knockouts:1,rating_points:112,place:1,revision:"a".repeat(64),points_per_ko:5,points_per_boss_ko:10,has_boss_ko:true};
beforeEach(async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});h.request.mockReset().mockResolvedValue({result:snapshot});h.saved.mockReset();el=document.createElement("div");document.body.append(el);root=createRoot(el);await act(async()=>root.render(<CompletedKnockoutEditor tournamentId="t" playerId="p" onSaved={h.saved}/>));});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();});
const button=(name:string)=>Array.from(el.querySelectorAll("button")).find(b=>b.textContent===name)!;
async function open(){await act(async()=>el.querySelector("button")!.click());}
async function change(label:string,value:string){await act(async()=>{const input=el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
it("loads canonical values and previews independent KO/Boss deltas before save",async()=>{await open();expect(el.querySelector<HTMLInputElement>('input[aria-label="KO"]')!.value).toBe("2");await change("KO","4");expect(el.textContent).toContain("112 → 122 (+10)");await change("Boss KO","3");expect(el.textContent).toContain("112 → 142 (+30)");expect(h.request).toHaveBeenCalledTimes(1);});
it("posts revision and updates parent only after successful persistence",async()=>{await open();await change("KO","4");h.request.mockResolvedValueOnce({result:{...snapshot,knockouts:4,rating_points:122},warnings:["Нужна синхронизация"]});await act(async()=>button("Сохранить").click());expect(h.saved).toHaveBeenCalledWith(expect.objectContaining({warnings:["Нужна синхронизация"]}));const req=JSON.parse(h.request.mock.calls[1][1].body);expect(req).toEqual({player_id:"p",knockouts:4,boss_knockouts:1,revision:snapshot.revision});expect(el.querySelector("form")).toBeNull();});
it("shows actual conflict and does not claim success",async()=>{await open();await change("KO","4");h.request.mockRejectedValueOnce(new Error("Результат устарел"));await act(async()=>button("Сохранить").click());expect(el.querySelector('[role="alert"]')!.textContent).toBe("Результат устарел");expect(h.saved).not.toHaveBeenCalled();expect(el.querySelector("form")).not.toBeNull();});
it("cancel never writes",async()=>{await open();await change("KO","4");await act(async()=>button("Отмена").click());expect(h.request).toHaveBeenCalledTimes(1);expect(h.saved).not.toHaveBeenCalled();});
it("rejects empty/fractional inputs and disables unchanged save",async()=>{await open();expect(button("Сохранить").disabled).toBe(true);for(const value of ["","-1","1.5"]){await change("KO",value);expect(button("Сохранить").disabled).toBe(true);}});
it("ordinary Bounty has no Boss field",async()=>{h.request.mockResolvedValueOnce({result:{...snapshot,boss_knockouts:0,points_per_boss_ko:0,has_boss_ko:false}});await open();expect(el.querySelector('input[aria-label="Boss KO"]')).toBeNull();});
it("read failure keeps save disabled and allows cancel/reopen",async()=>{h.request.mockRejectedValueOnce(new Error("Не удалось загрузить"));await open();expect(button("Сохранить").disabled).toBe(true);expect(el.querySelector('[role="alert"]')!.textContent).toBe("Не удалось загрузить");await act(async()=>button("Отмена").click());await open();expect(el.querySelector('input[aria-label="KO"]')).not.toBeNull();});
