import { redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

export const loader = ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  return redirect(`/app/gift-cards/${params.jobid}/download${url.search}`);
};

export default function LegacyJobDownloadRedirect() {
  return null;
}
