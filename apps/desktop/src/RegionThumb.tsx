import { useEffect, useState } from "react";
import { pageImageUrl } from "./api";
import type { Rect } from "./types";

/// Cropped preview of one region of one page image, used so the user can
/// see exactly what a region rule will erase before applying it.
export default function RegionThumb(props: {
  projectDir: string;
  pageIndex: number;
  rect: Rect;
  maxWidth: number;
  maxHeight: number;
  /// Crop from the transformed page under renders/ instead of the original.
  rendered?: boolean;
  /// Cache-buster for rendered crops, bumped after each 適用.
  version?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setNatural(null);
    pageImageUrl(props.projectDir, props.pageIndex, props.rendered ?? false)
      .then((base) => {
        if (cancelled) return;
        const loaded =
          props.version === undefined ? base : `${base}?v=${props.version}`;
        setUrl(loaded);
        const image = new Image();
        image.onload = () => {
          if (!cancelled)
            setNatural({ w: image.naturalWidth, h: image.naturalHeight });
        };
        image.src = loaded;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.projectDir, props.pageIndex, props.rendered, props.version]);

  if (!url || !natural) {
    return <div className="region-thumb loading" />;
  }

  const scale = Math.min(
    props.maxWidth / props.rect.width,
    props.maxHeight / props.rect.height,
  );
  return (
    <div
      className="region-thumb"
      style={{
        width: Math.max(8, props.rect.width * scale),
        height: Math.max(8, props.rect.height * scale),
        backgroundImage: `url(${url})`,
        backgroundSize: `${natural.w * scale}px ${natural.h * scale}px`,
        backgroundPosition: `${-props.rect.x * scale}px ${-props.rect.y * scale}px`,
      }}
    />
  );
}
