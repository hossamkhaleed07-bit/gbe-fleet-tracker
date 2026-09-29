import React, { useState } from "react";
import "../styles/FormResponseDemo.css";

// Visual prototype only — mock data, nothing reads from or writes to Supabase.

// Inline stroke icons (lucide-style) so this page needs no extra dependency.
const ICONS = {
  fuel: <><path d="M3 22h12" /><path d="M4 9h10" /><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" /><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  shield: <><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="m9 12 2 2 4-4" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  arrowRight: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  arrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
};

function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

const EMPTY_FORM = {
  driver: "",
  project: "",
  amount: "",
  // The only request a driver can make — automatic fuel is allocated by the system.
  type: "Reinforcement",
  reason: "",
};

export default function FormResponseDemo() {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const update = (key, value) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const canContinue =
    step === 1 ? form.driver.trim() && form.project.trim() :
    step === 2 ? Number(form.amount) > 0 :
    true;

  const submit = () => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      setSubmitted(true);
    }, 1200);
  };

  const startOver = () => {
    setForm(EMPTY_FORM);
    setSubmitted(false);
    setStep(1);
  };

  // Moves the page-wide .cursor-glow via CSS variables (no re-render).
  const handlePageMove = (e) => {
    e.currentTarget.style.setProperty("--glow-x", `${e.clientX}px`);
    e.currentTarget.style.setProperty("--glow-y", `${e.clientY}px`);
  };

  const handleMouseMove = (e) => {
    const card = e.currentTarget;

    const rect = card.getBoundingClientRect();

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rotateY = ((x / rect.width) - 0.5) * 5;
    const rotateX = ((y / rect.height) - 0.5) * -5;

    card.style.setProperty("--rotate-x", `${rotateX}deg`);
    card.style.setProperty("--rotate-y", `${rotateY}deg`);
  };

  const resetMouse = (e) => {
    e.currentTarget.style.setProperty("--rotate-x", "0deg");
    e.currentTarget.style.setProperty("--rotate-y", "0deg");
  };

  const stepClass = (n) =>
    submitted || step > n ? "step active done" : step === n ? "step active" : "step";

  return (
    <div className="fleet-page" dir="ltr" onMouseMove={handlePageMove}>

      <div className="cursor-glow" />

      {/* HERO */}

      <section className="hero">

        <div className="hero-overlay" />

        <nav className="top-nav glass">

          <div className="brand">
            <div className="brand-logo">G</div>
            <span>GBE Fleet</span>
          </div>

          <div className="nav-links">
            <span className="active">Fuel</span>
            <span>Drivers</span>
            <span>Fleet</span>
            <span>Analytics</span>
          </div>

          <div className="profile">
            <div className="notification"><Icon name="bell" size={16} /></div>
            <div className="avatar">HK</div>
          </div>

        </nav>

        <div className="hero-content">

          <div className="hero-small">
            FLEET OPERATIONS
          </div>

          <h1>
            Fuel
            <br />
            Operations
          </h1>

          <p>
            Manage fuel requests, drivers and daily fleet operations
            from one intelligent workspace.
          </p>

          <div className="hero-actions">
            <button
              className="hero-button"
              onClick={() => document.getElementById("fuel-request")?.scrollIntoView({ behavior: "smooth" })}
            >
              New Request →
            </button>

            <button
              className="hero-button secondary"
              onClick={() => document.getElementById("fuel-activity")?.scrollIntoView({ behavior: "smooth" })}
            >
              View Activity
            </button>
          </div>

        </div>

        <div className="hero-orb orb-one" />
        <div className="hero-orb orb-two" />

      </section>


      {/* MAIN CONTENT */}

      <main className="dashboard-shell">

        {/* STAT CARDS */}

        <section className="stats-grid">

          <div
            className="stat-card glass-card"
            onMouseMove={handleMouseMove}
            onMouseLeave={resetMouse}
          >
            <div className="card-icon fuel-icon">
              <Icon name="fuel" size={24} />
            </div>

            <div>
              <span>Today's Fuel</span>
              <strong>SAR 20</strong>
              <small>Automatic allocation</small>
            </div>
          </div>


          <div
            className="stat-card glass-card"
            onMouseMove={handleMouseMove}
            onMouseLeave={resetMouse}
          >
            <div className="card-icon driver-icon">
              <Icon name="users" size={24} />
            </div>

            <div>
              <span>Active Drivers</span>
              <strong>134</strong>
              <small>Currently operational</small>
            </div>
          </div>


          <div
            className="stat-card glass-card"
            onMouseMove={handleMouseMove}
            onMouseLeave={resetMouse}
          >
            <div className="card-icon status-icon">
              <Icon name="shield" size={24} />
            </div>

            <div>
              <span>Fuel Status</span>
              <strong>Available</strong>
              <small>System operational</small>
            </div>
          </div>

        </section>


        {/* WORKSPACE */}

        <section className="workspace" id="fuel-request">

          {/* LEFT */}

          <div className="form-area">

            <div className="section-header">

              <div>
                <span className="eyebrow">
                  REQUEST WORKSPACE
                </span>

                <h2>
                  Fuel Request
                </h2>

                <p>
                  Submit and review your fuel request.
                </p>
              </div>

              <div className="step-indicator">

                <div className={stepClass(1)}>
                  <span>{submitted || step > 1 ? <Icon name="check" size={14} /> : 1}</span>
                  Driver
                </div>

                <div className="step-line" />

                <div className={stepClass(2)}>
                  <span>{submitted || step > 2 ? <Icon name="check" size={14} /> : 2}</span>
                  Request
                </div>

                <div className="step-line" />

                <div className={stepClass(3)}>
                  <span>{submitted ? <Icon name="check" size={14} /> : 3}</span>
                  Review
                </div>

              </div>

            </div>


            <div className="form-card glass-card">

              {submitted ? (

                <div className="success-state">
                  <div className="success-ring">
                    <Icon name="check" size={34} />
                  </div>
                  <h3>Request submitted</h3>
                  <p>
                    Your reinforcement request of SAR {form.amount} is now waiting for approval.
                  </p>
                  <button className="submit-button" onClick={startOver}>
                    New request
                    <span>→</span>
                  </button>
                </div>

              ) : (
                <>

                  {/* key forces a fresh fade-in whenever the step changes */}
                  <div className="step-panel" key={step}>

                    {step === 1 && (
                      <div className="form-grid">

                        <div className="field">
                          <input
                            value={form.driver}
                            onChange={(e) =>
                              update("driver", e.target.value)
                            }
                            placeholder=" "
                          />
                          <label>
                            Driver ID
                          </label>
                        </div>

                        <div className="field">
                          <input
                            value={form.project}
                            onChange={(e) =>
                              update("project", e.target.value)
                            }
                            placeholder=" "
                          />
                          <label>
                            Project
                          </label>
                        </div>

                      </div>
                    )}

                    {step === 2 && (
                      <div className="form-grid">

                        <div className="field is-locked">
                          <input value={form.type} readOnly placeholder=" " />
                          <label>
                            Request Type
                          </label>
                          <span className="field-lock"><Icon name="lock" size={14} /></span>
                        </div>

                        <div className="field">
                          <input
                            type="number"
                            min="1"
                            value={form.amount}
                            onChange={(e) =>
                              update("amount", e.target.value)
                            }
                            placeholder=" "
                          />
                          <label>
                            Amount (SAR)
                          </label>
                        </div>

                        <div className="field full">
                          <input
                            value={form.reason}
                            onChange={(e) =>
                              update("reason", e.target.value)
                            }
                            placeholder=" "
                          />
                          <label>
                            Reason / Notes
                          </label>
                        </div>

                      </div>
                    )}

                    {step === 3 && (
                      <div className="review-grid">
                        {[
                          ["Driver ID", form.driver],
                          ["Project", form.project],
                          ["Request Type", form.type],
                          ["Amount", `SAR ${form.amount}`],
                          ["Reason / Notes", form.reason || "—"],
                        ].map(([label, value]) => (
                          <div key={label} className={label === "Reason / Notes" ? "review-item full" : "review-item"}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                          </div>
                        ))}
                      </div>
                    )}

                  </div>


                  <div className="form-footer">

                    {step > 1 ? (
                      <button className="back-button" onClick={() => setStep((prev) => prev - 1)}>
                        <Icon name="arrowLeft" size={16} />
                        Back
                      </button>
                    ) : (
                      <div className="secure">
                        <span><Icon name="shield" size={14} /></span>
                        Secure submission
                      </div>
                    )}

                    {step < 3 ? (
                      <button
                        className="submit-button"
                        disabled={!canContinue}
                        onClick={() => setStep((prev) => prev + 1)}
                      >
                        Continue
                        <span>→</span>
                      </button>
                    ) : (
                      <button
                        className={submitting ? "submit-button is-loading" : "submit-button"}
                        disabled={submitting}
                        onClick={submit}
                      >
                        {submitting ? (
                          <>
                            <i className="spinner" />
                            Submitting…
                          </>
                        ) : (
                          <>
                            Submit request
                            <span>→</span>
                          </>
                        )}
                      </button>
                    )}

                  </div>

                </>
              )}

            </div>

          </div>


          {/* RIGHT SUMMARY */}

          <aside
            className="summary-card"
            onMouseMove={handleMouseMove}
            onMouseLeave={resetMouse}
          >

            <div className="summary-top">

              <span>
                REQUEST SUMMARY
              </span>

              <div className="summary-status">
                ● Available
              </div>

            </div>


            <div className="summary-icon">
              <Icon name="fuel" size={28} />
            </div>


            <h3>
              Fuel Request
            </h3>

            <p>
              Review your request details before submitting.
            </p>


            <div className="summary-list">

              <div>
                <span>Driver</span>
                <strong>
                  {form.driver || "Not selected"}
                </strong>
              </div>

              <div>
                <span>Project</span>
                <strong>
                  {form.project || "Not selected"}
                </strong>
              </div>

              <div>
                <span>Amount</span>
                <strong>
                  SAR {form.amount || "0"}
                </strong>
              </div>

              <div>
                <span>Type</span>
                <strong>
                  {form.type}
                </strong>
              </div>

            </div>


            <div className="cooldown">

              <div className="cooldown-icon">
                <Icon name="clock" size={18} />
              </div>

              <div>
                <strong>
                  Reinforcement
                </strong>

                <span>
                  One request every 2 hours
                </span>
              </div>

            </div>

          </aside>

        </section>


        {/* BOTTOM */}

        <section className="bottom-grid" id="fuel-activity">

          <div className="activity-card glass-card">

            <div className="section-title">
              <div>
                <span>RECENT ACTIVITY</span>
                <h3>Fuel Activity</h3>
              </div>

              <button>
                View all →
              </button>
            </div>

            <div className="activity-list">

              <div>
                <span className="activity-dot green" />
                <div>
                  <strong>
                    Automatic fuel issued
                  </strong>
                  <small>
                    Driver #12456 · 2 min ago
                  </small>
                </div>
                <b>SAR 20</b>
              </div>

              <div>
                <span className="activity-dot orange" />
                <div>
                  <strong>
                    Reinforcement requested
                  </strong>
                  <small>
                    Driver #98231 · 18 min ago
                  </small>
                </div>
                <b>SAR 50</b>
              </div>

              <div>
                <span className="activity-dot green" />
                <div>
                  <strong>
                    Fuel request approved
                  </strong>
                  <small>
                    Driver #77192 · 31 min ago
                  </small>
                </div>
                <b>SAR 30</b>
              </div>

            </div>

          </div>


          <div className="insight-card">

            <span>
              FLEET INSIGHT
            </span>

            <h3>
              Fuel operations
              <br />
              are running smoothly.
            </h3>

            <div className="insight-number">
              96.8%
            </div>

            <p>
              Requests processed successfully
            </p>

            <div className="progress">
              <div />
            </div>

          </div>

        </section>

      </main>

    </div>
  );
}
