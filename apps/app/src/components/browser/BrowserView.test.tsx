// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type { BbDesktopBrowserState } from "@bb/desktop-contract";
import { defaultAppSettings } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AppCommandProvider,
  useAppCommandRunner,
  type AppCommandRunner,
} from "@/components/commands/AppCommandProvider";
import { resetBrowserViewPersistence } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
  type RecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";
import { BrowserView, type BrowserViewProps } from "./BrowserView";
import { resetBrowserViewMountsForTest } from "./browserViewMounts";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: defaultAppSettings, keybindings: [] },
  }),
}));

const VIEW_ID = "plugin-view:acme:inbox";
let runner: AppCommandRunner | null = null;

function CommandRunnerProbe() {
  runner = useAppCommandRunner();
  return null;
}

function runCommand(command: "browser.find" | "browser.focusLocation") {
  let handled = false;
  act(() => {
    handled = runner?.dispatch(command, null) ?? false;
  });
  return handled;
}

function WithCommands({ children }: { children: ReactNode }) {
  return (
    <AppCommandProvider>
      <CommandRunnerProbe />
      {children}
    </AppCommandProvider>
  );
}

function paneValue(paneId: string, isFocused: boolean): PaneContextValue {
  return {
    paneId,
    isFocused,
    isSplitPane: true,
    secondaryPanelHost: null,
    reservesWindowPanelToggle: false,
    onRequestClose: null,
    isMaximized: false,
    onToggleMaximize: null,
    isBoundedPane: true,
    isTopRow: true,
    ownsWindowTopLeft: paneId === "a",
    navigateInPane: () => {},
  };
}

function installFindableBrowser(): RecordingDesktopBrowser {
  const browser = createRecordingDesktopBrowser();
  browser.api.findInPage = () => {};
  browser.api.stopFindInPage = () => {};
  installRecordingDesktopBrowser(browser);
  return browser;
}

function findBar(container: HTMLElement = document.body) {
  return within(container).queryByRole("search", { name: "Find in page" });
}

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
  runner = null;
  resetBrowserViewPersistence();
  resetBrowserViewMountsForTest();
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

describe("BrowserView commands", () => {
  it("opens find in page for a mount that can run browser commands", async () => {
    const browser = installFindableBrowser();
    render(
      <WithCommands>
        <BrowserView {...viewProps()} />
      </WithCommands>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    expect(runCommand("browser.find")).toBe(true);
    expect(findBar()).not.toBeNull();
  });

  it("leaves find in page to other handlers when the mount cannot run browser commands", async () => {
    const browser = installFindableBrowser();
    render(
      <WithCommands>
        <BrowserView {...viewProps({ canHandleBrowserCommands: false })} />
      </WithCommands>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    expect(runCommand("browser.find")).toBe(false);
    expect(findBar()).toBeNull();
  });

  it("does not claim find in page from a mount that is showing elsewhere", async () => {
    const browser = installFindableBrowser();
    render(
      <WithCommands>
        <div data-testid="pane-a">
          <BrowserView {...viewProps()} />
        </div>
        <div data-testid="pane-b">
          <BrowserView {...viewProps({ canHandleBrowserCommands: false })} />
        </div>
      </WithCommands>,
    );
    await waitFor(() => expect(browser.attachments()).not.toHaveLength(0));
    expect(
      within(screen.getByTestId("pane-a")).getByRole("button", {
        name: "Show here",
      }),
    ).toBeTruthy();
    expect(runCommand("browser.find")).toBe(false);
    expect(findBar()).toBeNull();
  });

  it("lets find and focus-location fall through without browser chrome", async () => {
    const browser = installFindableBrowser();
    render(
      <WithCommands>
        <BrowserView {...viewProps({ chrome: "none" })} />
      </WithCommands>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    expect(runCommand("browser.find")).toBe(false);
    expect(runCommand("browser.focusLocation")).toBe(false);
  });

  it("moves find in page to the mount whose pane gains focus", async () => {
    const browser = installFindableBrowser();
    function Panes({ focused }: { focused: "a" | "b" }) {
      return (
        <WithCommands>
          {(["a", "b"] as const).map((paneId) => (
            <PaneContext.Provider
              key={paneId}
              value={paneValue(paneId, focused === paneId)}
            >
              <div data-testid={`pane-${paneId}`}>
                <BrowserView
                  {...viewProps({
                    canHandleBrowserCommands: focused === paneId,
                  })}
                />
              </div>
            </PaneContext.Provider>
          ))}
        </WithCommands>
      );
    }
    const view = render(<Panes focused="a" />);
    await waitFor(() => expect(browser.attachments()).not.toHaveLength(0));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("pane-b")).queryByRole("button", {
          name: "Show here",
        }),
      ).not.toBeNull(),
    );
    view.rerender(<Panes focused="b" />);
    await waitFor(() =>
      expect(
        within(screen.getByTestId("pane-a")).queryByRole("button", {
          name: "Show here",
        }),
      ).not.toBeNull(),
    );
    expect(runCommand("browser.find")).toBe(true);
    expect(findBar(screen.getByTestId("pane-b"))).not.toBeNull();
    expect(findBar(screen.getByTestId("pane-a"))).toBeNull();
  });
});
