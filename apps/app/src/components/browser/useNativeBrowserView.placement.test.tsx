// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserViewVisibilityCoordinator,
  resetBrowserViewPersistence,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { DIALOG_OVERLAY } from "@/test/browser-dimming-overlays";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
  type RecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";
import { BrowserView } from "./BrowserView";

const VIEW_ID = "plugin-view:acme:inbox";
const SNAPSHOT = "data:image/jpeg;base64,c25hcHNob3Q=";
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const pendingFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;
const rects = {
  slot: new DOMRect(0, 0, 400, 200),
  scroller: new DOMRect(0, 0, 500, 300),
};

function flushFrames(): void {
  act(() => {
    const queued = [...pendingFrames.values()];
    pendingFrames.clear();
    for (const callback of queued) callback(performance.now());
  });
}

function ScrolledView({
  browser,
  dialogOpen,
  canShow = true,
}: {
  browser: RecordingDesktopBrowser;
  dialogOpen: boolean;
  canShow?: boolean;
}) {
  const [coordinator] = useState(() =>
    createBrowserViewVisibilityCoordinator(browser.api),
  );
  return (
    <>
      <div data-testid="scroller" style={{ overflow: "auto" }}>
        <BrowserView
          viewId={VIEW_ID}
          ownerId="plugin-view:acme"
          environmentId={null}
          initialUrl="https://mail.example/"
          chrome="none"
          canShow={canShow}
          canHandleBrowserCommands
          visibilityCoordinator={coordinator}
          shouldAttachExistingOnly={() => false}
          unavailableCopy={{ title: "Needs desktop", body: "Desktop only" }}
          onNavigate={() => {}}
          onOpenTab={null}
          onNativeFocus={null}
        />
      </div>
      {DIALOG_OVERLAY.element(dialogOpen)}
    </>
  );
}

let browser: RecordingDesktopBrowser;

beforeEach(() => {
  rects.slot = new DOMRect(0, 0, 400, 200);
  rects.scroller = new DOMRect(0, 0, 500, 300);
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      if (this.hasAttribute("data-browser-view-slot")) return rects.slot;
      if (this.getAttribute("data-testid") === "scroller")
        return rects.scroller;
      return new DOMRect(0, 0, 1024, 768);
    },
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    nextFrameId += 1;
    pendingFrames.set(nextFrameId, callback);
    return nextFrameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pendingFrames.delete(id);
  });
  browser = createRecordingDesktopBrowser();
  installRecordingDesktopBrowser(browser);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pendingFrames.clear();
  resetBrowserViewPersistence();
  delete window.bbDesktop;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

