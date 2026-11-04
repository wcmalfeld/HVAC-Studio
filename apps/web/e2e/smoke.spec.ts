import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end smoke: register → create project → open studio → draw a rectangle room →
 * place a window → wait for "Saved" → reload → room and window still there.
 * Needs the API on :8000 and the web app on :3000 (or E2E_BASE_URL).
 */

async function buildingFromApi(page: Page, projectId: string) {
  const org = await page.evaluate(() => localStorage.getItem("hvac.activeOrgId"));
  const res = await page.request.get(`/api/v1/projects/${projectId}/building`, { headers: { "X-Organization-Id": org ?? "" } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { revision: number; model: { rooms: { name: string }[]; walls: unknown[]; openings: { type: string }[] } };
}

test("register, model a room with a window, and persist across reload", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Company name").fill(`E2E Mechanical ${stamp}`);
  await page.getByLabel("Your name").fill("Sam Tester");
  await page.getByLabel("Work email").fill(`e2e-${stamp}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /Sam/ })).toBeVisible();

  // Create project
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("E2E Smoke House");
  await page.getByLabel("Building address").fill("100 Test Street, Denver, CO");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = page.url().split("/projects/")[1]!;
  await expect(page.getByRole("heading", { name: "E2E Smoke House" })).toBeVisible();

  // Studio
  await page.getByRole("link", { name: "Open Building Studio" }).first().click();
  await expect(page).toHaveURL(/\/studio$/);
  const canvas = page.getByTestId("plan-canvas");
  await expect(canvas.locator("canvas").first()).toBeVisible();
  const box = (await canvas.boundingBox())!;

  // Rectangle room
  await page.locator('[data-tool="rect-room"]').click();
  const a = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  const b = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.7 };
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 5 });
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("Rooms on this floor").getByText("Room 1")).toBeVisible();
  await expect(page.getByTestId("properties").getByText("Room 1").first()).toBeVisible();

  // Window on the top wall
  await page.locator('[data-tool="window"]').click();
  const top = { x: (a.x + b.x) / 2, y: a.y };
  await page.mouse.move(top.x, top.y + 30);
  await page.mouse.move(top.x, top.y, { steps: 4 });
  await page.mouse.click(top.x, top.y);
  await expect(page.getByTestId("properties").getByText("Window", { exact: true })).toBeVisible();

  // Autosave
  await expect(page.getByTestId("save-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  const saved = await buildingFromApi(page, projectId);
  expect(saved.model.rooms).toHaveLength(1);
  expect(saved.model.walls).toHaveLength(4);
  expect(saved.model.openings.map((o) => o.type)).toEqual(["window"]);

  // Reload: still there, no restore prompt
  await page.reload();
  await expect(page.getByLabel("Rooms on this floor").getByText("Room 1")).toBeVisible();
  await expect(page.getByText("Restore unsaved changes?")).toHaveCount(0);
  const after = await buildingFromApi(page, projectId);
  expect(after.model.rooms[0]!.name).toBe("Room 1");
  expect(after.model.openings).toHaveLength(1);
  expect(after.revision).toBe(saved.revision);

  // Undo the window, verify it saves, redo
  await page.getByTestId("plan-canvas").click({ position: { x: 5, y: 5 } });
});
