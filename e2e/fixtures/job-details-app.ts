import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { URLS } from "../helpers/constants";

const PROFILE_DIR = ".auth/chrome-profile";
const DASHBOARD_URL = `${URLS.APP_BASE}${URLS.DASHBOARD}`;

export type AppLocator = {
  locator: (selector: string) => Locator;
};

let sharedContext: BrowserContext | null = null;
let sharedPage: Page | null = null;

async function getSharedPage(): Promise<Page> {
  if (!sharedContext) {
    sharedContext = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome",
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
  if (!sharedPage) {
    sharedPage = sharedContext.pages()[0] || (await sharedContext.newPage());
  }
  return sharedPage;
}

/**
 * Resolve the AppLocator that points inside the embedded app iframe.
 */
async function resolveAppFrame(page: Page): Promise<AppLocator> {
  for (const frame of page.frames()) {
    try {
      const sPage = frame.locator("s-page");
      if ((await sPage.count()) > 0) {
        await expect(sPage).toBeVisible({ timeout: 10_000 });
        return { locator: (s: string) => frame.locator(s) };
      }
    } catch {
      // not in this frame
    }
  }

  await expect(page.locator("s-page")).toBeVisible({ timeout: 30_000 });
  return { locator: (s: string) => page.locator(s) };
}

export const test = base.extend<{
  appFrame: AppLocator;
  shopifyPage: Page;
}>({
  shopifyPage: async ({}, use) => {
    await use(await getSharedPage());
  },

  appFrame: async ({}, use) => {
    const page = await getSharedPage();

    // Navigate to the dashboard first
    await page.goto(DASHBOARD_URL);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3_000);

    // Find the app frame on the dashboard
    const dashFrame = await resolveAppFrame(page);

    // Click the first completed job row to navigate to its details page.
    // Jobs are rendered in an s-table; look for the first row link.
    const firstJobLink = dashFrame.locator("s-table-body s-table-row s-link").first();
    await firstJobLink.waitFor({ state: "attached", timeout: 10_000 });
    const href = await firstJobLink.getAttribute("href");

    if (href) {
      // Navigate via the full Shopify admin URL
      const jobUrl = href.startsWith("http") ? href : `${URLS.APP_BASE}${href}`;
      await page.goto(jobUrl);
    } else {
      // Fallback: click the link
      await firstJobLink.evaluate((el: HTMLElement) => el.click());
    }

    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3_000);

    // Resolve the app frame on the job details page
    const detailsFrame = await resolveAppFrame(page);
    await use(detailsFrame);
  },
});

process.on("exit", () => {
  sharedContext?.close().catch(() => {});
});

export { expect } from "@playwright/test";
