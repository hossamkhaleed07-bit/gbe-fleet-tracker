import { createContext, useContext, useState } from "react";
import { flushSync } from "react-dom";
import { toggleThemeWithCircle } from "../lib/viewTransition";

const ThemeContext = createContext(null);
const STORAGE_KEY = "gbe.theme";

function readInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* storage blocked: fall through */ }
  return "light";
}

function applyToDom(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    const initial = readInitialTheme();
    document.documentElement.dataset.theme = initial;
    return initial;
  });

  function toggleTheme(button) {
    const next = theme === "dark" ? "light" : "dark";
    const apply = () => flushSync(() => { setTheme(next); applyToDom(next); });
    if (button) toggleThemeWithCircle(button, apply);
    else apply();
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
