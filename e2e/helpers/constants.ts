export const URLS = {
  APP_BASE:
    "https://admin.shopify.com/store/app-store-apps-furkan/apps/datora-bulk-gift-cards-dev",
  CREATE_JOB: "/app/job/create",
  DASHBOARD: "/app",
} as const;

export const APP_IFRAME_SELECTOR = 'iframe[id="app-iframe"]';
export const APP_IFRAME_SELECTOR_ALT = 'iframe[src*="datora"]';

export const TEST_DATA = {
  validCount: "10",
  validValue: "25.00",
  validPrefix: "TEST",
  validPostfix: "END",
  defaultCodeLength: "16",
  validNote: "E2E test note",
  validPresetName: "E2E Test Preset",
  overLimitCount: "100000",
  zeroValue: "0",
} as const;

export const FORM_LIMITS = {
  countMaxVolume: 75_000,
  prefixMaxChars: 4,
  postfixMaxChars: 4,
  valueMax: 10_000_000,
  noteMaxChars: 100,
  codeLngMin: 8,
  codeLngMax: 20,
  codeLngDefault: 16,
  presetMaxChars: 50,
} as const;
