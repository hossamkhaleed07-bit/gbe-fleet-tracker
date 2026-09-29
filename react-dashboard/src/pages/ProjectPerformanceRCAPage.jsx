import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import ProjectPerformanceRCA from "../components/ProjectPerformanceRCA";
import HeroPortal from "../components/HeroPortal";
import { yesterday } from "../lib/calc";

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
  const [searchParams] = useSearchParams();

  const [project, setProject] = useState(searchParams.get("project") || currentUserProject || "");
  const [status, setStatus] = useState(searchParams.get("status") || "followup");
  const [from, setFrom] = useState(searchParams.get("rcaFrom") || yesterday());
  const [to, setTo] = useState(searchParams.get("rcaTo") || yesterday());

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
