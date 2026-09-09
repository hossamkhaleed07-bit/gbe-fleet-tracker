export default function Field({ label, val }) {
  return <div className="f"><label>{label}</label><div className="val">{val ?? "—"}</div></div>;
}
