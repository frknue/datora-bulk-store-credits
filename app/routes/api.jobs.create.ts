import { authenticate } from "../shopify.server";
import { createBulkGiftCardJob } from "../lib/services/create-job.server";
import type { CreateJobBody } from "../lib/types";
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

  const body: CreateJobBody = await request.json();
  const result = await createBulkGiftCardJob(admin, billing, session, body);

  return cors(Response.json(result.body, { status: result.status }));
};
