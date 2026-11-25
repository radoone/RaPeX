import { useState } from "react";
import { useNavigate, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { AdminCard } from "./AdminCard";
import { LocalDateTime } from "./LocalDateTime";
import type { checkLedger } from "../services/check-ledger.server";

export function CheckLedger({ ledger }: { ledger: Awaited<ReturnType<typeof checkLedger>> }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [exported, setExported] = useState(false);
  const busy = navigation.state !== "idle";
  function pageUrl(cursor: string, state = ledger.filters.state) {
    const params = new URLSearchParams(window.location.search);
    params.delete("checkAfter"); params.delete("checkState");
    if (cursor) params.set("checkAfter", cursor);
    if (state) params.set("checkState", state);
    return `/app/audit-report?${params}#product-check-evidence`;
  }
  async function downloadPage() {
    if (exporting) return;
    setExporting(true); setFailed(false); setExported(false);
    try {
      const params = new URLSearchParams({ lang: i18n.resolvedLanguage || i18n.language });
      if (ledger.filters.cursor) params.set("checkAfter", ledger.filters.cursor);
      if (ledger.filters.state) params.set("checkState", ledger.filters.state);
      const response = await fetch(`/app/check-ledger.csv?${params}`);
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("text/csv")) throw new Error("Export failed");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `zerorecall-check-evidence-page-${ledger.generatedAt.slice(0, 10)}.csv`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      // Leave the browser time to consume the object URL before releasing it.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setExported(true);
    } catch { setFailed(true); }
    finally { setExporting(false); }
  }
  const date = (value: string | null) => value ? <LocalDateTime value={value} locale={i18n.language} /> : "—";
  return <AdminCard className="admin-card" id="product-check-evidence">
    <div className="admin-card__header">
      <h2 className="admin-card__title">{t("checkLedger.title")}</h2>
      <s-button variant="secondary" onClick={downloadPage} loading={exporting} disabled={exporting || busy}>
        {t("checkLedger.download")}
      </s-button>
    </div>
    <p>{t("checkLedger.description")}</p>
    <p className="admin-helper">{t("checkLedger.pageScope")}</p>
    <s-select label={t("checkLedger.state")} value={ledger.filters.state} disabled={busy || exporting}
      onChange={(event: any) => navigate(pageUrl("", event.currentTarget.value))}>
      <s-option value="">{t("checkLedger.all")}</s-option>
      {(["current", "changed", "unverified", "unchecked", "deleted"] as const).map(state =>
        <s-option key={state} value={state}>{t(`checkLedger.states.${state}`)}</s-option>)}
    </s-select>
    {failed && <s-banner tone="critical" heading={t("errors.apiError")}>
      <s-button onClick={downloadPage}>{t("actions.retry")}</s-button>
    </s-banner>}
    {exported && <p role="status">{t("workspace.exportReady")}</p>}
    {ledger.records.length === 0 ? <p role="status">{t("checkLedger.empty")}</p> :
      <div className="audit-report-table-wrap">
        <s-table accessibilityLabel={t("checkLedger.title")}>
          <s-table-header-row>
            <s-table-header listSlot="primary">{t("checkLedger.product")}</s-table-header>
            <s-table-header listSlot="inline">{t("checkLedger.state")}</s-table-header>
            <s-table-header listSlot="labeled">{t("checkLedger.checkedAt")}</s-table-header>
            <s-table-header listSlot="labeled">{t("checkLedger.version")}</s-table-header>
            <s-table-header listSlot="labeled">{t("checkLedger.checkedVersion")}</s-table-header>
            <s-table-header listSlot="labeled">{t("checkLedger.result")}</s-table-header>
            <s-table-header listSlot="labeled">{t("checkLedger.evidence")}</s-table-header>
          </s-table-header-row>
          <s-table-body>{ledger.records.map(record => <s-table-row key={record.id}>
            <s-table-cell>{record.title}<p className="admin-helper">{record.id}</p></s-table-cell>
            <s-table-cell><s-badge tone={record.state === "changed" ? "warning" : "subdued"}>{t(`checkLedger.states.${record.state}`)}</s-badge></s-table-cell>
            <s-table-cell>{date(record.checkedAt)}</s-table-cell>
            <s-table-cell>{date(record.productVersion)}</s-table-cell>
            <s-table-cell>{date(record.checkedVersion)}</s-table-cell>
            <s-table-cell>{t(`checkLedger.results.${record.result}`)}</s-table-cell>
            <s-table-cell>{t(`checkLedger.evidenceTypes.${record.evidence}`)}
              {record.coveredThrough && <p>{t("checkLedger.coveredThrough")}: {date(record.coveredThrough)}</p>}
            </s-table-cell>
          </s-table-row>)}</s-table-body>
        </s-table>
      </div>}
    <div className="admin-actions">
      {ledger.filters.cursor && <s-button disabled={busy || exporting} onClick={() => navigate(pageUrl(""))}>{t("checkLedger.first")}</s-button>}
      {ledger.nextCursor && <s-button disabled={busy || exporting} onClick={() => navigate(pageUrl(ledger.nextCursor!))}>{t("checkLedger.next")}</s-button>}
    </div>
    <p className="admin-helper">{t("checkLedger.legal")}</p>
  </AdminCard>;
}
