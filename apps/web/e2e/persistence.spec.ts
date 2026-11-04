import { expect, test, type Page } from "@playwright/test";
import { registerFresh } from "./helpers";

async function api(page: Page, path: string) {
  const org = await page.evaluate(() => localStorage.getItem("hvac.activeOrgId"));
  return (await page.request.get(`/api/v1${path}`, { headers: { "X-Organization-Id": org ?? "" } })).json();
}
const saved = (page: Page) => expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 20_000 });

async function drag(page: Page, a: { x: number; y: number }, b: { x: number; y: number }) {
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
}
async function hoverClick(page: Page, p: { x: number; y: number }) {
  await page.mouse.move(p.x, p.y + 25);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.mouse.click(p.x, p.y);
}

test("QA: multi-room model, components, property edit, undo/redo, reload, crash recovery, conflict", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const page = await ctxA.newPage();
  await registerFresh(page, "QA");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("QA House");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const id = page.url().split("/projects/")[1]!;
  await page.goto(`/projects/${id}/studio`);
  const canvas = page.getByTestId("plan-canvas");
  await expect(canvas.locator("canvas").first()).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const P = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  // Two adjacent rectangle rooms
  await page.locator('[data-tool="rect-room"]').click();
  await drag(page, P(0.25, 0.3), P(0.45, 0.6));
  await page.locator('[data-tool="rect-room"]').click();
  await drag(page, P(0.45, 0.3), P(0.65, 0.6));
  // A free wall
  await page.locator('[data-tool="wall"]').click();
  await page.mouse.click(P(0.25, 0.75).x, P(0.25, 0.75).y);
  await page.mouse.move(P(0.4, 0.75).x, P(0.4, 0.75).y, { steps: 3 });
  await page.keyboard.type("10'");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  // Window on top wall of room 1, door on bottom wall of room 2
  await page.locator('[data-tool="window"]').click();
  await hoverClick(page, P(0.35, 0.3));
  await page.locator('[data-tool="door"]').click();
  await hoverClick(page, P(0.55, 0.6));
  await saved(page);
  let doc = await api(page, `/projects/${id}/building`);
  console.log("rooms", doc.model.rooms.length, "walls", doc.model.walls.length, "openings", doc.model.openings.map((o: { type: string }) => o.type));
  expect(doc.model.rooms).toHaveLength(2);
  expect(doc.model.walls.length).toBeGreaterThanOrEqual(8);
  expect(doc.model.openings.map((o: { type: string }) => o.type).sort()).toEqual(["door", "window"]);

  // Select room 1 via list, edit name and ceiling height in right panel
  await page.getByLabel("Rooms on this floor").getByText("Room 1").click();
  const name = page.getByTestId("properties").getByLabel("Room name");
  await name.fill("Great Room");
  await name.press("Enter");
  const ceil = page.getByTestId("properties").getByLabel("Ceiling height");
  await ceil.fill("9'");
  await ceil.press("Enter");
  await saved(page);
  doc = await api(page, `/projects/${id}/building`);
  const r1 = doc.model.rooms.find((r: { name: string }) => r.name === "Great Room");
  expect(r1).toBeTruthy();
  expect(r1.ceilingHeight).toBe(108);
  // UI area/volume vs hand calc from stored boundary
  const b = r1.boundary as { x: number; y: number }[];
  let a2 = 0;
  for (let i = 0; i < b.length; i++) { const p = b[i]!, q = b[(i + 1) % b.length]!; a2 += p.x * q.y - q.x * p.y; }
  const areaSqFt = Math.abs(a2) / 2 / 144;
  console.log("room1 area sqft", areaSqFt, "vol", (areaSqFt * 9).toFixed(1), "panel:", await page.getByTestId("properties").innerText().then((t) => t.split("\n").slice(0, 8).join(" | ")));
  // Untouched opening fields stay null (no silent defaults)
  const win = doc.model.openings.find((o: { type: string }) => o.type === "window");
  console.log("window properties", JSON.stringify(win.properties ?? win), "provenance", JSON.stringify(win.provenance));

  // Undo/redo on the canvas
  await canvas.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z"); // undo ceiling
  await page.keyboard.press("Control+z"); // undo name
  await saved(page);
  doc = await api(page, `/projects/${id}/building`);
  expect(doc.model.rooms.map((r: { name: string }) => r.name).sort()).toEqual(["Room 1", "Room 2"]);
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  await saved(page);
  doc = await api(page, `/projects/${id}/building`);
  expect(doc.model.rooms.find((r: { name: string }) => r.name === "Great Room")?.ceilingHeight).toBe(108);
  const savedRev = doc.revision;

  // Close and reopen (new page in same context)
  await page.close();
  const p2 = await ctxA.newPage();
  await p2.goto(`/projects/${id}/studio`);
  await expect(p2.getByLabel("Rooms on this floor").getByText("Great Room")).toBeVisible();
  await expect(p2.getByText("Restore unsaved changes?")).toHaveCount(0);
  const doc2 = await api(p2, `/projects/${id}/building`);
  expect(doc2.revision).toBe(savedRev);
  expect(JSON.stringify(doc2.model)).toBe(JSON.stringify(doc.model));

  // Crash recovery: block saves, make an edit, "crash" (close page), reopen → restore prompt
  await p2.route("**/api/v1/projects/*/building", (r) => (r.request().method() === "PUT" ? r.abort() : r.continue()));
  await p2.getByLabel("Rooms on this floor").getByText("Room 2").click();
  const n2 = p2.getByTestId("properties").getByLabel("Room name");
  await n2.fill("Crash Room");
  await n2.press("Enter");
  await expect.poll(() => p2.evaluate((pid) => localStorage.getItem(`hvac.draft.${pid}`)?.includes("Crash Room") ?? false, id)).toBe(true);
  await p2.close({ runBeforeUnload: false });
  const p3 = await ctxA.newPage();
  await p3.goto(`/projects/${id}/studio`);
  await expect(p3.getByText("Restore unsaved changes?")).toBeVisible();
  await p3.getByRole("button", { name: "Restore unsaved changes" }).click();
  await saved(p3);
  const doc3 = await api(p3, `/projects/${id}/building`);
  expect(doc3.model.rooms.map((r: { name: string }) => r.name).sort()).toEqual(["Crash Room", "Great Room"]);

  // Conflict across two browser contexts (same user)
  const ctxB = await browser.newContext({ storageState: await ctxA.storageState() });
  const pb = await ctxB.newPage();
  await pb.goto(`/projects/${id}/studio`);
  await expect(pb.getByLabel("Rooms on this floor").getByText("Crash Room")).toBeVisible();
  // A edits and saves
  await p3.getByLabel("Rooms on this floor").getByText("Great Room").click();
  const na = p3.getByTestId("properties").getByLabel("Room name");
  await na.fill("From A");
  await na.press("Enter");
  await saved(p3);
  // B edits stale copy
  await pb.getByLabel("Rooms on this floor").getByText("Crash Room").click();
  const nb = pb.getByTestId("properties").getByLabel("Room name");
  await nb.fill("From B");
  await nb.press("Enter");
  await expect(pb.getByTestId("save-status")).toHaveAttribute("data-status", "conflict", { timeout: 20_000 });
  await expect(pb.getByText("This building was changed somewhere else")).toBeVisible();
  const docC = await api(pb, `/projects/${id}/building`);
  const names = docC.model.rooms.map((r: { name: string }) => r.name).sort();
  console.log("after conflict server names", names);
  expect(names).toEqual(["Crash Room", "From A"]); // B did not clobber A
  await ctxB.close();
  await ctxA.close();
});
