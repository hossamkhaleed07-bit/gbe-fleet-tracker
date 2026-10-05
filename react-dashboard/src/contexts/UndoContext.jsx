import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLang } from "./LanguageContext";
import { useAuth } from "./AuthContext";

const UndoContext = createContext(null);

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function UndoProvider({ children }) {
  const { t } = useLang();
  const { isViewer } = useAuth();
  const stackRef = useRef([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // A read-only viewer has nothing to undo: nothing is ever pushed, Ctrl+Z does nothing.
  const pushUndo = useCallback((label, undo) => {
    if (isViewer) return;
    stackRef.current.push({ label, undo });
  }, [isViewer]);

  const runUndo = useCallback(async () => {
    const action = stackRef.current.pop();
    if (!action || busy) return;
    setBusy(true);
    try {
      await action.undo();
      setToast({ kind: "ok", text: t("common.undoRestored", { label: action.label }) });
    } catch (e) {
      setToast({ kind: "err", text: t("common.undoFailed") + e.message });
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  useEffect(() => {
    function handleKey(e) {
      if (isViewer || e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      if (isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      runUndo();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [runUndo, isViewer]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <UndoContext.Provider value={{ pushUndo }}>
      {children}
      {toast && <div className={"undo-toast " + toast.kind}>{toast.text}</div>}
    </UndoContext.Provider>
  );
}

export function useUndo() {
  return useContext(UndoContext);
}
