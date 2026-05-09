import { authenticate } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

const CUSTOMERS_QUERY = `#graphql
  query StoreCreditCustomers($query: String, $first: Int!) {
    customers(first: $first, query: $query) {
      edges {
        node {
          id
          displayName
          firstName
          lastName
          defaultEmailAddress { emailAddress }
          numberOfOrders
          amountSpent { amount currencyCode }
        }
      }
    }
  }
`;

export interface StoreCreditPickerCustomer {
  id: string;
  name: string;
  email: string;
  orders: string;
  spent: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";

  const response = await admin.graphql(CUSTOMERS_QUERY, {
    variables: { query: q || null, first: 50 },
  });
  const { data } = await response.json();

  const customers: StoreCreditPickerCustomer[] =
    data?.customers?.edges?.map((edge: { node: Record<string, unknown> }) => {
      const node = edge.node as {
        id: string;
        displayName?: string;
        firstName?: string | null;
        lastName?: string | null;
        defaultEmailAddress?: { emailAddress?: string | null } | null;
        numberOfOrders?: string | number | null;
        amountSpent?: { amount?: string | null; currencyCode?: string | null } | null;
      };
      const fallbackName = [node.firstName, node.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const name = node.displayName?.trim() || fallbackName || "(no name)";
      const email = node.defaultEmailAddress?.emailAddress || "";
      const orders = String(node.numberOfOrders ?? "0");
      const amount = node.amountSpent?.amount ?? "0.00";
      const currency = node.amountSpent?.currencyCode ?? "";
      const spent = currency ? `${amount} ${currency}` : amount;
      return { id: node.id, name, email, orders, spent };
    }) ?? [];

  return { customers };
};
