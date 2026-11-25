import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  effects: [] as Array<() => unknown>,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  loader: {} as Record<string, unknown>,
  actionData: undefined as { error: string } | undefined,
  navigation: { state: "idle" },
  location: { key: "initial" },
  blocker: { state: "unblocked", proceed: vi.fn(), reset: vi.fn() },
  shouldBlock: undefined as unknown,
  leaveConfirmation: vi.fn(),
  toastShow: vi.fn(),
  previewLoad: vi.fn(),
}));

const getDraft = () => state.states[1] as Record<string, unknown>;
const setDraft = (next: Record<string, unknown>) => {
  state.states[1] = next;
};

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.stateIndex++;
    if (state.states[index] === undefined) state.states[index] = initial;
    return [state.states[index], (next: unknown) => {
      state.states[index] = typeof next === "function" ? next(state.states[index]) : next;
    }];
  },
  useEffect: (effect: () => unknown) => { state.effects.push(effect); },
  useRef: (initial: unknown) => {
    const index = state.refIndex++;
    return state.refs[index] ||= { current: initial };
  },
  useSyncExternalStore: (_subscribe: unknown, getClientSnapshot: () => unknown) => getClientSnapshot(),
}));
vi.mock("react-router", async (original) => ({
  ...await original<typeof import("react-router")>(),
  UNSAFE_withComponentProps: (component: unknown) => component,
  UNSAFE_withErrorBoundaryProps: (component: unknown) => component,
  data: vi.fn(), redirect: vi.fn(), Form: "form",
  useLoaderData: () => state.loader,
  useActionData: () => state.actionData,
  useFetcher: () => ({ Form: "form", state: "idle", load: state.previewLoad }),
  useNavigation: () => state.navigation,
  useLocation: () => state.location,
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
  useBlocker: (callback: unknown) => { state.shouldBlock = callback; return state.blocker; },
  useRouteError: vi.fn(), isRouteErrorResponse: vi.fn(),
}));
vi.mock("@shopify/app-bridge-react", () => ({
  SaveBar: "ui-save-bar",
  useAppBridge: () => ({
    saveBar: { leaveConfirmation: state.leaveConfirmation },
    toast: { show: state.toastShow },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../app/components", () => ({
  AdminCard: "admin-card",
  LanguageSwitcher: "language-switcher",
  MonitoringStatus: "monitoring-status",
}));
vi.mock("../app/shopify.server", () => ({ authenticate: {}, SHOPIFY_BILLING_MODE: "app-pricing" }));
vi.mock("../app/merchant-db.server", () => ({ default: {} }));
vi.mock("../app/firestore.server", () => ({ firestore: {} }));
vi.mock("../app/services/billing.server", () => ({ getBillingStatus: vi.fn() }));
vi.mock("../app/services/cancel-subscription.server", () => ({ cancelSubscription: vi.fn() }));
vi.mock("../app/services/monitoring-runs.server", () => ({ getRecentMonitoringRuns: vi.fn() }));

import { SettingsContent } from "../app/routes/app.settings";

type Element = ReactElement<Record<string, any>>;
function find(tree: unknown, predicate: (element: Element) => boolean): Element {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      try { return find(child, predicate); } catch { /* Search the next sibling. */ }
    }
  } else if (tree && typeof tree === "object" && "props" in tree) {
    const element = tree as Element;
    if (predicate(element)) return element;
    return find(element.props.children, predicate);
  }
  throw new Error("Element not found");
}
function render() {
  state.stateIndex = 0;
  state.refIndex = 0;
  state.effects = [];
  return SettingsContent({ data: state.loader as Parameters<typeof SettingsContent>[0]["data"] });
}
function bar(tree: unknown) { return find(tree, element => element.type === "ui-save-bar"); }
function button(tree: unknown, label: string) {
  return find(tree, element => element.type === "button" && element.props.children === label);
}
const savedDraft = {
  threshold: "70", priority: false, immediate: true, weekly: false,
  email: "owner@example.com", language: "sk", vendors: "Example", types: "Gift Card",
};
beforeEach(() => {
  vi.clearAllMocks();
  state.states = [];
  state.stateIndex = 0;
  state.actionData = undefined;
  state.refs = [];
  state.navigation.state = "idle";
  state.location.key = "initial";
  state.blocker.state = "unblocked";
  state.loader = {
    settings: {
      similarityThreshold: 70, autoDraftHighRisk: false,
      immediateAlertEmails: true, weeklySummaryEmails: false,
      notificationEmail: "owner@example.com", notificationLanguage: "sk",
      excludeVendors: "Example", excludeTypes: "Gift Card",
    },
    billingStatus: { developmentBypass: true },
    supportsCancellation: true,
    lastMonitoringAt: null,
    automaticMonitoring: "unknown",
    initialAuditCompleted: false,
    nextCheck: null,
    emailDelivery: "paused",
    lastVerifiedPlan: null,
    saved: false,
  };
  state.leaveConfirmation.mockResolvedValue(undefined);
});

