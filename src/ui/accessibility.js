/**
 * Accessibility helpers: live region announcements and focus utilities.
 */

/**
 * @param {string} message
 * @param {"polite" | "assertive"} [priority]
 */
export function announce(message, priority = "polite") {
  const el = document.getElementById("live-region");
  if (!el) return;
  el.setAttribute("aria-live", priority);
  // Clear then set so repeated messages are announced.
  el.textContent = "";
  window.setTimeout(() => {
    el.textContent = message;
  }, 20);
}

/**
 * Prefer reduced motion when set.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
