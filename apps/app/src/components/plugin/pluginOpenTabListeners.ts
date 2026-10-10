import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type { ExperimentalBrowserViewsOpenTabRequest } from "@get-bb/plugin-sdk";
import {
  isValidPluginBrowserViewKey,
  pluginBrowserViewOwnerId,
} from "@/components/browser/plugin-browser-view-ids";

type OpenTabListener = (request: ExperimentalBrowserViewsOpenTabRequest) => void;

const listenersByPlugin = new Map<string, Set<OpenTabListener>>();
let desktopSubscription: { desktopBrowser: BbDesktopBrowserApi; unsubscribe: () => void } | null = null;

function viewKeyForPlugin(pluginId: string, tabId: string): string | null {
  const prefix = `${pluginBrowserViewOwnerId(pluginId)}:`;
  if (!tabId.startsWith(prefix)) return null;
  const viewKey = tabId.slice(prefix.length);
  return isValidPluginBrowserViewKey(viewKey) ? viewKey : null;
}

function dispatch({ tabId, url }: { tabId: string; url: string }): void {
  for (const [pluginId, listeners] of listenersByPlugin) {
    const viewKey = viewKeyForPlugin(pluginId, tabId);
    if (viewKey === null) continue;
    for (const listener of [...listeners]) listener({ viewKey, url });
  }
}

function ensureDesktopSubscription(desktopBrowser: BbDesktopBrowserApi): void {
  if (desktopSubscription?.desktopBrowser === desktopBrowser) return;
  desktopSubscription?.unsubscribe();
  const unsubscribe = desktopBrowser.onScopedOpenTab?.(dispatch);
  desktopSubscription = unsubscribe === undefined ? null : { desktopBrowser, unsubscribe };
}

function releaseDesktopSubscriptionIfUnused(): void {
  if (listenersByPlugin.size > 0) return;
  desktopSubscription?.unsubscribe();
  desktopSubscription = null;
}

export function hasPluginOpenTabListener(pluginId: string): boolean {
  return (listenersByPlugin.get(pluginId)?.size ?? 0) > 0;
}

export function addPluginOpenTabListener({
  desktopBrowser,
  pluginId,
  listener,
}: {
  desktopBrowser: BbDesktopBrowserApi | null;
  pluginId: string;
  listener: OpenTabListener;
}): () => void {
  if (desktopBrowser === null || desktopBrowser.onScopedOpenTab === undefined) {
    return () => {};
  }
  const listeners = listenersByPlugin.get(pluginId) ?? new Set<OpenTabListener>();
  listeners.add(listener);
  listenersByPlugin.set(pluginId, listeners);
  ensureDesktopSubscription(desktopBrowser);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByPlugin.delete(pluginId);
    releaseDesktopSubscriptionIfUnused();
  };
}
