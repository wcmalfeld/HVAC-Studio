import { expect, test, type Page } from "@playwright/test";
import { registerFresh } from "./helpers";

/**
 * Studio interaction coverage beyond the smoke test: typed wall lengths, undo/redo, delete cascade,
 * revision conflict handling, and canvas performance with a ~400 wall / 150 room stress model.
 */
async function login(page: Page) {
  await registerFresh(page, "Studio");
}

async function newProject(page: Page, name: string, query = "") {
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const id = page.url().split("/projects/")[1]!;
  await page.goto(`/projects/${id}/studio${query}`);
  await expect(page.getByTestId("plan-canvas").locator("canvas").first()).toBeVisible();
  return id;
}

async function api(page: Page, path: string, init?: { method?: string; data?: unknown }) {
  const org = await page.evaluate(() => localStorage.getItem("hvac.activeOrgId"));
  const headers = { "X-Organization-Id": org ?? "", "X-Requested-With": "hvac-studio" };
  const res = init?.method === "PUT" ? await page.request.put(`/api/v1${path}`, { headers, data: init.data }) : await page.request.get(`/api/v1${path}`, { headers });
  return res;
}

test("typed wall lengths, undo/redo and delete cascade", async ({ page }) => {
  await login(page);
  const id = await newProject(page, `Tools ${Date.now()}`);
  const box = (await page.getByTestId("plan-canvas").boundingBox())!;
  const o = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.6 };

  await page.keyboard.press("w");
  await page.mouse.click(o.x, o.y);
  await page.mouse.move(o.x + 200, o.y, { steps: 3 });
  await page.keyboard.type("12'6\"");
  await page.keyboard.press("Enter");
  await page.mouse.move(o.x + 200, o.y - 200, { steps: 3 });
  await page.keyboard.type("10");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  let doc = await (await api(page, `/projects/${id}/building`)).json();
  expect(doc.model.walls).toHaveLength(2);
  const len = (w: { start: { x: number; y: number }; end: { x: number; y: number } }) => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
  expect(len(doc.model.walls[0])).toBeCloseTo(150, 6);
  expect(len(doc.model.walls[1])).toBeCloseTo(120, 6);

  // Window on the first wall, then delete the wall → window goes too
  await page.keyboard.press("n");
  const mid = { x: o.x + 30, y: o.y };
  await page.mouse.move(mid.x, mid.y - 20);
  await page.mouse.move(mid.x, mid.y, { steps: 3 });
  await page.mouse.click(mid.x, mid.y);
  await page.keyboard.press("v");
  await page.mouse.click(o.x + 140, o.y); // on the wall, clear of the window near its start
  await expect(page.getByTestId("properties").getByText("Exterior wall")).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  doc = await (await api(page, `/projects/${id}/building`)).json();
  expect(doc.model.walls).toHaveLength(1);
  expect(doc.model.openings).toHaveLength(0);

  // Undo restores wall + window
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  doc = await (await api(page, `/projects/${id}/building`)).json();
  expect(doc.model.walls).toHaveLength(2);
  expect(doc.model.openings).toHaveLength(1);
});

test("revision conflict shows the conflict dialog and 'keep mine' resolves it", async ({ page }) => {
  await login(page);
  const id = await newProject(page, `Conflict ${Date.now()}`);
  // Someone else saves first
  const cur = await (await api(page, `/projects/${id}/building`)).json();
  const theirs = { ...cur.model, northAngleDeg: 45 };
  const put = await api(page, `/projects/${id}/building`, { method: "PUT", data: { revision: cur.revision, model: theirs } });
  expect(put.ok()).toBeTruthy();

  const box = (await page.getByTestId("plan-canvas").boundingBox())!;
  await page.keyboard.press("b");
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText("This building was changed somewhere else")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "conflict");
  await page.getByRole("button", { name: /Keep mine/ }).click();
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  const after = await (await api(page, `/projects/${id}/building`)).json();
  expect(after.model.rooms).toHaveLength(1);
  expect(after.revision).toBeGreaterThan(cur.revision + 1);
});

test("stress model stays responsive and saves", async ({ page }) => {
  await login(page);
  const id = await newProject(page, `Stress ${Date.now()}`, "?debug=1");
  await page.getByRole("button", { name: "Debug menu" }).click();
  await page.getByRole("menuitem", { name: /stress grid/i }).click();
  await expect(page.getByLabel("Rooms on this floor").locator("button")).toHaveCount(150);

  // Measure frame times while panning and hovering across the model.
  const box = (await page.getByTestId("plan-canvas").boundingBox())!;
  await page.evaluate(() => {
    (window as unknown as { __frames: number[] }).__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      (window as unknown as { __frames: number[] }).__frames.push(t - last);
      last = t;
      if ((window as unknown as { __frames: number[] }).__frames.length < 2000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.press("v");
  for (let i = 0; i < 60; i++) await page.mouse.move(box.x + 100 + i * 12, box.y + 150 + (i % 10) * 20);
  await page.keyboard.press("h");
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) await page.mouse.move(box.x + 400 + i * 4, box.y + 300 + i * 2);
  await page.mouse.up();
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, i < 5 ? -120 : 120);
  const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames.slice(5));
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  console.log(`stress: ${frames.length} frames, median ${sorted[Math.floor(sorted.length / 2)]!.toFixed(1)}ms, p95 ${p95.toFixed(1)}ms`);
  expect(p95).toBeLessThan(50);

  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 20_000 });
  const doc = await (await api(page, `/projects/${id}/building`)).json();
  expect(doc.model.rooms.length).toBe(150);
  expect(doc.model.walls.length).toBeGreaterThan(300);
  await page.screenshot({ path: `${process.env.SCREENS_DIR || "test-results"}/studio-stress.png` });
});
