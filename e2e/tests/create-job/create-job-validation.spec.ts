import { test, expect } from "../../fixtures/shopify-app";
import {
  polarisField,
  fillPolarisField,
  togglePolarisCheckbox,
} from "../../helpers/polaris";

async function clickSubmit(appFrame: { locator: (s: string) => any }) {
  const btn = appFrame.locator('s-button[variant="primary"]');
  await btn.waitFor({ state: "attached" });
  await btn.evaluate((el: HTMLElement) => el.click());
}

test.describe("Create Job Form - Validation", () => {
  test("submitting empty form shows count and value errors", async ({ appFrame }) => {
    await clickSubmit(appFrame);

    const countField = polarisField(appFrame, "s-number-field", "Count");
    const valueField = appFrame.locator('s-number-field[label*="Value"]');

    await expect(countField).toHaveAttribute("error", /count must be at least 1/i, {
      timeout: 5_000,
    });
    await expect(valueField).toHaveAttribute("error", /value must be greater than 0/i);
  });

  test("count exceeding max shows error", async ({ appFrame }) => {
    await fillPolarisField(polarisField(appFrame, "s-number-field", "Count"), "100000");
    await fillPolarisField(appFrame.locator('s-number-field[label*="Value"]'), "10");

    await clickSubmit(appFrame);

    await expect(polarisField(appFrame, "s-number-field", "Count")).toHaveAttribute(
      "error",
      /cannot exceed/i,
      { timeout: 5_000 },
    );
  });

  test("value of zero shows error", async ({ appFrame }) => {
    await fillPolarisField(polarisField(appFrame, "s-number-field", "Count"), "1");
    await fillPolarisField(appFrame.locator('s-number-field[label*="Value"]'), "0");

    await clickSubmit(appFrame);

    await expect(appFrame.locator('s-number-field[label*="Value"]')).toHaveAttribute(
      "error",
      /greater than 0/i,
      { timeout: 5_000 },
    );
  });

  test("save preset without name shows error", async ({ appFrame }) => {
    const checkbox = appFrame.locator('s-checkbox[label="Save Preset"]');
    if ((await checkbox.count()) === 0) {
      test.skip();
      return;
    }

    await fillPolarisField(polarisField(appFrame, "s-number-field", "Count"), "1");
    await fillPolarisField(appFrame.locator('s-number-field[label*="Value"]'), "10");

    await togglePolarisCheckbox(checkbox, true);
    await clickSubmit(appFrame);

    await expect(polarisField(appFrame, "s-text-field", "Preset Name")).toHaveAttribute(
      "error",
      /preset name is required/i,
      {
        timeout: 5_000,
      },
    );
  });
});
