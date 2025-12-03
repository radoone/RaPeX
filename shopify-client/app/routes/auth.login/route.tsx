import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useRouteError } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";

import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const errors = loginErrorMessage(await login(request));
    return { errors, polarisTranslations };
  } catch (error) {
    console.error("Auth login loader failed", error);
    return {
      errors: { shop: "Authentication failed. Please re-enter your shop domain." },
      polarisTranslations,
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
    <PolarisAppProvider i18n={loaderData.polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    (error as any)?.data?.message ||
    (error as any)?.message ||
    "Something went wrong while loading the login screen.";

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <Text variant="headingMd" as="h2">
            Login error
          </Text>
          <Text as="p" tone="subdued">
            {message}
          </Text>
          <Form method="get" action="/auth/login">
            <Button submit>Try again</Button>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
