const THEME_CLASS = "theme-transition";

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// HashRouter ignores NavLink's `viewTransition` prop (only RouterProvider supports it),
// so page navigations are wrapped by hand. The transition callback must resolve only
// once the new page has committed, otherwise the "new" snapshot is the old page.
let pendingNavigation = null;

// Called by Layout after every committed location change.
export function notifyNavigated() {
  if (pendingNavigation) { pendingNavigation(); pendingNavigation = null; }
}

export function navigateWithTransition(navigate) {
  if (!document.startViewTransition || prefersReducedMotion()) {
    navigate();
    return;
  }
  document.startViewTransition(() => new Promise((resolve) => {
    // safety net: lazy chunks that never commit must not freeze the page
    const timer = setTimeout(() => { pendingNavigation = null; resolve(); }, 2000);
    pendingNavigation = () => { clearTimeout(timer); resolve(); };
    navigate();
  }));
}

// Swaps the theme with a circle that grows from the clicked button. `applyTheme`
// must update the DOM synchronously (flushSync) so the "new" snapshot is the new theme.
export function toggleThemeWithCircle(button, applyTheme) {
  if (!document.startViewTransition || prefersReducedMotion()) {
    applyTheme();
    return;
  }

  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const root = document.documentElement;
  // Scoped to the theme swap only: it switches off the default crossfade, which
  // would otherwise fight the clip-path animation (and the page crossfades).
  root.classList.add(THEME_CLASS);

  const transition = document.startViewTransition(applyTheme);

  transition.ready.then(() => {
    root.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
      { duration: 500, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" },
    );
  }).catch(() => {});

  transition.finished.finally(() => root.classList.remove(THEME_CLASS));
}
