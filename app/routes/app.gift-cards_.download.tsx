import { useLoaderData, useOutletContext } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { DownloadForm } from "../components/download-form";
import type { AppOutletContext } from "../lib/types/app";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const rawIds = url.searchParams.get("ids") ?? "";
  const ids = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    throw new Response("ids query parameter required", { status: 400 });
  }

  const rows = await prisma.job.findMany({
    where: { id: { in: ids }, shopName: session.shop },
    select: {
      id: true,
      prefix: true,
      postfix: true,
      value: true,
      note: true,
      expireDate: true,
      giftCardCurrency: true,
    },
  });
  const owned = new Set(rows.map((r) => r.id));
  const allOwned = ids.every((id) => owned.has(id));
  if (!allOwned) {
    throw new Response("One or more jobs not found", { status: 400 });
  }

  const sharedField = <K extends keyof (typeof rows)[number]>(
    key: K,
  ): (typeof rows)[number][K] | null => {
    if (rows.length === 0) return null;
    const first = rows[0][key];
    return rows.every((r) => r[key] === first) ? first : null;
  };

  const sharedValue = (() => {
    if (rows.length === 0) return null;
    const first = rows[0].value;
    const allSame = rows.every(
      (r) => Number(r.value ?? 0) === Number(first ?? 0),
    );
    return allSame && first != null ? Number(first) : null;
  })();

  const previewMeta = {
    prefix: sharedField("prefix"),
    postfix: sharedField("postfix"),
    value: sharedValue,
    note: sharedField("note"),
    expireDate: sharedField("expireDate"),
    currency: sharedField("giftCardCurrency"),
  };

  return { jobIds: ids, previewMeta };
};

export default function BatchDownload() {
  const { jobIds, previewMeta } = useLoaderData<typeof loader>();
  const { subscriptionPlan } = useOutletContext<AppOutletContext>();

  return (
    <s-page heading="Download gift cards" inlineSize="base">
      <s-link slot="breadcrumb-actions" href="/app/gift-cards">
        Gift Cards
      </s-link>

      <DownloadForm
        mode="batch"
        jobIds={jobIds}
        subscriptionPlan={subscriptionPlan}
        backHref="/app/gift-cards"
        previewMeta={previewMeta}
      />
    </s-page>
  );
}
