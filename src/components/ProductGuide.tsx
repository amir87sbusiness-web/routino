import { CircleHelp, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useAppMaybe } from "@/state/app";
import { faNum, type Lang } from "@/lib/dates";
import {
  GUIDE_CHANGED,
  GUIDE_HELP,
  readGuide,
  replayGuide,
  saveGuideProgress,
} from "@/lib/product-guide";
import {
  GUIDE_SECTIONS,
  HELP_TOPICS,
  type GuideSection,
  type HelpTopic,
} from "@/lib/product-guide-content";

interface HelpRequest {
  topic: HelpTopic;
  anchor: HTMLElement;
}
interface Visit {
  node: HTMLElement;
  id: GuideSection;
  closed: boolean;
}
interface View {
  visit: Visit;
  index: number;
  anchor: HTMLElement;
}

function targetFor(node: HTMLElement, id: string) {
  return node.getAttribute("data-guide") === id
    ? node
    : node.querySelector<HTMLElement>(`[data-guide="${id}"]`);
}

function visible(node: HTMLElement) {
  return (
    !node.closest('[hidden], [aria-hidden="true"]') &&
    getComputedStyle(node).display !== "none" &&
    getComputedStyle(node).visibility !== "hidden"
  );
}

export function HelpHint({ topic, lang }: { topic: HelpTopic; lang?: Lang }) {
  const language = lang ?? (document.documentElement.lang === "en" ? "en" : "fa");
  const title = HELP_TOPICS[topic][language === "en" ? 1 : 0];
  return (
    <button
      type="button"
      data-help-hint
      aria-haspopup="dialog"
      aria-label={language === "en" ? `Help: ${title}` : `راهنمای ${title}`}
      className="guide-help-button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        window.dispatchEvent(
          new CustomEvent<HelpRequest>(GUIDE_HELP, {
            detail: { topic, anchor: event.currentTarget },
          }),
        );
      }}
    >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

export function GuideReplayButton() {
  const ctx = useAppMaybe();
  const navigate = useNavigate();
  const owner = ctx?.db?.auth?.userId;
  if (!ctx || !owner) return null;
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-sm font-bold text-foreground hover:bg-secondary"
      onClick={() => {
        replayGuide(owner);
        void navigate({ to: "/" });
      }}
    >
      {ctx.t("شروع دوباره راهنما", "Restart the guide")}
      <CircleHelp className="h-4 w-4 text-primary" aria-hidden="true" />
    </button>
  );
}

export function ProductGuide() {
  const ctx = useAppMaybe();
  const owner = ctx?.db?.auth?.userId;
  return owner ? <GuideOverlay key={owner} owner={owner} lang={ctx.lang} /> : null;
}

