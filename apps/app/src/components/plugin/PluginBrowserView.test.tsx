// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ExperimentalBrowserViewProps } from "@get-bb/plugin-sdk";
import { useEffect, type ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";
import { BrowserViewHostContext } from "@/components/browser/BrowserViewHostContext";
import { resetBrowserViewMountsForTest } from "@/components/browser/browserViewMounts";
import { resetBrowserViewPersistence } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
  type RecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";
import { LazyPluginBrowserView } from "./LazyPluginBrowserView";
import { PluginContext } from "./plugin-context";
import { clearPluginOpenTabListeners } from "./pluginOpenTabListeners";

const PluginSdkBrowserView =
  pluginSdkAppImplementation.experimental_BrowserView;
const VIEW_ID = "plugin-view:acme:inbox";
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
let browser: RecordingDesktopBrowser;

function PluginSurface({
  children,
  openUrl = () => true,
}: {
  children: ReactNode;
  openUrl?: (intent: { url: string }) => boolean;
}) {
  return (
    <PluginContext.Provider value="acme">
      <AppNavigationHostProvider capabilities={{ openUrl }}>
        {children}
      </AppNavigationHostProvider>
    </PluginContext.Provider>
  );
}

function view(props: Partial<ExperimentalBrowserViewProps> = {}) {
  return (
    <PluginSdkBrowserView
      viewKey="inbox"
      url="https://mail.example/"
      {...props}
    />
  );
}

beforeAll(async () => {
  await LazyPluginBrowserView.preload();
});

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
  clearPluginOpenTabListeners("acme");
  resetBrowserViewPersistence();
  resetBrowserViewMountsForTest();
  window.localStorage.clear();
  delete window.bbDesktop;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

describe("experimental_BrowserView", () => {
  it.each([
    ["", "https://mail.example/"],
    ["has space", "https://mail.example/"],
    ["a".repeat(129), "https://mail.example/"],
    ["inbox", "javascript:alert(1)"],
    ["inbox", "file:///etc/hosts"],
    ["inbox", "not a url"],
  ])(
    "renders an error card instead of a view for viewKey %j and url %j",
    async (viewKey, url) => {
      render(<PluginSurface>{view({ viewKey, url })}</PluginSurface>);
      expect(
        await screen.findByText("This browser view can't open"),
      ).toBeTruthy();
      expect(browser.attachments()).toEqual([]);
    },
  );

  it("attaches once under the plugin's identity and ignores later url changes", async () => {
    const rendered = render(<PluginSurface>{view()}</PluginSurface>);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    rendered.rerender(
      <PluginSurface>{view({ url: "https://other.example/" })}</PluginSurface>,
    );
    await act(async () => {});
    expect(browser.attachments()).toHaveLength(1);
    expect(browser.attachments()[0]).toMatchObject({
      tabId: VIEW_ID,
      threadId: "plugin-view:acme",
      url: "https://mail.example/",
    });
  });

  it("waits for a valid url before creating the view and then keeps it", async () => {
    const rendered = render(<PluginSurface>{view({ url: "" })}</PluginSurface>);
    expect(
      await screen.findByText("This browser view can't open"),
    ).toBeTruthy();
    rendered.rerender(
      <PluginSurface>{view({ url: "https://mail.example/" })}</PluginSurface>,
    );
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    expect(screen.queryByText("This browser view can't open")).toBeNull();
    rendered.rerender(
      <PluginSurface>{view({ url: "https://other.example/" })}</PluginSurface>,
    );
    await act(async () => {});
    expect(browser.attachments()).toHaveLength(1);
    expect(browser.attachments()[0]).toMatchObject({
      tabId: VIEW_ID,
      url: "https://mail.example/",
    });
  });

  it("opens the page's new-tab links through the current surface by default", async () => {
    const openUrl = vi.fn(() => true);
    render(<PluginSurface openUrl={openUrl}>{view()}</PluginSurface>);
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    act(() =>
      browser.emitScopedOpenTab({
        tabId: "plugin-view:other:inbox",
        url: "https://x.example/",
      }),
    );
    act(() =>
      browser.emitScopedOpenTab({
        tabId: VIEW_ID,
        url: "https://link.example/",
      }),
    );
    expect(openUrl.mock.calls).toEqual([[{ url: "https://link.example/" }]]);
  });

  it("hands new-tab links to onOpenTab when the plugin supplies it", async () => {
    const openUrl = vi.fn(() => true);
    const onOpenTab = vi.fn();
    render(
      <PluginSurface openUrl={openUrl}>{view({ onOpenTab })}</PluginSurface>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    act(() =>
      browser.emitScopedOpenTab({
        tabId: VIEW_ID,
        url: "https://link.example/",
      }),
    );
    expect(onOpenTab.mock.calls).toEqual([[{ url: "https://link.example/" }]]);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("reports the live url and title through onNavigate", async () => {
    const onNavigate = vi.fn();
    render(<PluginSurface>{view({ onNavigate })}</PluginSurface>);
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    act(() =>
      browser.emitState({
        tabId: VIEW_ID,
        url: "https://mail.example/#inbox",
        title: "Inbox",
        isLoading: false,
        canGoBack: true,
        canGoForward: false,
        errorText: null,
      }),
    );
    expect(onNavigate).toHaveBeenLastCalledWith({
      url: "https://mail.example/#inbox",
      title: "Inbox",
    });
  });

  it("stays hidden while its host covers the main area", async () => {
    render(
      <BrowserViewHostContext.Provider
        value={{ canShowNativeBrowserView: false }}
      >
        <PluginSurface>{view()}</PluginSurface>
      </BrowserViewHostContext.Provider>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    await act(async () => {});
    expect(browser.isShown(VIEW_ID)).toBe(false);
  });
});

describe("experimental_useBrowserViews", () => {
  function OpenTabListener({
    received,
  }: {
    received: Array<{ viewKey: string; url: string }>;
  }) {
    const views = pluginSdkAppImplementation.experimental_useBrowserViews();
    useEffect(
      () =>
        views.onOpenTab((request) => {
          received.push(request);
        }),
      [views],
    );
    return null;
  }

  it("delivers new-tab requests from this plugin's views to a listener, mounted or not", () => {
    const received: Array<{ viewKey: string; url: string }> = [];
    render(
      <PluginSurface>
        <OpenTabListener received={received} />
      </PluginSurface>,
    );
    act(() => {
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://one.example/" });
      browser.emitScopedOpenTab({ tabId: "plugin-view:acme:inbox.t2", url: "https://two.example/" });
      browser.emitScopedOpenTab({ tabId: "plugin-view:acme-two:inbox", url: "https://other.example/" });
      browser.emitScopedOpenTab({ tabId: "plugin-view:other:inbox", url: "https://other.example/" });
      browser.emitScopedOpenTab({ tabId: "browser:abc:none", url: "https://panel.example/" });
    });
    expect(received).toEqual([
      { viewKey: "inbox", url: "https://one.example/" },
      { viewKey: "inbox.t2", url: "https://two.example/" },
    ]);
  });

  it("skips default routing for views without onOpenTab while a listener is registered", async () => {
    const received: Array<{ viewKey: string; url: string }> = [];
    const openUrl = vi.fn(() => true);
    render(
      <PluginSurface openUrl={openUrl}>
        <OpenTabListener received={received} />
        {view()}
      </PluginSurface>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    act(() => {
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" });
    });
    expect(openUrl).not.toHaveBeenCalled();
    expect(received).toEqual([{ viewKey: "inbox", url: "https://link.example/" }]);
  });

  it("still calls a view's own onOpenTab alongside the listener", async () => {
    const received: Array<{ viewKey: string; url: string }> = [];
    const onOpenTab = vi.fn();
    render(
      <PluginSurface>
        <OpenTabListener received={received} />
        {view({ onOpenTab })}
      </PluginSurface>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    act(() => {
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" });
    });
    expect(onOpenTab.mock.calls).toEqual([[{ url: "https://link.example/" }]]);
    expect(received).toHaveLength(1);
  });

  it("keeps a later listener when an earlier unsubscribe runs twice", () => {
    const received: string[] = [];
    let stopFirst: () => void = () => {};
    let stopSecond: () => void = () => {};
    function Subscriber() {
      const views = pluginSdkAppImplementation.experimental_useBrowserViews();
      useEffect(() => {
        stopFirst = views.onOpenTab(() => received.push("first"));
      }, [views]);
      return null;
    }
    render(
      <PluginSurface>
        <Subscriber />
      </PluginSurface>,
    );
    act(() => stopFirst());
    function Second() {
      const views = pluginSdkAppImplementation.experimental_useBrowserViews();
      useEffect(() => {
        stopSecond = views.onOpenTab(() => received.push("second"));
      }, [views]);
      return null;
    }
    render(
      <PluginSurface>
        <Second />
      </PluginSurface>,
    );
    act(() => stopFirst());
    act(() => {
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" });
    });
    expect(received).toEqual(["second"]);
    act(() => stopSecond());
  });

  it("needs one unsubscribe per registration of the same listener", () => {
    const received: string[] = [];
    const listener = () => received.push("hit");
    let stops: Array<() => void> = [];
    function Subscriber() {
      const views = pluginSdkAppImplementation.experimental_useBrowserViews();
      useEffect(() => {
        stops = [views.onOpenTab(listener), views.onOpenTab(listener)];
      }, [views]);
      return null;
    }
    render(
      <PluginSurface>
        <Subscriber />
      </PluginSurface>,
    );
    act(() => stops[0]?.());
    act(() => {
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" });
    });
    expect(received).toEqual(["hit"]);
    act(() => stops[1]?.());
  });

  it("drops a plugin's listeners when its frontend is torn down", () => {
    const received: string[] = [];
    function Subscriber() {
      const views = pluginSdkAppImplementation.experimental_useBrowserViews();
      useEffect(() => {
        views.onOpenTab(() => received.push("hit"));
      }, [views]);
      return null;
    }
    render(
      <PluginSurface>
        <Subscriber />
      </PluginSurface>,
    );
    act(() => clearPluginOpenTabListeners("acme"));
    act(() => {
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" });
    });
    expect(received).toEqual([]);
  });

  it("stops delivering after unsubscribe and restores default routing", async () => {
    const received: Array<{ viewKey: string; url: string }> = [];
    const openUrl = vi.fn(() => true);
    const { rerender } = render(
      <PluginSurface openUrl={openUrl}>
        <OpenTabListener received={received} />
        {view()}
      </PluginSurface>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    rerender(<PluginSurface openUrl={openUrl}>{view()}</PluginSurface>);
    act(() => {
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" });
    });
    expect(received).toEqual([]);
    expect(openUrl.mock.calls).toEqual([[{ url: "https://link.example/" }]]);
  });

  it("closes only this plugin's view and ignores invalid keys", () => {
    function CloseButton() {
      const views = pluginSdkAppImplementation.experimental_useBrowserViews();
      return (
        <button
          type="button"
          onClick={() => {
            views.close("inbox");
            views.close("bad key");
          }}
        >
          Close
        </button>
      );
    }
    render(
      <PluginSurface>
        <CloseButton />
      </PluginSurface>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(browser.detachments()).toEqual([VIEW_ID]);
  });
});
