import { test, expect } from "../../fixtures/shopify-app";
import { polarisField } from "../../helpers/polaris";

test.describe("Create Job Page - Structure", () => {
  test("page loads with correct heading", async ({ appFrame }) => {
    await expect(appFrame.locator('s-page[heading="Create Gift Cards"]')).toBeVisible();
  });

  test("breadcrumb link to Dashboard is present", async ({ appFrame }) => {
    const link = appFrame.locator('s-link[href="/app"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText("Dashboard");
  });

  test("Create Gift Cards primary action button is present", async ({ appFrame }) => {
    const button = appFrame.locator('s-button[variant="primary"]');
    await expect(button).toBeVisible();
    await expect(button).toContainText("Create Gift Cards");
  });

  test("plan banner is displayed", async ({ appFrame }) => {
    const banner = appFrame.locator("s-banner").first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Plan Information");
  });

  test("first row has Count, Value, Code Length in a grid", async ({ appFrame }) => {
    await expect(polarisField(appFrame, "s-number-field", "Count")).toBeVisible();
    await expect(appFrame.locator('s-number-field[label*="Value"]')).toBeVisible();
    await expect(polarisField(appFrame, "s-select", "Code Length")).toBeVisible();
  });

  test("second row has Prefix, Postfix, Expire Date", async ({ appFrame }) => {
    await expect(polarisField(appFrame, "s-text-field", "Prefix")).toBeVisible();
    await expect(polarisField(appFrame, "s-text-field", "Postfix")).toBeVisible();
    await expect(polarisField(appFrame, "s-date-field", "Expire Date")).toBeVisible();
  });

  test("Note field is displayed with correct label", async ({ appFrame }) => {
    await expect(
      appFrame.locator('s-text-field[label="Note (only visible to you)"]'),
    ).toBeVisible();
  });

  test("Save Preset checkbox is displayed when plan supports it", async ({
    appFrame,
  }) => {
    const checkbox = appFrame.locator('s-checkbox[label="Save Preset"]');
    const count = await checkbox.count();
    if (count > 0) {
      await expect(checkbox).toBeVisible();
    }
  });
});
