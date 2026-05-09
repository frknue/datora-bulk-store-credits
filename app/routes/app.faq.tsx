import { useOutletContext } from "react-router";
import { AppPageFooter } from "../components/app-page-footer";
import type { AppOutletContext } from "../lib/types/app";

export default function Help() {
  const { openOnboarding } = useOutletContext<AppOutletContext>();
  const docsBase = "https://docs.datora.de/gift-card-app";

  const resources = [
    {
      heading: "Getting Started",
      description:
        "Learn how to create your first gift card job, configure code options, and download your CSV export.",
      link: `${docsBase}/getting-started`,
    },
    {
      heading: "Features",
      description:
        "Explore all features including code formatting, email delivery, job presets, usage tracking, and batch downloads.",
      link: `${docsBase}/features/overview`,
    },
    {
      heading: "Plans & Pricing",
      description:
        "Compare our Free, Basic, Premium, and Ultimate plans to find the right fit for your store.",
      link: `${docsBase}/features/plans`,
    },
    {
      heading: "FAQ",
      description:
        "Find answers to common questions about gift card creation, downloads, job processing, and more.",
      link: `${docsBase}/faq`,
    },
    {
      heading: "Settings Guide",
      description:
        "Set up auto-deactivation of older jobs and configure Slack notifications for your team.",
      link: `${docsBase}/features/settings`,
    },
    {
      heading: "Troubleshooting",
      description:
        "Solve common issues with jobs, downloads, gift cards not appearing, and other problems.",
      link: `${docsBase}/troubleshooting`,
    },
  ];

  return (
    <s-page heading="Help Center" inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>

      <s-stack direction="block" gap="large">
        <s-grid
          gridTemplateColumns="1fr 1fr"
          gap="base"
        >
          {resources.map((resource) => (
            <s-grid-item key={resource.heading}>
              <s-section heading={resource.heading}>
                <s-stack direction="block" gap="base">
                  <s-text color="subdued">{resource.description}</s-text>
                  <div>
                    <s-link href={resource.link} target="_blank">
                      Read more →
                    </s-link>
                  </div>
                </s-stack>
              </s-section>
            </s-grid-item>
          ))}
        </s-grid>

        <s-section>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              Can&apos;t find what you&apos;re looking for?
            </s-text>
            <s-stack direction="inline" gap="small">
              <s-button href="/app/contact?subject=help">Contact support</s-button>
              <s-button variant="secondary" onClick={openOnboarding}>
                Replay tour
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>

        <AppPageFooter />
      </s-stack>
    </s-page>
  );
}
