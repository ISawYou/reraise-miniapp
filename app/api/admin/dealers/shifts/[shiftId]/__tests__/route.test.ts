import { describe, expect, it, vi, beforeEach } from "vitest";

const mockEditDealerShiftTimestamps = vi.fn();
const mockCorrectDealerShiftTournament = vi.fn();
const mockCorrectDealerShiftDealer = vi.fn();
const mockSetDealerShiftTaxiAllowance = vi.fn();

class MockDealerShiftNotFoundError extends Error {}
class MockDealerShiftOpenError extends Error {}
class MockInvalidShiftRangeError extends Error {}
class MockInvalidTournamentIdError extends Error {}
class MockInvalidTaxiAllowanceError extends Error {}
class MockDealerNotFoundError extends Error {}

vi.mock("@/features/dealers", () => ({
  editDealerShiftTimestamps: mockEditDealerShiftTimestamps,
  correctDealerShiftTournament: mockCorrectDealerShiftTournament,
  correctDealerShiftDealer: mockCorrectDealerShiftDealer,
  setDealerShiftTaxiAllowance: mockSetDealerShiftTaxiAllowance,
  DealerShiftNotFoundError: MockDealerShiftNotFoundError,
  DealerShiftOpenError: MockDealerShiftOpenError,
  InvalidShiftRangeError: MockInvalidShiftRangeError,
  InvalidTournamentIdError: MockInvalidTournamentIdError,
  InvalidTaxiAllowanceError: MockInvalidTaxiAllowanceError,
  DealerNotFoundError: MockDealerNotFoundError,
}));

const { PATCH } = await import("@/app/api/admin/dealers/shifts/[shiftId]/route");

function context(shiftId = "s1") {
  return { params: Promise.resolve({ shiftId }) };
}

function request(body: unknown) {
  return new Request("http://localhost/api/admin/dealers/shifts/s1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockEditDealerShiftTimestamps.mockReset();
  mockCorrectDealerShiftTournament.mockReset();
  mockCorrectDealerShiftDealer.mockReset();
  mockSetDealerShiftTaxiAllowance.mockReset();
});

