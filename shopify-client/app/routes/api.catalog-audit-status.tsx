import type { LoaderFunctionArgs } from "react-router";
import { data as json } from "react-router";
import { authenticate } from "../shopify.server";
import { firestore } from "../firestore.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const snapshot = await firestore
    .collection("merchants")
    .doc(encodeURIComponent(session.shop))
    .get();
  const data = snapshot.data() || {};
  const runId =
    typeof data.initialScanRunId === "string" &&
    !data.initialScanRunId.includes("/")
      ? data.initialScanRunId
      : null;
  const run = runId
    ? await snapshot.ref.collection("initial_catalog_runs").doc(runId).get()
    : null;
  const phase = run?.get("phase");
  return json({
    phase: phase === "import" || phase === "monitor" ? phase : null,
    status:
      typeof data.initialScanStatus === "string"
        ? data.initialScanStatus
        : null,
    productsFetched: Number(data.initialScanProductsFetched || 0),
    productsImported: Number(data.initialScanProductsImported || 0),
    productsScanned: Number(data.initialScanProductsScanned || 0),
    alertsScanned: Number(data.initialScanAlertsScanned || 0),
    failureCode:
      typeof data.initialScanFailureCode === "string"
        ? data.initialScanFailureCode
        : null,
  });
};
