import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDefaultTournamentVisual } from "@/config/tournament-visuals";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/current-player", () => ({ resolveCurrentPlayer: async () => ({ id: "admin", role: "admin" }) }));
vi.mock("@/lib/client-request", () => ({ fetchAdminJson: mocks.request }));
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));
const { default: Editor } = await import("../page");
let root: Root;
let el: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  el = document.createElement("div"); document.body.append(el); root = createRoot(el);
  mocks.request.mockReset().mockResolvedValue({ visuals: [getDefaultTournamentVisual("classic")] });
  await act(async () => root.render(<Editor />));
});
afterEach(async () => { await act(async () => root.unmount()); el.remove(); });
async function profileTab() {
  const tab = Array.from(el.querySelectorAll('button[role="tab"]')).find(b => b.textContent === "Профиль")!;
  await act(async () => (tab as HTMLButtonElement).click());
}

it("previews both real compact rows with immediate tuning and no upload control", async () => {
  await profileTab();
  expect(el.querySelector('input[type="file"]')).toBeNull();
  const slider = el.querySelector<HTMLInputElement>('input[type="range"]')!;
  expect(slider.max).toBe("300");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, "240");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(el.querySelectorAll('[data-profile-artwork]')).toHaveLength(2);
  for (const image of el.querySelectorAll('img[data-profile-artwork-img]')) {
    expect((image.parentElement as HTMLElement).style.transform).toContain('scale(2.4)');
  }
  expect(mocks.request).toHaveBeenCalledTimes(1); // preview has no write
});

it("saves only selected Profile geometry and resets through its scoped endpoint", async () => {
  await profileTab();
  mocks.request.mockResolvedValue({ visual: { ...getDefaultTournamentVisual("classic"), profile: { scale: 100, offsetX: 0, offsetY: 0, opacity: 100 } } });
  await act(async () => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Сохранить')!.click());
  const [url, init] = mocks.request.mock.calls[1];
  expect(url).toBe('/api/admin/tournament-visuals/profile');
  expect(init.method).toBe('PUT');
  expect(mocks.request.mock.calls[1][2]).toEqual({ retries: 0 });
  expect(JSON.parse(init.body)).toEqual({ tournamentType: 'classic', geometry: { scale: 100, offsetX: 0, offsetY: 0, opacity: 100 } });
  mocks.request.mockResolvedValue({ visual: getDefaultTournamentVisual("classic") });
  expect(el.textContent).toContain('Сброс затрагивает только геометрию арта в Профиле');
  await act(async () => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Сбросить геометрию арта')!.click());
  expect(mocks.request.mock.calls[2][1].method).toBe('DELETE');
});

async function adjustScale(value: string) {
  const slider = el.querySelector<HTMLInputElement>('input[type="range"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function save() {
  await act(async () => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Сохранить')!.click());
}

it('shows unsaved changes and only claims success after server persistence completes', async () => {
  await profileTab();
  await adjustScale('175');
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Не сохранено');
  let finish!: (value: unknown) => void;
  mocks.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await save();
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Не сохранено');
  await act(async () => finish({ visual: { ...getDefaultTournamentVisual('classic'), profile: { scale: 175, offsetX: 0, offsetY: 0, opacity: 100 } } }));
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Сохранено');
  await adjustScale('180');
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Не сохранено');
});

it('shows the actual save/reset error and clears prior success without changing the preview draft', async () => {
  await profileTab();
  mocks.request.mockResolvedValue({ visual: getDefaultTournamentVisual('classic') });
  await save();
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Сохранено');
  await adjustScale('180');
  mocks.request.mockRejectedValue(new Error('Сервер временно недоступен'));
  await save();
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Сервер временно недоступен');
  expect(el.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('180');
  await act(async () => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Сбросить геометрию арта')!.click());
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Сервер временно недоступен');
});

it('does not show a stale unsaved message after selecting another tournament type', async () => {
  await profileTab(); await adjustScale('175');
  await act(async () => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Bounty')!.click());
  expect(el.querySelector('[role="status"]')).toBeNull();
});

it('does not populate a failed read with editable defaults and permits a safe read retry', async () => {
  await act(async () => root.unmount()); root = createRoot(el);
  mocks.request.mockReset().mockRejectedValueOnce(new Error('Настройки недоступны'));
  await act(async () => root.render(<Editor />));
  expect(el.querySelector('[role="alert"]')?.textContent).toBe('Настройки недоступны');
  expect(el.querySelector('input[type="range"]')).toBeNull();
  mocks.request.mockResolvedValue({ visuals: [getDefaultTournamentVisual('classic')] });
  await act(async () => Array.from(el.querySelectorAll('button')).find(b => b.textContent === 'Повторить загрузку')!.click());
  expect(el.querySelector('input[type="range"]')).not.toBeNull();
  expect(el.querySelector('[role="status"]')).toBeNull();
});

it('keeps newer unsaved slider values when an older persisted response arrives', async () => {
  await profileTab(); await adjustScale('175');
  let finish!: (value: unknown) => void;
  mocks.request.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await save();
  // Inputs are disabled in the real UI, but the version guard also protects
  // against an already queued/programmatic slider event during the request.
  await adjustScale('185');
  await act(async () => finish({ visual: { ...getDefaultTournamentVisual('classic'), profile: { scale: 175, offsetX: 0, offsetY: 0, opacity: 100 } } }));
  expect(el.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('185');
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Не сохранено');
});

it('sends narrow Main/List commands, never a full stale asset/config snapshot', async () => {
  mocks.request.mockResolvedValue({ visual: getDefaultTournamentVisual('classic') });
  await adjustScale('130'); await save();
  expect(JSON.parse(mocks.request.mock.calls[1][1].body)).toEqual({ tournamentType: 'classic', surface: 'main', geometry: { scale: 130, offsetX: 0, offsetY: 0, opacity: 100 } });
  await act(async () => Array.from(el.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(b => b.textContent === 'Турниры (список)')!.click());
  await adjustScale('120'); await save();
  expect(JSON.parse(mocks.request.mock.calls[2][1].body)).toEqual({ tournamentType: 'classic', surface: 'list', geometry: { scale: 120, offsetX: 0, offsetY: 0, opacity: 100 } });
});

it('never automatically retries a PNG upload after an ambiguous failure', async () => {
  const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [new File(['fixture'], 'test.png', { type: 'image/png' })] });
  mocks.request.mockRejectedValue(new Error('Соединение потеряно'));
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(mocks.request).toHaveBeenCalledTimes(2); // initial GET + one upload
  expect(mocks.request.mock.calls[1][2]).toEqual({ retries: 0 });
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Соединение потеряно');
});

it('can manually retry a failed write without losing the pending geometry', async () => {
  await profileTab(); await adjustScale('190');
  mocks.request.mockRejectedValue(new Error('Сохранение недоступно')); await save();
  expect(el.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('190');
  expect(el.querySelector('[role="status"]')?.textContent).toBe('Сохранение недоступно');
  mocks.request.mockResolvedValue({ visual: { ...getDefaultTournamentVisual('classic'), profile: { scale: 190, offsetX: 0, offsetY: 0, opacity: 100 } } });
  await save(); expect(el.querySelector('[role="status"]')?.textContent).toBe('Сохранено');
  expect(el.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('190');
});
