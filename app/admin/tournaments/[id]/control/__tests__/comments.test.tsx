import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {OperationCells} from "../operation-cells";
const h=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("@/lib/client-request",()=>({fetchAdminJson:h.request}));
let root:Root,el:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});el=document.createElement("div");document.body.append(el);root=createRoot(el);h.request.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();});
const mount=async(locked=false)=>act(async()=>root.render(<table><tbody><tr><OperationCells id="t" playerId="p" type="free_roll" locked={locked} initial={{playerId:"p",version:2,paid:false,paymentMethod:"cash",comment:null}}/></tr></tbody></table>));
const comment=()=>el.querySelector<HTMLTextAreaElement>('textarea')!;
async function edit(value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(comment(),value);comment().dispatchEvent(new Event("input",{bubbles:true}));});}
const blur=()=>act(async()=>comment().dispatchEvent(new FocusEvent("focusout",{bubbles:true})));
it("renders paid as checkbox, no payment-method selector; autosaves comment only on blur with version",async()=>{h.request.mockResolvedValue({row:{playerId:"p",version:3,comment:"Стол 4"}});await mount();expect(el.querySelector('select')).toBeNull();expect(el.querySelector('input[aria-label="p: Оплачен"]')!.getAttribute("type")).toBe("checkbox");expect(comment().maxLength).toBe(1000);const original=comment();await edit("Стол 4");expect(h.request).not.toHaveBeenCalled();await blur();expect(h.request).toHaveBeenCalledTimes(1);expect(JSON.parse(h.request.mock.calls[0][1].body)).toEqual({playerId:"p",expectedVersion:2,patch:{comment:"Стол 4"}});expect(h.request.mock.calls[0][2]).toEqual({retries:0});expect(comment()).toBe(original);expect(el.textContent).toContain("Сохранено");await blur();expect(h.request).toHaveBeenCalledTimes(1);});
it("preserves unsafe-looking text as text and keeps exact failed-save draft",async()=>{h.request.mockRejectedValue(new Error("Конфликт версии"));await mount();await edit('<script>alert(1)</script>');await blur();expect(el.querySelector('script')).toBeNull();expect(comment().value).toBe('<script>alert(1)</script>');expect(el.textContent).toContain("Не сохранено: Конфликт версии");expect(el.textContent).not.toContain("Сохранено");});
it("saves paid boolean separately and locks comment in readonly mode",async()=>{h.request.mockResolvedValue({row:{playerId:"p",version:3,paid:true}});await mount();await act(async()=>el.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());expect(JSON.parse(h.request.mock.calls[0][1].body).patch).toEqual({paid:true});await mount(true);expect(comment().disabled).toBe(true);});
it("leaves an untouched unknown comment unknown",async()=>{await mount();await blur();expect(h.request).not.toHaveBeenCalled();});
