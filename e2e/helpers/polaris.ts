import type { Locator } from "@playwright/test";
import type { AppLocator } from "../fixtures/shopify-app";

/**
 * Locate a Polaris web component by tag name and label attribute.
 */
export function polarisField(frame: AppLocator, tag: string, label: string): Locator {
  return frame.locator(`${tag}[label="${label}"]`);
}

/**
 * Fill a Polaris text/number field by dispatching to its shadow DOM input.
 */
export async function fillPolarisField(locator: Locator, value: string): Promise<void> {
  await locator.waitFor({ state: "attached" });
  await locator.evaluate((el, val) => {
    const input = el.shadowRoot?.querySelector("input");
    if (!input) throw new Error("No input found in shadow root");
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

/**
 * Select an option in a Polaris s-select component.
 */
export async function selectPolarisOption(
  locator: Locator,
  value: string,
): Promise<void> {
  await locator.waitFor({ state: "attached" });
  await locator.evaluate((el, val) => {
    const select = el.shadowRoot?.querySelector("select");
    if (!select) throw new Error("No select found in shadow root");
    select.value = val;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

/**
 * Toggle a Polaris s-checkbox.
 */
export async function togglePolarisCheckbox(
  locator: Locator,
  checked: boolean,
): Promise<void> {
  await locator.waitFor({ state: "attached" });
  const currentChecked = await locator.evaluate((el) => (el as any).checked ?? false);
  if (currentChecked !== checked) {
    await locator.evaluate((el) => (el as HTMLElement).click());
    // Wait for React state to update
    await locator.page().waitForTimeout(500);
  }
}

/**
 * Read the error attribute from a Polaris form field.
 */
export async function getPolarisFieldError(locator: Locator): Promise<string | null> {
  return locator.getAttribute("error");
}
