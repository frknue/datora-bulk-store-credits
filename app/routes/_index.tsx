import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../shopify.server";
import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: "2rem", fontFamily: "Inter, sans-serif" }}>
      <h1>Datora | Bulk Store Credits</h1>
      <p>Install this app from the Shopify Admin to get started.</p>
      {showForm && (
        <Form method="post" action="/auth/login">
          <label>
            <span>Shop domain</span>
            <input type="text" name="shop" placeholder="my-shop.myshopify.com" />
          </label>
          <button type="submit">Log in</button>
        </Form>
      )}
    </div>
  );
}
