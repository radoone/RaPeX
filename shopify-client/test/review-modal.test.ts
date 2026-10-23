import { describe, expect, it, vi } from "vitest";
import { openReviewModalWhenReady } from "../app/services/review-modal";

function fixture(modal: object) {
  let ready!: (value: CustomElementConstructor) => void;
  const registry = { whenDefined: vi.fn(() => new Promise<CustomElementConstructor>(resolve => { ready = resolve; })) };
  const trigger = { click: vi.fn() };
  const dom = { getElementById: vi.fn(() => modal), querySelector: vi.fn(() => trigger) } as unknown as Document;
  return { registry, trigger, dom, ready: () => ready(class {} as CustomElementConstructor) };
}

describe("opening a review from a deep link", () => {
  it("waits for the Polaris upgrade and never toggles the modal closed after opening", async () => {
    const modal = { showOverlay: vi.fn(), show: vi.fn() };
    const f = fixture(modal);
    openReviewModalWhenReady("alert-detail-1", f.dom, f.registry);
    expect(modal.showOverlay).not.toHaveBeenCalled();
    f.ready();
    await Promise.resolve();
    expect(modal.showOverlay).toHaveBeenCalledTimes(1);
    expect(modal.show).not.toHaveBeenCalled();
    expect(f.trigger.click).not.toHaveBeenCalled();
  });
  it("does not reopen a modal after navigation or effect cleanup", async () => {
    const modal = { showOverlay: vi.fn() };
    const f = fixture(modal);
    const cancel = openReviewModalWhenReady("alert-detail-1", f.dom, f.registry);
    cancel(); f.ready(); await Promise.resolve();
    expect(modal.showOverlay).not.toHaveBeenCalled();
    expect(f.trigger.click).not.toHaveBeenCalled();
  });
  it("uses one fallback only when the modal has no open method", async () => {
    const f = fixture({});
    openReviewModalWhenReady("alert-detail-1", f.dom, f.registry);
    f.ready(); await Promise.resolve();
    expect(f.trigger.click).toHaveBeenCalledTimes(1);
  });
});
