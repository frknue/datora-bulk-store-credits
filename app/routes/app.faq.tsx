import { AppPageFooter } from "../components/app-page-footer";

export default function Help() {
  // TODO: point at the dedicated store-credits docs site once it's published.
  const docsBase = "https://docs.datora.de/store-credits-app";

  const resources = [
    {
      heading: "Getting Started",
      description:
        "Learn how to issue your first store credit job — pick recipients, set amount and currency, and schedule delivery.",
      link: `${docsBase}/getting-started`,
    },
    {
      heading: "Features",
      description:
        "Explore everything: bulk store credit, gift card creation, segment targeting, scheduled delivery, usage tracking, and CSV exports.",
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
        "Common questions about store credit issuance, gift card creation, downloads, and job processing.",
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
        "Solve common issues with jobs, downloads, store credit not appearing on customer accounts, and more.",
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
          gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
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
            </s-stack>
          </s-stack>
        </s-section>

        <AppPageFooter />
      </s-stack>
    </s-page>
  );
}
