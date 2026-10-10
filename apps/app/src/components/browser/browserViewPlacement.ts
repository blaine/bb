import type {
  BbDesktopBrowserViewportBounds,
  BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import { clampBbDesktopBrowserViewBounds } from "@bb/desktop-contract";

interface BrowserViewBoundsFromElementArgs {
  element: HTMLElement;
}

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

export function browserViewBoundsFromElement(
  args: BrowserViewBoundsFromElementArgs,
): BbDesktopBrowserViewBounds {
  return clampBbDesktopBrowserViewBounds({
    bounds: roundedBoundsFromRect(args.element.getBoundingClientRect()),
    viewport: browserViewportBounds(),
  });
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
