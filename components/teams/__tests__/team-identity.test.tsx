import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamIdentity } from "@/components/teams/team-ui";

let container: HTMLDivElement;
let root: Root;

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

describe("TeamIdentity", () => {
  it("renders the emoji emblem when avatar_url is absent", async () => {
    await act(async () => {
      root.render(<TeamIdentity team={{ emblem: "🦈", avatar_url: null }} />);
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("🦈");
  });

  it("renders the photo (an <img>) when avatar_url is present, instead of the emblem text", async () => {
    await act(async () => {
      root.render(<TeamIdentity team={{ emblem: "🦈", avatar_url: "https://cdn/teams/team-1/avatar.webp?v=1" }} />);
    });

    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn/teams/team-1/avatar.webp?v=1");
    expect(container.textContent).not.toContain("🦈");
  });
});
