import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {TournamentConsole,type Row} from "../table";
const h=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("@/lib/client-request",()=>({fetchAdminJson:h.request}));
let root:Root,el:HTMLDivElement;
const row=(id:string,status="registered"):Row=>({id,name:id,status,arrived:false,eliminated:false,time:null,rebuys:1,addons:0});
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});el=document.createElement("div");document.body.append(el);root=createRoot(el);h.request.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();});
const mount=async(locked=false,rows=[row("A"),row("B")])=>act(async()=>root.render(<TournamentConsole id="t1" title="Classic" locked={locked} rows={rows}/>));
const input=(name:string)=>el.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
async function edit(name:string,value:string){await act(async()=>{const i=input(name);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(i,value);i.dispatchEvent(new Event("input",{bubbles:true}));});}
async function blur(name:string){await act(async()=>input(name).dispatchEvent(new FocusEvent("focusout",{bubbles:true})));}
it("keeps inputs mounted/focused and lets another row save while a request is pending",async()=>{
 let resolve!:(v:object)=>void;h.request.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({});await mount();
 const original=input("A: rebuys");await edit("A: rebuys","2");await blur("A: rebuys");
 await act(async()=>input("B: arrived").click());expect(h.request).toHaveBeenCalledTimes(2);expect(input("B: arrived").disabled).toBe(false);
 await act(async()=>input("A: addons").focus());await act(async()=>resolve({}));expect(input("A: rebuys")).toBe(original);expect(document.activeElement).toBe(input("A: addons"));
});
it("serializes shared entries/addon payloads, retains later edits and deduplicates blur",async()=>{
 let resolve!:(v:object)=>void;h.request.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({});await mount();
 await edit("A: rebuys","2");await blur("A: rebuys");await blur("A: rebuys");await edit("A: addons","3");await blur("A: addons");expect(h.request).toHaveBeenCalledTimes(1);
 await edit("A: rebuys","4");await act(async()=>resolve({}));expect(input("A: rebuys").value).toBe("4");expect(h.request).toHaveBeenCalledTimes(2);expect(JSON.parse(h.request.mock.calls[1][1].body)).toMatchObject({rebuys:2,addons:3});expect(h.request.mock.calls[0][2]).toEqual({retries:0});
});
it("marks failed cells unsaved with exact error and permits explicit retry",async()=>{
 h.request.mockRejectedValueOnce(new Error("Конфликт записи: 409")).mockResolvedValue({});await mount();await edit("A: rebuys","7");await blur("A: rebuys");
 expect(el.textContent).toContain("Не сохранено: Конфликт записи: 409");expect(input("A: rebuys").value).toBe("7");expect(el.querySelector('[data-testid="totals"]')!.textContent).toContain("Входы: 2");expect(h.request).toHaveBeenCalledTimes(1);
 await act(async()=>Array.from(el.querySelectorAll("button")).find(b=>b.textContent==="Повторить")!.click());expect(el.querySelector('[data-testid="totals"]')!.textContent).toContain("Входы: 8");
});
it.each([true,false])("locks all operational cells for readonly or ineligible registrations (%s)",async locked=>{
 await mount(locked,locked?[row("A")]:[row("A","waitlist"),row("B","cancelled")]);for(const i of el.querySelectorAll<HTMLInputElement>('tbody input'))expect(i.disabled).toBe(true);expect(h.request).not.toHaveBeenCalled();
});
it("excludes waitlisted and cancelled players from all totals",async()=>{await mount(false,[row("A"),{...row("B","attended"),arrived:true,rebuys:2,addons:1}, {...row("C","waitlist"),arrived:true,rebuys:10},{...row("D","cancelled"),rebuys:20}]);expect(el.querySelector('[data-testid="totals"]')!.textContent).toContain("Игроки: 2 · Пришли: 1 · Входы: 3 · Add-on: 1 · Выбыли: 0");});
it("Enter moves to the next input and commits the previous numeric cell",async()=>{h.request.mockResolvedValue({});await mount();await edit("A: rebuys","3");await act(async()=>{input("A: rebuys").focus();input("A: rebuys").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));});expect(document.activeElement).toBe(input("A: addons"));expect(h.request).toHaveBeenCalledTimes(1);});
it("qualification final exposes editable comment while live controls/completion remain restricted",async()=>{h.request.mockResolvedValue({row:{playerId:"A",version:1,comment:"Final note"}});await act(async()=>root.render(<TournamentConsole id="final" title="Final" locked={false} type="qualification_final" rows={[row("A")]}/>));const textarea=el.querySelector<HTMLTextAreaElement>('textarea')!;expect(textarea.disabled).toBe(false);for(const i of el.querySelectorAll<HTMLInputElement>('tbody input'))expect(i.disabled).toBe(true);expect(el.textContent).not.toContain("Проверить завершение");await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(textarea,"Final note");textarea.dispatchEvent(new Event("input",{bubbles:true}));});await act(async()=>textarea.dispatchEvent(new FocusEvent("focusout",{bubbles:true})));expect(JSON.parse(h.request.mock.calls[0][1].body)).toMatchObject({patch:{comment:"Final note"}});});
it("Phoenix renders no editable free reentry or Add-on column",async()=>{await act(async()=>root.render(<TournamentConsole id="phoenix" title="Phoenix" locked={false} type="phoenix" rows={[row("A")]}/>));expect(el.querySelector('thead')!.textContent).not.toContain("Беспл. re-entry");expect(el.querySelector('thead')!.textContent).not.toContain("Add-on");});
