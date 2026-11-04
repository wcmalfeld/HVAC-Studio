import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { registerFresh } from "./helpers";

/** Drawing import foundation: upload a 2-page PDF, choose page 2, place it, calibrate. */
test("import a PDF page as a background and calibrate its scale", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await registerFresh(page, "Import");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill(`Import ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await page.goto(page.url() + "/studio");
  await expect(page.getByTestId("plan-canvas").locator("canvas").first()).toBeVisible();

  await page.getByRole("button", { name: "Import drawing" }).first().click();
  await page.getByTestId("drawing-input").setInputFiles(fileURLToPath(new URL("./fixtures/plan.pdf", import.meta.url)));
  await expect(page.getByText("1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("2 of 2")).toBeVisible();
  await expect(page.getByAltText("Drawing preview")).toBeVisible();
  await page.getByRole("button", { name: "Place on floor" }).click();
  await expect(page.getByText("Not calibrated", { exact: false })).toBeVisible();

  // Calibrate: the placing flow switches to the calibrate tool. Click two points 200px apart.
  const box = (await page.getByTestId("plan-canvas").boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 300);
  await page.mouse.click(box.x + 400, box.y + 300);
  await page.getByLabel("Real distance").fill("20'");
  await page.getByRole("button", { name: "Set scale" }).click();
  await expect(page.getByText(/Calibrated · 1 px =|too coarse/)).toBeVisible();
  await page.screenshot({ path: `${process.env.SCREENS_DIR || "test-results"}/studio-import.png` });
  expect(errors).toEqual([]);
});
