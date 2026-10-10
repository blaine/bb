// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import { resetBrowserViewPersistence } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { getPluginPagePanelStateId } from "@/components/plugin/plugin-page-panel-state";
import { BROWSER_DIMMING_OVERLAYS } from "@/test/browser-dimming-overlays";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
  type RecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";

const CONTRACT_URL = "https://example.com/contract";
const SLOT_RECT = new DOMRect(12, 24, 420, 260);

interface BrowserSurfaceCase {
  name: string;
  viewId: string;
  ownerId: string;
  element: () => ReactElement;
}

function panelSurface(
  name: string,
  ownerId: string,
  environmentId: string | null,
): BrowserSurfaceCase {
  const tab: BrowserFixedPanelTab = {
    environmentId,
    id: "browser:contract",
    kind: "browser",
    title: null,
    url: CONTRACT_URL,
  };
  return {
    name,
    viewId: tab.id,
    ownerId,
    element: () => (
      <BrowserTabDeck
        browserTabs={[tab]}
        activeBrowserTabId={tab.id}
        environmentId={environmentId}
        canShowNativeBrowserView
        threadId={ownerId}
        onUpdate={() => {}}
        onOpenInNewTab={null}
      />
    ),
  };
}

const BROWSER_SURFACES: readonly BrowserSurfaceCase[] = [
  panelSurface("thread panel", "thr_contract", "env-contract"),
  panelSurface("New-thread panel", "thr_new_thread_contract", null),
  panelSurface(
    "plugin page panel",
    getPluginPagePanelStateId({ pluginId: "acme", panelPath: "inbox" }),
    null,
  ),
];

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => SLOT_RECT,
  });
});

afterEach(() => {
  cleanup();
  resetBrowserViewPersistence();
  window.localStorage.clear();
  delete window.bbDesktop;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

describe.each(BROWSER_SURFACES)("browser view on the $name", (surface) => {
  let browser: RecordingDesktopBrowser;

  beforeEach(() => {
    browser = createRecordingDesktopBrowser();
    installRecordingDesktopBrowser(browser);
  });

  it("attaches hidden under the surface's identity and shows only after attaching", async () => {
    render(surface.element());
    await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
    expect(browser.attachments()).toEqual([
      {
        tabId: surface.viewId,
        threadId: surface.ownerId,
        url: CONTRACT_URL,
        bounds: { x: 12, y: 24, width: 420, height: 260 },
        visible: false,
      },
    ]);
    const attachIndex = browser.calls.findIndex(
      (call) => call.type === "attach",
    );
    const showIndex = browser.calls.findIndex(
      (call) =>
        (call.type === "setVisible" ||
          call.type === "setVisibleWithoutFocus") &&
        call.request.tabId === surface.viewId &&
        call.request.visible,
    );
    expect(showIndex).toBeGreaterThan(attachIndex);
  });

  it("hides without detaching when it unmounts", async () => {
    const view = render(surface.element());
    await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
    view.unmount();
    expect(browser.isShown(surface.viewId)).toBe(false);
    expect(browser.detachments()).toEqual([]);
  });

  it.each(BROWSER_DIMMING_OVERLAYS)(
    "hides under an open $name and returns when it closes",
    async (overlay) => {
      const view = render(
        <>
          {surface.element()}
          {overlay.element(false)}
        </>,
      );
      await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
      view.rerender(
        <>
          {surface.element()}
          {overlay.element(true)}
        </>,
      );
      await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(false));
      view.rerender(
        <>
          {surface.element()}
          {overlay.element(false)}
        </>,
      );
      await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
      expect(browser.detachments()).toEqual([]);
    },
  );

  it("offers Open in browser and Copy link without the desktop app", async () => {
    delete window.bbDesktop;
    render(surface.element());
    expect(
      await screen.findByRole("button", { name: "Open in browser" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByText(CONTRACT_URL)).toBeTruthy();
  });
});
