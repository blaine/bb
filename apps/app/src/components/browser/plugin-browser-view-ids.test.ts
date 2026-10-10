import { afterEach, describe, expect, it } from "vitest";
import {
  registerBrowserView,
  resetBrowserViewPersistence,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { createRecordingDesktopBrowser } from "@/test/recording-desktop-browser-api";
import {
  closePluginBrowserView,
  closePluginBrowserViews,
  isValidPluginBrowserViewKey,
  pluginBrowserViewId,
  pluginBrowserViewOwnerId,
} from "./plugin-browser-view-ids";

afterEach(() => {
  resetBrowserViewPersistence();
});

describe("plugin browser view ids", () => {
  it.each(["inbox", "pin:mail.google.com", "tab_1-2.3", "a".repeat(128)])(
    "accepts the view key %j",
    (viewKey) => {
      expect(isValidPluginBrowserViewKey(viewKey)).toBe(true);
    },
  );

  it.each(["", "a".repeat(129), "has space", "slash/es", "ünicode", "pin\n"])(
    "rejects the view key %j",
    (viewKey) => {
      expect(isValidPluginBrowserViewKey(viewKey)).toBe(false);
    },
  );

  it("namespaces view ids and owners under the plugin id", () => {
    expect(pluginBrowserViewId({ pluginId: "acme", viewKey: "inbox" })).toBe(
      "plugin-view:acme:inbox",
    );
    expect(pluginBrowserViewOwnerId("acme")).toBe("plugin-view:acme");
  });

  it("closes only the calling plugin's view and ignores invalid keys", () => {
    const browser = createRecordingDesktopBrowser();
    expect(
      closePluginBrowserView({
        desktopBrowser: browser.api,
        pluginId: "acme",
        viewKey: "inbox",
      }),
    ).toBe(true);
    expect(
      closePluginBrowserView({
        desktopBrowser: browser.api,
        pluginId: "acme",
        viewKey: "../acme-two:inbox",
      }),
    ).toBe(false);
    expect(browser.detachments()).toEqual(["plugin-view:acme:inbox"]);
  });

  it("closes every view the plugin owns and leaves other owners' views", () => {
    const browser = createRecordingDesktopBrowser();
    registerBrowserView({
      environmentId: null,
      tabId: "plugin-view:acme:a",
      threadId: "plugin-view:acme",
    });
    registerBrowserView({
      environmentId: null,
      tabId: "plugin-view:acme:b",
      threadId: "plugin-view:acme",
    });
    registerBrowserView({
      environmentId: null,
      tabId: "plugin-view:acme-two:a",
      threadId: "plugin-view:acme-two",
    });
    registerBrowserView({
      environmentId: "env-1",
      tabId: "browser:x",
      threadId: "thr_1",
    });
    closePluginBrowserViews({ desktopBrowser: browser.api, pluginId: "acme" });
    expect(browser.detachments().sort()).toEqual([
      "plugin-view:acme:a",
      "plugin-view:acme:b",
    ]);
  });
});