describe("native browser view placement", () => {
  it("requests a snapshot before hiding under a dialog and drops it when the page returns", async () => {
    const view = render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    view.rerender(<ScrolledView browser={browser} dialogOpen />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(false));
    const captureIndex = browser.calls.findIndex(
      (call) => call.type === "captureSnapshot",
    );
    const hideIndex = browser.calls.reduce(
      (last, call, index) =>
        call.type === "setVisible" &&
        call.request.tabId === VIEW_ID &&
        !call.request.visible
          ? index
          : last,
      -1,
    );
    expect(captureIndex).toBeGreaterThanOrEqual(0);
    expect(captureIndex).toBeLessThan(hideIndex);
    act(() => browser.emitSnapshot({ tabId: VIEW_ID, dataUrl: SNAPSHOT }));
    expect(
      view.container.querySelector(`img[src="${SNAPSHOT}"]`),
    ).not.toBeNull();
    view.rerender(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("resyncs bounds when an ancestor scroll moves the slot without resizing it", async () => {
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    flushFrames();
    rects.slot = new DOMRect(0, 50, 400, 200);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.bounds(VIEW_ID).at(-1)).toEqual({
      x: 0,
      y: 50,
      width: 400,
      height: 200,
    });
  });

  it("resyncs bounds when a layout change moves the slot", async () => {
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    flushFrames();
    rects.slot = new DOMRect(0, 80, 400, 200);
    await act(async () => {
      document.body.append(document.createElement("div"));
    });
    flushFrames();
    expect(browser.bounds(VIEW_ID).at(-1)).toEqual({
      x: 0,
      y: 80,
      width: 400,
      height: 200,
    });
  });

  it("hides a slot clipped by its scroll container and shows it again once it fits", async () => {
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    flushFrames();
    rects.slot = new DOMRect(0, 150, 400, 200);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(false);
    expect(browser.snapshotRequests()).toEqual([VIEW_ID]);
    rects.slot = new DOMRect(0, 100, 400, 200);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(true);
    expect(browser.bounds(VIEW_ID).at(-1)).toEqual({
      x: 0,
      y: 100,
      width: 400,
      height: 200,
    });
  });

  it("never shows a slot taller than its scroll container", async () => {
    rects.slot = new DOMRect(0, 0, 400, 600);
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(false);
  });

  it("hides a zero-size slot such as a tab hidden with display:none", async () => {
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    flushFrames();
    rects.slot = new DOMRect(0, 0, 0, 0);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(false);
    rects.slot = new DOMRect(0, 0, 400, 0);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(false);
    rects.slot = new DOMRect(0, 0, 400, 200);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(true);
  });

  it.each(["transitioncancel", "animationcancel"])(
    "rechecks placement after a %s",
    async (eventType) => {
      render(<ScrolledView browser={browser} dialogOpen={false} />);
      await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
      flushFrames();
      rects.slot = new DOMRect(0, 40, 400, 200);
      act(() => {
        screen
          .getByTestId("scroller")
          .dispatchEvent(new Event(eventType, { bubbles: true }));
      });
      flushFrames();
      expect(browser.bounds(VIEW_ID).at(-1)).toEqual({
        x: 0,
        y: 40,
        width: 400,
        height: 200,
      });
    },
  );

  it("stops listening for cancelled transitions and animations once it unmounts", async () => {
    const view = render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    flushFrames();
    const boundsBefore = browser.bounds(VIEW_ID).length;
    view.unmount();
    rects.slot = new DOMRect(0, 40, 400, 200);
    document.dispatchEvent(new Event("transitioncancel"));
    document.dispatchEvent(new Event("animationcancel"));
    flushFrames();
    expect(browser.bounds(VIEW_ID)).toHaveLength(boundsBefore);
  });

  it("ignores a snapshot that arrives while the page is showing", async () => {
    const view = render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    act(() => browser.emitSnapshot({ tabId: VIEW_ID, dataUrl: SNAPSHOT }));
    expect(view.container.querySelector("img")).toBeNull();
    view.rerender(
      <ScrolledView browser={browser} dialogOpen={false} canShow={false} />,
    );
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(false));
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("drops a held snapshot when the page navigates", async () => {
    const view = render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    act(() =>
      browser.emitState({
        tabId: VIEW_ID,
        url: "https://mail.example/",
        title: "Inbox",
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        errorText: null,
      }),
    );
    view.rerender(<ScrolledView browser={browser} dialogOpen />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(false));
    act(() => browser.emitSnapshot({ tabId: VIEW_ID, dataUrl: SNAPSHOT }));
    expect(
      view.container.querySelector(`img[src="${SNAPSHOT}"]`),
    ).not.toBeNull();
    act(() =>
      browser.emitState({
        tabId: VIEW_ID,
        url: "https://mail.example/sent",
        title: "Sent",
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        errorText: null,
      }),
    );
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("shows the host window resize snapshot and drops it once the resize ends", async () => {
    const view = render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    act(() => browser.emitSnapshot({ tabId: VIEW_ID, dataUrl: SNAPSHOT }));
    expect(
      view.container.querySelector(`img[src="${SNAPSHOT}"]`),
    ).not.toBeNull();
    act(() => browser.emitSnapshot({ tabId: VIEW_ID, dataUrl: null }));
    expect(view.container.querySelector("img")).toBeNull();
    act(() => browser.emitSnapshot({ tabId: VIEW_ID, dataUrl: SNAPSHOT }));
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("drops a resize snapshot when the view hides without capturing a new one", async () => {
    const view = render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    act(() => browser.emitSnapshot({ tabId: VIEW_ID, dataUrl: SNAPSHOT }));
    expect(
      view.container.querySelector(`img[src="${SNAPSHOT}"]`),
    ).not.toBeNull();
    view.rerender(
      <ScrolledView browser={browser} dialogOpen={false} canShow={false} />,
    );
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(false));
    expect(browser.snapshotRequests()).toEqual([]);
    expect(view.container.querySelector("img")).toBeNull();
  });
});
