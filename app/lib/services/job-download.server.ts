import prisma from "../../db.server";
import { getPlanById, canDownload } from "../subscriptions/plans";
import { decryptGiftCard } from "../utils/encryption.server";
import { convertRowsToCsv } from "./csv.server";
import type { SubscriptionPlan } from "../subscriptions/plans";

interface GiftCardRecord {
  id?: number;
  code?: string;
  last_characters?: string;
  balance?: string;
  currency?: string;
  value?: number;
  note?: string;
  expires_on?: string;
  disabled_at?: string;
  status?: string;
  created_at?: string;
}

const ALL_FIELDS = [
  "id",
  "code",
  "last_characters",
  "balance",
  "currency",
  "value",
  "note",
  "expires_on",
  "disabled_at",
  "status",
  "created_at",
] as const;

interface BuildJobDownloadResponseOptions {
  jobId: string;
  shopName: string;
  currentPlan: SubscriptionPlan;
  fieldsParam: string;
  delimiter: string;
  uppercase: boolean;
  splitted: boolean;
}

interface BuildBatchJobDownloadResponseOptions {
  jobIds: string[];
  shopName: string;
  currentPlan: SubscriptionPlan;
  fieldsParam: string;
  delimiter: string;
  uppercase: boolean;
  splitted: boolean;
}

function formatCode(code: string, uppercase: boolean, splitted: boolean): string {
  let formatted = code;

  if (uppercase) {
    formatted = formatted.toUpperCase();
  }

  if (splitted) {
    formatted = formatted.match(/.{1,4}/g)?.join("-") || formatted;
  }

  return formatted;
}

function getSelectedFields(fieldsParam: string): string[] {
  if (fieldsParam === "all" || fieldsParam === "none") {
    return [...ALL_FIELDS];
  }

  const selectedFields = fieldsParam
    .split(",")
    .filter((field) => ALL_FIELDS.includes(field as (typeof ALL_FIELDS)[number]));

  // Code is always included in the download
  if (selectedFields.length > 0 && !selectedFields.includes("code")) {
    selectedFields.unshift("code");
  }

  return selectedFields.length > 0 ? selectedFields : [...ALL_FIELDS];
}

export async function buildJobDownloadResponse({
  jobId,
  shopName,
  currentPlan,
  fieldsParam,
  delimiter,
  uppercase,
  splitted,
}: BuildJobDownloadResponseOptions): Promise<Response> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, shopName },
  });

  if (!job) {
    return Response.json({ message: "job not found" }, { status: 404 });
  }

  const jobPlan = getPlanById(job.subscriptionPlanId ?? currentPlan.id);

  if (!canDownload(jobPlan, job.createdAt)) {
    return Response.json(
      { message: "Download window has expired for your plan." },
      { status: 403 },
    );
  }

  if ((uppercase || splitted) && !currentPlan.formatter) {
    return Response.json(
      {
        message: "Code formatting requires the Basic plan or higher.",
      },
      { status: 403 },
    );
  }

  const selectedFields = getSelectedFields(fieldsParam);
  const giftCards = (job.giftCards || []) as GiftCardRecord[];
  const csvRows: Record<string, unknown>[] = [];

  // Job-level fallbacks for V1 cards that only stored {id, code}
  const jobFallbacks: Record<string, unknown> = {
    value: job.value != null ? Number(job.value) : "",
    note: job.note ?? "",
    expires_on: job.expireDate ?? "",
    created_at: job.createdAt ? new Date(job.createdAt).toISOString() : "",
    currency: job.giftCardCurrency ?? "",
  };

  for (const card of giftCards) {
    const row: Record<string, unknown> = {};

    for (const field of selectedFields) {
      if (field === "code" && card.code) {
        try {
          const decryptedCode = decryptGiftCard(card.code);
          row.code = formatCode(decryptedCode, uppercase, splitted);
        } catch {
          row.code = card.code;
        }
      } else {
        const cardValue = (card as Record<string, unknown>)[field];
        row[field] = cardValue != null && cardValue !== "" ? cardValue : (jobFallbacks[field] ?? "");
      }
    }

    csvRows.push(row);
  }

  const csvContent = convertRowsToCsv(csvRows, delimiter);

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${jobId}.csv"`,
    },
  });
}

export async function buildBatchJobDownloadResponse({
  jobIds,
  shopName,
  currentPlan,
  fieldsParam,
  delimiter,
  uppercase,
  splitted,
}: BuildBatchJobDownloadResponseOptions): Promise<Response> {
  const jobs = await prisma.job.findMany({
    where: { id: { in: jobIds }, shopName },
  });

  if (jobs.length === 0) {
    return Response.json({ message: "No jobs found" }, { status: 404 });
  }

  if ((uppercase || splitted) && !currentPlan.formatter) {
    return Response.json(
      { message: "Code formatting requires the Basic plan or higher." },
      { status: 403 },
    );
  }

  const selectedFields = getSelectedFields(fieldsParam);
  const allCsvRows: Record<string, unknown>[] = [];

  for (const job of jobs) {
    const jobPlan = getPlanById(job.subscriptionPlanId ?? currentPlan.id);
    if (!canDownload(jobPlan, job.createdAt)) continue;

    const giftCards = (job.giftCards || []) as GiftCardRecord[];
    const jobLabel = job.id.slice(0, 8).toUpperCase();

    const jobFallbacks: Record<string, unknown> = {
      value: job.value != null ? Number(job.value) : "",
      note: job.note ?? "",
      expires_on: job.expireDate ?? "",
      created_at: job.createdAt ? new Date(job.createdAt).toISOString() : "",
      currency: job.giftCardCurrency ?? "",
    };

    for (const card of giftCards) {
      const row: Record<string, unknown> = { job_id: jobLabel };

      for (const field of selectedFields) {
        if (field === "code" && card.code) {
          try {
            const decryptedCode = decryptGiftCard(card.code);
            row.code = formatCode(decryptedCode, uppercase, splitted);
          } catch {
            row.code = card.code;
          }
        } else {
          const cardValue = (card as Record<string, unknown>)[field];
          row[field] = cardValue != null && cardValue !== "" ? cardValue : (jobFallbacks[field] ?? "");
        }
      }

      allCsvRows.push(row);
    }
  }

  if (allCsvRows.length === 0) {
    return Response.json(
      { message: "Download window has expired for all selected jobs." },
      { status: 403 },
    );
  }

  const csvContent = convertRowsToCsv(allCsvRows, delimiter);
  const timestamp = new Date().toISOString().slice(0, 10);

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="batch-${timestamp}.csv"`,
    },
  });
}
