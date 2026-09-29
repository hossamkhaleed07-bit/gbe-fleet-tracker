import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

// Renders a page's header/filter bar inside the Layout hero instead of the
// content sheet: #fx-hero-slot (filters, notes) or #fx-hero-actions (buttons
// beside the hero title). Falls back to rendering in place when the
// slot doesn't exist, so pages keep working outside the Layout.
export default function HeroPortal({ className, children, target = "fx-hero-slot" }) {
  const [slot, setSlot] = useState(null);
  useLayoutEffect(() => {
    setSlot(document.getElementById(target));
  }, [target]);

  const content = <div className={className}>{children}</div>;
  return slot ? createPortal(content, slot) : content;
}
