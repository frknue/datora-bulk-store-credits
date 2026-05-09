import type { authenticate } from "../../shopify.server";

type AdminAuthContext = Awaited<ReturnType<typeof authenticate.admin>>;
type AdminGraphqlClient = AdminAuthContext["admin"];

const SEGMENT_MEMBERS_QUERY = `#graphql
  query ResolveSegmentMembers($id: ID!, $cursor: String) {
    customerSegmentMembers(first: 250, segmentId: $id, after: $cursor) {
      edges { node { id } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/**
 * Paginate `customerSegmentMembers(segmentId:)` and return every member's
 * customer GID. Used by the create-job and store-credit services to freeze
 * segment membership at job-creation time, and by /api/recipients-count to
 * preview the deduped recipient count before submission.
 */
export async function resolveSegmentMemberIds(
  admin: AdminGraphqlClient,
  segmentId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const response = await admin.graphql(SEGMENT_MEMBERS_QUERY, {
      variables: { id: segmentId, cursor },
    });
    const json = (await response.json()) as {
      data?: {
        customerSegmentMembers?: {
          edges: { node: { id: string } }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (json.errors && json.errors.length > 0) {
      throw new Error(json.errors[0].message);
    }
    const page = json.data?.customerSegmentMembers;
    if (!page) break;
    for (const edge of page.edges) ids.push(edge.node.id);
    hasNextPage = page.pageInfo.hasNextPage && Boolean(page.pageInfo.endCursor);
    cursor = page.pageInfo.endCursor;
  }
  return ids;
}
