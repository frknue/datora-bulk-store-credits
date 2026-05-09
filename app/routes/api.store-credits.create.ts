import { authenticate } from "../shopify.server";
import { createStoreCreditJob } from "../lib/services/store-credit.server";
import type { CreateStoreCreditJobBody } from "../../shared/store-credit";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.admin(request);
  return cors(Response.json({ message: "Method not allowed" }, { status: 405 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, cors, session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return cors(Response.json({ message: "Method not allowed" }, { status: 405 }));
  }

  const body: CreateStoreCreditJobBody = await request.json();
  const result = await createStoreCreditJob(admin, billing, session, body);

  return cors(Response.json(result.body, { status: result.status }));
};
