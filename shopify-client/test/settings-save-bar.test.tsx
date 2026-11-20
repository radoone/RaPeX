import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  draft: undefined as unknown,
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
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    if (state.draft === undefined) state.draft = initial;
    return [state.draft, (next: unknown) => {
      state.draft = typeof next === "function" ? next(state.draft) : next;
    }];
  },
  useEffect: (effect: () => unknown) => { state.effects.push(effect); },
  useRef: (initial: unknown) => {
    const index = state.refIndex++;
    return state.refs[index] ||= { current: initial };
  },
}));
vi.mock("react-router", async (original) => ({
  ...await original<typeof import("react-router")>(),
  UNSAFE_withComponentProps: (component: unknown) => component,
  UNSAFE_withErrorBoundaryProps: (component: unknown) => component,
  data: vi.fn(), redirect: vi.fn(), Form: "form",
  useLoaderData: () => state.loader,
  useActionData: () => state.actionData,
  useFetcher: () => ({ Form: "form", state: "idle" }),
  useNavigation: () => state.navigation,
  useLocation: () => state.location,
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
  useBlocker: (callback: unknown) => { state.shouldBlock = callback; return state.blocker; },
  useRouteError: vi.fn(), isRouteErrorResponse: vi.fn(),
}));
vi.mock("@shopify/app-bridge-react", () => ({
  SaveBar: "ui-save-bar",
  useAppBridge: () => ({ saveBar: { leaveConfirmation: state.leaveConfirmation } }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("../app/components", () => ({ LanguageSwitcher: "language-switcher" }));
vi.mock("../app/shopify.server", () => ({ authenticate: {}, SHOPIFY_BILLING_MODE: "app-pricing" }));
vi.mock("../app/merchant-db.server", () => ({ default: {} }));
vi.mock("../app/firestore.server", () => ({ firestore: {} }));
vi.mock("../app/services/billing.server", () => ({ getBillingStatus: vi.fn() }));
vi.mock("../app/services/cancel-subscription.server", () => ({ cancelSubscription: vi.fn() }));
vi.mock("../app/services/monitoring-runs.server", () => ({ getRecentMonitoringRuns: vi.fn() }));

import Settings from "../app/routes/app.settings";

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
  state.refIndex = 0;
  state.effects = [];
  return Settings();
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
  state.draft = undefined;
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
    billingStatus: { developmentBypass: true }, catalog: [], saved: false,
    automaticMonitoring: "unknown", emailDelivery: "paused",
  };
  state.leaveConfirmation.mockResolvedValue(undefined);
});

describe("native settings save bar", () => {
  it.each(Object.entries({
    threshold: "85", priority: true, immediate: false, weekly: true,
    email: "other@example.com", language: "de", vendors: "Other", types: "Toy",
  }))("detects and discards a change to %s using the actual saved preferences", (field, value) => {
    expect(bar(render()).props.open).toBe(false);
    state.draft = { ...savedDraft, [field]: value };
    const tree = render();
    expect(bar(tree).props.open).toBe(true);
    expect(bar(tree).props.discardConfirmation).toBe(true);
    button(tree, "settingsUx.discard").props.onClick();
    expect(state.draft).toEqual(savedDraft);
    expect(bar(render()).props.open).toBe(false);
  });

  it("submits through the existing authenticated settings form and allows its redirect", () => {
    render();
    state.draft = { ...savedDraft, threshold: "85" };
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
    state.draft = { ...savedDraft, language: "de" };
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
    state.draft = { ...savedDraft, language: "de" };
    state.blocker.state = "blocked";
    state.leaveConfirmation.mockRejectedValue(new Error("cancelled"));
    render();
    state.effects[2]();
    await Promise.resolve();
    await Promise.resolve();
    expect(state.blocker.reset).toHaveBeenCalledOnce();
    expect(state.blocker.proceed).not.toHaveBeenCalled();
    expect(state.draft).toEqual({ ...savedDraft, language: "de" });
  });

  it("restores server-normalized values after saving even when the saved snapshot is unchanged", () => {
    render();
    state.draft = { ...savedDraft, email: "OWNER@EXAMPLE.COM" };
    state.location.key = "saved-redirect";
    render();
    state.effects[0]();
    expect(state.draft).toEqual(savedDraft);
    expect(bar(render()).props.open).toBe(false);
  });

  it("keeps every unsaved field when a rejected save changes the router location key", () => {
    render();
    const draft = { ...savedDraft, email: "invalid email", vendors: "New supplier", weekly: true };
    state.draft = draft;
    state.actionData = { error: "invalid_notification_email" };
    state.location.key = "rejected-post";
    render();
    state.effects[0]();
    expect(state.draft).toEqual(draft);
    expect(bar(render()).props.open).toBe(true);
  });

  it("disables both save-bar actions while the save is pending", () => {
    render();
    state.draft = { ...savedDraft, threshold: "85" };
    state.navigation.state = "submitting";
    const tree = render();
    expect(button(tree, "workspace.saveChanges").props.disabled).toBe(true);
    expect(button(tree, "settingsUx.discard").props.disabled).toBe(true);
  });
});
