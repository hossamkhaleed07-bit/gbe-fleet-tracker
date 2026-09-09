// Tiny in-memory cache (survives for the life of the tab, not across a hard
// reload) so a page that fetches its own data can render instantly from the
// last-seen result when the user navigates back to it, instead of flashing
// a loading state on every remount, while still refreshing in the background.
const store = new Map();

export function getPageCache(key) {
  return store.get(key);
}

export function setPageCache(key, value) {
  store.set(key, value);
}
