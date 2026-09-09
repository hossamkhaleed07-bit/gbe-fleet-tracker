import { useEffect, useRef, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import { PROJECT_LIST } from "../lib/constants";

export default function BranchSwitcher() {
  const { viewingProject, setViewingProject } = useDashboard();
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  const options = ["", ...PROJECT_LIST].filter(p => {
    const label = p || t("branchSwitcher.mainAccount");
    return label.toLowerCase().includes(search.trim().toLowerCase());
  });

  function choose(p) {
    setViewingProject(p || null);
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="branch-switcher" ref={rootRef}>
      <button className="branch-switcher-trigger" onClick={() => setOpen(o => !o)}>
        <span className="branch-switcher-icon">🔀</span>
        <span className="branch-switcher-text">
          <span className="branch-switcher-label">{t("branchSwitcher.switchAccount")}</span>
          <span className="branch-switcher-value">{viewingProject || t("branchSwitcher.mainAccount")}</span>
        </span>
        <span className={"branch-switcher-chevron" + (open ? " open" : "")}>▾</span>
      </button>
      {open && (
        <div className="branch-switcher-panel">
          <input
            className="branch-switcher-search"
            placeholder={t("branchSwitcher.search")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <div className="branch-switcher-list">
            {options.map(p => (
              <button
                key={p || "main"}
                className={"branch-switcher-item" + ((viewingProject || null) === (p || null) ? " active" : "")}
                onClick={() => choose(p)}
              >
                {p || t("branchSwitcher.mainAccount")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
