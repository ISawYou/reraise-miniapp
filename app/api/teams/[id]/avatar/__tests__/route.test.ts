import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveTeamsActor: vi.fn(),
  uploadTeamAvatar: vi.fn(),
  resetTeamAvatar: vi.fn(),
  createTeamAvatarDerivative: vi.fn(),
}));

vi.mock("@/lib/teams-auth", () => ({ resolveTeamsActor: mocks.resolveTeamsActor }));
vi.mock("@/lib/team-avatar-derivative", () => ({
  createTeamAvatarDerivative: mocks.createTeamAvatarDerivative,
}));

// features/teams.ts pulls in @/lib/db and @/lib/repositories at module
// scope (real Postgres/Supabase clients that need env vars this test
// suite doesn't set up) -- stub those two dependencies exactly like
// features/__tests__/teams.test.ts does, so importActual can load the
// REAL error classes and the real uploadTeamAvatar/resetTeamAvatar
// implementations get overridden below without dragging in a live DB.
vi.mock("@/lib/db", () => ({ db: { transaction: vi.fn(), select: vi.fn() } }));
vi.mock("@/lib/canonical-player", () => ({ resolveCanonicalPlayer: vi.fn() }));
vi.mock("@/lib/telegram-bot-notify", () => ({ sendTeamsTelegramNotification: vi.fn() }));
vi.mock("@/lib/repositories", () => ({
  playerRepository: {},
  resultRepository: {},
  seasonRepository: {},
  avatarStorageRepository: {},
  contentTypeToExtension: () => "jpg",
}));

// features/teams's real error classes + teamsErrorResponse's real mapping
// are used unmocked here (only its DB-touching functions are stubbed) so
// this test also proves the route wires those errors to the right status
// codes, not just that it "calls the function".
vi.mock("@/features/teams", async () => {
  const actual = await vi.importActual<typeof import("@/features/teams")>("@/features/teams");
  return {
    ...actual,
    uploadTeamAvatar: mocks.uploadTeamAvatar,
    resetTeamAvatar: mocks.resetTeamAvatar,
  };
});

const { POST, DELETE } = await import("@/app/api/teams/[id]/avatar/route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function uploadRequest(file: File | null) {
  const formData = new FormData();
  if (file) formData.set("file", file);
  return { formData: async () => formData } as unknown as Request;
}

beforeEach(() => {
  mocks.resolveTeamsActor.mockReset();
  mocks.uploadTeamAvatar.mockReset();
  mocks.resetTeamAvatar.mockReset();
  mocks.createTeamAvatarDerivative.mockReset().mockResolvedValue(Buffer.from("processed-webp-bytes"));
});

describe("POST /api/teams/[id]/avatar", () => {
  it("rejects an unauthenticated caller (401)", async () => {
    mocks.resolveTeamsActor.mockResolvedValue(null);

    const response = await POST(
      uploadRequest(new File(["x"], "a.jpg", { type: "image/jpeg" })),
      ctx("team-1")
    );

    expect(response.status).toBe(401);
    expect(mocks.uploadTeamAvatar).not.toHaveBeenCalled();
  });

  it("rejects a non-image file (400)", async () => {
    mocks.resolveTeamsActor.mockResolvedValue({ id: "captain-1" });

    const response = await POST(
      uploadRequest(new File(["not an image"], "notes.txt", { type: "text/plain" })),
      ctx("team-1")
    );

    expect(response.status).toBe(400);
    expect(mocks.uploadTeamAvatar).not.toHaveBeenCalled();
  });

  it("rejects an oversized file (400)", async () => {
    mocks.resolveTeamsActor.mockResolvedValue({ id: "captain-1" });

    const oversized = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });
    const response = await POST(uploadRequest(oversized), ctx("team-1"));

    expect(response.status).toBe(400);
    expect(mocks.uploadTeamAvatar).not.toHaveBeenCalled();
  });

  it("rejects when no file field is present (400)", async () => {
    mocks.resolveTeamsActor.mockResolvedValue({ id: "captain-1" });

    const response = await POST(uploadRequest(null), ctx("team-1"));

    expect(response.status).toBe(400);
  });

  it("captain upload succeeds: processes with Sharp, persists via uploadTeamAvatar, returns the team", async () => {
    mocks.resolveTeamsActor.mockResolvedValue({ id: "captain-1" });
    mocks.uploadTeamAvatar.mockResolvedValue({ id: "team-1", avatar_url: "https://cdn/teams/team-1/avatar.webp?v=1" });

    const response = await POST(
      uploadRequest(new File(["x"], "photo.jpg", { type: "image/jpeg" })),
      ctx("team-1")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.createTeamAvatarDerivative).toHaveBeenCalled();
    expect(mocks.uploadTeamAvatar).toHaveBeenCalledWith("captain-1", "team-1", expect.any(Buffer), "image/webp");
    expect(payload.team.avatar_url).toContain("avatar.webp");
  });

  it("propagates NotCaptainError from the feature layer as 403", async () => {
    mocks.resolveTeamsActor.mockResolvedValue({ id: "member-1" });
    const { NotCaptainError } = await import("@/features/teams");
    mocks.uploadTeamAvatar.mockRejectedValue(new NotCaptainError());

    const response = await POST(
      uploadRequest(new File(["x"], "photo.jpg", { type: "image/jpeg" })),
      ctx("team-1")
    );

    expect(response.status).toBe(403);
  });

  it("propagates TeamDisbandedError from the feature layer with its error-mapper status", async () => {
    mocks.resolveTeamsActor.mockResolvedValue({ id: "captain-1" });
    const { TeamDisbandedError } = await import("@/features/teams");
    mocks.uploadTeamAvatar.mockRejectedValue(new TeamDisbandedError());

    const response = await POST(
      uploadRequest(new File(["x"], "photo.jpg", { type: "image/jpeg" })),
      ctx("team-1")
    );

    expect(response.status).toBe(409);
  });
});

describe("DELETE /api/teams/[id]/avatar", () => {
  it("rejects an unauthenticated caller (401)", async () => {
    mocks.resolveTeamsActor.mockResolvedValue(null);

    const response = await DELETE({} as Request, ctx("team-1"));

    expect(response.status).toBe(401);
    expect(mocks.resetTeamAvatar).not.toHaveBeenCalled();
  });

  it("captain reset succeeds, sets avatar_url back to null", async () => {
    mocks.resolveTeamsActor.mockResolvedValue({ id: "captain-1" });
    mocks.resetTeamAvatar.mockResolvedValue({ id: "team-1", avatar_url: null });

    const response = await DELETE({} as Request, ctx("team-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.team.avatar_url).toBeNull();
    expect(mocks.resetTeamAvatar).toHaveBeenCalledWith("captain-1", "team-1");
  });
});
