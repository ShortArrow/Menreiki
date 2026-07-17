import { useEffect, useRef, useState } from "react";
import { pageImageUrl } from "./api";
import type { Finding, Rect } from "./types";

export type DrawMode = "none" | "erase" | "mask";

interface Point {
  x: number;
  y: number;
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
  focusRect: Rect | null;
  focusNonce: number;
  onRegion: (rect: Rect) => void;
  onRegionRemove: (index: number) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState<{ start: Point; current: Point } | null>(
    null,
  );
  const overlayRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

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
    <div className="page-stage-wrap" ref={wrapRef}>
      {url === null ? (
        <p className="status">ページ画像を読み込み中…</p>
      ) : (
        <div className="page-stage">
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
              {props.findings.map((finding, index) => (
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
                />
              ))}
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
              {dragRect && (
                <rect
                  className="drag-rect"
                  x={dragRect.x}
                  y={dragRect.y}
                  width={dragRect.width}
                  height={dragRect.height}
                />
              )}
            </svg>
          )}
        </div>
      )}
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
