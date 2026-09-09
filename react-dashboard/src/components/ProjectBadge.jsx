const PROJECT_COLORS = {
  FDP: "c-blue",
  ADM: "c-green",
  LMS: "c-purple",
  JDL: "c-orange",
  MGF: "c-cyan",
};

export default function ProjectBadge({ project }) {
  if (!project) return null;
  const c = PROJECT_COLORS[project] || "c-pink";
  return (
    <span className="badge" style={{ background: `var(--${c}-bg)`, color: `var(--${c}-ink)` }}>
      {project}
    </span>
  );
}
