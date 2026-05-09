import { authenticate } from "../shopify.server";
import { sendContactMessage } from "../lib/services/contact.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return Response.json({ message: "Method not allowed" }, { status: 405 });
  }

  const { subject, name, email, message } = (await request.json()) as {
    subject?: string;
    name?: string;
    email?: string;
    message?: string;
  };

  const result = await sendContactMessage({
    subject: subject ?? "",
    name: name ?? "",
    email: email ?? "",
    message: message ?? "",
    shopName: session.shop,
  });

  if (!result.ok) {
    if (result.reason === "invalid") {
      return Response.json(
        { message: "All fields are required" },
        { status: 400 },
      );
    }
    return Response.json({ message: "Failed to send email" }, { status: 500 });
  }

  return Response.json({ message: "success" }, { status: 200 });
};
