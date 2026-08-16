// Selection-window coordination shared by Shift-click and marquee gestures.
// Input owns the selected ids; the UI owns the actual context windows. Keeping
// the reconciliation here makes the one-panel contract testable without
// reaching through InputHandler's private event-routing methods.

/**
 * Close stale per-item windows and show one window for the current primary.
 * The primary window reads the complete live selection when it renders, so it
 * becomes the group panel whenever more than one id is selected.
 */
export function reconcileSelectionWindow({
  previousIds = [],
  selectedIds = [],
  primaryId = null,
  getPlaceable,
  closeWindow,
  openWindow,
  refreshWindows,
} = {}) {
  const primary = primaryId == null ? null : getPlaceable?.(primaryId) || null;
  const affectedIds = new Set([...(previousIds || []), ...(selectedIds || [])]);
  affectedIds.delete(primary?.id);

  for (const id of affectedIds) {
    const entry = getPlaceable?.(id);
    if (entry) closeWindow?.(entry);
  }
  if (primary) openWindow?.(primary);
  refreshWindows?.();
  return primary;
}
