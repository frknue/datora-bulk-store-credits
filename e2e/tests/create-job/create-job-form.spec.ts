import { test, expect } from "../../fixtures/shopify-app";
import {
  polarisField,
  fillPolarisField,
  selectPolarisOption,
  togglePolarisCheckbox,
} from "../../helpers/polaris";
import { TEST_DATA, FORM_LIMITS } from "../../helpers/constants";

test.describe("Create Job Form - Interactions", () => {
  test("Count field accepts numeric input", async ({ appFrame }) => {
    const countField = polarisField(appFrame, "s-number-field", "Count");
    await fillPolarisField(countField, TEST_DATA.validCount);
    await expect(countField).toHaveAttribute("value", TEST_DATA.validCount);
  });

  test("Value field accepts decimal input", async ({ appFrame }) => {
    const valueField = appFrame.locator('s-number-field[label*="Value"]');
    await fillPolarisField(valueField, TEST_DATA.validValue);
    await expect(valueField).toHaveAttribute("value", TEST_DATA.validValue);
  });

  test("Code Length select defaults to 16 and can be changed", async ({ appFrame }) => {
    const codeLengthSelect = polarisField(appFrame, "s-select", "Code Length");
    await expect(codeLengthSelect).toHaveAttribute(
      "value",
      String(FORM_LIMITS.codeLngDefault),
    );
    await selectPolarisOption(codeLengthSelect, "12");
    await expect(codeLengthSelect).toHaveAttribute("value", "12");
  });

  test("Code Length select has options from 8 to 20", async ({ appFrame }) => {
    const options = appFrame.locator('s-select[label="Code Length"] option');
    const count = await options.count();
    expect(count).toBe(FORM_LIMITS.codeLngMax - FORM_LIMITS.codeLngMin + 1);
  });

  test("Prefix field has 4 char max length", async ({ appFrame }) => {
    const prefixField = polarisField(appFrame, "s-text-field", "Prefix");
    await expect(prefixField).toHaveAttribute(
      "maxLength",
      String(FORM_LIMITS.prefixMaxChars),
    );
    await fillPolarisField(prefixField, TEST_DATA.validPrefix);
    await expect(prefixField).toHaveAttribute("value", TEST_DATA.validPrefix);
  });

  test("Postfix field has 4 char max length", async ({ appFrame }) => {
    const postfixField = polarisField(appFrame, "s-text-field", "Postfix");
    await expect(postfixField).toHaveAttribute(
      "maxLength",
      String(FORM_LIMITS.postfixMaxChars),
    );
    await fillPolarisField(postfixField, TEST_DATA.validPostfix);
    await expect(postfixField).toHaveAttribute("value", TEST_DATA.validPostfix);
  });

  test("Note field has 100 char max length", async ({ appFrame }) => {
    const noteField = appFrame.locator(
      's-text-field[label="Note (only visible to you)"]',
    );
    await expect(noteField).toHaveAttribute(
      "maxLength",
      String(FORM_LIMITS.noteMaxChars),
    );
    await fillPolarisField(noteField, TEST_DATA.validNote);
    await expect(noteField).toHaveAttribute("value", TEST_DATA.validNote);
  });

  test("Expire Date field accepts date input", async ({ appFrame }) => {
    const expireDateField = polarisField(appFrame, "s-date-field", "Expire Date");
    await fillPolarisField(expireDateField, "2027-12-31");
    await expect(expireDateField).toHaveAttribute("value", "2027-12-31");
  });

  test("Save Preset checkbox toggles preset name field", async ({ appFrame }) => {
    const checkbox = appFrame.locator('s-checkbox[label="Save Preset"]');
    if ((await checkbox.count()) === 0) {
      test.skip();
      return;
    }

    const presetNameField = polarisField(appFrame, "s-text-field", "Preset Name");
    await expect(presetNameField).not.toBeVisible();

    await togglePolarisCheckbox(checkbox, true);
    await expect(presetNameField).toBeVisible();

    await togglePolarisCheckbox(checkbox, false);
    await expect(presetNameField).not.toBeVisible();
  });

  test("summary appears when count and value are filled", async ({ appFrame }) => {
    await fillPolarisField(polarisField(appFrame, "s-number-field", "Count"), "5");
    await fillPolarisField(appFrame.locator('s-number-field[label*="Value"]'), "10");

    const summary = appFrame.locator('s-text:has-text("Total:")');
    await expect(summary).toBeVisible({ timeout: 5_000 });
  });
});
