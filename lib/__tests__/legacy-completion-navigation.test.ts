import {beforeEach,it,expect,vi} from "vitest";
const h=vi.hoisted(()=>({request:vi.fn()}));vi.mock("@/lib/client-request",()=>({fetchAdminJson:h.request}));
import {redirectPostgresCompletion} from "../legacy-completion-navigation";
beforeEach(()=>{h.request.mockReset();});
it("navigates PG completion to internal console before sending any legacy body",async()=>{h.request.mockResolvedValue({sourceMode:"POSTGRESQL",redirectUrl:"https://untrusted.invalid"});const navigate=vi.fn();expect(await redirectPostgresCompletion("t",navigate)).toBe(true);expect(navigate).toHaveBeenCalledWith("/admin/tournaments/t/control");expect(h.request).toHaveBeenCalledWith("/api/admin/tournaments/t/complete-free",undefined,{retries:0});});
it("leaves legacy Sheet completion unchanged",async()=>{h.request.mockResolvedValue({sourceMode:"LEGACY_GOOGLE_SHEETS"});const navigate=vi.fn();expect(await redirectPostgresCompletion("t",navigate)).toBe(false);expect(navigate).not.toHaveBeenCalled();});
it("fails closed on unknown or unavailable ownership",async()=>{h.request.mockResolvedValue({sourceMode:"unknown"});await expect(redirectPostgresCompletion("t",vi.fn())).rejects.toThrow();h.request.mockRejectedValue(new Error("Unavailable"));await expect(redirectPostgresCompletion("t",vi.fn())).rejects.toThrow("Unavailable");});
