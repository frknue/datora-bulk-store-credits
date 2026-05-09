import { useLoaderData, useOutletContext } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { DownloadForm } from "../components/download-form";
import type { AppOutletContext } from "../lib/types/app";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobid;
  if (!jobId) {
    throw new Response("Not found", { status: 404 });
  }
  const job = await prisma.job.findFirst({
    where: { id: jobId, shopName: session.shop },
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
  if (!job) {
    throw new Response("Not found", { status: 404 });
  }
  return {
    jobId: job.id,
    previewMeta: {
      prefix: job.prefix,
      postfix: job.postfix,
      value: job.value != null ? Number(job.value) : null,
      note: job.note,
      expireDate: job.expireDate,
      currency: job.giftCardCurrency,
    },
  };
};

export default function JobDownload() {
  const { jobId, previewMeta } = useLoaderData<typeof loader>();
  const { subscriptionPlan } = useOutletContext<AppOutletContext>();

  return (
    <s-page heading="Download gift cards" inlineSize="base">
      <s-link slot="breadcrumb-actions" href={`/app/gift-cards/${jobId}`}>
        Job details
      </s-link>

      <DownloadForm
        mode="single"
        jobIds={[jobId]}
        subscriptionPlan={subscriptionPlan}
        backHref={`/app/gift-cards/${jobId}`}
        previewMeta={previewMeta}
      />
    </s-page>
  );
}
