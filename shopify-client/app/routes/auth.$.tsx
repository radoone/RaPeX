import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, url }: LoaderFunctionArgs) => {
  
  // Skip authentication for login path - it's handled by auth.login route
  if (url.pathname === "/auth/login") {
    return null;
  }
  
  await authenticate.admin(request);

  return null;
};
