import { useLang } from "../contexts/LanguageContext";
import { OFF_CODES, attendanceLabel } from "../lib/attendanceCodes";

// Shared "what am I about to decide on" recap shown inside the approve/reject
// confirmation modals, so a manager reviews the key facts before committing.
export default function RequestSummary({ request, project, attendanceStatus, loanAdjustment }) {
  const { t, lang } = useLang();
  const isConflict = OFF_CODES.has(attendanceStatus);
  const adjustment = loanAdjustment === "" || loanAdjustment == null ? 0 : Number(loanAdjustment);
  const hasAdjustment = adjustment !== 0;
  const total = request.amount != null ? Number(request.amount) + adjustment : null;
  return (
    <div className="confirm-summary">
      <div className="confirm-summary-row"><span>{t("fuel.colDriver")}</span><b>{request.full_name}</b></div>
      <div className="confirm-summary-row"><span>{t("fuel.colAmount")}</span><b>{t("fuel.amountPrefix")} {request.amount ?? "—"}</b></div>
      {hasAdjustment && (
        <div className="confirm-summary-row"><span>{t("fuel.colLoanAdjustment")}</span><b>{t("fuel.amountPrefix")} {adjustment}</b></div>
      )}
      {hasAdjustment && (
        <div className="confirm-summary-row"><span>{t("fuel.colTotalLoan")}</span><b>{t("fuel.amountPrefix")} {total}</b></div>
      )}
      <div className="confirm-summary-row"><span>{t("common.project")}</span><b>{project || "—"}</b></div>
      {attendanceStatus && (
        <div className="confirm-summary-row">
          <span>{t("attendance.breadcrumb")}</span>
          <b className={isConflict ? "confirm-summary-warn" : ""}>{attendanceLabel(attendanceStatus, lang)}</b>
        </div>
      )}
    </div>
  );
}