describe("native settings save bar", () => {
  it("shows a warning when enabled emails have no recipient", () => {
    state.loader.settings = { ...(state.loader.settings as object), notificationEmail: "" };
    const warning = find(render(), element =>
      element.type === "s-banner" && element.props.heading === "settingsAdmin.notifications.noRecipientHeading",
    );
    expect(warning.props.tone).toBe("warning");
  });

  it.each(Object.entries({
    threshold: "85", priority: true, immediate: false, weekly: true,
    email: "other@example.com", language: "de", vendors: "Other", types: "Toy",
  }))("detects and discards a change to %s using the actual saved preferences", (field, value) => {
    expect(bar(render()).props.open).toBe(false);
    setDraft({ ...savedDraft, [field]: value });
    const tree = render();
    expect(bar(tree).props.open).toBe(true);
    expect(bar(tree).props.discardConfirmation).toBe(true);
    button(tree, "settingsUx.discard").props.onClick();
    expect(getDraft()).toEqual(savedDraft);
    expect(bar(render()).props.open).toBe(false);
  });

  it("submits through the existing authenticated settings form and allows its redirect", () => {
    render();
    setDraft({ ...savedDraft, threshold: "85" });
    const tree = render();
    const form = find(tree, element => element.type === "form" && !!element.props.onSubmit);
    const requestSubmit = vi.fn();
    form.props.ref.current = { requestSubmit };
    button(tree, "workspace.saveChanges").props.onClick();
    expect(requestSubmit).toHaveBeenCalledOnce();
    form.props.onSubmit();
    expect((state.shouldBlock as (transition: unknown) => boolean)({
      currentLocation: { pathname: "/app/settings" },
      nextLocation: { pathname: "/app/settings", search: "?saved=1" },
    })).toBe(false);
  });

  it("uses Shopify's leave confirmation before continuing iframe navigation", async () => {
    render();
    setDraft({ ...savedDraft, language: "de" });
    state.blocker.state = "blocked";
    render();
    expect((state.shouldBlock as (transition: unknown) => boolean)({
      currentLocation: { pathname: "/app/settings" }, nextLocation: { pathname: "/app" },
    })).toBe(true);
    state.effects[2]();
    expect(state.leaveConfirmation).toHaveBeenCalledOnce();
    expect(state.blocker.proceed).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(state.blocker.proceed).toHaveBeenCalledOnce();
  });

  it("keeps the draft if the merchant cancels leaving", async () => {
    render();
    setDraft({ ...savedDraft, language: "de" });
    state.blocker.state = "blocked";
    state.leaveConfirmation.mockRejectedValue(new Error("cancelled"));
    render();
    state.effects[2]();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.blocker.reset).toHaveBeenCalledOnce();
    expect(state.blocker.proceed).not.toHaveBeenCalled();
    expect(getDraft()).toEqual({ ...savedDraft, language: "de" });
  });

  it("restores server-normalized values after saving even when the saved snapshot is unchanged", () => {
    render();
    setDraft({ ...savedDraft, email: "OWNER@EXAMPLE.COM" });
    state.location.key = "saved-redirect";
    render();
    state.effects[0]();
    expect(getDraft()).toEqual(savedDraft);
    expect(bar(render()).props.open).toBe(false);
  });

  it("keeps every unsaved field when a rejected save changes the router location key", () => {
    render();
    const draft = { ...savedDraft, email: "invalid email", vendors: "New supplier", weekly: true };
    setDraft(draft);
    state.actionData = { error: "invalid_notification_email" };
    state.location.key = "rejected-post";
    render();
    state.effects[0]();
    expect(getDraft()).toEqual(draft);
    expect(bar(render()).props.open).toBe(true);
  });

  it("disables both save-bar actions while the save is pending", () => {
    render();
    setDraft({ ...savedDraft, threshold: "85" });
    state.navigation.state = "submitting";
    const tree = render();
    expect(button(tree, "workspace.saveChanges").props.disabled).toBe(true);
    expect(button(tree, "settingsUx.discard").props.disabled).toBe(true);
  });

  it("shows a Shopify toast once when settings are saved cleanly", () => {
    state.loader.saved = true;
    state.location.key = "saved-toast-1";
    render();
    state.effects[4]();
    expect(state.toastShow).toHaveBeenCalledTimes(1);
    expect(state.toastShow).toHaveBeenCalledWith("workspace.saved");
    render();
    state.effects[4]();
    expect(state.toastShow).toHaveBeenCalledTimes(1);
  });

  it("renders native choice list, Help & support section, and stop-renewal modal for cancellable active plans", () => {
    state.loader.billingStatus = {
      developmentBypass: false,
      ownerTestAccess: false,
      billingVerified: true,
      hasActivePayment: true,
      planHandle: "starter",
      validUntil: "2026-12-31T00:00:00Z",
    };
    const tree = render();
    const choiceList = find(tree, el => el.type === "s-choice-list" && el.props.name === "monitoringModeChoice");
    expect(choiceList).toBeTruthy();
    const supportSection = find(tree, el => el.type === "s-section" && el.props.heading === "settingsUx.supportTitle");
    expect(supportSection).toBeTruthy();
    const supportLink = find(supportSection, el => el.type === "s-link" && el.props.href === "mailto:info@zerorecall.online");
    expect(supportLink).toBeTruthy();
    const stopModal = find(tree, el => el.type === "s-modal" && el.props.id === "stop-renewal-modal");
    expect(stopModal).toBeTruthy();
  });
});
