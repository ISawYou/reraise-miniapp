import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlayerAvatarImage } from "@/components/profile/player-avatar-image";

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

async function render(url: string) {
  await act(async () => {
    root.render(<PlayerAvatarImage player={{ display_name: "Alice", custom_avatar_url: url }} />);
  });
}

describe("PlayerAvatarImage", () => {
  it("replaces an inaccessible image with initials without retrying it", async () => {
    await render("https://expired.example/photo.jpg");
    await act(async () => container.querySelector("img")?.dispatchEvent(new Event("error")));

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("A");
  });

  it("tries a newly replaced URL after an earlier URL failed", async () => {
    await render("https://expired.example/photo.jpg");
    await act(async () => container.querySelector("img")?.dispatchEvent(new Event("error")));

    await render("/storage/avatar.jpg?v=2");

    expect(container.querySelector("img")?.getAttribute("src")).toBe("/storage/avatar.jpg?v=2");
  });
});
