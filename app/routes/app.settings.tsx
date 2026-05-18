import {
  useLoaderData,
  useNavigate,
  useOutletContext,
  useFetcher,
} from "react-router";
import { useState, useCallback, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getPlanFromBilling } from "../services/plan.server";
import { canUseSlackNotifications } from "../lib/subscriptions/plans";
import { AppPageFooter } from "../components/app-page-footer";
import prisma from "../db.server";
import type { AppOutletContext } from "../lib/types/app";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";

interface LoaderData {
  autoDeactivateDays: number | null;
  slackWebhookUrl: string | null;
}

interface ActionData {
  success: boolean;
  intent?: string;
  error?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const user = await prisma.user.findUnique({
    where: { shopName: session.shop },
    select: { autoDeactivateDays: true, slackWebhookUrl: true },
  });

  return {
    autoDeactivateDays: user?.autoDeactivateDays ?? null,
    slackWebhookUrl: user?.slackWebhookUrl ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "saveAutoDeactivation") {
    const enabled = formData.get("enabled") === "true";
    const daysStr = formData.get("days") as string;
    const days = parseInt(daysStr, 10);

    if (enabled && (isNaN(days) || days < 1)) {
      return { success: false, intent, error: "Please enter a valid number of days." };
    }

    await prisma.user.upsert({
      where: { shopName: session.shop },
      update: { autoDeactivateDays: enabled ? days : null },
      create: {
        shopName: session.shop,
        autoDeactivateDays: enabled ? days : null,
      },
    });

    return { success: true, intent };
  }

  if (intent === "saveSlackWebhook" || intent === "testSlackWebhook") {
    const plan = await getPlanFromBilling(admin, billing, session.shop);
    if (!canUseSlackNotifications(plan)) {
      return {
        success: false,
        intent,
        error: "Slack notifications require the Premium or Ultimate plan.",
      };
    }
  }

  if (intent === "saveSlackWebhook") {
    const enabled = formData.get("slackEnabled") === "true";
    const webhookUrl = (formData.get("slackWebhookUrl") as string)?.trim() || "";

    if (enabled && !webhookUrl.startsWith("https://hooks.slack.com/")) {
      return {
        success: false,
        intent,
        error: "Please enter a valid Slack webhook URL.",
      };
    }

    await prisma.user.upsert({
      where: { shopName: session.shop },
      update: { slackWebhookUrl: enabled ? webhookUrl : null },
      create: {
        shopName: session.shop,
        slackWebhookUrl: enabled ? webhookUrl : null,
      },
    });

    return { success: true, intent };
  }

  if (intent === "testSlackWebhook") {
    const user = await prisma.user.findUnique({
      where: { shopName: session.shop },
      select: { slackWebhookUrl: true },
    });

    if (!user?.slackWebhookUrl) {
      return { success: false, intent, error: "No webhook URL configured. Save first." };
    }

    try {
      const resp = await fetch(user.slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Datora Bulk Store Credits: Test notification successful!",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: ":white_check_mark: *Test notification from Datora Bulk Store Credits*\nYour Slack webhook is working correctly.",
              },
            },
          ],
        }),
      });

      if (!resp.ok) {
        return { success: false, intent, error: "Webhook returned an error. Check the URL." };
      }

      return { success: true, intent };
    } catch {
      return { success: false, intent, error: "Failed to reach webhook URL." };
    }
  }

  return { success: false };
};

const SETTINGS_SAVE_BAR = "settings-save-bar";

