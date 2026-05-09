import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

const SEGMENTS_QUERY = `#graphql
  query StoreCreditSegments($query: String, $first: Int!) {
    segments(first: $first, query: $query) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

export interface StoreCreditPickerSegment {
  id: string;
  name: string;
  count: number;
}

function buildCountsQuery(segmentIds: string[]): string {
  const aliases = segmentIds
    .map(
      (_, i) =>
        `s${i}: customerSegmentMembers(first: 1, segmentId: $id${i}) { totalCount }`,
    )
    .join("\n    ");
  const params = segmentIds.map((_, i) => `$id${i}: ID!`).join(", ");
  return `#graphql
    query StoreCreditSegmentCounts(${params}) {
      ${aliases}
    }
  `;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";

  const listResponse = await admin.graphql(SEGMENTS_QUERY, {
    variables: { query: q || null, first: 50 },
  });
  const { data: listData } = await listResponse.json();

  const rawSegments: { id: string; name: string }[] =
    listData?.segments?.edges?.map(
      (edge: { node: { id: string; name: string } }) => ({
        id: edge.node.id,
        name: edge.node.name,
      }),
    ) ?? [];

  if (rawSegments.length === 0) return { segments: [] };

  // Fetch member counts for all segments in a single round-trip via aliased
  // fields, then drop any segment with zero members so they don't pollute the
  // picker.
  const countsResponse = await admin.graphql(
    buildCountsQuery(rawSegments.map((s) => s.id)),
    {
      variables: Object.fromEntries(
        rawSegments.map((s, i) => [`id${i}`, s.id]),
      ),
    },
  );
  const { data: countsData } = (await countsResponse.json()) as {
    data?: Record<string, { totalCount: number } | null>;
  };

  const segments: StoreCreditPickerSegment[] = rawSegments
    .map((s, i) => ({
      id: s.id,
      name: s.name,
      count: countsData?.[`s${i}`]?.totalCount ?? 0,
    }))
    .filter((s) => s.count > 0);

  return { segments };
};
