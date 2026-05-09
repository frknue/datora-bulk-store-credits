import { AppPageFooter } from "../components/app-page-footer";

export default function Changelog() {
  const versions = [
    {
      version: "V6.2",
      date: "May 2026",
      features: [
        "Store credit — Issue store credit to one or many customers, with currency, expiry, and immediate or scheduled delivery",
        "Resume cancelled jobs — Pick up gift card creation where you cancelled, without recreating cards already made",
        "Deactivate cancelled jobs — Disable the gift cards a cancelled job had already created",
        "Unified product overview — New dashboard summarising gift cards and store credits side by side",
        "Contact page — Replaces the in-app modal with a dedicated page for easier follow-up",
        "Dedicated download pages — Per-job and batch downloads now have their own pages with the same options",
        "Dismissible help card — Hide the contact callout once you don't need it",
        "More reliable cancel and resume — The app now waits safely for in-flight creation to settle before letting you resume or deactivate, and the page refreshes automatically once it does",
      ],
    },
    {
      version: "V6.1",
      date: "March 2026",
      features: [
        "Gift card deactivation — Permanently deactivate all gift cards from a completed job",
        "Batch download — Select multiple jobs and download all gift cards as a single CSV file",
        "Slack notifications — Get notified in Slack when jobs complete or fail",
        "Settings page — Configure auto-deactivation and Slack notifications",
      ],
    },
    {
      version: "V6.0",
      date: "March 2025",
      features: [
        "Redesigned dashboard with cleaner statistics overview",
        "Full-width layout for better readability of job tables",
        "Subscription plans page now adapts to any screen size",
        "Improved mobile experience across all pages",
        "Smoother navigation between job details and usage tracking",
        "Refreshed contact form for easier communication",
      ],
    },
    {
      version: "V5.0",
      date: "January 2025",
      features: [
        "Admin extensions — Send gift cards directly by email from the job details page",
        "Scheduled delivery — Set a specific date and time for email delivery",
        "Timezone support — Schedule deliveries in your store's local timezone",
      ],
    },
    {
      version: "V4.3",
      date: "November 2024",
      features: [
        "Updated app to comply with Shopify's latest best practices and guidelines",
        "Improved security and session management",
      ],
    },
    {
      version: "V4.2",
      date: "September 2024",
      features: [
        "Improved overall app layout and navigation",
        "Enhanced mobile responsiveness for the app interface",
        "Updated UI components for better usability",
      ],
    },
    {
      version: "V4.1",
      date: "July 2024",
      features: [
        "Download manager — Manage and re-download your CSV exports",
        "Code formatter — Format gift card codes with custom separators and grouping",
        "Improved CSV export with additional columns",
      ],
    },
    {
      version: "V3.3",
      date: "May 2024",
      features: [
        "Performance improvements with lazy loading for large job lists",
        "Caching layer for frequently accessed data",
        "Reduced API calls for faster page loads",
      ],
    },
    {
      version: "V3.2",
      date: "March 2024",
      features: [
        "Added expiry date column to CSV export",
        "Improved date formatting in exports",
      ],
    },
    {
      version: "V3.1",
      date: "January 2024",
      features: [
        "Per-job details page with full gift card listing",
        "Job progress tracking with real-time updates",
        "Individual gift card status and usage information",
      ],
    },
    {
      version: "V2.1",
      date: "October 2023",
      features: [
        "Email delivery feature — Send gift cards directly to customers",
        "Customer selection from Shopify store data",
        "Customizable email messages",
      ],
    },
  ];

  return (
    <s-page heading="Changelog" inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app">
        Dashboard
      </s-link>
      <s-stack direction="block" gap="base">
        {versions.map((entry) => (
          <s-section key={entry.version} heading={`${entry.version} — ${entry.date}`}>
            <s-unordered-list>
              {entry.features.map((feature, i) => (
                <s-list-item key={i}>{feature}</s-list-item>
              ))}
            </s-unordered-list>
          </s-section>
        ))}

        <AppPageFooter />
      </s-stack>
    </s-page>
  );
}