describe("PATCH /api/admin/dealers/shifts/[shiftId]", () => {
  it("corrects timestamps when startedAt/endedAt are both present, unchanged behavior", async () => {
    mockEditDealerShiftTimestamps.mockResolvedValue({ id: "s1", amount_rub: 500 });

    const response = await PATCH(
      request({ startedAt: "2026-01-01T18:00:00.000Z", endedAt: "2026-01-01T20:00:00.000Z" }),
      context()
    );

    expect(response.status).toBe(200);
    expect(mockEditDealerShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      "2026-01-01T18:00:00.000Z",
      "2026-01-01T20:00:00.000Z",
      undefined
    );
  });

  it("also threads hourlyRateRub through when present alongside startedAt/endedAt", async () => {
    mockEditDealerShiftTimestamps.mockResolvedValue({ id: "s1", amount_rub: 2800, hourly_rate_rub: 700 });

    const response = await PATCH(
      request({
        startedAt: "2026-01-01T18:00:00.000Z",
        endedAt: "2026-01-01T22:00:00.000Z",
        hourlyRateRub: 700,
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(mockEditDealerShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      "2026-01-01T18:00:00.000Z",
      "2026-01-01T22:00:00.000Z",
      700
    );
  });

  it("toggling taxiAllowanceRub alone does NOT require startedAt/endedAt (works on an open shift)", async () => {
    mockSetDealerShiftTaxiAllowance.mockResolvedValue({ id: "s1", taxi_allowance_rub: 500 });

    const response = await PATCH(request({ taxiAllowanceRub: 500 }), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockSetDealerShiftTaxiAllowance).toHaveBeenCalledWith("s1", 500);
    expect(mockEditDealerShiftTimestamps).not.toHaveBeenCalled();
    expect(json.shift.taxi_allowance_rub).toBe(500);
  });

  it("removing the allowance sends 0", async () => {
    mockSetDealerShiftTaxiAllowance.mockResolvedValue({ id: "s1", taxi_allowance_rub: 0 });

    await PATCH(request({ taxiAllowanceRub: 0 }), context());

    expect(mockSetDealerShiftTaxiAllowance).toHaveBeenCalledWith("s1", 0);
  });

  it("correcting the tournament link alone does not require startedAt/endedAt either", async () => {
    mockCorrectDealerShiftTournament.mockResolvedValue({ id: "s1", tournament_id: "t2" });

    const response = await PATCH(request({ tournamentId: "t2" }), context());

    expect(response.status).toBe(200);
    expect(mockCorrectDealerShiftTournament).toHaveBeenCalledWith("s1", "t2");
    expect(mockEditDealerShiftTimestamps).not.toHaveBeenCalled();
  });

  it("correcting the dealer alone does not require startedAt/endedAt either", async () => {
    mockCorrectDealerShiftDealer.mockResolvedValue({ id: "s1", dealer_player_id: "p2" });

    const response = await PATCH(request({ dealerPlayerId: "p2" }), context());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mockCorrectDealerShiftDealer).toHaveBeenCalledWith("s1", "p2");
    expect(mockEditDealerShiftTimestamps).not.toHaveBeenCalled();
    expect(json.shift.dealer_player_id).toBe("p2");
  });

  it("a single request can correct dealer, tournament, timestamps/rate, and taxi allowance together", async () => {
    mockCorrectDealerShiftDealer.mockResolvedValue({ id: "s1" });
    mockCorrectDealerShiftTournament.mockResolvedValue({ id: "s1" });
    mockEditDealerShiftTimestamps.mockResolvedValue({ id: "s1" });
    mockSetDealerShiftTaxiAllowance.mockResolvedValue({ id: "s1", taxi_allowance_rub: 500 });

    const response = await PATCH(
      request({
        dealerPlayerId: "p2",
        tournamentId: "t2",
        startedAt: "2026-01-01T18:00:00.000Z",
        endedAt: "2026-01-01T22:00:00.000Z",
        hourlyRateRub: 700,
        taxiAllowanceRub: 500,
      }),
      context()
    );

    expect(response.status).toBe(200);
    expect(mockCorrectDealerShiftDealer).toHaveBeenCalledWith("s1", "p2");
    expect(mockCorrectDealerShiftTournament).toHaveBeenCalledWith("s1", "t2");
    expect(mockEditDealerShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      "2026-01-01T18:00:00.000Z",
      "2026-01-01T22:00:00.000Z",
      700
    );
    expect(mockSetDealerShiftTaxiAllowance).toHaveBeenCalledWith("s1", 500);
  });

  it("rejects an empty body -- nothing to change", async () => {
    const response = await PATCH(request({}), context());

    expect(response.status).toBe(400);
    expect(mockEditDealerShiftTimestamps).not.toHaveBeenCalled();
    expect(mockCorrectDealerShiftTournament).not.toHaveBeenCalled();
    expect(mockCorrectDealerShiftDealer).not.toHaveBeenCalled();
    expect(mockSetDealerShiftTaxiAllowance).not.toHaveBeenCalled();
  });

  it("there is no amountRub/amount_rub field anywhere in the accepted body -- sending one is silently ignored", async () => {
    mockEditDealerShiftTimestamps.mockResolvedValue({ id: "s1", amount_rub: 2000 });

    await PATCH(
      request({
        startedAt: "2026-01-01T18:00:00.000Z",
        endedAt: "2026-01-01T22:00:00.000Z",
        amountRub: 999999, // attempted client-supplied override
        amount_rub: 999999,
      }),
      context()
    );

    // The route only ever reads startedAt/endedAt/hourlyRateRub/tournamentId/
    // dealerPlayerId/taxiAllowanceRub off the body -- amountRub/amount_rub
    // are never read or forwarded to editDealerShiftTimestamps.
    expect(mockEditDealerShiftTimestamps).toHaveBeenCalledWith(
      "s1",
      "2026-01-01T18:00:00.000Z",
      "2026-01-01T22:00:00.000Z",
      undefined
    );
  });

  it("maps InvalidTaxiAllowanceError to 400 with a clear message", async () => {
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

  it("maps DealerNotFoundError (invalid reassignment target) to 400", async () => {
    mockCorrectDealerShiftDealer.mockRejectedValue(new MockDealerNotFoundError("not-a-dealer"));

    const response = await PATCH(request({ dealerPlayerId: "not-a-dealer" }), context());
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe("Дилер не найден");
  });
});
