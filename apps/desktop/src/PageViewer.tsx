import { Minus, Plus } from "./icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pageImageUrl } from "./api";
import type { Finding, Rect } from "./types";

export type DrawMode = "none" | "erase" | "mask" | "detect";

type PreviewAction = "keep" | "erase" | "mask" | "replace";
export type TextAlign = "left" | "center" | "right";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;

interface Point {
  x: number;
  y: number;
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/// A rect covering almost the whole page is a location-unknown candidate
/// (a VLM finding is page-level); it should not be drawn as a page-wide tint.
function coversWholePage(rect: Rect, size: { w: number; h: number }): boolean {
  return rect.width >= size.w * 0.85 && rect.height >= size.h * 0.85;
}

export default function PageViewer(props: {
  projectDir: string;
  pageIndex: number;
  rendered: boolean;
  version: number;
  findings: Finding[];
  regions: { rect: Rect; action: "erase" | "mask"; index: number }[];
  highlightKey: string | null;
  findingKey: (finding: Finding) => string;
  drawMode: DrawMode;
  /// text → the transformation it will receive, painted over the page so the
  /// reviewer sees the pending result in place. Null hides the preview.
  rulePreview: Map<
    string,
    { action: PreviewAction; value: string; align?: TextAlign }
  > | null;
  focusRect: Rect | null;
  focusNonce: number;
  onRegion: (rect: Rect) => void;
  onRegionRemove: (index: number) => void;
  /// Clicking a finding's overlay rect (outside drawing modes) — used to
  /// reveal the matching row in the side pane.
  onFindingClick?: (finding: Finding) => void;
  /// Scroll-to-flip mode: a plain wheel at the page's edge turns to the
  /// next/previous page instead of stopping dead.
  pageCount?: number;
  scrollPageFlip?: boolean;
  onPageChange?: (page: number) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ start: Point; current: Point } | null>(
    null,
  );
  const overlayRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  // Cursor anchor for zoom-to-cursor, in fit-normalized content units so it
  // survives the pending width change; applied once the new zoom lays out.
  const zoomAnchor = useRef<{
    fitX: number;
    fitY: number;
    viewX: number;
    viewY: number;
  } | null>(null);
  // Scroll-to-flip bookkeeping: the wheel listener is registered once, so it
  // reads the latest props through this mirror. The accumulator requires a
  // deliberate amount of wheel at the edge before flipping, and the cooldown
  // stops trackpad momentum from skipping several pages.
  const flip = useRef({
    enabled: false,
    pageIndex: 0,
    pageCount: 0,
    onPageChange: undefined as ((page: number) => void) | undefined,
    accumulated: 0,
    lastWheelAt: 0,
    cooldownUntil: 0,
  });
  flip.current.enabled = props.scrollPageFlip ?? false;
  flip.current.pageIndex = props.pageIndex;
  flip.current.pageCount = props.pageCount ?? 0;
  flip.current.onPageChange = props.onPageChange;

  useEffect(() => {
    setZoom(1);
    wrapRef.current?.scrollTo({ top: 0 });
  }, [props.pageIndex]);

  // The focus ring is only drawn in a short window after a jump. Without
  // this, a page switch remounts the SVG and replays the stale ring from an
  // earlier jump — an unrelated rect blinking at the old coordinates.
  const [flashOn, setFlashOn] = useState(false);
  useEffect(() => {
    if (!props.focusRect) return;
    setFlashOn(true);
    const timer = window.setTimeout(() => setFlashOn(false), 2500);
    return () => window.clearTimeout(timer);
  }, [props.focusNonce]);

  // Ctrl+wheel zooms (anchored at the cursor), Shift+wheel scrolls
  // horizontally; a plain wheel keeps the browser's vertical scroll. The
  // listener is non-passive so it can preventDefault the browser's own
  // Ctrl+wheel page zoom.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    function onWheel(event: WheelEvent) {
      if (!wrap) return;
      if (event.ctrlKey) {
        event.preventDefault();
        const rect = wrap.getBoundingClientRect();
        const viewX = event.clientX - rect.left;
        const viewY = event.clientY - rect.top;
        setZoom((current) => {
          const next = clampZoom(
            current * (event.deltaY < 0 ? 1.15 : 1 / 1.15),
          );
          if (next !== current) {
            zoomAnchor.current = {
              fitX: (wrap.scrollLeft + viewX) / current,
              fitY: (wrap.scrollTop + viewY) / current,
              viewX,
              viewY,
            };
          }
          return next;
        });
      } else if (event.shiftKey) {
        event.preventDefault();
        wrap.scrollLeft += event.deltaY;
      } else if (flip.current.enabled) {
        const state = flip.current;
        const goingDown = event.deltaY > 0;
        const atEdge = goingDown
          ? wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 2
          : wrap.scrollTop <= 1;
        if (!atEdge) return; // scroll within the page as usual until the edge
        event.preventDefault();
        const now = performance.now();
        if (now < state.cooldownUntil) return;
        if (now - state.lastWheelAt > 400) state.accumulated = 0;
        state.lastWheelAt = now;
        state.accumulated += event.deltaY;
        const threshold = 100;
        if (state.accumulated >= threshold && state.pageIndex + 1 < state.pageCount) {
          state.accumulated = 0;
          state.cooldownUntil = now + 350;
          state.onPageChange?.(state.pageIndex + 1);
        } else if (state.accumulated <= -threshold && state.pageIndex > 0) {
          state.accumulated = 0;
          state.cooldownUntil = now + 350;
          state.onPageChange?.(state.pageIndex - 1);
        }
      }
    }
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const anchor = zoomAnchor.current;
    if (!wrap || !anchor) return;
    wrap.scrollLeft = anchor.fitX * zoom - anchor.viewX;
    wrap.scrollTop = anchor.fitY * zoom - anchor.viewY;
    zoomAnchor.current = null;
  }, [zoom]);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    pageImageUrl(props.projectDir, props.pageIndex, props.rendered)
      .then((base) => {
        if (!cancelled) setUrl(`${base}?v=${props.version}`);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectDir, props.pageIndex, props.rendered, props.version]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const image = imageRef.current;
    if (!wrap || !image || !size || !props.focusRect) return;
    const scale = image.clientWidth / size.w;
    const centerX = (props.focusRect.x + props.focusRect.width / 2) * scale;
    const centerY = (props.focusRect.y + props.focusRect.height / 2) * scale;
    wrap.scrollTo({
      left: Math.max(0, centerX - wrap.clientWidth / 2),
      top: Math.max(0, centerY - wrap.clientHeight / 2),
      behavior: "smooth",
    });
  }, [props.focusNonce, size]);

  function toImageCoords(event: React.PointerEvent): Point | null {
    const svg = overlayRef.current;
    if (!svg || !size) return null;
    const box = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * size.w,
      y: ((event.clientY - box.top) / box.height) * size.h,
    };
  }

  function onPointerDown(event: React.PointerEvent) {
    if (props.drawMode === "none") return;
    const point = toImageCoords(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ start: point, current: point });
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag) return;
    const point = toImageCoords(event);
    if (point) setDrag({ start: drag.start, current: point });
  }

  function onPointerUp() {
    if (!drag) return;
    const rect = normalized(drag.start, drag.current);
    setDrag(null);
    if (rect.width > 4 && rect.height > 4) props.onRegion(rect);
  }

  const dragRect = drag ? normalized(drag.start, drag.current) : null;

  return (
    <div className="viewer-canvas">
      <div className="zoom-bar">
        <button
          onClick={() => setZoom((current) => clampZoom(current / 1.15))}
          title="縮小"
          aria-label="縮小"
        >
          <Minus size={13} />
        </button>
        <button onClick={() => setZoom(1)} title="幅に合わせる">
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => setZoom((current) => clampZoom(current * 1.15))}
          title="拡大"
          aria-label="拡大"
        >
          <Plus size={13} />
        </button>
        <span className="hint">Ctrl+ホイールで拡大縮小 / Shift+ホイールで左右</span>
      </div>
      <div className="page-stage-wrap" ref={wrapRef}>
      {url === null ? (
        <p className="status">ページ画像を読み込み中…</p>
      ) : (
        <div className="page-stage" style={{ width: `${zoom * 100}%` }}>
          <img
            ref={imageRef}
            src={url}
            alt={`page ${props.pageIndex + 1}`}
            onLoad={(event) =>
              setSize({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
          />
          {size && (
            <svg
              ref={overlayRef}
              className={
                props.drawMode !== "none" ? "overlay drawing" : "overlay"
              }
              viewBox={`0 0 ${size.w} ${size.h}`}
              preserveAspectRatio="none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {props.findings.map((finding, index) => {
                // A finding covering the whole page has no real location (a
                // VLM candidate is page-level); don't tint the page for it.
                if (coversWholePage(finding.rect, size)) return null;
                return (
                  <rect
                    key={index}
                    className={[
                      "finding-rect",
                      finding.category === "search" ? "search" : "",
                      props.highlightKey === props.findingKey(finding)
                        ? "highlight"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    x={finding.rect.x}
                    y={finding.rect.y}
                    width={finding.rect.width}
                    height={finding.rect.height}
                    onClick={() => {
                      if (props.drawMode === "none")
                        props.onFindingClick?.(finding);
                    }}
                  >
                    <title>クリックで右ペインの該当候補を表示</title>
                  </rect>
                );
              })}
              {props.regions.map((region) => (
                <rect
                  key={`region-${region.index}`}
                  className={`region-rect ${region.action}`}
                  x={region.rect.x}
                  y={region.rect.y}
                  width={region.rect.width}
                  height={region.rect.height}
                  onClick={() => {
                    if (props.drawMode === "none")
                      props.onRegionRemove(region.index);
                  }}
                >
                  <title>クリックでこの領域ルールを削除</title>
                </rect>
              ))}
              {props.rulePreview &&
                props.findings.map((finding, index) => {
                  const rule = props.rulePreview?.get(finding.text);
                  if (!rule || rule.action === "keep") return null;
                  if (coversWholePage(finding.rect, size)) return null;
                  const { x, y, width, height } = finding.rect;
                  // Draw the pending result in place: erase/mask are solid
                  // fills; replace paints the substitute text inside the same
                  // box, so its length and alignment against the original are
                  // visible before applying.
                  const text =
                    rule.action === "replace"
                      ? rule.value || "（仮称）"
                      : rule.action === "mask"
                        ? "■".repeat(Math.max(1, [...finding.text].length))
                        : null;
                  const fontSize = Math.max(8, Math.min(height * 0.8, 40));
                  const align = rule.align ?? "center";
                  const anchorX =
                    align === "right"
                      ? x + width - 2
                      : align === "left"
                        ? x + 2
                        : x + width / 2;
                  const textAnchor =
                    align === "right"
                      ? "end"
                      : align === "left"
                        ? "start"
                        : "middle";
                  return (
                    <g key={`preview-${index}`} className="rule-preview">
                      <rect
                        className={`preview-rect ${rule.action}`}
                        x={x}
                        y={y}
                        width={width}
                        height={height}
                      />
                      {text !== null && (
                        <text
                          className={`preview-label ${rule.action}`}
                          x={anchorX}
                          y={y + height / 2}
                          fontSize={fontSize}
                          textAnchor={textAnchor}
                          dominantBaseline="central"
                        >
                          {text}
                        </text>
                      )}
                    </g>
                  );
                })}
              {dragRect && (
                <rect
                  className="drag-rect"
                  x={dragRect.x}
                  y={dragRect.y}
                  width={dragRect.width}
                  height={dragRect.height}
                />
              )}
              {flashOn && props.focusRect && (
                // Keyed by nonce so every jump restarts the blink, making the
                // jumped-to spot unmistakable among many rects.
                <rect
                  key={`focus-${props.focusNonce}`}
                  className="focus-flash"
                  x={props.focusRect.x - 4}
                  y={props.focusRect.y - 4}
                  width={props.focusRect.width + 8}
                  height={props.focusRect.height + 8}
                />
              )}
            </svg>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

function normalized(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
