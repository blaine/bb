import type {
  BbDesktopBrowserViewportBounds,
  BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import { clampBbDesktopBrowserViewBounds } from "@bb/desktop-contract";

interface BrowserViewBoundsEqualArgs {
  a: BbDesktopBrowserViewBounds;
  b: BbDesktopBrowserViewBounds;
}

export const EMPTY_BROWSER_VIEW_BOUNDS: BbDesktopBrowserViewBounds = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};

function roundedBoundsFromRect(rect: DOMRect): BbDesktopBrowserViewBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function browserViewportBounds(): BbDesktopBrowserViewportBounds {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export interface BrowserViewPlacement {
  bounds: BbDesktopBrowserViewBounds;
  clipped: boolean;
}

const BROWSER_VIEW_CLIP_TOLERANCE_PX = 1;

function clipsOverflow(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const clips = (value: string) => value !== "" && value !== "visible";
  return (
    clips(style.overflow) || clips(style.overflowX) || clips(style.overflowY)
  );
}

export function readBrowserViewPlacement(
  element: HTMLElement,
): BrowserViewPlacement {
  const rect = element.getBoundingClientRect();
  let top = Number.NEGATIVE_INFINITY;
  let left = Number.NEGATIVE_INFINITY;
  let right = Number.POSITIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  for (
    let ancestor = element.parentElement;
    ancestor !== null &&
    ancestor !== document.body &&
    ancestor !== document.documentElement;
    ancestor = ancestor.parentElement
  ) {
    if (!clipsOverflow(ancestor)) continue;
    const clip = ancestor.getBoundingClientRect();
    top = Math.max(top, clip.top);
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  const clipped =
    rect.top < top - BROWSER_VIEW_CLIP_TOLERANCE_PX ||
    rect.left < left - BROWSER_VIEW_CLIP_TOLERANCE_PX ||
    rect.right > right + BROWSER_VIEW_CLIP_TOLERANCE_PX ||
    rect.bottom > bottom + BROWSER_VIEW_CLIP_TOLERANCE_PX;
  return {
    bounds: clampBbDesktopBrowserViewBounds({
      bounds: roundedBoundsFromRect(rect),
      viewport: browserViewportBounds(),
    }),
    clipped,
  };
}

export function browserViewBoundsEqual(
  args: BrowserViewBoundsEqualArgs,
): boolean {
  return (
    args.a.x === args.b.x &&
    args.a.y === args.b.y &&
    args.a.width === args.b.width &&
    args.a.height === args.b.height
  );
}
