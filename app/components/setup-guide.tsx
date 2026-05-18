import { useState } from "react";
import { Link } from "react-router";
import type {
  SetupGuideCompletion,
  SetupGuideStepId,
} from "../lib/services/setup-guide.server";
import type { SubscriptionPlan } from "../lib/subscriptions/plans";

type Step = {
  id: SetupGuideStepId;
  title: string;
  description: string;
  cta: { label: string; href: string };
  /**
   * Predicate that decides whether this step applies to the merchant's
   * current plan. Steps that require a feature the merchant can't access
   * are hidden so the guide can actually reach 100% on every tier
   * (BFS 4.2.2 "sufficiently guide merchants to completion").
   */
  appliesToPlan: (plan: SubscriptionPlan) => boolean;
};

// Store-credit-led ordering: store credits is the primary product so it
// leads the guide. Gift cards are gated to Basic+ here, so the gift-card
// step is plan-aware too.
const ALL_STEPS: Step[] = [
  {
    id: "choose-plan",
    title: "Choose your plan",
    description:
      "Pick the plan that fits your business. Free is great for trying things out; paid plans unlock store credit issuance, gift card creation, email delivery, presets, and Slack notifications.",
    cta: { label: "View plans", href: "/app/subscriptions" },
    appliesToPlan: () => true,
  },
  {
    id: "issue-store-credit",
    title: "Issue store credit",
    description:
      "Credit one or many customers with store credit. Pick a currency, set an expiry, send now or schedule it for later. Great for refunds, loyalty rewards, and promotions.",
    cta: { label: "Issue store credit", href: "/app/store-credit/create" },
    appliesToPlan: (plan) => plan.extension,
  },
  {
    id: "create-gift-card",
    title: "Create your first gift card",
    description:
      "Generate a batch of gift cards in one click. Set a value, count, code format, and optional expiry. Once the job finishes, download a CSV of every code from the Gift Cards page.",
    cta: { label: "Create a gift card job", href: "/app/gift-cards/create" },
    appliesToPlan: (plan) => plan.maxGiftCards !== 0,
  },
  {
    id: "send-by-email",
    title: "Send gift cards by email",
    description:
      "Send gift cards directly to specific customers or customer segments. Pick recipients, include a custom message, and optionally schedule delivery for a specific date and time.",
    cta: { label: "Set up email delivery", href: "/app/gift-cards/create" },
    appliesToPlan: (plan) => plan.extension && plan.maxGiftCards !== 0,
  },
  {
    id: "set-up-slack",
    title: "Set up Slack notifications",
    description:
      "Get pinged in Slack when bulk jobs finish or fail so you don't have to check the dashboard. Paste an incoming-webhook URL in Settings and you're done.",
    cta: { label: "Configure Slack", href: "/app/settings" },
    appliesToPlan: (plan) => plan.slackNotifications,
  },
];

type Props = {
  completion: SetupGuideCompletion;
  /**
   * Current subscription plan from the outlet context. Used to (a) hide
   * steps that require features the plan doesn't unlock, and (b) auto-
   * complete step 1 for any non-Free plan in addition to the explicit
   * subscriptions-page visit tracked server-side.
   */
  subscriptionPlan: SubscriptionPlan;
  onDismiss: () => void;
};

export function SetupGuide({
  completion,
  subscriptionPlan,
  onDismiss,
}: Props) {
  const steps = ALL_STEPS.filter((step) => step.appliesToPlan(subscriptionPlan));

  const stepCompletion: Record<SetupGuideStepId, boolean> = {
    ...completion.steps,
    "choose-plan":
      completion.steps["choose-plan"] || subscriptionPlan.name !== "Free",
  };

  const completedCount = steps.filter((s) => stepCompletion[s.id]).length;
  const totalCount = steps.length;
  const allComplete = completedCount === totalCount;

  // Expand the first incomplete step by default. Hooks run before the
  // all-complete early return below; that's fine because the state isn't
  // consumed in the null-return path.
  const firstIncomplete = steps.find((s) => !stepCompletion[s.id])?.id ?? null;
  const [expandedId, setExpandedId] = useState<string | null>(firstIncomplete);

  // Auto-hide once every applicable step is complete — no point making the
  // merchant X a card that just says "done". If the state ever regresses
  // (e.g. they clear their Slack URL or upgrade to a higher plan which adds
  // new applicable steps) the card reappears automatically.
  if (allComplete) return null;

  const toggleStep = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-grid
          gridTemplateColumns="1fr auto"
          gap="small-300"
          alignItems="center"
        >
          <s-stack direction="block" gap="small-100">
            <s-heading>Getting started</s-heading>
            <s-paragraph color="subdued">
              {completedCount} of {totalCount} steps completed
            </s-paragraph>
          </s-stack>
          <s-button
            accessibilityLabel="Dismiss getting started guide"
            variant="tertiary"
            tone="neutral"
            icon="x"
            onClick={onDismiss}
          />
        </s-grid>

        <s-divider />

        <s-stack direction="block" gap="small-200">
          {steps.map((step, index) => {
            const isComplete = stepCompletion[step.id];
            const isExpanded = expandedId === step.id;
            const numberedTitle = `Step ${index + 1}: ${step.title}`;
            return (
              <s-box
                key={step.id}
                border="base"
                borderRadius="base"
                padding="base"
              >
                <s-stack direction="block" gap="small">
                  <s-grid
                    gridTemplateColumns="auto 1fr auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-icon
                      type={isComplete ? "check-circle" : "circle"}
                      tone={isComplete ? "success" : "neutral"}
                    />
                    <s-text type="strong">{numberedTitle}</s-text>
                    <s-button
                      accessibilityLabel={
                        isExpanded
                          ? `Collapse ${numberedTitle}`
                          : `Expand ${numberedTitle}`
                      }
                      variant="tertiary"
                      tone="neutral"
                      icon={isExpanded ? "chevron-up" : "chevron-down"}
                      onClick={() => toggleStep(step.id)}
                    />
                  </s-grid>

                  {isExpanded && (
                    <s-stack direction="block" gap="base">
                      <s-paragraph color="subdued">
                        {step.description}
                      </s-paragraph>
                      {!isComplete && (
                        <div>
                          <Link to={step.cta.href}>
                            <s-button variant="primary">
                              {step.cta.label}
                            </s-button>
                          </Link>
                        </div>
                      )}
                    </s-stack>
                  )}
                </s-stack>
              </s-box>
            );
          })}
        </s-stack>
      </s-stack>
    </s-section>
  );
}
