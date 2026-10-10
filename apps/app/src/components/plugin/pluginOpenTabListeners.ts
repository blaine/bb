import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type { ExperimentalBrowserViewsOpenTabRequest } from "@get-bb/plugin-sdk";
import {
  isValidPluginBrowserViewKey,
  pluginBrowserViewOwnerId,
} from "@/components/browser/plugin-browser-view-ids";

type OpenTabListener = (request: ExperimentalBrowserViewsOpenTabRequest) => void;

interface Registration {
  listener: OpenTabListener;
}

const registrationsByPlugin = new Map<string, Set<Registration>>();
let desktopSubscription: {
  desktopBrowser: BbDesktopBrowserApi;
  unsubscribe: () => void;
} | null = null;

function viewKeyForPlugin(pluginId: string, tabId: string): string | null {
  const prefix = `${pluginBrowserViewOwnerId(pluginId)}:`;
  if (!tabId.startsWith(prefix)) return null;
  const viewKey = tabId.slice(prefix.length);
  return isValidPluginBrowserViewKey(viewKey) ? viewKey : null;
}

function dispatch({ tabId, url }: { tabId: string; url: string }): void {
  for (const [pluginId, registrations] of registrationsByPlugin) {
    const viewKey = viewKeyForPlugin(pluginId, tabId);
    if (viewKey === null) continue;
    for (const registration of [...registrations]) {
      if (registrations.has(registration)) registration.listener({ viewKey, url });
    }
  }
}

function ensureDesktopSubscription(desktopBrowser: BbDesktopBrowserApi): void {
  if (desktopSubscription?.desktopBrowser === desktopBrowser) return;
  desktopSubscription?.unsubscribe();
  const unsubscribe = desktopBrowser.onScopedOpenTab?.(dispatch);
  desktopSubscription =
    unsubscribe === undefined ? null : { desktopBrowser, unsubscribe };
}

function releaseDesktopSubscriptionIfUnused(): void {
  if (registrationsByPlugin.size > 0) return;
  desktopSubscription?.unsubscribe();
  desktopSubscription = null;
}

export function hasPluginOpenTabListener(pluginId: string): boolean {
  return (registrationsByPlugin.get(pluginId)?.size ?? 0) > 0;
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
  const registrations =
    registrationsByPlugin.get(pluginId) ?? new Set<Registration>();
  const registration: Registration = { listener };
  registrations.add(registration);
  registrationsByPlugin.set(pluginId, registrations);
  ensureDesktopSubscription(desktopBrowser);
  return () => {
    if (!registrations.delete(registration)) return;
    if (
      registrations.size === 0 &&
      registrationsByPlugin.get(pluginId) === registrations
    ) {
      registrationsByPlugin.delete(pluginId);
    }
    releaseDesktopSubscriptionIfUnused();
  };
}

export function clearPluginOpenTabListeners(pluginId: string): void {
  const registrations = registrationsByPlugin.get(pluginId);
  if (registrations === undefined) return;
  registrations.clear();
  registrationsByPlugin.delete(pluginId);
  releaseDesktopSubscriptionIfUnused();
}
