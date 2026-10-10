import { useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ExperimentalBrowserViewProps } from "@get-bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import {
  BrowserView,
  type BrowserViewNavigation,
  type BrowserViewOpenTabRequest,
} from "@/components/browser/BrowserView";
import { BrowserViewFallbackCard } from "@/components/browser/BrowserViewFallbackCard";
import { BrowserViewHostContext } from "@/components/browser/BrowserViewHostContext";
import {
  isValidPluginBrowserViewKey,
  pluginBrowserViewId,
  pluginBrowserViewOwnerId,
} from "@/components/browser/plugin-browser-view-ids";
import { createBrowserViewVisibilityCoordinator } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { usePluginId } from "./plugin-context";

const PLUGIN_BROWSER_UNAVAILABLE_COPY = {
  title: "This page needs the bb desktop app",
  body: "Plugin browser views run in the bb desktop app.",
};

function isHttpUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol } = new URL(url);
  return protocol === "http:" || protocol === "https:";
}

export function PluginBrowserView(props: ExperimentalBrowserViewProps) {
  return <PluginBrowserViewForKey key={props.viewKey} {...props} />;
}

function PluginBrowserViewForKey({
  viewKey,
  url,
  chrome,
  onNavigate,
  onOpenTab,
  className,
}: ExperimentalBrowserViewProps) {
  const pluginId = usePluginId();
  const [createdUrl] = useState(url);
  const host = useContext(BrowserViewHostContext);
  const isPaneFocused = useOptionalPaneContext()?.isFocused ?? true;
  const navigation = useAppNavigationHost();
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const visibilityCoordinator = useMemo(
    () =>
      desktopBrowser === null
        ? null
        : createBrowserViewVisibilityCoordinator(desktopBrowser),
    [desktopBrowser],
  );
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onOpenTabRef = useRef(onOpenTab);
  onOpenTabRef.current = onOpenTab;
  const handleNavigate = useCallback(
    ({ url: liveUrl, title }: BrowserViewNavigation) => {
      onNavigateRef.current?.({ url: liveUrl, title });
    },
    [],
  );
  const handleOpenTab = useCallback(
    (request: BrowserViewOpenTabRequest) => {
      const override = onOpenTabRef.current;
      if (override !== undefined) {
        override({ url: request.url });
        return;
      }
      navigation.openUrl({ url: request.url });
    },
    [navigation],
  );
  const shouldAttachExistingOnly = useCallback(() => false, []);
  const isKeyValid = isValidPluginBrowserViewKey(viewKey);
  if (!isKeyValid || !isHttpUrl(createdUrl)) {
    return (
      <BrowserViewFallbackCard
        className={cn("h-full", className)}
        title="This browser view can't open"
        body={
          isKeyValid
            ? "Browser views open only http:// and https:// pages."
            : "View keys use 1–128 letters, digits, and _ - : . characters."
        }
        url={createdUrl}
        onRetry={null}
      />
    );
  }
  return (
    <BrowserView
      viewId={pluginBrowserViewId({ pluginId, viewKey })}
      ownerId={pluginBrowserViewOwnerId(pluginId)}
      environmentId={null}
      initialUrl={createdUrl}
      chrome={chrome === "none" ? "none" : "full"}
      canShow={host.canShowNativeBrowserView}
      canHandleBrowserCommands={isPaneFocused && host.canShowNativeBrowserView}
      visibilityCoordinator={visibilityCoordinator}
      shouldAttachExistingOnly={shouldAttachExistingOnly}
      unavailableCopy={PLUGIN_BROWSER_UNAVAILABLE_COPY}
      onNavigate={handleNavigate}
      onOpenTab={handleOpenTab}
      onNativeFocus={null}
      className={className}
    />
  );
}
