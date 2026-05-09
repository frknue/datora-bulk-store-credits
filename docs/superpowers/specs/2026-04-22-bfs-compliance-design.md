# Built for Shopify Compliance Fixes — Design

Date: 2026-04-22
Branch: `feat/bfs-compliance` (created from `dev`)
Purpose: Address every issue from Shopify's previous "Built for Shopify" review so the app is ready to re-apply.

## Background

The app was rebuilt after Shopify's earlier BfS review. Some feedback points were already resolved in the rewrite (onboarding is now exactly 5 steps, plan cards use neutral background + blue "Current Plan" badge). Others were not. This spec covers every remaining item plus verification that the already-resolved items stayed resolved.

## Scope

In scope (user confirmed "full sweep"):

1. Add bottom padding to all pages.
2. Replace green decorative progress-bar fills with neutral.
3. Shorten every toast to ≤3 words.
4. Make the "Need help" dashboard card dismissible.
5. Convert the contact modal to `/app/contact`.
6. Convert the download modal to per-flow pages (`/app/jobs/:jobId/download`, `/app/gift-cards/download`).
7. Verify plan cards stay color-neutral.
8. Verify onboarding stays ≤5 steps.

Out of scope:

- Job detail header actions — the header keeps the five job-related actions plus prev/next chevrons. Shopify's own admin uses the same prev/next pattern on order and product detail pages, so this is defensible as BfS-compliant.
- Restructuring error toasts into banners/inline messages. Choice A in brainstorming: shorten toasts, keep them as toasts for both success and error paths.

## High-level architecture

New routes:

- `app/routes/app.contact.tsx` — contact form page.
- `app/routes/app.jobs.$jobid.download.tsx` — per-job download form page.
- `app/routes/app.gift-cards.download.tsx` — batch download form page (takes `?ids=...`).

New components:

- `app/components/app-page-footer.tsx` — tiny spacer component rendered as the last child of every page. Keeps bottom padding consistent and centrally controlled.
- `app/components/download-form.tsx` — shared download form UI used by both new download routes. Encapsulates the current `DownloadManagerModal` form body (separator, field checkboxes, uppercase/splitter toggles, code preview, submit handling).

Deletions:

- `app/components/contact-modal.tsx`.
- `app/components/download-manager-modal.tsx`.
- `<ContactModal />` and `<DownloadManagerModal />` mount points in `app/routes/app.tsx` and in any callsite.
- `openContact` prop from the app outlet context and its consumers.

Navigation change: add a `Contact` link to `<s-app-nav>` in `app/routes/app.tsx`.

Data model change: add `showContactCard Boolean @default(true)` to the `User` model in `prisma/schema.prisma`. Migration name `add_show_contact_card`. Mirrors the existing `showCard` / `dismissFeatureCard` pattern.

## Per-item design

### 1. Bottom padding — `AppPageFooter`

```tsx
// app/components/app-page-footer.tsx
export function AppPageFooter() {
  return <s-box paddingBlockEnd="large-400" />;
}
```

Usage: render `<AppPageFooter />` as the last child of each `<s-page>` (or the last child inside its outer `<s-stack>` when the page uses one). 13 existing routes to touch, plus the three new ones.

Routes to update:

- `app/routes/app._index.tsx`
- `app/routes/app.gift-cards.tsx`
- `app/routes/app.subscriptions.tsx`
- `app/routes/app.job.create.tsx`
- `app/routes/app.jobs.$jobid.tsx`
- `app/routes/app.faq.tsx`
- `app/routes/app.settings.tsx`
- `app/routes/app.store-credit._index.tsx`
- `app/routes/app.store-credit.create.tsx`
- `app/routes/app.store-credit.$jobId.tsx`
- `app/routes/app.changelog.tsx`
- `app/routes/app.contact.tsx` (new)
- `app/routes/app.jobs.$jobid.download.tsx` (new)
- `app/routes/app.gift-cards.download.tsx` (new)

### 2. Green progress bars → neutral

Three call sites use `var(--p-color-bg-fill-success, #29845a)` as a decorative fill.

Replacement: `var(--p-color-text)` for the "running/neutral" state. Dark enough to remain visible on low fill percentages, fully semantic-neutral. The at-limit `critical` branch of `DashboardUsageProgressBar` keeps `var(--p-color-bg-fill-critical)` because red-for-problem is semantically correct.

Files:

- `app/components/dashboard-sections.tsx` around line 115-142 — `DashboardUsageProgressBar.fillColor`.
- `app/components/job-details-sections.tsx` around line 77 — `JobRunningProgressBanner`.
- `app/routes/app.store-credit.$jobId.tsx` around line 100 — `RunningBanner`.

### 3. Toast shortening

Every toast gets ≤3 words. Errors stay as toasts (`isError: true`) per choice A.

