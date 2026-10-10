import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import {
  destroyPersistedBrowserView,
  destroyPersistedBrowserViewsForThread,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { bumpBrowserViewGeneration } from "./browserViewMounts";

const PLUGIN_BROWSER_VIEW_KEY_PATTERN = /^[A-Za-z0-9_:.-]{1,128}$/u;

interface PluginBrowserViewIdArgs {
  pluginId: string;
  viewKey: string;
}

interface ClosePluginBrowserViewArgs extends PluginBrowserViewIdArgs {
  desktopBrowser: BbDesktopBrowserApi | null;
}

interface ClosePluginBrowserViewsArgs {
  desktopBrowser: BbDesktopBrowserApi | null;
  pluginId: string;
}

export function isValidPluginBrowserViewKey(viewKey: string): boolean {
  return PLUGIN_BROWSER_VIEW_KEY_PATTERN.test(viewKey);
}

export function pluginBrowserViewOwnerId(pluginId: string): string {
  return `plugin-view:${pluginId}`;
}

export function pluginBrowserViewId({
  pluginId,
  viewKey,
}: PluginBrowserViewIdArgs): string {
  return `${pluginBrowserViewOwnerId(pluginId)}:${viewKey}`;
}

export function closePluginBrowserView({
  desktopBrowser,
  pluginId,
  viewKey,
}: ClosePluginBrowserViewArgs): boolean {
  if (desktopBrowser === null || !isValidPluginBrowserViewKey(viewKey)) {
    return false;
  }
  const viewId = pluginBrowserViewId({ pluginId, viewKey });
  destroyPersistedBrowserView({ desktopBrowser, tabId: viewId });
  bumpBrowserViewGeneration(viewId);
  return true;
}

export function closePluginBrowserViews({
  desktopBrowser,
  pluginId,
}: ClosePluginBrowserViewsArgs): void {
  destroyPersistedBrowserViewsForThread({
    desktopBrowser,
    threadId: pluginBrowserViewOwnerId(pluginId),
  });
}
