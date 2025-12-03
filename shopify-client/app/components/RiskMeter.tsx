import type { ReactNode } from "react";

interface RiskMeterProps {
  riskLevel?: string;
  similarity?: number | null;
  label?: ReactNode;
}

export function RiskMeter({ riskLevel, similarity, label }: RiskMeterProps) {
  const { score, tone, title } = getRiskScore(riskLevel, similarity);

  return (
    <s-stack gap="small-200">
      <s-text tone="subdued" size="small">Risk score</s-text>
      <s-stack direction="inline" gap="small" blockAlign="center" wrap>
        <s-badge tone={tone}>{label || title}</s-badge>
        <s-text tone="subdued" size="small">{score}/100</s-text>
      </s-stack>
      <s-progress-bar progress={score} tone={tone === "success" ? "primary" : tone} />
    </s-stack>
  );
}

function getRiskScore(
  riskLevel?: string,
  similarity?: number | null
): { score: number; tone: "critical" | "warning" | "success" | "info"; title: string } {
  if (typeof similarity === "number") {
    return {
      score: clamp(similarity),
      tone: similarity >= 80 ? "critical" : similarity >= 60 ? "warning" : "success",
      title: riskLevel ? formatLabel(riskLevel) : "Similarity",
    };
  }

  const normalized = riskLevel?.toLowerCase() || "";
  if (normalized.includes("serious")) return { score: 92, tone: "critical", title: formatLabel(riskLevel) };
  if (normalized.includes("high")) return { score: 78, tone: "warning", title: formatLabel(riskLevel) };
  if (normalized.includes("other")) return { score: 64, tone: "warning", title: formatLabel(riskLevel) };
  if (normalized.includes("low")) return { score: 36, tone: "success", title: formatLabel(riskLevel) };

  return { score: 50, tone: "info", title: formatLabel(riskLevel || "Unknown risk") };
}

function clamp(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function formatLabel(value: string) {
  const first = value.trim();
  return first.charAt(0).toUpperCase() + first.slice(1);
}
