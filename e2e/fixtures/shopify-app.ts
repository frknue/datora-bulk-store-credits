import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";
import { URLS } from "../helpers/constants";

const PROFILE_DIR = ".auth/chrome-profile";
const CREATE_JOB_URL = `${URLS.APP_BASE}${URLS.CREATE_JOB}`;

// Wrapper that provides a consistent locator API regardless of whether
// the app renders in an iframe or directly in the page.
export type AppLocator = {
  locator: (selector: string) => Locator;
};

// Single shared browser instance across ALL tests
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

export const test = base.extend<{
  appFrame: AppLocator;
  shopifyPage: Page;
}>({
  shopifyPage: async ({}, use) => {
    await use(await getSharedPage());
  },

  appFrame: async ({}, use) => {
    const page = await getSharedPage();

    // Always navigate fresh to ensure clean form state
    await page.goto(CREATE_JOB_URL);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3_000);

    // Search all frames for the one containing the app
    for (const frame of page.frames()) {
      try {
        const sPage = frame.locator("s-page");
        if ((await sPage.count()) > 0) {
          await expect(sPage).toBeVisible({ timeout: 10_000 });
          await use({ locator: (s: string) => frame.locator(s) });
          return;
        }
      } catch {
        // not in this frame, try next
      }
    }

    // Fallback: check the main page directly
    await expect(page.locator("s-page")).toBeVisible({ timeout: 30_000 });
    await use({ locator: (s: string) => page.locator(s) });
  },
});

process.on("exit", () => {
  sharedContext?.close().catch(() => {});
});

export { expect } from "@playwright/test";
