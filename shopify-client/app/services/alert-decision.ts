export type AlertDecisionAction = "resolve" | "dismiss" | "reactivate";

export type AlertDecisionTransition = {
  status: "active" | "resolved" | "dismissed";
  reviewState: "needs_review" | "waiting_for_supplier" | "resolved" | "dismissed";
  resolutionType: string | null;
  resolvedAt: Date | null;
  dismissedAt: Date | null;
  dismissedBy: string | null;
  notes: string | null;
};

export function getAlertDecisionTransition(params: {
  action: AlertDecisionAction;
  resolutionType?: string | null;
  notes?: string | null;
  actorId: string;
  now?: Date;
}): AlertDecisionTransition {
  const now = params.now || new Date();
  const notes = params.notes?.trim() || null;

  if (params.action === "dismiss") {
    return {
      status: "dismissed",
      reviewState: "dismissed",
      resolutionType: params.resolutionType || null,
      resolvedAt: null,
      dismissedAt: now,
      dismissedBy: params.actorId,
      notes,
    };
  }

  if (params.action === "reactivate") {
    return {
      status: "active",
      reviewState: "needs_review",
      resolutionType: null,
      resolvedAt: null,
      dismissedAt: null,
      dismissedBy: null,
      notes: null,
    };
  }

  if (params.resolutionType === "contacted_supplier") {
    return {
      status: "active",
      reviewState: "waiting_for_supplier",
      resolutionType: params.resolutionType,
      resolvedAt: null,
      dismissedAt: null,
      dismissedBy: null,
      notes,
    };
  }

  return {
    status: "resolved",
    reviewState: "resolved",
    resolutionType: params.resolutionType || null,
    resolvedAt: now,
    dismissedAt: null,
    dismissedBy: null,
    notes,
  };
}
