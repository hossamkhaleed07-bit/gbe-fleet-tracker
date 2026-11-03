import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import ProjectPerformanceRCA from "../components/ProjectPerformanceRCA";
import HeroPortal from "../components/HeroPortal";
import { riyadhYesterday } from "../lib/rcaFollowup";

// Its own nav destination (Project Performance > RCA / Driver Follow-up),
// not portaled into the hero — reached either via the sidebar sub-link
// (plain visit, defaults to checking just yesterday) or via a Statistics
// badge click (arrives with project/status/rcaFrom/rcaTo already set in the
// URL, landing on exactly the clicked bucket). rcaFrom/rcaTo are deliberately
// separate query params from the app's shared from/to (used by Statistics
// and every other page) so visiting this page never silently changes that
// shared filter, and leaving it never resets what Statistics was showing.
export default function ProjectPerformanceRCAPage() {
  const { currentUserProject } = useAuth();
  const { t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState(searchParams.get("project") || currentUserProject || "");
  const [status, setStatus] = useState(searchParams.get("status") || "followup");
  // "Yesterday" in Saudi time, not the viewing device's timezone.
  const [rawFrom, setFrom] = useState(searchParams.get("rcaFrom") || riyadhYesterday());
  const [rawTo, setTo] = useState(searchParams.get("rcaTo") || riyadhYesterday());
  // A cleared date input means "just the other end's day", never an unbounded range.
  const from = rawFrom || rawTo || riyadhYesterday();
  const to = rawTo || from;

  // Keep the picked range in the URL so a refresh or a shared link shows the same days.
  useEffect(() => {
    setSearchParams(prev => {
      if (prev.get("rcaFrom") === from && prev.get("rcaTo") === to) return prev;
      const next = new URLSearchParams(prev);
      next.set("rcaFrom", from);
      next.set("rcaTo", to);
      return next;
    }, { replace: true });
  }, [from, to, setSearchParams]);

  return (
    <>
      {/* This route IS listed in Layout's nav (a Project Performance
          sub-link), so the hero already shows its own title/breadcrumb via
          nav-matching — portal the header like any other regular page
          instead of the inline pattern used by non-nav dynamic routes. */}
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">{t("layout.navProjectPerformance")} &gt; <b>{t("layout.navProjectRCA")}</b></div>
          <h1 className="page-title">{t("layout.navProjectRCA")}</h1>
        </div>
      </HeroPortal>

      <ProjectPerformanceRCA
        project={project}
        onProjectChange={setProject}
        status={status}
        onStatusChange={setStatus}
        from={from}
        onFromChange={setFrom}
        to={to}
        onToChange={setTo}
        lockedProject={currentUserProject}
      />
    </>
  );
}
