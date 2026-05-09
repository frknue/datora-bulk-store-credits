import { authenticate } from "../shopify.server";
import { resolveSegmentMemberIds } from "../lib/services/segments.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

interface RecipientsCountBody {
  customerIds?: string[];
  segmentIds?: string[];
}

function extractNumericId(gid: string): string {
  const match = gid.match(/(\d+)$/);
  return match ? match[1] : gid;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.admin(request);
  return cors(Response.json({ message: "Method not allowed" }, { status: 405 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, cors } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return cors(
      Response.json({ message: "Method not allowed" }, { status: 405 }),
    );
  }

  const body = (await request.json()) as RecipientsCountBody;
  const customerIds = Array.isArray(body.customerIds) ? body.customerIds : [];
  const segmentIds = Array.isArray(body.segmentIds)
    ? body.segmentIds.filter(Boolean)
    : [];

  const segmentMemberIds: string[] = [];
  for (const segmentId of segmentIds) {
    try {
      const ids = await resolveSegmentMemberIds(admin, segmentId);
      segmentMemberIds.push(...ids);
    } catch (e) {
      console.error("Error resolving segment members:", segmentId, e);
      return cors(
        Response.json(
          { message: "Failed to resolve segment members" },
          { status: 502 },
        ),
      );
    }
  }

  const seen = new Set<string>();
  for (const raw of [...customerIds, ...segmentMemberIds]) {
    const id = extractNumericId(String(raw).trim());
    if (id) seen.add(id);
  }

  return cors(Response.json({ count: seen.size }));
};
