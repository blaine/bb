# `experimental_BrowserView` — design

Date: 2026-10-09 · Status: draft for review · Fork: `blaine/bb`, branch
`feat/plugin-browser-view` (this spec and its plan are fork-only and are dropped
from any upstream PR)

## Goal

Let a plugin render bb's native in-app Browser anywhere in its own UI — in
particular the main area of a `navPanel` page — through one shared component
that bb's own right-panel Browser tab also renders through.

Motivating consumer: the Pinned Pages plugin
(`~/Code/bb-plugin-pinned-pages`) shows Gmail/PostHog full-size in its page's
main area with its own tab strip, instead of in the right panel.

Success:
- A plugin page can show a live site (e.g. Gmail) in its main area, with bb's
  browser toolbar, that survives navigating away and back without reloading.
- The right-panel Browser tab renders through the same `BrowserView`, with no
  behavior change.
- Native views never paint over bb menus/popovers or outside their slot.
- Plugin-owned views are cleaned up when the plugin is disabled or uninstalled.

## Decisions (agreed)

1. Upstream quality: follow `AGENTS.md` (core uses the same path, `experimental_`
   prefix, `docs/api_to_audit.md` entry, Plugin Guide card, one contract test
   table across every surface).
2. Approach: extract a shared `BrowserView` from `BrowserTabContent`; do not
   wrap `BrowserTabContent` as-is; no panel "full-page" option.
3. Toolbar: full bb browser chrome by default (`chrome: "full"`); plugins may
   pass `chrome: "none"`.
4. Lifetime: views stay alive (hidden) after unmount; closed on window close,
   explicit `close(viewKey)`, or plugin disable/uninstall.
5. One component = one view. No host-provided tabbed browser; plugins compose
   tabs from several `BrowserView`s (`viewKey` per tab, `onOpenTab`, `close`).

## Current state (fork @ 6d3e82f35)

- `apps/app/src/components/secondary-panel/BrowserTabContent.tsx` (~980 lines)
  renders chrome, find bar, agent-control banner, load-error/new-tab screens, the
  native-view placeholder, and the non-desktop fallback. Mounted only by
  `BrowserTabDeck.tsx` (via `LazyBrowserTabDeck`) from `ThreadDetailView`,
  `RootComposeView`, and `PluginPanelRightPanelHost`.
- Native view identity: desktop key `${hostWebContentsId}:${tabId}`; `threadId`
  is an owner tag; `attach` ignores a request whose owner differs from an
  existing entry (`apps/desktop/src/desktop-browser-view.ts` ~1188).
- Unmount hides and releases but does not detach; views persist until detached
  by `BrowserTabLifecycleObserver` (thread pages only), thread/environment
  deletion, or `releaseWindow`. Plugin-page panel tabs are never detached (leak).
- Visibility: per-deck `browserViewVisibilityCoordinator`; hidden while
  `useBrowserDimmingModal` count > 0 (only `Dialog`, image lightbox, pane
  maximize menu increment it). Popovers/menus/selects do not.
- Bounds: placeholder `getBoundingClientRect()` → `setBounds`, resynced on
  `ResizeObserver`, window resize, and `bb:browser-view-bounds-sync`. No
  move/scroll tracking; no clipping.
- New-tab links: `setWindowOpenHandler` sends `BB_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL`
  `{ tabId, url }` to the renderer; popups (`new-window`) open native popup
  windows.
- Non-thread owners are invisible to server browser services
  (`isRawThreadId` gate in `desktop-browser-broker.ts`; `requirePublicThread`).

## Design

### Shared core (`apps/app/src/components/browser/`)

- `useNativeBrowserView({ viewId, ownerId, environmentId, initialUrl, canShow, onState, onOpenTab })`:
  attach on mount (`visible: false`), never detach on unmount (hide + release
  only); bounds sync; show/hide through a visibility coordinator; state
  subscription (url, title, loading, history, load error); snapshot handling;
  scoped open-tab events for this `viewId`.
- `BrowserView` component built on the hook: optional chrome
  (`"full" | "none"`) — back/forward/reload, address bar, find, plugin toolbar
  actions, open externally; agent-control banner; load-error and new-tab
  screens; non-desktop fallback (Open in browser, Copy link; HTTP(S) only).
- `BrowserTabContent` becomes a thin wrapper keeping only panel concerns:
  `addressFocusRequest`, `onNativeFocus`, `canHandleBrowserCommands`,
  `desktopTarget`/`existingOnly` recovery, and `onUpdate` → fixed-panel tab
  state. `BrowserTabDeck` is unchanged apart from rendering the wrapper.

### SDK surface (`@get-bb/plugin-sdk/app`)

```ts
interface ExperimentalBrowserViewProps {
  viewKey: string;            // stable, plugin-chosen; [A-Za-z0-9_-:.]{1,128}
  url: string;                // http(s); used only when the view is first created
  chrome?: "full" | "none";   // default "full"
  onNavigate?: (state: { url: string; title: string | null }) => void;
  onOpenTab?: (request: { url: string }) => void;
  className?: string;
}
experimental_BrowserView: ComponentType<ExperimentalBrowserViewProps>;
experimental_useBrowserViews(): { close(viewKey: string): void };
```

