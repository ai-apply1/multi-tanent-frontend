import { useEffect, useState } from "react";

/** Debounce any fast-changing value (typically a search string). Returns the
 *  latest value only after `delay` ms without a change, so an input stays
 *  controlled on the raw value while a react-query key reads the debounced
 *  one — one request per pause instead of one per keystroke. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
