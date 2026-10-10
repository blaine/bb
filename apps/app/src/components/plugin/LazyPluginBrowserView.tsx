import type { ExperimentalBrowserViewProps } from "@get-bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";
import { defineSplit } from "@/lib/define-split";

export const LazyPluginBrowserView = defineSplit<ExperimentalBrowserViewProps>({
  id: "plugin-browser-view",
  tier: "intent",
  load: () =>
    import("./PluginBrowserView").then((module) => module.PluginBrowserView),
  loading: ({ className }) => (
    <div
      className={cn("flex h-full min-h-0 flex-col", className)}
      aria-busy="true"
    />
  ),
});
