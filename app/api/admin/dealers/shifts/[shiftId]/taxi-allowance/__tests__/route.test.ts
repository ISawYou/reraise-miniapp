import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSetDealerShiftTaxiAllowance = vi.fn();
const mockResolveCurrentServerActor = vi.fn();

class MockDealerShiftNotFoundError extends Error {}
class MockInvalidTaxiAllowanceError extends Error {}

vi.mock("@/features/dealers", () => ({
  setDealerShiftTaxiAllowance: mockSetDealerShiftTaxiAllowance,
  DealerShiftNotFoundError: MockDealerShiftNotFoundError,
  InvalidTaxiAllowanceError: MockInvalidTaxiAllowanceError,
}));

vi.mock("@/lib/admin-auth", () => ({
  resolveCurrentServerActor: mockResolveCurrentServerActor,
}));

const { PATCH } = await import(
  "@/app/api/admin/dealers/shifts/[shiftId]/taxi-allowance/route"
);

function context(shiftId = "s1") {
  return { params: Promise.resolve({ shiftId }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/admin/dealers/shifts/s1/taxi-allowance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockSetDealerShiftTaxiAllowance.mockReset();
  mockResolveCurrentServerActor.mockReset();
});

describe("PATCH /api/admin/dealers/shifts/[shiftId]/taxi-allowance", () => {
  it("reuses setDealerShiftTaxiAllowance -- same canonical toggle, no second payroll calculator", async () => {
    mockSetDealerShiftTaxiAllowance.mockResolvedValue({
      id: "s1",
      taxi_allowance_rub: 500,
      hourly_rate_rub: 700,
      amount_rub: 2800,
    });
    mockResolveCurrentServerActor.mockResolvedValue({ id: "op1", role: "admin" });

    const response = await PATCH(request({ taxiAllowanceRub: 500 }), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockSetDealerShiftTaxiAllowance).toHaveBeenCalledWith("s1", 500);
    expect(json.shift.amount_rub).toBe(2800);
  });

  it("strips hourly_rate_rub/amount_rub from the response for a non-admin (operator) caller", async () => {
    mockSetDealerShiftTaxiAllowance.mockResolvedValue({
      id: "s1",
      taxi_allowance_rub: 500,
      hourly_rate_rub: 700,
      amount_rub: 2800,
    });
    mockResolveCurrentServerActor.mockResolvedValue({ id: "op1", role: "operator" });

    const response = await PATCH(request({ taxiAllowanceRub: 500 }), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.shift).toEqual({ id: "s1", taxiAllowanceRub: 500 });
    expect(json.shift.hourly_rate_rub).toBeUndefined();
    expect(json.shift.amount_rub).toBeUndefined();
  });

  it("removing the allowance sends 0", async () => {
    mockSetDealerShiftTaxiAllowance.mockResolvedValue({ id: "s1", taxi_allowance_rub: 0 });
    mockResolveCurrentServerActor.mockResolvedValue({ id: "a1", role: "admin" });

    await PATCH(request({ taxiAllowanceRub: 0 }), context());

    expect(mockSetDealerShiftTaxiAllowance).toHaveBeenCalledWith("s1", 0);
  });

  it("rejects a body with no taxiAllowanceRub -- this route does nothing else", async () => {
    const response = await PATCH(request({ hourlyRateRub: 900 }), context());

    expect(response.status).toBe(400);
    expect(mockSetDealerShiftTaxiAllowance).not.toHaveBeenCalled();
  });

  it("maps InvalidTaxiAllowanceError to 400", async () => {
    mockSetDealerShiftTaxiAllowance.mockRejectedValue(new MockInvalidTaxiAllowanceError("bad"));

    const response = await PATCH(request({ taxiAllowanceRub: 250 }), context());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Некорректная сумма чая");
  });

  it("maps DealerShiftNotFoundError to 404", async () => {
    mockSetDealerShiftTaxiAllowance.mockRejectedValue(new MockDealerShiftNotFoundError("missing"));

    const response = await PATCH(request({ taxiAllowanceRub: 500 }), context());

    expect(response.status).toBe(404);
  });
});