export default function Settings() {
  const { autoDeactivateDays, slackWebhookUrl } = useLoaderData<LoaderData>();
  const { subscriptionPlan } = useOutletContext<AppOutletContext>();
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const deactivationFetcher = useFetcher<ActionData>();
  const slackFetcher = useFetcher<ActionData>();
  const testFetcher = useFetcher<ActionData>();
  const canSlack = canUseSlackNotifications(subscriptionPlan);

  const initialDeactivateEnabled = autoDeactivateDays !== null;
  const initialDays =
    autoDeactivateDays !== null ? String(autoDeactivateDays) : "90";
  const initialSlackEnabled = slackWebhookUrl !== null;
  const initialWebhookUrl = slackWebhookUrl ?? "";

  const [deactivateEnabled, setDeactivateEnabled] = useState(
    initialDeactivateEnabled,
  );
  const [days, setDays] = useState(initialDays);
  const [slackEnabled, setSlackEnabled] = useState(initialSlackEnabled);
  const [webhookUrl, setWebhookUrl] = useState(initialWebhookUrl);

  const [deactivationBaseline, setDeactivationBaseline] = useState({
    enabled: initialDeactivateEnabled,
    days: initialDays,
  });
  const [slackBaseline, setSlackBaseline] = useState({
    enabled: initialSlackEnabled,
    url: initialWebhookUrl,
  });

  const isDeactivationDirty =
    deactivateEnabled !== deactivationBaseline.enabled ||
    days !== deactivationBaseline.days;
  const isSlackDirty =
    canSlack &&
    (slackEnabled !== slackBaseline.enabled ||
      webhookUrl !== slackBaseline.url);
  const isAnyDirty = isDeactivationDirty || isSlackDirty;
  const isSaving =
    deactivationFetcher.state !== "idle" || slackFetcher.state !== "idle";

  useEffect(() => {
    if (isAnyDirty) {
      shopify.saveBar.show(SETTINGS_SAVE_BAR);
    } else {
      shopify.saveBar.hide(SETTINGS_SAVE_BAR);
    }
  }, [isAnyDirty, shopify]);

  useEffect(() => {
    return () => {
      shopify.saveBar.hide(SETTINGS_SAVE_BAR);
    };
  }, [shopify]);

  const handleBreadcrumbClick = useCallback(async () => {
    try {
      await shopify.saveBar.leaveConfirmation();
    } catch {
      return;
    }
    navigate("/app");
  }, [shopify, navigate]);

  useEffect(() => {
    if (deactivationFetcher.state !== "idle" || !deactivationFetcher.data)
      return;
    const data = deactivationFetcher.data;
    if (data.success && data.intent === "saveAutoDeactivation") {
      setDeactivationBaseline({ enabled: deactivateEnabled, days });
      shopify.toast.show("Settings saved");
    } else if (!data.success && data.intent === "saveAutoDeactivation") {
      shopify.toast.show(data.error ?? "Save failed", { isError: true });
    }
  }, [
    deactivationFetcher.state,
    deactivationFetcher.data,
    deactivateEnabled,
    days,
    shopify,
  ]);

  useEffect(() => {
    if (slackFetcher.state !== "idle" || !slackFetcher.data) return;
    const data = slackFetcher.data;
    if (data.success && data.intent === "saveSlackWebhook") {
      setSlackBaseline({ enabled: slackEnabled, url: webhookUrl });
      shopify.toast.show("Settings saved");
    } else if (!data.success && data.intent === "saveSlackWebhook") {
      shopify.toast.show(data.error ?? "Save failed", { isError: true });
    }
  }, [
    slackFetcher.state,
    slackFetcher.data,
    slackEnabled,
    webhookUrl,
    shopify,
  ]);

  useEffect(() => {
    if (!testFetcher.data) return;
    if (testFetcher.data.success) {
      shopify.toast.show("Test sent");
    } else if (testFetcher.data.error) {
      shopify.toast.show("Test failed", { isError: true });
    }
  }, [testFetcher.data, shopify]);

  const handleDeactivateEnabledChange = useCallback((e: Event) => {
    setDeactivateEnabled((e.target as HTMLInputElement).checked);
  }, []);

  const handleDaysInput = useCallback((e: Event) => {
    setDays((e.target as HTMLInputElement).value);
  }, []);

  const handleSlackEnabledChange = useCallback((e: Event) => {
    setSlackEnabled((e.target as HTMLInputElement).checked);
  }, []);

  const handleWebhookUrlInput = useCallback((e: Event) => {
    setWebhookUrl((e.target as HTMLInputElement).value);
  }, []);

  const handleTestSlack = useCallback(() => {
    testFetcher.submit({ intent: "testSlackWebhook" }, { method: "post" });
  }, [testFetcher]);

  const handleSave = useCallback(() => {
    if (isDeactivationDirty) {
      deactivationFetcher.submit(
        {
          intent: "saveAutoDeactivation",
          enabled: String(deactivateEnabled),
          days,
        },
        { method: "post" },
      );
    }
    if (isSlackDirty) {
      slackFetcher.submit(
        {
          intent: "saveSlackWebhook",
          slackEnabled: String(slackEnabled),
          slackWebhookUrl: webhookUrl,
        },
        { method: "post" },
      );
    }
  }, [
    isDeactivationDirty,
    isSlackDirty,
    deactivateEnabled,
    days,
    slackEnabled,
    webhookUrl,
    deactivationFetcher,
    slackFetcher,
  ]);

  const handleDiscard = useCallback(() => {
    setDeactivateEnabled(deactivationBaseline.enabled);
    setDays(deactivationBaseline.days);
    setSlackEnabled(slackBaseline.enabled);
    setWebhookUrl(slackBaseline.url);
  }, [deactivationBaseline, slackBaseline]);

  return (
    <s-page heading="Settings" inlineSize="base">
      <s-button
        slot="breadcrumb-actions"
        variant="tertiary"
        onClick={handleBreadcrumbClick}
      >
        Dashboard
      </s-button>

      <ui-save-bar id={SETTINGS_SAVE_BAR}>
        <button
          {...{ variant: "primary", loading: isSaving || undefined }}
          onClick={handleSave}
        >
          Save
        </button>
        <button onClick={handleDiscard}>Discard</button>
      </ui-save-bar>

      <s-stack direction="block" gap="large">
        {/* Auto-Deactivation Section */}
        <div>
          <s-box paddingBlockEnd="large">
            <s-grid
              gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 2fr"
              gap="large"
            >
              <s-grid-item>
                <s-stack gap="small">
                  <s-heading>Auto-Deactivation</s-heading>
                  <s-paragraph color="subdued">
                    Automatically deactivate every gift card in a job once the
                    job reaches a specified age. This applies regardless of
                    whether individual cards have been redeemed.
                  </s-paragraph>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-section>
                  <s-stack gap="base">
                    <s-checkbox
                      label="Enable auto-deactivation"
                      checked={deactivateEnabled || undefined}
                      onChange={handleDeactivateEnabledChange}
                    />

                    {deactivateEnabled && (
                      <>
                        <s-text-field
                          label="Days after job creation"
                          name="days"
                          value={days}
                          onInput={handleDaysInput}
                        />
                        <s-text color="subdued">
                          When a job is older than this many days, all gift
                          cards in it will be deactivated, including any that
                          customers have already partially or fully used. This
                          applies to all future jobs.
                        </s-text>
                      </>
                    )}

                    <s-banner tone="warning">
                      Deactivation is permanent and cannot be undone. All gift
                      cards in eligible jobs are deactivated, even those with a
                      remaining balance — customers will lose access to any
                      unspent funds.
                    </s-banner>
                  </s-stack>
                </s-section>
              </s-grid-item>
            </s-grid>
          </s-box>
        </div>

        <s-divider />

        {/* Slack Notifications Section */}
        <div>
          <s-box paddingBlockEnd="large">
            <s-grid
              gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 2fr"
              gap="large"
            >
              <s-grid-item>
                <s-stack gap="small">
                  <s-heading>Slack Notifications</s-heading>
                  <s-paragraph color="subdued">
                    Get notified in Slack when a job completes or fails. Create a
                    Slack app with an Incoming Webhook and paste the URL here.
                  </s-paragraph>
                </s-stack>
              </s-grid-item>
              <s-grid-item>
                <s-section>
                  {canSlack ? (
                    <s-stack gap="base">
                      <s-checkbox
                        label="Enable Slack notifications"
                        checked={slackEnabled || undefined}
                        onChange={handleSlackEnabledChange}
                      />

                      {slackEnabled && (
                        <>
                          <s-text-field
                            label="Webhook URL"
                            name="slackWebhookUrl"
                            value={webhookUrl}
                            onInput={handleWebhookUrlInput}
                          />
                          <s-text color="subdued">
                            Create an Incoming Webhook at{" "}
                            <s-link
                              href="https://api.slack.com/apps"
                              target="_blank"
                            >
                              api.slack.com/apps
                            </s-link>{" "}
                            and paste the URL above.
                          </s-text>
                        </>
                      )}

                      {slackEnabled && webhookUrl && !isSlackDirty && (
                        <div>
                          <s-button
                            variant="secondary"
                            onClick={handleTestSlack}
                            loading={
                              testFetcher.state !== "idle" || undefined
                            }
                          >
                            Send test notification
                          </s-button>
                        </div>
                      )}
                    </s-stack>
                  ) : (
                    <s-text>
                      Slack notifications are available on the Premium and
                      Ultimate plans.{" "}
                      <s-link href="/app/subscriptions">Upgrade your plan</s-link>
                    </s-text>
                  )}
                </s-section>
              </s-grid-item>
            </s-grid>
          </s-box>
        </div>

        <AppPageFooter />
      </s-stack>
    </s-page>
  );
}
