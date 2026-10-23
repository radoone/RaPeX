type ReviewModal = HTMLElement & { showOverlay?: () => void; show?: () => void };

/** Wait for Polaris to upgrade the modal, then open it exactly once. */
export function openReviewModalWhenReady(
  modalId: string,
  dom: Pick<Document, "getElementById" | "querySelector">,
  registry: Pick<CustomElementRegistry, "whenDefined">,
): () => void {
  let cancelled = false;
  void registry.whenDefined("s-modal").then(() => {
    if (cancelled) return;
    const modal = dom.getElementById(modalId) as ReviewModal | null;
    if (!modal) return;
    if (modal.showOverlay) modal.showOverlay();
    else if (modal.show) modal.show();
    else (dom.querySelector(`[commandFor="${modalId}"]`) as HTMLElement | null)?.click();
  });
  return () => { cancelled = true; };
}
