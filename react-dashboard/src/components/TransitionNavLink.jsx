import { NavLink, useNavigate, useLocation, useResolvedPath } from "react-router-dom";
import { navigateWithTransition } from "../lib/viewTransition";

// NavLink that animates the page change with the View Transitions API.
export default function TransitionNavLink({ to, onClick, ...rest }) {
  const navigate = useNavigate();
  const location = useLocation();
  const target = useResolvedPath(to);

  function handleClick(e) {
    onClick?.(e);
    const plain = e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !rest.target;
    const sameUrl = target.pathname === location.pathname && target.search === location.search;
    if (e.defaultPrevented || !plain || sameUrl) return;
    e.preventDefault();
    navigateWithTransition(() => navigate(to));
  }

  return <NavLink to={to} onClick={handleClick} {...rest} />;
}
