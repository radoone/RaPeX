import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  
  // Skip authentication for login path - it's handled by auth.login route
  if (url.pathname === "/auth/login") {
    return null;
  }
  
  await authenticate.admin(request);

  return null;
};
