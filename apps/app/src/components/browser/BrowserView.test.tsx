// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { BbDesktopBrowserState } from "@bb/desktop-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetBrowserViewPersistence } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";
import { BrowserView, type BrowserViewProps } from "./BrowserView";

const VIEW_ID = "plugin-view:acme:inbox";

function viewProps(
  overrides: Partial<BrowserViewProps> = {},
): BrowserViewProps {
  return {
    viewId: VIEW_ID,
    ownerId: "plugin-view:acme",
    environmentId: null,
    initialUrl: "https://mail.example/",
    chrome: "full",
    canShow: true,
    canHandleBrowserCommands: true,
    visibilityCoordinator: null,
    shouldAttachExistingOnly: () => false,
    unavailableCopy: { title: "Needs desktop", body: "Desktop only" },
    onNavigate: () => {},
    onOpenTab: null,
    onNativeFocus: null,
    ...overrides,
  };
}

function pageState(
  overrides: Partial<BbDesktopBrowserState>,
): BbDesktopBrowserState {
  return {
    tabId: VIEW_ID,
    url: "https://mail.example/",
    title: null,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  resetBrowserViewPersistence();
  window.localStorage.clear();
  delete window.bbDesktop;
});

describe("BrowserView", () => {
  it("shows only the page without browser chrome", async () => {
    const browser = createRecordingDesktopBrowser();
    installRecordingDesktopBrowser(browser);
    render(<BrowserView {...viewProps({ chrome: "none" })} />);
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    expect(
      screen.queryByRole("region", { name: "Browser navigation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("textbox", { name: /Address and search bar/ }),
    ).toBeNull();
  });

  it("reports navigation for its own view only", async () => {
    const browser = createRecordingDesktopBrowser();
    installRecordingDesktopBrowser(browser);
    const onNavigate = vi.fn();
    render(<BrowserView {...viewProps({ onNavigate })} />);
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    act(() =>
      browser.emitState(
        pageState({
          tabId: "plugin-view:acme:other",
          url: "https://o.example/",
        }),
      ),
    );
    act(() =>
      browser.emitState(
        pageState({ url: "https://mail.example/inbox", title: "Inbox" }),
      ),
    );
    expect(onNavigate.mock.calls).toEqual([
      [{ url: "https://mail.example/inbox", title: "Inbox" }],
    ]);
  });

  it("routes only its own new-tab requests to onOpenTab", async () => {
    const browser = createRecordingDesktopBrowser();
    installRecordingDesktopBrowser(browser);
    const onOpenTab = vi.fn();
    render(<BrowserView {...viewProps({ onOpenTab })} />);
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    act(() =>
      browser.emitScopedOpenTab({
        tabId: "browser:panel",
        url: "https://panel.example/",
      }),
    );
    act(() =>
      browser.emitScopedOpenTab({
        tabId: VIEW_ID,
        url: "https://link.example/",
      }),
    );
    expect(onOpenTab.mock.calls).toEqual([[{ url: "https://link.example/" }]]);
  });
});
