import { test, expect } from "../../fixtures/job-details-app";

test.describe("Usage Tracking", () => {
  test("job details page loads with tab switcher for premium+ plans", async ({
    appFrame,
  }) => {
    // Verify we are on a job details page
    const page = appFrame.locator("s-page");
    await expect(page).toBeVisible();

    // Check for tab buttons — they only render for Premium+ plans
    // with a completed job. If the current plan is Premium+ and the
    // job is completed, the "Usage Tracking" tab button should exist.
    const usageTab = appFrame.locator('button[type="button"]');
    const tabCount = await usageTab.count();

    if (tabCount >= 2) {
      // Premium+ plan with completed job: both "Details" and
      // "Usage Tracking" tab buttons should be present.
      const detailsTab = usageTab.first();
      const trackingTab = usageTab.nth(1);

      await expect(detailsTab).toBeVisible();
      await expect(trackingTab).toBeVisible();

      // Verify text content
      await expect(detailsTab).toHaveText("Details");
      await expect(trackingTab).toHaveText("Usage Tracking");
    }
    // If tabCount < 2, the plan is Free/Basic or the job is not
    // completed, so the tab switcher is correctly hidden.
  });

  test("clicking Usage Tracking tab shows usage section", async ({ appFrame }) => {
    const tabButtons = appFrame.locator('button[type="button"]');
    const tabCount = await tabButtons.count();

    // Skip if tabs are not present (Free/Basic plan or non-completed job)
    test.skip(tabCount < 2, "Usage tracking tabs not available for this plan/job");

    // Click the "Usage Tracking" tab
    const trackingTab = tabButtons.nth(1);
    await trackingTab.click();

    // The usage tracking section should now be visible
    const usageSection = appFrame.locator('s-section[heading="Usage Tracking"]');
    await expect(usageSection).toBeVisible({ timeout: 5_000 });
  });

  test("Load Usage Data button is present and clickable", async ({
    appFrame,
    shopifyPage,
  }) => {
    const tabButtons = appFrame.locator('button[type="button"]');
    const tabCount = await tabButtons.count();

    test.skip(tabCount < 2, "Usage tracking tabs not available for this plan/job");

    // Click the "Usage Tracking" tab
    await tabButtons.nth(1).click();

    const usageSection = appFrame.locator('s-section[heading="Usage Tracking"]');
    await expect(usageSection).toBeVisible({ timeout: 5_000 });

    // Find the "Load Usage Data" or "Reload Usage" button
    const loadButton = usageSection.locator("s-button").first();
    await expect(loadButton).toBeAttached({ timeout: 5_000 });

    // Set up a request listener to verify the button triggers a network request
    let requestFired = false;
    const onRequest = (request: { url: () => string; method: () => string }) => {
      if (request.method() === "POST" && request.url().includes("/app/jobs/")) {
        requestFired = true;
      }
    };
    shopifyPage.on("request", onRequest);

    // Click via evaluate since s-button is a web component
    await loadButton.evaluate((el: HTMLElement) => el.click());
    await shopifyPage.waitForTimeout(3_000);

    shopifyPage.off("request", onRequest);

    // The button should have triggered a POST request
    expect(requestFired).toBe(true);
  });

  test("Refresh Usage button is present and clickable", async ({
    appFrame,
    shopifyPage,
  }) => {
    const tabButtons = appFrame.locator('button[type="button"]');
    const tabCount = await tabButtons.count();

    test.skip(tabCount < 2, "Usage tracking tabs not available for this plan/job");

    // Click the "Usage Tracking" tab
    await tabButtons.nth(1).click();

    const usageSection = appFrame.locator('s-section[heading="Usage Tracking"]');
    await expect(usageSection).toBeVisible({ timeout: 5_000 });

    // The Refresh Usage button is the second s-button (variant="secondary")
    const refreshButton = usageSection.locator('s-button[variant="secondary"]').first();
    await expect(refreshButton).toBeAttached({ timeout: 5_000 });

    // Set up a request listener to verify the button triggers a network request
    let requestFired = false;
    const onRequest = (request: { url: () => string; method: () => string }) => {
      if (request.method() === "POST" && request.url().includes("/app/jobs/")) {
        requestFired = true;
      }
    };
    shopifyPage.on("request", onRequest);

    // Click via evaluate since s-button is a web component
    await refreshButton.evaluate((el: HTMLElement) => el.click());
    await shopifyPage.waitForTimeout(3_000);

    shopifyPage.off("request", onRequest);

    expect(requestFired).toBe(true);
  });
});
