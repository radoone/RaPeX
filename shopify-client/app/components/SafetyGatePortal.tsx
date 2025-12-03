export function SafetyGatePortal() {
  return (
    <s-section heading="Safety Gate Portal">
      <s-text>
        Access the official European Safety Gate database to search for dangerous products and view detailed safety alerts.
      </s-text>
      <s-stack direction="inline" gap="small" wrap>
        <s-button
          variant="primary"
          href="https://ec.europa.eu/safety-gate-alerts/screen/search?resetSearch=true"
          target="_blank"
        >
          Search Database
        </s-button>
        <s-button
          variant="secondary"
          href="https://ec.europa.eu/safety-gate-alerts/screen/home"
          target="_blank"
        >
          Safety Gate Home
        </s-button>
      </s-stack>
    </s-section>
  );
}
