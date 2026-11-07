import { test, expect } from "@playwright/test";
import path from "node:path";

test.describe("Verify Views & Accessibility", () => {
  test("login page renders correctly with accessible controls and screenshot", async ({ page }) => {
    await page.goto("http://localhost:3000/login");
    await page.waitForLoadState("networkidle");

    // Take screenshot of login page
    const screenshotPath = path.resolve(__dirname, "login.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Inspect HTML: verify skip-link <a href="#main-content"> is present
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();

    // Verify password toggle has aria-label
    const passwordToggle = page.locator('button[aria-label*="kata sandi" i]');
    await expect(passwordToggle).toBeVisible();
    const pwAriaLabel = await passwordToggle.getAttribute("aria-label");
    expect(pwAriaLabel).toBeTruthy();

    // Verify theme toggle button has aria-label and accessible size
    const themeToggle = page.locator('button[aria-label*="mode" i]');
    await expect(themeToggle).toBeVisible();
    const themeAriaLabel = await themeToggle.getAttribute("aria-label");
    expect(themeAriaLabel).toBeTruthy();

    const className = await themeToggle.getAttribute("class");
    expect(className).toMatch(/size-11/);

    const box = await themeToggle.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(36);
      expect(box.height).toBeGreaterThanOrEqual(36);
    }
  });
});
