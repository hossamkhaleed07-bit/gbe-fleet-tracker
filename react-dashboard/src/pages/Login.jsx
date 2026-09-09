import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";

export default function Login() {
  const { login } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const err = await login(email, password);
    setBusy(false);
    if (err) { setError(t("login.failedPrefix") + err.message); return; }
    navigate("/overview");
  }

  return (
    <>
      <img src={`${import.meta.env.BASE_URL}login-banner.jpg`} alt="GBE Logistics" className="login-banner"
        onError={(e) => { e.currentTarget.style.display = "none"; }} />
      <div id="login-screen">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="GBE Logistics" className="login-logo"
          onError={(e) => { e.currentTarget.style.display = "none"; }} />
        <h1>{t("login.title")}</h1>
        <p className="sub">{t("login.subtitle")}</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>{t("login.email")}</label>
            <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>{t("login.password")}</label>
            <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t("login.submitBusy") : t("login.submit")}</button>
          {error && <div id="login-error" style={{ display: "block" }}>{error}</div>}
        </form>
      </div>
    </>
  );
}
