import { expect, test } from "@playwright/test";

/** Visual review captures (not assertions). Uses the seeded demo account. */
const OUT = process.env.SCREENS_DIR || "test-results/screens";

test.skip(!process.env.SCREENS, "set SCREENS=1 to capture screenshots");
test.setTimeout(120_000);

test("capture dashboard, projects, overview and studio", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("demo@hvacstudio.dev");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.screenshot({ path: `${OUT}/login.png` });
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await expect(page.locator("article").first()).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/dashboard.png`, fullPage: true });

  await page.goto("/projects");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/projects.png` });

  await page.locator("tbody tr", { hasText: "Hendricks" }).click();
  await expect(page.getByRole("link", { name: "Open Building Studio" }).first()).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/overview.png` });

  await page.getByRole("link", { name: "Open Building Studio" }).first().click();
  await expect(page.getByTestId("plan-canvas").locator("canvas").first()).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/studio.png` });

  // select a room via the list
  await page.getByLabel("Rooms on this floor").locator("button").first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/studio-room.png` });

  await page.getByTestId("issues-toggle").click();
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/studio-dark.png` });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

  await page.goto("/projects");
  await page.locator("tbody tr", { hasText: "Hendricks" }).click();
  await page.getByRole("link", { name: "Load Analysis" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/coming-soon.png` });
});
