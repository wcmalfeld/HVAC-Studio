import { expect, test } from "@playwright/test";
for (const next of ["/\\evil.example.com", "/\t/evil.example.com", "//evil.example.com", "https://evil.example.com", "/%2F%2Fevil.example.com", "javascript:alert(1)"]) {
  test(`next=${JSON.stringify(next)}`, async ({ page }) => {
    await page.route("**://evil.example.com/**", (r) => r.fulfill({ body: "EVIL" }));
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel("Work email").fill("demo@hvacstudio.dev");
    await page.getByLabel("Password").fill("demo-password-123");
    await page.getByRole("button", { name: /Sign in|Log in/ }).click();
    await page.waitForTimeout(3000);
    console.log(JSON.stringify(next), "->", page.url());
    expect(new URL(page.url()).host).toBe("localhost:3000");
  });
}
