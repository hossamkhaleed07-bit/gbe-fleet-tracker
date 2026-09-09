import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import BranchSwitcher from "./BranchSwitcher";

export default function Layout() {
  const { isAdmin, isFleetManager, currentUserProject, logout } = useAuth();
  const { viewingProject } = useDashboard();
  const { t, lang, toggleLang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const canManageFleet = isAdmin || isFleetManager;
  const canSeeFuel = canManageFleet || !!currentUserProject;

  const FUEL_LINKS = [
    { to: "/fuel-approver", icon: "⛽", label: t("fuel.navApprover"), key: "fuel-approver" },
    { to: "/fuel-approval", icon: "👍", label: t("fuel.navApproval"), key: "fuel-approval" },
    { to: "/fuel-missing-form", icon: "⚠️", label: t("fuel.navMissingForm"), key: "fuel-missing-form" },
  ];
  const isOnFuelPage = FUEL_LINKS.some(l => location.pathname === l.to);
  const [fuelOpen, setFuelOpen] = useState(isOnFuelPage);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const NAV_ITEMS = [
    { section: t("layout.sectionReports"), links: [
      { to: "/overview", icon: "📊", label: t("layout.navOverview"), key: "overview" },
      { to: "/form-response", icon: "📝", label: t("layout.navFormResponse"), key: "form-response" },
      { to: "/records", icon: "🗂️", label: t("layout.navRecords"), key: "records" },
      { to: "/compare", icon: "🔁", label: t("layout.navCompare"), key: "compare" },
      { to: "/stations", icon: "📍", label: t("layout.navStations"), key: "stations" },
      { to: "/project-performance", icon: "📈", label: t("layout.navProjectPerformance"), key: "project-performance" },
    ]},
    { section: t("layout.sectionManagement"), links: [
      { to: "/fleet", icon: "🚚", label: t("layout.navFleet"), key: "fleet" },
      { to: "/drivers", icon: "🧑‍✈️", label: t("layout.navDrivers"), key: "drivers" },
    ]},
  ];

  const subLabel = isFleetManager ? t("layout.subFleetManager")
    : isAdmin ? t("layout.subAdmin")
    : t("layout.subProject", { project: currentUserProject });

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div id="app-layout" style={{ display: "flex" }}>
      <div id="mobile-topbar">
        <button type="button" className="mobile-menu-btn" onClick={() => setMobileSidebarOpen(o => !o)} aria-label={t("layout.toggleMenu")}>
          ☰
        </button>
        <span className="mobile-topbar-title">Master Fuel Report</span>
      </div>
      {mobileSidebarOpen && <div className="sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} />}
      <aside id="sidebar" className={mobileSidebarOpen ? "mobile-open" : ""}>
        <div className="sidebar-brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="GBE Logistics" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <div><div className="brand-text">Master Fuel Report</div><span className="sub2">{subLabel}</span></div>
        </div>
        {isAdmin && <BranchSwitcher />}
        <nav>
          {NAV_ITEMS.map(section => (
            <div key={section.section}>
              <div className="side-section-label">{section.section}</div>
              {section.links.map(link => {
                if (link.key === "overview" && isFleetManager) return null;
                if ((link.key === "fleet" || link.key === "drivers") && !canManageFleet) return null;
                if (link.key === "project-performance" && !isAdmin) return null;
                return (
                  <NavLink key={link.key} to={{ pathname: link.to, search: location.search }} className={({ isActive }) => "side-link" + (isActive ? " active" : "")}>
                    <span className="ic">{link.icon}</span> {link.label}
                  </NavLink>
                );
              })}
            </div>
          ))}
          {canSeeFuel && (
            <div>
              <button type="button" className="side-link side-group-toggle" onClick={() => setFuelOpen(o => !o)}>
                <span className="ic">⛽</span> {t("fuel.navSection")}
                <span className={"side-group-chevron" + (fuelOpen ? " open" : "")}>▾</span>
              </button>
              {fuelOpen && (
                <div className="side-subgroup">
                  {FUEL_LINKS.map(link => (
                    <NavLink key={link.key} to={{ pathname: link.to, search: location.search }} className={({ isActive }) => "side-link side-sublink" + (isActive ? " active" : "")}>
                      <span className="ic">{link.icon}</span> {link.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
        <div id="sidebar-bottom">
          <button className="side-link" onClick={toggleLang}><span className="ic">🌐</span> {t("layout.languageToggle")}</button>
          <button className="side-link" onClick={handleLogout}><span className="ic">🚪</span> {t("layout.logout")}</button>
        </div>
      </aside>
      <main id="content">
        {isAdmin && viewingProject && (
          <div className="scope-banner">{t("layout.scopeBannerPrefix")} <b>{viewingProject}</b> {t("layout.scopeBannerSuffix")}</div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
