import { test, expect } from "../../fixtures/dashboard-app";

/**
 * Helper: click the first per-row download button in the gift-cards table.
 * Playwright considers s-button inside s-table-cell as "hidden" due to shadow
 * DOM, so we click it programmatically.
 */
async function clickFirstDownloadButton(appFrame: { locator: (s: string) => any }) {
  const btn = appFrame.locator('s-button[icon="page-down"]').first();
  await btn.waitFor({ state: "attached", timeout: 10_000 });
  await btn.evaluate((el: HTMLElement) => el.click());
}

test.describe("Download page", () => {
  test("gift cards dashboard shows per-row download buttons", async ({
    appFrame,
  }) => {
    await expect(appFrame.locator('s-page[heading="Gift Card Jobs"]')).toBeVisible();

    const downloadButtons = appFrame.locator('s-button[icon="page-down"]');
    const count = await downloadButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test("clicking a download button navigates to the download page", async ({
    appFrame,
  }) => {
    await clickFirstDownloadButton(appFrame);

    const page = appFrame.locator('s-page[heading="Download gift cards"]');
    await expect(page).toBeAttached({ timeout: 10_000 });
  });

  test("download page contains separator select with correct options", async ({
    appFrame,
  }) => {
    await clickFirstDownloadButton(appFrame);

    const page = appFrame.locator('s-page[heading="Download gift cards"]');
    await expect(page).toBeAttached({ timeout: 10_000 });

    const separator = page.locator('s-select[label="Separator"]');
    await expect(separator).toBeAttached();

    await expect(page.locator('s-option[value="comma"]')).toBeAttached();
    await expect(page.locator('s-option[value="semicolon"]')).toBeAttached();
  });

  test("download page contains field checkboxes", async ({ appFrame }) => {
    await clickFirstDownloadButton(appFrame);

    const page = appFrame.locator('s-page[heading="Download gift cards"]');
    await expect(page).toBeAttached({ timeout: 10_000 });

    // Code checkbox should be present and disabled
    const codeCheckbox = page.locator('s-checkbox[label="Code"]');
    await expect(codeCheckbox).toBeAttached();
    await expect(codeCheckbox).toHaveAttribute("disabled", "");

    // Other field checkboxes should be present
    for (const label of ["ID", "Value", "Note", "Expires On", "Created At"]) {
      await expect(page.locator(`s-checkbox[label="${label}"]`)).toBeAttached();
    }
  });

  test("download page contains code format section with Uppercase and Splitted", async ({
    appFrame,
  }) => {
    await clickFirstDownloadButton(appFrame);

    const page = appFrame.locator('s-page[heading="Download gift cards"]');
    await expect(page).toBeAttached({ timeout: 10_000 });

    await expect(page.locator('s-checkbox[label="Uppercase"]')).toBeAttached();
    await expect(page.locator('s-checkbox[label="Splitted"]')).toBeAttached();
  });

  test("download page has Cancel and Download action buttons", async ({
    appFrame,
  }) => {
    await clickFirstDownloadButton(appFrame);

    const page = appFrame.locator('s-page[heading="Download gift cards"]');
    await expect(page).toBeAttached({ timeout: 10_000 });

    // The page has a tertiary Cancel button and a primary Download button.
    const cancelButton = page.locator('s-button[variant="tertiary"]');
    await expect(cancelButton).toBeAttached();

    const primaryButton = page.locator('s-button[variant="primary"]');
    await expect(primaryButton).toBeAttached();
  });

  test("cancel button navigates away from the download page", async ({
    appFrame,
  }) => {
    await clickFirstDownloadButton(appFrame);

    const downloadPage = appFrame.locator(
      's-page[heading="Download gift cards"]',
    );
    await expect(downloadPage).toBeAttached({ timeout: 10_000 });

    const cancelButton = downloadPage.locator('s-button[variant="tertiary"]');
    await cancelButton.evaluate((el: HTMLElement) => el.click());

    // After Cancel, the page should change (download page no longer in DOM).
    await expect(downloadPage).not.toBeAttached({ timeout: 10_000 });
  });

  test("download button triggers CSV download and navigates away", async ({
    appFrame,
  }) => {
    await clickFirstDownloadButton(appFrame);

    const downloadPage = appFrame.locator(
      's-page[heading="Download gift cards"]',
    );
    await expect(downloadPage).toBeAttached({ timeout: 10_000 });

    const primaryButton = downloadPage.locator('s-button[variant="primary"]');
    await primaryButton.evaluate((el: HTMLElement) => el.click());

    // After successful download, the page navigates away.
    await expect(downloadPage).not.toBeAttached({ timeout: 15_000 });
  });
});