| Callsite | Current | Replacement |
| --- | --- | --- |
| `app/lib/hooks/use-create-job-form.ts:122` | "Gift card job created successfully!" | "Job created" |
| `app/components/contact-modal.tsx:103` (moving to new contact page) | "Feedback sent successfully" | "Message sent" |
| `app/components/contact-modal.tsx:105,108` (moving to new contact page) | "Failed to send message" | "Send failed" |
| `app/components/download-manager-modal.tsx:137` (moving to new download pages) | "Download started" | "Download started" (unchanged) |
| `app/routes/app.subscriptions.tsx:238` | "Subscription cancelled" | "Subscription cancelled" (unchanged) |
| `app/routes/app.subscriptions.tsx:248` | "Failed to cancel subscription" | "Cancel failed" |
| `app/routes/app.subscriptions.tsx:297,301` | "Failed to change plan" | "Change failed" |
| `app/routes/app.settings.tsx:168` | "Auto-deactivation settings saved" | "Settings saved" |
| `app/routes/app.settings.tsx:170` | "Slack settings saved" | "Settings saved" |
| `app/routes/app.settings.tsx:180` | "Test notification sent to Slack" | "Test sent" |

Rule for any toast added in this effort or found during implementation: ≤3 words, action-confirming.

### 4. "Need help" card dismissibility

Current state: `DashboardCalloutCards` in `app/components/dashboard-sections.tsx` renders the "Need help or miss a feature?" card unconditionally, with no dismiss button.

Changes:

1. Add `showContactCard Boolean @default(true)` to `User` in `prisma/schema.prisma`. New migration `add_show_contact_card`.
2. `app/lib/services/dashboard.server.ts`: add `dismissContactCard(shopName)` mirroring `dismissFeatureCard`.
3. `app/lib/services/overview.server.ts`: include `showContactCard` in the loader return (defaulting to `true` if no `User` row).
4. `app/routes/app._index.tsx`: handle a `dismiss_contact_card` form action. Pass `showContactCard` and a dismiss callback down to `DashboardCalloutCards`.
5. `app/components/dashboard-sections.tsx`: accept `showContactCard` and `onDismissContactCard` props. Pass `onDismiss` to the "Need help" card. When `showContactCard === false`, render nothing for that card.

After dismissal, the card stays gone. No re-surfacing.

### 5. Contact modal → `/app/contact` page

Remove `ContactModal` entirely. Users reach contact from the nav, the dashboard card, the footer help link, and Shopify's native Support button.

New route `app/routes/app.contact.tsx`:

- `loader({ request })`: call `authenticate.admin(request)`, return `{ shop }` (the form has no prefill needs beyond subject, which arrives via query string).
- `action({ request })`: parse form data, validate name/email/message/subject using the existing validators from `app/lib/utils/validation.ts`. On validation failure, return `{ errors }` with `400`. On success, call the same underlying email-send logic that `app/routes/api.contact.ts` uses — factor that logic out of the API route into a server-side service if needed, and have both the API route and the new page `action` call the service. Return `{ success: true }` on success.
- UI: `<s-page heading="Contact us" inlineSize="base">` with a breadcrumb link back to home. Form with Subject select, Name, Email, Message. Primary "Send" action in a form submit button. Secondary "Cancel" button navigates back.
- On success: short toast ("Message sent") and navigate to `/app`.
- On error: short toast ("Send failed") and keep the form populated so the merchant can retry.
- Subject query param: if `?subject=help` arrives, the Subject select initializes to "help".

Callsite updates:

- `app/routes/app.tsx`: remove `<ContactModal />` mount; remove `openContact` from the outlet context; update `SupportHandler` to `navigate("/app/contact?subject=help")` on Shopify's native support trigger; add `<s-link href="/app/contact">Contact</s-link>` to `<s-app-nav>`.
- `app/routes/app._index.tsx`: remove `handleContact`, remove `openContact` from the outlet context destructure. Pass an href (or remove the callback in favor of `DashboardCalloutCards` rendering its own link).
- `app/components/dashboard-sections.tsx`: `DashboardCalloutCard`'s contact variant uses `buttonHref="/app/contact"` instead of a callback. `DashboardFooterHelp` uses `<s-link href="/app/contact">here</s-link>`.

Delete: `app/components/contact-modal.tsx` once all references are removed.

### 6. Download modal → download pages

Remove `DownloadManagerModal`. Two routes plus a shared form component.

Shared form: `app/components/download-form.tsx` exports a `DownloadForm` component that receives `mode: "single" | "batch"`, `jobIds: string[]`, `subscriptionPlan`. Contains separator select, field checkboxes, uppercase/splitter toggles, code preview, primary "Download" button. On submit, calls the existing client-side helpers in `app/lib/utils/download.ts` (`downloadJob` / `downloadBatchJobs`), fires short toast ("Download started"), then navigates back to the source page.

