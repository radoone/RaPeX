import { describe, expect, it } from "vitest";
import { getAlertDecisionTransition } from "../app/services/alert-decision";

const now = new Date("2026-09-30T12:00:00Z");

describe("getAlertDecisionTransition", () => {
  it("keeps supplier follow-up open while recording its waiting state", () => {
    expect(getAlertDecisionTransition({
      action: "resolve",
      resolutionType: "contacted_supplier",
      notes: "  Asked supplier for documents  ",
      actorId: "session-1",
      now,
    })).toEqual({
      status: "active",
      reviewState: "waiting_for_supplier",
      resolutionType: "contacted_supplier",
      resolvedAt: null,
      dismissedAt: null,
      dismissedBy: null,
      notes: "Asked supplier for documents",
    });
  });

  it("marks a completed merchant decision resolved", () => {
    const transition = getAlertDecisionTransition({
      action: "resolve",
      resolutionType: "removed_from_store",
      actorId: "session-1",
      now,
    });
    expect(transition.status).toBe("resolved");
    expect(transition.reviewState).toBe("resolved");
    expect(transition.resolvedAt).toBe(now);
  });

  it("dismisses and reopens findings with explicit workflow states", () => {
    const dismissed = getAlertDecisionTransition({ action: "dismiss", actorId: "session-1", now });
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.reviewState).toBe("dismissed");
    expect(dismissed.dismissedBy).toBe("session-1");

    const reopened = getAlertDecisionTransition({ action: "reactivate", actorId: "session-1", now });
    expect(reopened.status).toBe("active");
    expect(reopened.reviewState).toBe("needs_review");
    expect(reopened.resolutionType).toBeNull();
  });
});
