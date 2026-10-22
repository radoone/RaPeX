import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ url }: LoaderFunctionArgs) => {
  return redirect(`/app/audit-report${url.search}`);
};