Routes:

- `app/routes/app.jobs.$jobid.download.tsx`:
  - `loader`: authenticate, verify the job belongs to the current shop, 404 otherwise. Return `{ jobId, subscriptionPlan }` (plan comes from outlet context, so the loader just needs the job existence check).
  - Renders `<s-page heading="Download gift cards" inlineSize="base">`, breadcrumb back to `/app/jobs/:jobId`, then `<DownloadForm mode="single" jobIds={[jobId]} ... />`.

- `app/routes/app.gift-cards.download.tsx`:
  - `loader`: authenticate, read `?ids=...`, validate all IDs belong to this shop; 400 on missing or unauthorized IDs.
  - Renders `<s-page heading="Download gift cards" inlineSize="base">`, breadcrumb back to `/app/gift-cards`, then `<DownloadForm mode="batch" jobIds={ids} ... />`.

Callsite updates:

- `app/routes/app.jobs.$jobid.tsx` Download button: change `onClick={openDownload}` to `href="/app/jobs/:jobId/download"` using `<s-button href="...">` (matches existing `<s-button href=...>` usage elsewhere in the app, e.g. the "Upgrade plan" button in the dashboard usage bar).
- `app/routes/app.gift-cards.tsx` batch Download: navigate to `/app/gift-cards/download?ids=${ids.join(",")}`.
- `app/routes/app.tsx`: remove `<DownloadManagerModal />` mount if it exists there, and remove any shared-modal wiring.

Delete: `app/components/download-manager-modal.tsx` once callsites are migrated.

### 7. Plan cards — verification only

Current state: `app/routes/app.subscriptions.tsx` `PlanCard` uses `background="base"` and `<s-badge tone="info">Current Plan</s-badge>`. No green, no decorative color. This already complies with the original feedback.

Verification step during implementation: re-read `app.subscriptions.tsx` before the PR is opened and confirm no `tone="success"` badge, no green CSS, no highlighted/colored plan card background was added during the rebuild. No changes expected.

### 8. Onboarding — verification only

Current state: `app/components/onboarding-modal.tsx` has exactly 5 steps. Compliant with "no more than 5 steps."

Verification step: confirm the count stays at 5. No changes expected.

## Data flow

No new data flows. The contact form uses the same underlying email-send logic as today (whether via the existing `/api/contact` endpoint or a direct server-side call, to be chosen during implementation based on which is easier to test). The download pages use the same existing download endpoints.

## Error handling

- Contact form validation errors: inline on fields using `error` prop on the form inputs (current pattern from `contact-modal.tsx`).
- Contact send failure: short toast ("Send failed"), form stays populated.
- Download failure: short toast ("Download failed") and the user stays on the download page.
- Dismissing the "Need help" card on DB failure: swallow silently (not worth interrupting the user; next page load will retry).

## Testing

Per-step verification uses the embedded-app flow in AGENTS.md. Prerequisites:

- `npm run dev` running
- Chrome launched with CDP 9222 and logged into the dev store

Verification checklist:

1. `npm run typecheck` and `npm run lint` pass with zero errors.
2. `npx prisma migrate dev` for `add_show_contact_card` completes cleanly.
3. In the embedded app:
   - Every page has visible bottom padding (compare to current cut-off).
   - Home: "Need help" card has a dismiss button; clicking it hides the card and a page reload keeps it hidden.
   - Home: usage progress bar is neutral-dark, not green.
   - Job detail page: progress banner fill is neutral-dark, not green.
   - Store-credit job detail: running banner fill is neutral-dark, not green.
   - Contact: nav link opens `/app/contact`; Shopify's native Support button opens `/app/contact?subject=help`; submit succeeds with "Message sent" toast; bad SMTP / forced failure shows "Send failed" toast and keeps form state.
   - Downloads: single-job download opens `/app/jobs/:jobId/download`, submits, file downloads, toast is "Download started"; batch download opens `/app/gift-cards/download?ids=...`, submits, zip downloads, toast is "Download started".
   - Subscriptions: "Cancel failed" and "Change failed" toasts fire on simulated errors; plan cards have no green anywhere.
   - Settings: all three save toasts read "Settings saved" / "Test sent".
4. `npm run build` produces a clean production build.

## Rollout

- Branch: `feat/bfs-compliance` created from `dev` at start of implementation.
- PR target: `dev`.
- Commits: one per discrete section where reasonable (padding, toasts, colors, etc.), or squash on merge per repo convention.
- Deploy once merged and QA'd on the dev store.

## Explicit non-goals

- No refactor of the overall dashboard or job detail page structure beyond the changes listed above.
- No changes to the Go worker.
- No changes to gift-card encryption, webhooks, auth, or billing.
- No BfS items the app already passes (≤5 onboarding steps, neutral plan cards, confirmation-only cancel modal) — these get a re-read, not a rewrite.
