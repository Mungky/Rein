import { test, expect } from "@playwright/test";

test.describe("Smoke Test", () => {
  test("loads login page and renders form", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/REIN/i);
    await expect(page.getByRole("button", { name: /masuk/i })).toBeVisible();
  });
});
