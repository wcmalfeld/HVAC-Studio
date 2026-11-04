import { expect, type Page } from "@playwright/test";

/** Register a throwaway account + organization so tests never write into shared/demo data. */
export async function registerFresh(page: Page, label = "E2E") {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto("/register");
  await page.getByLabel("Company name").fill(`${label} Mechanical ${stamp}`);
  await page.getByLabel("Your name").fill("Sam Tester");
  await page.getByLabel("Work email").fill(`e2e-${stamp}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}
