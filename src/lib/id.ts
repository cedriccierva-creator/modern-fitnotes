/**
 * Stable record ids.
 *
 * Every table uses these as its primary key rather than an auto-increment, so
 * a record keeps its identity across export/import and future sync, and a
 * cascade delete never depends on insertion order.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older WebViews: time-ordered prefix plus random suffix.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
