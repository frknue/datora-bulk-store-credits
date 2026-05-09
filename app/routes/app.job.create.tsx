import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/gift-cards/create${url.search}`);
};

export default function LegacyJobCreateRedirect() {
  return null;
}
