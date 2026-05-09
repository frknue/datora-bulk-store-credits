import { chromium } from "@playwright/test";

const AUTH_STATE_PATH = ".auth/shopify-state.json";
const PROFILE_DIR = ".auth/chrome-profile";
const APP_URL =
  "https://admin.shopify.com/store/app-store-apps-furkan/apps/datora-bulk-gift-cards-dev/app";

async function main() {
  // Use system Chrome with a persistent profile to avoid bot detection.
  // Playwright's bundled Chromium sets navigator.webdriver=true which
  // Shopify's login blocks.
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(APP_URL);

  // Wait for the user to complete login and reach the admin page.
  // This polls the URL — once it matches the admin app, login is done.
  // Timeout is 5 minutes to allow for MFA, CAPTCHA, etc.
  console.log(
    "\n🔐 Please log in to Shopify in the browser window.\n" +
      "   The script will continue automatically once you reach the app.\n",
  );

  await page.waitForURL(/admin\.shopify\.com\/store\/.*\/apps\//, {
    timeout: 300_000,
  });

  console.log("✅ Login detected — saving auth state...\n");

  await context.storageState({ path: AUTH_STATE_PATH });
  await context.close();

  console.log(`✅ Auth state saved to ${AUTH_STATE_PATH}\n`);
}

main().catch((err) => {
  console.error("Auth setup failed:", err);
  process.exit(1);
});
