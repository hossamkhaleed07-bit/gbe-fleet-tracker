import { useEffect, useRef } from "react";

// The combined hero filter box has one "Clear filters" button (in GlobalFilters).
// It broadcasts this event so each page can also reset its own local filters.
export const CLEAR_FILTERS_EVENT = "gbe:clear-filters";

export function useClearFilters(onClear) {
  const ref = useRef(onClear);
  useEffect(() => { ref.current = onClear; });
  useEffect(() => {
    const handler = () => ref.current?.();
    window.addEventListener(CLEAR_FILTERS_EVENT, handler);
    return () => window.removeEventListener(CLEAR_FILTERS_EVENT, handler);
  }, []);
}
