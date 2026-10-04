import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FileText, FolderOpen, CalendarDays, GitCompareArrows, MapPin, TrendingUp, Gauge,
  Truck, IdCard, Fuel, ThumbsUp, TriangleAlert, RefreshCw, Globe, LogOut, ChevronDown, Menu, ClipboardList,
  Receipt, Database,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import { useFuelInsights } from "../hooks/useFuelInsights";
import BranchSwitcher from "./BranchSwitcher";

export default function Layout() {
  const { session, isAdmin, isFleetManager, currentUserProject, logout } = useAuth();
  const { viewingProject, loading, lastUpdated } = useDashboard();
  const { t, lang, toggleLang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();
  const canManageFleet = isAdmin || isFleetManager;
  const canSeeFuel = canManageFleet || !!currentUserProject;
  const { pendingCount, conflictCount } = useFuelInsights();

  const FUEL_LINKS = [
    { to: "/fuel-approver", icon: <Fuel size={17} />, label: t("fuel.navApprover"), key: "fuel-approver", badge: pendingCount },
    { to: "/fuel-approval", icon: <ThumbsUp size={17} />, label: t("fuel.navApproval"), key: "fuel-approval" },
    { to: "/fuel-missing-form", icon: <TriangleAlert size={17} />, label: t("fuel.navMissingForm"), key: "fuel-missing-form" },
    { to: "/automatic-fuel", icon: <RefreshCw size={17} />, label: t("fuel.navAutomaticFuel"), key: "automatic-fuel" },
  ];
  const isOnFuelPage = FUEL_LINKS.some(l => location.pathname === l.to);
  const [fuelOpen, setFuelOpen] = useState(isOnFuelPage);

  const PROJECT_PERFORMANCE_LINKS = [
    { to: "/project-performance", icon: <TrendingUp size={17} />, label: t("layout.navProjectStatistics"), key: "project-performance-stats" },
    { to: "/project-performance/rca", icon: <ClipboardList size={17} />, label: t("layout.navProjectRCA"), key: "project-performance-rca" },
  ];
  const isOnProjectPerformancePage = PROJECT_PERFORMANCE_LINKS.some(l => location.pathname === l.to);
  const [ppOpen, setPpOpen] = useState(isOnProjectPerformancePage);
  // Project managers need this too (their own project's RCA follow-up), not
  // just admins — mirrors canSeeFuel's pattern, no new permission concept.
  const canSeeProjectPerformance = isAdmin || isFleetManager || !!currentUserProject;

  const FUEL_INVOICE_LINKS = [
    { to: "/fuel-invoice/entries", icon: <Receipt size={17} />, label: "Entries", key: "fuel-invoice-entries" },
    { to: "/fuel-invoice/database", icon: <Database size={17} />, label: "Data Base", key: "fuel-invoice-database" },
  ];
  const isOnFuelInvoicePage = FUEL_INVOICE_LINKS.some(l => location.pathname === l.to);
  const [fiOpen, setFiOpen] = useState(isOnFuelInvoicePage);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const layoutRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (e) => { if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [userMenuOpen]);

  useEffect(() => {
    setMobileSidebarOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  // Cursor-follow glow + subtle 3D tilt on cards. One delegated listener that
  // only writes CSS variables, so pages need no changes and React never re-renders.
  const TILT_SELECTOR = ".kpi-dot-card.clickable, .driver-card, .compare-card";
  function handlePointerMove(e) {
    const root = layoutRef.current;
    if (!root || e.pointerType === "touch") return;
    root.style.setProperty("--glow-x", e.clientX + "px");
    root.style.setProperty("--glow-y", e.clientY + "px");
    const card = e.target.closest?.(TILT_SELECTOR);
    if (card) {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      card.style.setProperty("--tilt-x", ((0.5 - py) * 5).toFixed(2) + "deg");
      card.style.setProperty("--tilt-y", ((px - 0.5) * 5).toFixed(2) + "deg");
      card.style.setProperty("--shine-x", (px * 100).toFixed(1) + "%");
      card.style.setProperty("--shine-y", (py * 100).toFixed(1) + "%");
    }
  }
  function handlePointerOut(e) {
    const card = e.target.closest?.(TILT_SELECTOR);
    if (card && !card.contains(e.relatedTarget)) {
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
    }
  }

  const NAV_ITEMS = [
    { section: t("layout.sectionReports"), links: [
      { to: "/overview", icon: <LayoutDashboard size={17} />, label: t("layout.navOverview"), key: "overview" },
      { to: "/form-response", icon: <FileText size={17} />, label: t("layout.navFormResponse"), key: "form-response" },
      { to: "/records", icon: <FolderOpen size={17} />, label: t("layout.navRecords"), key: "records" },
      { to: "/attendance", icon: <CalendarDays size={17} />, label: t("layout.navAttendance"), key: "attendance", badge: conflictCount },
      { to: "/compare", icon: <GitCompareArrows size={17} />, label: t("layout.navCompare"), key: "compare" },
      { to: "/driver-performance", icon: <Gauge size={17} />, label: t("layout.navDriverPerformance"), key: "driver-performance" },
      { to: "/stations", icon: <MapPin size={17} />, label: t("layout.navStations"), key: "stations" },
    ]},
    { section: t("layout.sectionManagement"), links: [
      { to: "/fleet", icon: <Truck size={17} />, label: t("layout.navFleet"), key: "fleet" },
      { to: "/drivers", icon: <IdCard size={17} />, label: t("layout.navDrivers"), key: "drivers" },
    ]},
  ];

  // Role-based visibility for nav links.
  function isVisible(link) {
    if (link.key === "overview" && isFleetManager) return false;
    if ((link.key === "fleet" || link.key === "drivers") && !canManageFleet) return false;
    return true;
  }

  // Hero title/eyebrow come from whichever nav entry matches the current page.
  const allLinks = [
    ...NAV_ITEMS.flatMap(s => s.links.map(l => ({ ...l, section: s.section }))),
    ...FUEL_LINKS.map(l => ({ ...l, section: t("fuel.navSection") })),
    ...PROJECT_PERFORMANCE_LINKS.map(l => ({ ...l, section: t("layout.navProjectPerformance") })),
    ...FUEL_INVOICE_LINKS.map(l => ({ ...l, section: "Fuel & Invoice Management" })),
  ];
  const currentLink = allLinks.find(l => l.to === location.pathname);

  // Quick-access pills in the hero bar (the full list lives in the side rail).
  const byKey = Object.fromEntries(allLinks.map(l => [l.key, l]));
  const quickLinks = [
    byKey.overview,
    canSeeFuel && byKey["fuel-approver"],
    byKey.records,
    canManageFleet && byKey.drivers,
    canManageFleet && byKey.fleet,
    isAdmin ? byKey["project-performance-stats"] : byKey.stations,
  ].filter(l => l && isVisible(l));
  const todayLabel = new Date().toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  const email = session?.user?.email || "";
  const initials = (email.split("@")[0] || "GB").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "GB";

  const subLabel = isFleetManager ? t("layout.subFleetManager")
    : isAdmin ? t("layout.subAdmin")
    : t("layout.subProject", { project: currentUserProject });

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  const search = location.search;

  return (
    <div id="app-layout" ref={layoutRef} onPointerMove={handlePointerMove} onPointerOut={handlePointerOut}>
      <div className="app-cursor-glow" aria-hidden="true" />
      {mobileSidebarOpen && <div className="sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} />}

      {/* Desktop: slim floating rail that expands on hover. Mobile: slide-in drawer. */}
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
              {section.links.filter(isVisible).map(link => (
                <NavLink key={link.key} to={{ pathname: link.to, search }} className={({ isActive }) => "side-link" + (isActive ? " active" : "")}>
                  <span className="ic">{link.icon}</span> <span className="side-label">{link.label}</span>
                  {!!link.badge && <span className="side-badge">{link.badge}</span>}
                </NavLink>
              ))}
            </div>
          ))}
          {canSeeProjectPerformance && (
            <div>
              <button type="button" className="side-link side-group-toggle" onClick={() => setPpOpen(o => !o)}>
                <span className="ic"><TrendingUp size={17} /></span> <span className="side-label">{t("layout.navProjectPerformance")}</span>
                <span className={"side-group-chevron" + (ppOpen ? " open" : "")}><ChevronDown size={15} /></span>
              </button>
              {ppOpen && (
                <div className="side-subgroup">
                  {PROJECT_PERFORMANCE_LINKS.map(link => (
                    // The RCA link deliberately drops the carried-over `search` —
                    // a Statistics badge click sets project/status/rcaFrom/rcaTo
                    // in the URL, and HashRouter keeps those in location.search
                    // across later navigations; without this, a plain sidebar
                    // click here would keep re-showing whatever date a past
                    // badge click left behind instead of resetting to yesterday.
                    <NavLink
                      key={link.key}
                      to={link.key === "project-performance-rca" ? { pathname: link.to } : { pathname: link.to, search }}
                      className={({ isActive }) => "side-link side-sublink" + (isActive ? " active" : "")}
                    >
                      <span className="ic">{link.icon}</span> <span className="side-label">{link.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}

          {(isAdmin || isFleetManager) && (
            <div>
              <button type="button" className="side-link side-group-toggle" onClick={() => setFiOpen(o => !o)}>
                <span className="ic"><Receipt size={17} /></span> <span className="side-label">Fuel & Invoice Management</span>
                <span className={"side-group-chevron" + (fiOpen ? " open" : "")}><ChevronDown size={15} /></span>
              </button>
              {fiOpen && (
                <div className="side-subgroup">
                  {FUEL_INVOICE_LINKS.filter(link => isAdmin || link.key === "fuel-invoice-database").map(link => (
                    <NavLink key={link.key} to={{ pathname: link.to, search }} className={({ isActive }) => "side-link side-sublink" + (isActive ? " active" : "")}>
                      <span className="ic">{link.icon}</span> <span className="side-label">{link.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}

          {canSeeFuel && (
            <div>
              <button type="button" className="side-link side-group-toggle" onClick={() => setFuelOpen(o => !o)}>
                <span className="ic"><Fuel size={17} /></span> <span className="side-label">{t("fuel.navSection")}</span>
                {!!pendingCount && <span className="side-badge">{pendingCount}</span>}
                <span className={"side-group-chevron" + (fuelOpen ? " open" : "")}><ChevronDown size={15} /></span>
              </button>
              {fuelOpen && (
                <div className="side-subgroup">
                  {FUEL_LINKS.map(link => (
                    <NavLink key={link.key} to={{ pathname: link.to, search }} className={({ isActive }) => "side-link side-sublink" + (isActive ? " active" : "")}>
                      <span className="ic">{link.icon}</span> <span className="side-label">{link.label}</span>
                      {!!link.badge && <span className="side-badge">{link.badge}</span>}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
      </aside>

      <main id="content">
        {/* ───── Dark hero with floating glass navigation ───── */}
        <header className={"fx-hero" + (isOnFuelInvoicePage ? " fx-hero-nonav" : "")}>
          {/* decorations live in their own clipped layer so nav dropdowns can overflow the hero */}
          <div className="fx-hero-fx" aria-hidden="true">
            <div className="fx-hero-overlay" />
            <div className="fx-hero-orb one" />
            <div className="fx-hero-orb two" />
          </div>

          <nav className="fx-nav">
            <div className="fx-brand">
              <button type="button" className="fx-menu-btn" onClick={() => setMobileSidebarOpen(o => !o)} aria-label={t("layout.toggleMenu")}>
                <Menu size={18} />
              </button>
              <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="fx-brand-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              {/* every page but Overview shows its own name here instead of the brand */}
              <span className="fx-brand-text">
                {currentLink && currentLink.key !== "overview" ? currentLink.label : <>GBE <b>Fleet</b></>}
              </span>
            </div>

            <div className="fx-nav-links">
              {quickLinks.map(link => (
                <NavLink key={link.key} to={{ pathname: link.to, search }} className={({ isActive }) => "fx-nav-link" + (isActive ? " active" : "")}>
                  {link.label}
                </NavLink>
              ))}
            </div>

            <div className="fx-nav-tools">
              {/* page action buttons (export, add, view toggle) portal here, next to the bell */}
              <div id="fx-hero-actions" className="fx-hero-actions-slot" />
              {/* NotificationCenter portals its bell + panel here */}
              <span id="fx-bell-slot" className="fx-bell-slot" />
              <div className="fx-user" ref={userMenuRef}>
                <button
                  type="button" className="fx-icon-btn" onClick={toggleLang}
                  title={t("layout.languageToggle")} aria-label={t("layout.languageToggle")}
                >
                  <Globe size={17} />
                </button>
                <button
                  type="button" className="fx-avatar" title={email}
                  onClick={() => setUserMenuOpen(o => !o)} aria-haspopup="menu" aria-expanded={userMenuOpen}
                >
                  {initials}
                </button>
                {userMenuOpen && (
                  <div className="fx-user-menu" role="menu">
                    <div className="fx-user-menu-head">
                      <span className="fx-user-menu-avatar">{initials}</span>
                      <div>
                        <div className="fx-user-menu-email">{email}</div>
                        <div className="fx-user-menu-sub">{subLabel}</div>
                      </div>
                    </div>
                    <button type="button" role="menuitem" className="fx-user-menu-item danger" onClick={handleLogout}>
                      <LogOut size={16} /> {t("layout.logout")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </nav>

          <div className="fx-hero-content">
            <div className="fx-hero-text">
            <div className="fx-hero-small">
              {currentLink?.section || "GBE LOGISTICS"} · {todayLabel}
              {/* This module doesn't touch the shared shift-entries dataset,
                  so the main dashboard's loading/lastUpdated status would be
                  irrelevant/misleading here — shown on every other page only. */}
              {!isOnFuelInvoicePage && (
                <>{" · "}{loading ? t("common.loading") : lastUpdated ? t("overview.lastUpdatedPrefix") + lastUpdated.toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }) : ""}</>
              )}
            </div>
            <h1 className="fx-hero-title">{currentLink?.label || "Master Fuel Report"}</h1>
            {/* Same reason: the generic "Shift Dashboard" tagline doesn't fit
                this standalone finance module. */}
            {!isOnFuelInvoicePage && <p className="fx-hero-sub">{subLabel}</p>}
            <div id="fx-hero-note" className="fx-hero-note-slot" />
            </div>
          </div>
          {/* pages portal their date filters here (see GlobalFilters) */}
          <div id="fx-hero-slot" className="fx-hero-slot" />
        </header>

        {/* ───── Content sheet overlapping the hero ───── */}
        <div className={"fx-sheet" + (isOnFuelInvoicePage ? " fx-sheet-wide" : "")}>
          {isAdmin && viewingProject && (
            <div className="scope-banner">{t("layout.scopeBannerPrefix")} <b>{viewingProject}</b> {t("layout.scopeBannerSuffix")}</div>
          )}
          <div key={location.pathname} className="page-transition">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
