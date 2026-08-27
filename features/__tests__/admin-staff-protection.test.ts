import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
  deleteLiveEntriesByPlayerId: vi.fn(),
  deleteAchievementsByPlayerId: vi.fn(),
  deleteResultsByPlayerId: vi.fn(),
  deleteRegistrationsByPlayerId: vi.fn(),
  deletePlayer: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findById: mocks.findById,
    update: mocks.update,
    delete: mocks.deletePlayer,
  },
  tournamentLiveStateRepository: {
    deleteLiveEntriesByPlayerId: mocks.deleteLiveEntriesByPlayerId,
  },
  achievementRepository: {
    deleteByPlayerId: mocks.deleteAchievementsByPlayerId,
  },
  resultRepository: {
    deleteByPlayerId: mocks.deleteResultsByPlayerId,
  },
  registrationRepository: {
    deleteByPlayerId: mocks.deleteRegistrationsByPlayerId,
  },
}));

const { setPlayerBlocked, deleteManualPlayer } = await import("@/features/admin");

function player(role: string) {
  return { id: "p1", display_name: "Player", role };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
    ...player("player"),
    id,
    ...patch,
  }));
});

describe("staff account safety", () => {
  it("an ordinary player can be blocked", async () => {
    mocks.findById.mockResolvedValue(player("player"));

    await setPlayerBlocked("p1", true);

    expect(mocks.update).toHaveBeenCalledWith("p1", { is_blocked: true });
  });

  it("an operator cannot be blocked -- must be demoted to player first", async () => {
    mocks.findById.mockResolvedValue(player("operator"));

    await expect(setPlayerBlocked("p1", true)).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a Super Admin cannot be blocked", async () => {
    mocks.findById.mockResolvedValue(player("admin"));

    await expect(setPlayerBlocked("p1", true)).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("unblocking is unaffected by staff protection", async () => {
    mocks.findById.mockResolvedValue(player("admin"));

    await setPlayerBlocked("p1", false);

    expect(mocks.update).toHaveBeenCalledWith("p1", { is_blocked: false });
  });

  it("an ordinary player can be deleted", async () => {
    mocks.findById.mockResolvedValue(player("player"));

    await deleteManualPlayer("p1");

    expect(mocks.deletePlayer).toHaveBeenCalledWith("p1");
  });

  it("an operator cannot be deleted -- must be demoted to player first", async () => {
    mocks.findById.mockResolvedValue(player("operator"));

    await expect(deleteManualPlayer("p1")).rejects.toThrow();
    expect(mocks.deletePlayer).not.toHaveBeenCalled();
    expect(mocks.deleteLiveEntriesByPlayerId).not.toHaveBeenCalled();
  });

  it("a Super Admin cannot be deleted", async () => {
    mocks.findById.mockResolvedValue(player("admin"));

    await expect(deleteManualPlayer("p1")).rejects.toThrow();
    expect(mocks.deletePlayer).not.toHaveBeenCalled();
  });
});
