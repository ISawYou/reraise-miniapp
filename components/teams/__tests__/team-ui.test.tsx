import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RosterSlots, formatRankBadge, formatStandingLine } from "@/components/teams/team-ui";

let container: HTMLDivElement;
let root: Root;

function member(overrides: Record<string, unknown> = {}) {
  return {
    player_id: "p1",
    display_name: "Player",
    username: null,
    telegram_avatar_url: null,
    custom_avatar_url: null,
    is_captain: false,
    ...overrides,
  };
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("formatRankBadge / formatStandingLine -- zero-point ranking UX", () => {
  it("7/9. rank=null never renders as an official number; a positive rank does", () => {
    expect(formatRankBadge(null)).toBe("—");
    expect(formatRankBadge(2)).toBe("#2");
  });

  it("zero-point team: 'Пока без рейтинга · 0 очков', never '#1'", () => {
    expect(formatStandingLine("active", null, 0)).toBe("Пока без рейтинга · 0 очков");
    expect(formatStandingLine("active", null, 0)).not.toContain("#1");
  });

  it("positive-score team shows its official rank and points", () => {
    expect(formatStandingLine("active", 2, 820)).toBe("#2 в рейтинге · 820 очков");
  });

  it("disbanded team always shows 'Распущена' regardless of rank", () => {
    expect(formatStandingLine("disbanded", null, 0)).toBe("Распущена");
    expect(formatStandingLine("disbanded", 3, 500)).toBe("Распущена");
  });
});

describe("RosterSlots", () => {
  it("11. renders exactly 5 total slots regardless of member count", async () => {
    await act(async () => root.render(<RosterSlots members={[member()]} />));
    expect(container.querySelectorAll('[data-testid="roster-slot"]')).toHaveLength(5);

    await act(async () => root.render(<RosterSlots members={[]} />));
    expect(container.querySelectorAll('[data-testid="roster-slot"]')).toHaveLength(5);
  });

  it("10. filled slots render the member's avatar (fallback initial when no avatar url)", async () => {
    await act(async () =>
      root.render(<RosterSlots members={[member({ player_id: "p1", display_name: "Alice" }), member({ player_id: "p2", display_name: "Bob" })]} />)
    );
    const filled = container.querySelectorAll('[data-slot-state="filled"]');
    expect(filled).toHaveLength(2);
    expect(container.textContent).toContain("A"); // Alice's fallback initial
  });

  it("captain gets a crown marker on their filled slot", async () => {
    await act(async () => root.render(<RosterSlots members={[member({ is_captain: true })]} />));
    expect(container.textContent).toContain("👑");
  });

  it("12. an onInviteSlotClick handler turns the FIRST empty slot into a '+ Пригласить' affordance", async () => {
    const onInvite = vi.fn();
    await act(async () => root.render(<RosterSlots members={[member()]} onInviteSlotClick={onInvite} />));

    const inviteSlots = container.querySelectorAll('[data-slot-state="invite"]');
    expect(inviteSlots).toHaveLength(1);
    expect(container.textContent).toContain("Пригласить");

    await act(async () => (inviteSlots[0] as HTMLButtonElement).click());
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it("13. without onInviteSlotClick (public/non-captain viewer), no invite affordance ever renders -- only neutral empty placeholders", async () => {
    await act(async () => root.render(<RosterSlots members={[member()]} />));
    expect(container.querySelectorAll('[data-slot-state="invite"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot-state="empty"]')).toHaveLength(4);
    expect(container.textContent).not.toContain("Пригласить");
  });

  it("14. a full 5/5 team never shows an invite slot even when onInviteSlotClick is passed", async () => {
    const onInvite = vi.fn();
    const fullRoster = Array.from({ length: 5 }, (_, i) => member({ player_id: `p${i}` }));
    await act(async () => root.render(<RosterSlots members={fullRoster} onInviteSlotClick={onInvite} />));

    expect(container.querySelectorAll('[data-slot-state="invite"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot-state="filled"]')).toHaveLength(5);
    expect(container.textContent).not.toContain("Пригласить");
  });
});
