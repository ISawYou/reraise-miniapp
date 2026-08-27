import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findByIdOrThrow: vi.fn(),
  listOrderedByCreatedAtDesc: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/repositories", () => ({
  playerRepository: {
    findByIdOrThrow: mocks.findByIdOrThrow,
    listOrderedByCreatedAtDesc: mocks.listOrderedByCreatedAtDesc,
    update: mocks.update,
  },
}));

const { assignPlayerRole, InvalidRoleError, SelfDemotionError, LastSuperAdminError } =
  await import("@/features/roles");

function player(overrides: Partial<{ id: string; role: string }> = {}) {
  return {
    id: "target-1",
    display_name: "Target",
    role: "player",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
    ...player({ id }),
    ...patch,
  }));
});

describe("assignPlayerRole", () => {
  it("Super Admin can create an operator", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ role: "player" }));

    await assignPlayerRole("target-1", "operator", "admin-1");

    expect(mocks.update).toHaveBeenCalledWith("target-1", { role: "operator" });
  });

  it("Super Admin can promote another player to Super Admin", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ role: "operator" }));
    mocks.listOrderedByCreatedAtDesc.mockResolvedValue([
      { id: "admin-1", role: "admin" },
      player({ role: "operator" }),
    ]);

    await assignPlayerRole("target-1", "admin", "admin-1");

    expect(mocks.update).toHaveBeenCalledWith("target-1", { role: "admin" });
  });

  it("rejects an unknown role string", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player());

    await expect(assignPlayerRole("target-1", "superuser", "admin-1")).rejects.toThrow(InvalidRoleError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a Super Admin cannot remove their OWN Super Admin role", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ id: "admin-1", role: "admin" }));

    await expect(assignPlayerRole("admin-1", "operator", "admin-1")).rejects.toThrow(SelfDemotionError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("demoting the LAST Super Admin (a different one, not self) is rejected -- zero Super Admins is never allowed", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ id: "admin-2", role: "admin" }));
    // Only one Super Admin exists overall, and it's the target itself.
    mocks.listOrderedByCreatedAtDesc.mockResolvedValue([player({ id: "admin-2", role: "admin" })]);

    await expect(assignPlayerRole("admin-2", "operator", "admin-1")).rejects.toThrow(LastSuperAdminError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("demoting a Super Admin when another Super Admin still exists is allowed", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ id: "admin-2", role: "admin" }));
    mocks.listOrderedByCreatedAtDesc.mockResolvedValue([
      player({ id: "admin-1", role: "admin" }),
      player({ id: "admin-2", role: "admin" }),
    ]);

    await assignPlayerRole("admin-2", "operator", "admin-1");

    expect(mocks.update).toHaveBeenCalledWith("admin-2", { role: "operator" });
  });

  it("assigning the same role the target already has is a harmless no-op", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ role: "operator" }));

    const result = await assignPlayerRole("target-1", "operator", "admin-1");

    expect(mocks.update).not.toHaveBeenCalled();
    expect(result.role).toBe("operator");
  });

  it("promoting a plain player to operator never triggers the last-super-admin check", async () => {
    mocks.findByIdOrThrow.mockResolvedValue(player({ role: "player" }));

    await assignPlayerRole("target-1", "operator", "admin-1");

    expect(mocks.listOrderedByCreatedAtDesc).not.toHaveBeenCalled();
  });
});
