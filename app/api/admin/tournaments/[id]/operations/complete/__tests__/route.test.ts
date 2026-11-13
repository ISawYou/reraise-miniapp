import {beforeEach,it,expect,vi} from "vitest";
const h=vi.hoisted(()=>({auth:vi.fn(),preview:vi.fn(),complete:vi.fn()}));
vi.mock("@/lib/admin-auth",()=>{class UnauthorizedActionError extends Error{};class ForbiddenActionError extends Error{};return {assertServerActorRole:h.auth,UnauthorizedActionError,ForbiddenActionError};});
vi.mock("@/features/postgres-tournament-completion",()=>({previewPostgresCompletion:h.preview,completePostgresTournament:h.complete,CompletionReadinessError:class extends Error{constructor(public blockers:unknown[]){super("All missing fields");}}}));
import {GET,POST} from "../route";
import {UnauthorizedActionError,ForbiddenActionError} from "@/lib/admin-auth";
const c={params:Promise.resolve({id:"t"})},request=(body:unknown)=>new Request("http://localhost",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{vi.stubEnv("DATABASE_PROVIDER","postgres");vi.clearAllMocks();h.auth.mockResolvedValue({id:"staff"});h.preview.mockResolvedValue({fingerprint:"v1"});h.complete.mockResolvedValue({ok:true});});
it.each([GET,POST])("authorizes before any read or completion",async handler=>{h.auth.mockRejectedValue(new UnauthorizedActionError());expect((await handler(request({}),c)).status).toBe(401);expect(h.complete).not.toHaveBeenCalled();expect(h.preview).not.toHaveBeenCalled();});
it("rejects nonstaff and requires explicit preview confirmation",async()=>{h.auth.mockRejectedValueOnce(new ForbiddenActionError());expect((await POST(request({}),c)).status).toBe(403);expect((await POST(request({fingerprint:"v1"}),c)).status).toBe(400);expect(h.complete).not.toHaveBeenCalled();});
it("uses only a confirmed fingerprint, not client result values",async()=>{expect((await POST(request({confirmed:true,fingerprint:"v1",rows:[{rating_points:99999}]}),c)).status).toBe(200);expect(h.complete).toHaveBeenCalledWith("t","v1");});

it("returns all structured readiness blockers in one authorized response",async()=>{const {CompletionReadinessError}=await import("@/features/postgres-tournament-completion");const blockers=[{player_id:"a",display_name:"A",fields:["KO"]},{player_id:"b",display_name:"B",fields:["Boss KO","Бесплатные re-entry"]}];h.preview.mockRejectedValue(new CompletionReadinessError(blockers));const response=await GET(request({}),c);expect(response.status).toBe(409);expect((await response.json()).blockers).toEqual(blockers);expect(h.complete).not.toHaveBeenCalled();});
