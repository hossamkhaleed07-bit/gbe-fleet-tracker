import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLang } from "./LanguageContext";

const UndoContext = createContext(null);

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function UndoProvider({ children }) {
  const { t } = useLang();
  const stackRef = useRef([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const pushUndo = useCallback((label, undo) => {
    stackRef.current.push({ label, undo });
  }, []);

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
      if (e.key.toLowerCase() !== "z" || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      if (isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      runUndo();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [runUndo]);

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
