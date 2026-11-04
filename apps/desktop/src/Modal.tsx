import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/// Elements that take focus with Tab. Visibility is checked separately.
/// `summary` covers the help page's collapsible sections.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "details > summary:first-of-type",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/// Whether Chromium makes `element` a Tab stop as a scroll container: it
/// overflows, scrolls, and holds no focusable control of its own. Without
/// it, a trapped Tab could never reach (and so never scroll) a list of
/// thumbnails such as the region preview's body.
function isKeyboardScroller(element: HTMLElement): boolean {
  const overflows =
    element.scrollHeight > element.clientHeight ||
    element.scrollWidth > element.clientWidth;
  if (!overflows) return false;
  const style = getComputedStyle(element);
  const scrolls = (value: string) => value === "auto" || value === "scroll";
  return (
    (scrolls(style.overflowY) || scrolls(style.overflowX)) &&
    element.querySelector(FOCUSABLE) === null
  );
}

/// Tab-reachable elements inside `container`, in document order.
export function focusableWithin(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("*")).filter(
    (element) =>
      (element.matches(FOCUSABLE) || isKeyboardScroller(element)) &&
      // Also false inside a closed <details>, whose content keeps its boxes.
      element.checkVisibility() &&
      !element.closest("[inert]"),
  );
}

/// The first Tab-reachable element of the app root — the fallback return
/// target when nothing more specific is known.
export function firstFocusableInRoot(): HTMLElement | null {
  const root = document.getElementById("root");
  return root ? (focusableWithin(root)[0] ?? null) : null;
}

/// Whether focus can actually land on `element` right now.
function canTakeFocus(element: Element | null): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element !== document.body &&
    element.isConnected &&
    !(element as HTMLButtonElement).disabled &&
    !element.closest("[inert]")
  );
}

// Layers stack in open order; only the topmost one answers Tab and Escape.
// `#root` stays inert while any layer is open (a reference count, so a
// first-run notice over a review-screen dialog unwinds cleanly).
interface Layer {
  container: RefObject<HTMLElement>;
  onEscape: RefObject<(() => void) | undefined>;
  /// Tab-order index of the control that last had focus inside the layer,
  /// so Tab can resume from there after that control unmounts.
  lastIndex: number;
}
const layers: Layer[] = [];
let inertCount = 0;

function setRootInert(inert: boolean) {
  const root = document.getElementById("root");
  if (!root) return;
  if (inert) root.setAttribute("inert", "");
  else root.removeAttribute("inert");
}

function handleKeyDown(event: KeyboardEvent) {
  const layer = layers[layers.length - 1];
  const container = layer?.container.current;
  if (!layer || !container || event.defaultPrevented || event.isComposing) {
    return;
  }
  if (event.key === "Escape") {
    const onEscape = layer.onEscape.current;
    if (onEscape) {
      event.preventDefault();
      onEscape();
    }
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = focusableWithin(container);
  event.preventDefault();
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const index = focusable.indexOf(active as HTMLElement);
  if (index === -1) {
    // Focus fell to <body> because the focused control unmounted (e.g. an
    // in-row confirm swapping its buttons). Continue from where it was: the
    // control now at its old index is the one that followed it.
    const lost = !active || active === document.body || !active.isConnected;
    if (lost && layer.lastIndex >= 0) {
      const resume = Math.min(layer.lastIndex, focusable.length);
      if (event.shiftKey) {
        (resume === 0 ? last : focusable[resume - 1]).focus();
      } else {
        (resume >= focusable.length ? first : focusable[resume]).focus();
      }
    } else {
      (event.shiftKey ? last : first).focus();
    }
  } else if (event.shiftKey) {
    (index === 0 ? last : focusable[index - 1]).focus();
  } else {
    (index === focusable.length - 1 ? first : focusable[index + 1]).focus();
  }
}

/// Keeps keyboard focus inside `container` while the caller is mounted:
/// focuses its first control on open, cycles Tab / Shift+Tab within it,
/// makes `#root` inert, answers Escape with `onEscape` (when given), and on
/// close returns focus to whatever had it before — or to `fallbackFocus()`
/// when that element is gone, disabled, or inert by then.
///
/// `container` must render outside `#root` (see `Modal`), or it would be
/// made inert along with the rest of the app.
export function useFocusLayer(
  container: RefObject<HTMLElement>,
  options: {
    onEscape?: () => void;
    fallbackFocus?: () => HTMLElement | null;
  } = {},
) {
  const onEscape = useRef(options.onEscape);
  onEscape.current = options.onEscape;
  const fallbackFocus = useRef(options.fallbackFocus);
  fallbackFocus.current = options.fallbackFocus;

  useEffect(() => {
    const opener = document.activeElement;
    const layer: Layer = { container, onEscape, lastIndex: -1 };
    layers.push(layer);
    if (layers.length === 1) document.addEventListener("keydown", handleKeyDown);
    if (inertCount++ === 0) setRootInert(true);
    const element = container.current;
    const onFocusIn = (event: FocusEvent) => {
      if (!element) return;
      const index = focusableWithin(element).indexOf(
        event.target as HTMLElement,
      );
      if (index !== -1) layer.lastIndex = index;
    };
    element?.addEventListener("focusin", onFocusIn);
    if (element && !element.contains(document.activeElement)) {
      focusableWithin(element)[0]?.focus();
    }

    return () => {
      element?.removeEventListener("focusin", onFocusIn);
      layers.splice(layers.indexOf(layer), 1);
      if (layers.length === 0) {
        document.removeEventListener("keydown", handleKeyDown);
      }
      // Lift inert first: focusing into an inert subtree silently fails.
      if (--inertCount === 0) setRootInert(false);
      // Passive cleanup runs after the DOM update of the closing commit, so
      // an opener disabled in that same commit is already seen as disabled.
      const target = canTakeFocus(opener)
        ? opener
        : (fallbackFocus.current?.() ?? null);
      if (canTakeFocus(target)) target.focus();
    };
  }, [container]);
}

/// A modal dialog rendered into `document.body` (outside the inert `#root`)
/// with the app's `modal-backdrop > modal` markup. `titleId` names the
/// heading that labels the dialog. Without `onDismiss`, neither the backdrop
/// nor Escape closes it — the caller's own buttons must. `onEscape` overrides
/// what Escape does (e.g. close a nested popover first); it defaults to
/// `onDismiss`.
export default function Modal(props: {
  titleId: string;
  className?: string;
  onDismiss?: () => void;
  onEscape?: () => void;
  fallbackFocus?: () => HTMLElement | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusLayer(ref, {
    onEscape: props.onEscape ?? props.onDismiss,
    fallbackFocus: props.fallbackFocus,
  });
  return createPortal(
    <div className="modal-backdrop" onClick={props.onDismiss}>
      <div
        ref={ref}
        className={props.className ? `modal ${props.className}` : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.titleId}
        onClick={(event) => event.stopPropagation()}
      >
        {props.children}
      </div>
    </div>,
    document.body,
  );
}
