import { useMemo } from "react";
import type { ExperimentalBrowserViews } from "@get-bb/plugin-sdk";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { closePluginBrowserView } from "@/components/browser/plugin-browser-view-ids";
import { usePluginId } from "./plugin-context";

export function usePluginBrowserViews(): ExperimentalBrowserViews {
  const pluginId = usePluginId();
  return useMemo(
    () => ({
      close(viewKey: string) {
        closePluginBrowserView({
          desktopBrowser: getDesktopBrowserApi(),
          pluginId,
          viewKey,
        });
      },
    }),
    [pluginId],
  );
}