- Identity: native `tabId = plugin-view:<pluginId>:<viewKey>`, owner
  `plugin-view:<pluginId>`, `environmentId = null`. Cannot collide with panel
  (`browser:…`) or thread ids.
- `url` changes after creation are ignored (the plugin navigates by changing
  `viewKey` or the user navigates); `onNavigate` reports the live URL/title.
- `onOpenTab` default (prop omitted): open the URL as a Browser tab in the
  current surface's right panel (same path as `usePanelBrowser.openInAppBrowser`);
  if the surface has no panel, follow the in-app/external link preference.
- Invalid `viewKey` or non-HTTP(S) `url`: render the fallback card with an
  error message; never throw.

### Lifecycle

- Unmount hides; view stays alive so returning is instant.
- Closed (detached) on: window close (existing `releaseWindow`);
  `experimental_useBrowserViews().close(viewKey)` (plugin-scoped — a plugin can
  only close its own `plugin-view:<pluginId>:*` views); plugin disable/uninstall
  (renderer detaches all `plugin-view:<pluginId>:*` on plugin unload).
- Fix: `PluginPanelRightPanelHost` detaches a Browser tab's view when that tab
  is closed, matching `BrowserTabLifecycleObserver` on thread pages.

### Visibility and overlays

- A view may show when: mounted, its route/pane is visible, not mid
  window-resize, slot fully within its scroll viewport, and no covering
  overlay.
- Extend the dimming counter to shared-ui popover, dropdown menu, context menu,
  select, and hover card (not tooltip). While dimmed, the view freezes to a
  snapshot `<img>` in its slot (reusing the resize-snapshot path; add an
  on-demand snapshot request if needed) instead of going blank.
- Position: also resync on ancestor scroll (capture listener) and on layout
  moves (rAF-throttled check while mounted, or IntersectionObserver +
  position compare); hide when the slot is clipped by an ancestor.
- Two mounts of the same `viewKey` in one window (split panes): the most
  recently focused mount owns the view; others render a placeholder with
  "Show here".

### Non-desktop clients

Fallback card (Open in browser, Copy link). No native view. The testing runtime
renders an inert placeholder.

### Out of scope (recorded in the audit entry)

- Agent / `bb browser` CLI visibility of plugin-owned views (server services
  are thread-scoped).
- A host-provided tabbed browser.
- Persisting plugin views across app restarts (plugins persist their own tab
  lists and recreate views from `url`).

## Testing

- One contract table (`describe.each`) over four surfaces — thread panel,
  New-thread panel, plugin page panel, plugin page main area — covering:
  attach; hide-not-detach on unmount; show only after attach; hidden under
  Dialog and each new overlay type; snapshot shown while dimmed; non-desktop
  fallback.
- Focused tests: plugin-unload cleanup; plugin-panel tab-close detach;
  `onOpenTab` routing (default panel and plugin override); two-mounts rule;
  scroll/move resync and clip-hide; `viewKey`/`url` validation; plugin-scoped
  `close`.
- Existing suites stay green: `BrowserTabContent.*.test.tsx`,
  `BrowserTabDeck*.test.ts(x)`, `browserViewVisibilityCoordinator.test.ts`,
  `usePanelBrowser.test.tsx`, `dialog.browser-dimming.test.tsx`,
  `apps/desktop/test/desktop-browser-view-manager.test.ts`,
  `packages/plugin-sdk` export parity tests,
  `apps/server/test/services/plugins/plugin-authoring-docs.test.ts`.
- All via `pnpm exec turbo run typecheck test --filter=<pkg>`.

## SDK wiring and docs

- `packages/plugin-sdk/src/app-contract.ts` (props + `PluginSdkApp` members),
  `app.ts` shims, `apps/app/src/lib/plugin-sdk-app-impl.tsx`,
  `apps/app/.ladle/plugin-sdk-app.ts`, testing runtime
  `packages/plugin-sdk/src/testing/app.tsx`.
- `docs/api_to_audit.md` entry (behavior, core callers = right-panel Browser
  tab, stabilization criteria incl. agent/CLI visibility decision).
- `plugins/plugin-api-docs/src/surfaces.ts` host-components card;
  `plugins/bb-guide/skills/bb-plugin-authoring/references/frontend-components.md`,
  `frontend-api-index.md`; `packages/plugin-sdk/README.md`;
  `packages/templates/src/templates/bb-guide-plugins.md`.

## Verification

1. Turbo typecheck + tests for affected packages.
2. `pnpm desktop:worktree` (isolated data dir/ports; installed bb keeps
   running). Install a test copy of Pinned Pages v2 there.
3. Live walkthrough with the user: Gmail in the main area with toolbar; plugin
   tab strip and new-tab links; menus/popovers over the view; leave and return
   (no reload); split panes; disable plugin (views closed); right-panel Browser
   tabs unchanged.

## Follow-ups (separate plans)

- Pinned Pages v2 (plugin repo): main-area `BrowserView` per pin with a plugin
  tab strip (pinned site first and not closable; `onOpenTab` adds tabs;
  per-pin tab list persisted by the plugin); feature-detect and fall back to
  the current right-panel behavior on stock bb.
- Switching the daily-driver bb to the fork (`pnpm desktop`), including the
  effect on enrolled machines' auto-update.