/** A single root-level overlay; route/form scopes are discovered without polling. */
export function GuideOverlay({ owner, lang }: { owner: string; lang: Lang }) {
  const [view, setView] = useState<View | null>(null);
  const [help, setHelp] = useState<HelpRequest | null>(null);
  const visits = useRef(new WeakMap<HTMLElement, Visit>());
  const card = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const keepFocus = useRef(false);
  const [position, setPosition] = useState({ left: 12, top: 80, width: 300, maxHeight: 350 });
  const english = lang === "en";
  const translate = (fa: string, en: string) => (english ? en : fa);

  useEffect(() => {
    visits.current = new WeakMap();
    setHelp(null);
    const scan = () => {
      const modals = [...document.querySelectorAll<HTMLElement>("[data-guide-modal]")].filter(
        visible,
      );
      const modal = modals.at(-1);
      setHelp((old) =>
        old && (!old.anchor.isConnected || (modal && !modal.contains(old.anchor))) ? null : old,
      );
      const nodes = modal
        ? modal.hasAttribute("data-guide-scope")
          ? [modal]
          : [...modal.querySelectorAll<HTMLElement>("[data-guide-scope]")]
        : [...document.querySelectorAll<HTMLElement>("[data-guide-scope]")].filter(
            (node) => !node.closest("[data-guide-modal]"),
          );
      const node = nodes.filter(visible).at(-1);
      const id = node?.getAttribute("data-guide-scope") as GuideSection | null;
      const state = readGuide(owner);
      if (!node || !id || !(id in GUIDE_SECTIONS) || !state.enabled || state.progress[id]?.done) {
        setView((old) => (old === null ? old : null));
        return;
      }
      let visit = visits.current.get(node);
      if (!visit || visit.id !== id) {
        visit = { node, id, closed: false };
        visits.current.set(node, visit);
      }
      if (visit.closed) {
        setView((old) => (old === null ? old : null));
        return;
      }
      const steps = GUIDE_SECTIONS[id];
      const savedIndex = steps.findIndex((step) => step.id === state.progress[id]?.step);
      let index = Math.max(0, savedIndex);
      let anchor: HTMLElement | null = null;
      // Conditional fields are never opened or changed by the guide.
      for (; index < steps.length; index++) {
        const candidate = targetFor(node, steps[index].id);
        if (candidate && visible(candidate)) {
          anchor = candidate;
          break;
        }
      }
      if (!anchor) {
        setView((old) => (old === null ? old : null));
        return;
      }
      const next = { visit, index, anchor };
      setView((old) =>
        old?.visit === visit && old.index === index && old.anchor === anchor ? old : next,
      );
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ owner: string }>).detail?.owner !== owner) return;
      // Replay clears completion/progress; it also clears this visit's dismissal.
      if (Object.keys(readGuide(owner).progress).length === 0) visits.current = new WeakMap();
      scan();
    };
    const requestHelp = (event: Event) => {
      const request = (event as CustomEvent<HelpRequest>).detail;
      if (request && request.topic in HELP_TOPICS && request.anchor.isConnected) setHelp(request);
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-guide-scope", "hidden", "aria-hidden"],
    });
    window.addEventListener(GUIDE_CHANGED, changed);
    window.addEventListener(GUIDE_HELP, requestHelp);
    scan();
    return () => {
      observer.disconnect();
      window.removeEventListener(GUIDE_CHANGED, changed);
      window.removeEventListener(GUIDE_HELP, requestHelp);
    };
  }, [owner]);

  const anchor = help?.anchor ?? view?.anchor;
  const identity = help ? `help:${help.topic}` : view ? `${view.visit.id}:${view.index}` : null;

  const dismiss = (completeSection = false) => {
    if (help) {
      keepFocus.current = true;
      help.anchor.focus({ preventScroll: true });
      setHelp(null);
      return;
    }
    if (view) {
      view.visit.closed = true;
      saveGuideProgress(
        owner,
        view.visit.id,
        GUIDE_SECTIONS[view.visit.id][view.index].id,
        completeSection,
      );
      setView(null);
    }
    restoreFocus.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!anchor || !identity) return;
    const panel = card.current;
    if (!panel) return;
    const focusBefore = document.activeElement;
    if (focusBefore instanceof HTMLElement && !panel.contains(focusBefore))
      restoreFocus.current = focusBefore;
    const measure = () => {
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const offset = viewport?.offsetTop ?? 0;
      const header = document.querySelector("[data-guide-header]")?.getBoundingClientRect();
      const nav = document.querySelector("[data-guide-nav]")?.getBoundingClientRect();
      const topLimit = Math.min(
        offset + height - 48,
        header && header.bottom > offset && header.top < offset + height
          ? Math.max(offset + 12, header.bottom + 12)
          : offset + 12,
      );
      const bottomLimit =
        nav && nav.height > 0 && nav.top < offset + height && nav.bottom > offset
          ? Math.max(topLimit + 32, nav.top - 12)
          : offset + height - 12;
      const panelWidth = Math.min(320, width - 24);
      const maxHeight = Math.max(32, bottomLimit - topLimit);
      const rect = anchor.getBoundingClientRect();
      const panelHeight = Math.min(panel.getBoundingClientRect().height || 180, maxHeight);
      const below = rect.bottom + 10;
      const above = rect.top - panelHeight - 10;
      const top = Math.max(
        topLimit,
        Math.min(below + panelHeight <= bottomLimit ? below : above, bottomLimit - panelHeight),
      );
      const left = Math.max(
        12,
        Math.min(rect.left + rect.width / 2 - panelWidth / 2, width - panelWidth - 12),
      );
      setPosition((old) =>
        old.left === left &&
        old.top === top &&
        old.width === panelWidth &&
        old.maxHeight === maxHeight
          ? old
          : { left, top, width: panelWidth, maxHeight },
      );
    };
    const rect = anchor.getBoundingClientRect();
    if (rect.top < 64 || rect.bottom > (window.visualViewport?.height ?? window.innerHeight) - 100)
      anchor.scrollIntoView?.({ block: "center", behavior: "instant" });
    anchor.setAttribute("data-guide-highlight", "true");
    measure();
    if (!keepFocus.current)
      panel.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    keepFocus.current = false;
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resize?.observe(anchor);
    resize?.observe(panel);
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      anchor.removeAttribute("data-guide-highlight");
      resize?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [anchor, identity, lang]);

  useEffect(() => {
    if (!identity) return;
    const outside = (event: MouseEvent) => {
      if (card.current?.contains(event.target as Node)) return;
      // Tab links, form controls and hint buttons must remain directly usable.
      if (
        !help &&
        (event.target as Element).closest?.("a, button, input, textarea, select, [role='switch']")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener("click", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("click", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  });

  if (!identity || !anchor) return null;
  const step = view ? GUIDE_SECTIONS[view.visit.id][view.index] : null;
  const topic = help ? HELP_TOPICS[help.topic] : null;
  const title = topic ? topic[english ? 1 : 0] : step!.title[english ? 1 : 0];
  let body = topic ? topic[english ? 3 : 2] : step!.body[english ? 1 : 0];
  if (!help && view?.visit.id === "today" && step?.id === "navigation" && window.innerWidth >= 1024)
    body = translate(
      "از نوار کناری بین بخش‌ها جابه‌جا شو. تنظیمات در همان نوار و اعلان‌ها بالای صفحه‌اند.",
      "Use the sidebar to switch sections and open Settings. Notifications are at the top.",
    );
  const move = (direction: number) => {
    if (!view) return;
    const steps = GUIDE_SECTIONS[view.visit.id];
    let index = view.index + direction;
    for (; index >= 0 && index < steps.length; index += direction) {
      const target = targetFor(view.visit.node, steps[index].id);
      if (target && visible(target)) {
        saveGuideProgress(owner, view.visit.id, steps[index].id, false);
        return;
      }
    }
    if (direction > 0) {
      saveGuideProgress(owner, view.visit.id, steps[view.index].id, true);
      restoreFocus.current?.focus({ preventScroll: true });
    }
  };
  const available = view
    ? GUIDE_SECTIONS[view.visit.id]
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          const target = targetFor(view.visit.node, item.id);
          return target && visible(target);
        })
    : [];
  const ordinal = available.findIndex((item) => item.index === view?.index);
  return createPortal(
    <div
      ref={card}
      data-guide-card
      role="dialog"
      aria-modal="false"
      aria-labelledby="guide-title"
      aria-describedby="guide-body"
      dir={english ? "ltr" : "rtl"}
      className="guide-card"
      style={position}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="guide-title" className="text-sm font-bold">
          {title}
        </h2>
        <button
          type="button"
          aria-label={translate("بستن راهنما", "Close guide")}
          className="guide-close"
          onClick={() => dismiss(true)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p id="guide-body" className="text-xs leading-6 text-muted-foreground" aria-live="polite">
        {body}
      </p>
      {!help && view && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            {faNum(ordinal + 1, lang)} {translate("از", "of")} {faNum(available.length, lang)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="guide-previous"
              disabled={ordinal <= 0}
              onClick={() => move(-1)}
            >
              {translate("قبلی", "Previous")}
            </button>
            <button type="button" className="guide-next" onClick={() => move(1)}>
              {ordinal === available.length - 1
                ? translate("فهمیدم", "Got it")
                : translate("بعدی", "Next")}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
