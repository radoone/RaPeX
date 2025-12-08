import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useRouteError } from "@remix-run/react";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const errors = loginErrorMessage(await login(request));
    return { errors };
  } catch (error) {
    console.error("Auth login loader failed", error);
    return {
      errors: { shop: "Authentication failed. Please re-enter your shop domain." },
    };
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const errors = loginErrorMessage(await login(request));
    return { errors };
  } catch (error) {
    console.error("Auth login action failed", error);
    return {
      errors: { shop: "Authentication failed. Please try again." },
    };
  }
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData;

  return (
    <s-page size="small">
      <s-section padding="base">
        <s-box
          padding="large"
          borderRadius="large"
          background="bg-surface"
          borderWidth="base"
          borderColor="border"
          style={{ maxWidth: "520px", margin: "0 auto" }}
        >
          <s-stack gap="base">
            <s-stack gap="small">
              <s-heading size="medium">Log in</s-heading>
              <s-text tone="subdued">Enter your shop domain to continue.</s-text>
            </s-stack>

            {errors?.shop && (
              <s-banner tone="critical" heading="Authentication failed">
                <s-text>{errors.shop}</s-text>
              </s-banner>
            )}

            <Form method="post">
              <s-stack gap="base">
                <s-text-field
                  name="shop"
                  label="Shop domain"
                  placeholder="example.myshopify.com"
                  value={shop}
                  onInput={(event: any) => {
                    const value =
                      event?.detail?.value ??
                      event?.target?.value ??
                      "";
                    setShop(value);
                  }}
                  autoComplete="on"
                  required
                />
                <s-button type="submit" variant="primary" style={{ width: "100%" }}>
                  Log in
                </s-button>
              </s-stack>
            </Form>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    (error as any)?.data?.message ||
    (error as any)?.message ||
    "Something went wrong while loading the login screen.";

  return (
    <s-page size="small">
      <s-section padding="base">
        <s-box
          padding="large"
          borderRadius="large"
          background="bg-surface"
          borderWidth="base"
          borderColor="border"
          style={{ maxWidth: "520px", margin: "0 auto" }}
        >
          <s-stack gap="base">
            <s-heading size="medium">Login error</s-heading>
            <s-text tone="subdued">{message}</s-text>
            <Form method="get" action="/auth/login">
              <s-button type="submit" variant="primary">
                Try again
              </s-button>
            </Form>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}
