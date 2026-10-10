// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserViewVisibilityCoordinator,
  resetBrowserViewPersistence,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
  type RecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";
import { BrowserView } from "./BrowserView";
import { resetBrowserViewMountsForTest } from "./browserViewMounts";
import {
  closePluginBrowserView,
  pluginBrowserViewId,
  pluginBrowserViewOwnerId,
} from "./plugin-browser-view-ids";

const VIEW_ID = pluginBrowserViewId({ pluginId: "acme", viewKey: "inbox" });
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
let browser: RecordingDesktopBrowser;

function PluginView() {
  const [coordinator] = useState(() =>
    createBrowserViewVisibilityCoordinator(browser.api),
  );
  return (
    <BrowserView
      viewId={VIEW_ID}
      ownerId={pluginBrowserViewOwnerId("acme")}
      environmentId={null}
      initialUrl="https://mail.example/"
      chrome="none"
      canShow
      canHandleBrowserCommands
      visibilityCoordinator={coordinator}
      shouldAttachExistingOnly={() => false}
      unavailableCopy={{ title: "Needs desktop", body: "Desktop only" }}
      onNavigate={() => {}}
      onOpenTab={null}
      onNativeFocus={null}
    />
  );
}

function TwoPanes({ showB = true }: { showB?: boolean }) {
  return (
    <>
      <div data-testid="pane-a">
        <PluginView />
      </div>
      {showB ? (
        <div data-testid="pane-b">
          <PluginView />
        </div>
      ) : null}
    </>
  );
}

function ClosingTab() {
  const [open, setOpen] = useState(true);
  return (
    <>
      {open ? <PluginView /> : null}
      <button
        type="button"
        onClick={() => {
          closePluginBrowserView({
            desktopBrowser: browser.api,
            pluginId: "acme",
            viewKey: "inbox",
          });
          setOpen(false);
        }}
      >
        Close tab
      </button>
    </>
  );
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(10, 20, 400, 300),
  });
  browser = createRecordingDesktopBrowser();
  installRecordingDesktopBrowser(browser);
});

afterEach(() => {
  cleanup();
  resetBrowserViewPersistence();
  resetBrowserViewMountsForTest();
  delete window.bbDesktop;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

describe("plugin browser view lifecycle", () => {
  it("lets one of two mounts own the view and moves it on Show here", async () => {
    render(<TwoPanes />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    const paneA = screen.getByTestId("pane-a");
    const paneB = screen.getByTestId("pane-b");
    expect(
      within(paneB).queryByRole("button", { name: "Show here" }),
    ).toBeNull();
    fireEvent.click(within(paneA).getByRole("button", { name: "Show here" }));
    await waitFor(() =>
      expect(
        within(paneB).getByRole("button", { name: "Show here" }),
      ).toBeTruthy(),
    );
    expect(
      within(paneA).queryByRole("button", { name: "Show here" }),
    ).toBeNull();
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    expect(browser.detachments()).toEqual([]);
  });

  it("hands the view to the remaining mount when its owner unmounts", async () => {
    const view = render(<TwoPanes />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    view.rerender(<TwoPanes showB={false} />);
    expect(
      within(screen.getByTestId("pane-a")).queryByRole("button", {
        name: "Show here",
      }),
    ).toBeNull();
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    expect(browser.detachments()).toEqual([]);
  });

  it("reloads a mounted view from its url after close", async () => {
    render(<PluginView />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    act(() => {
      closePluginBrowserView({
        desktopBrowser: browser.api,
        pluginId: "acme",
        viewKey: "inbox",
      });
    });
    await waitFor(() => expect(browser.attachments()).toHaveLength(2));
    expect(browser.detachments()).toEqual([VIEW_ID]);
    expect(browser.attachments()[1]?.url).toBe("https://mail.example/");
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
  });

  it("does not recreate a view closed and unmounted in the same handler", async () => {
    render(<ClosingTab />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
    await act(async () => {});
    expect(browser.detachments()).toEqual([VIEW_ID]);
    expect(browser.attachments()).toHaveLength(1);
  });
});
