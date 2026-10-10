# experimental_BrowserView Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a plugin render bb's native in-app browser anywhere in its UI (notably a `navPanel` page's main area) through one shared `BrowserView` that bb's own right-panel Browser tab also renders through, with views hidden under overlays, kept alive across unmounts, and cleaned up on plugin close/disable/uninstall.

**Architecture:** Extract the native-view lifecycle (attach, bounds, visibility, state, snapshots, scoped new-tab events) from `BrowserTabContent` into `useNativeBrowserView`, and the UI (chrome, find, banners, error/new-tab screens, fallback card) into `BrowserView` under `apps/app/src/components/browser/`. `BrowserTabContent` becomes a thin panel wrapper. A plugin-facing `PluginBrowserView` composes the same `BrowserView` with plugin-scoped ids (`plugin-view:<pluginId>:<viewKey>`). It is exposed as `experimental_BrowserView` / `experimental_useBrowserViews` in `@get-bb/plugin-sdk/app`. The desktop main process gains one on-demand `captureSnapshot` IPC so dimmed or clipped views freeze to an `<img>`.

**Tech Stack:** React 19, TypeScript, Jotai (dimming counter), Radix via `@bb/shared-ui`, Electron 44 `WebContentsView`, Zod (`@bb/desktop-contract`), Vitest + Testing Library (jsdom), Turbo.

**Spec:** docs/superpowers/specs/2026-10-09-plugin-browser-view-design.md

## Global Constraints

- Native identity for plugin views: `tabId = plugin-view:<pluginId>:<viewKey>`, owner (`threadId` field) `plugin-view:<pluginId>`, `environmentId = null`.
- `viewKey` must match `^[A-Za-z0-9_:.-]{1,128}$` (spec: `[A-Za-z0-9_\-:.]{1,128}`). Plugin ids match `^[a-z0-9][a-z0-9-]*$` (`packages/domain/src/plugin-id.ts:9`), so the owner prefix plus `:` scopes a plugin unambiguously.
- `chrome` defaults to `"full"`; `"none"` is the only other value.
- Unmount hides and never detaches. Detach happens only on window close (`releaseWindow`), explicit `close(viewKey)`, plugin removal from the frontend inventory, or panel Browser tab close.
- `url` is used only when the view is first created; later `url` prop changes are ignored.
- No code comments, except Plugin SDK declaration (JSDoc) comments in `packages/plugin-sdk/src/app-contract.ts`.
- New public plugin API members use the `experimental_` prefix and get a `docs/api_to_audit.md` entry and a Plugin Guide card (`plugins/plugin-api-docs/src/surfaces.ts`).
- Core uses the same path as the plugin API. One contract table (`apps/app/src/components/browser/BrowserView.surfaces.test.tsx`) runs against every surface: thread panel, New-thread panel, plugin page panel, plugin page main area.
- Build/test through Turbo: `pnpm exec turbo run <task> --filter=<pkg>` (pass file filters after `--`). Packages: `@bb/app`, `@bb/shared-ui`, `@bb/desktop`, `@bb/desktop-contract`, `@get-bb/plugin-sdk`, `bb-plugin-plugin-api-docs`, `@bb/server`.
- Generated modules (`packages/plugin-sdk/bundled-types/`, `packages/templates/src/generated/`, `packages/plugin-build/src/generated/`) are gitignored. Never commit them.
- Vitest projects come from `sharedWorkerProjects`. Restore any global you change (`Element.prototype.getBoundingClientRect`, `window.bbDesktop`, rAF spies). Never mock the DB.
- Environment: the shell is sandboxed. Commands writing under /Users/blainecook/Code need `dangerouslyDisableSandbox: true`. Use Node from `.nvmrc` (22.19.0). Run `pnpm install` once before the first Turbo command.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An overlay opens over a shown native view (the view paints above all DOM).** Dialog, Popover, DropdownMenu, ContextMenu, Select and HoverCard must hide the view; Tooltip must not; the view must return when the overlay closes. Pinned by Task 1 `overlay.browser-dimming.test.tsx` and the contract-table case "hides under an open $name and returns when it closes" (Task 2), plus "freezes to a snapshot under a dialog" (Task 3). Known gap, recorded in the audit: overlays the plugin bundles itself (its own shadcn wrappers over the shimmed Radix modules) do not count.
2. **Bad input from plugins.** Invalid `viewKey` (empty, 129 chars, spaces, `/`, non-ASCII, trailing newline), non-HTTP(S) `url` (`javascript:`, `file:`, junk), and `url` changing after creation. Must render an error card, never throw, never attach. Pinned by Task 4 `plugin-browser-view-ids.test.ts` and Task 5 `PluginBrowserView.test.tsx` ("renders an error card…", "ignores url changes…").
3. **Cross-scope cleanup.** `close(viewKey)` and plugin unload must touch only `plugin-view:<pluginId>:*`. A plugin whose id is a prefix of another's (`acme` vs `acme-two`) must not leak across, and neither may panel or thread views. A bundle reload must not close views, and closing a plugin-page panel Browser tab must detach its view (the leak). Pinned by Task 4 `plugin-browser-view-ids.test.ts`, the `plugin-frontend-reload.test.ts` case, and the `PluginPanelRightPanelHost.test.tsx` case.
4. **The same `viewKey` mounted twice, and close while mounted.** Exactly one mount owns the native view and the other shows "Show here". Ownership moves on Show here, pane focus, and owner unmount. `close` on a mounted view reloads it from `url`, but `close` followed by unmount in the same handler must not bring the view back. Pinned by Task 4 `BrowserView.lifecycle.test.tsx`.
5. **Geometry.** The slot can move without resizing (sibling growth, ancestor scroll) or be partly clipped by a scroll container, including a view taller than its container. Bounds must resync, clipped views must hide (with snapshot), and they must return once they fit. Pinned by Task 3 `useNativeBrowserView.placement.test.tsx`.

## Decomposition notes

The suggested decomposition holds, with three adjustments the code forced:

- **`onOpenTab` lands in Task 2.** The prop and its hook subscription ship with the extraction, tested in `BrowserView.test.tsx`. Otherwise every later test would need a prop-signature churn. Panels pass `null` and keep routing through `usePanelBrowser`, which also serves unmounted panel tabs, so core behavior is unchanged.
- **`PluginBrowserView` lands in Task 5, not Task 4.** Task 4 owns ids, ownership, close/unload, and the panel leak, tested on `BrowserView` directly. Task 5 owns the plugin-facing component: validation fallback, default new-tab routing through `useAppNavigationHost`, and host visibility context. It is lazy-loaded to stay out of the boot bundle (`apps/app/src/bundle-budget.test.ts` guards it). Task 5 also does the SDK wiring and adds contract row 4.
- **Overlay dimming lives on the overlay roots.** Popover, DropdownMenu and Select already own `open` through `useResponsiveRoot`, including compact drawers. ContextMenu and HoverCard need small root wrappers, because their content wrappers render even while closed.

---

### Task 1: Hide native browser views under shared-ui overlays

**Files:**
- Create: `apps/app/src/test/browser-dimming-overlays.tsx`
- Create: `apps/app/src/components/ui/overlay.browser-dimming.test.tsx`
- Modify: `packages/shared-ui/src/components/ui/popover.tsx` (root `Popover`, lines 33-63)
- Modify: `packages/shared-ui/src/components/ui/dropdown-menu.tsx` (root `DropdownMenu`, lines 47-79)
- Modify: `packages/shared-ui/src/components/ui/select.tsx` (root `Select`, lines 64-135)
- Modify: `packages/shared-ui/src/components/ui/context-menu.tsx` (line 81 `const ContextMenu = ContextMenuPrimitive.Root;`)
- Modify: `packages/shared-ui/src/components/ui/hover-card.tsx` (line 6 `const HoverCard = HoverCardPrimitive.Root;`)
- Test (stays green): `apps/app/src/components/ui/dialog.browser-dimming.test.tsx`, `apps/app/src/views/thread-detail/PaneMaximizeButton.test.tsx`, `apps/app/src/components/ui/select.test.tsx`

**Interfaces:**
- Consumes: `useBrowserDimmingModal(active: boolean): void` from `packages/shared-ui/src/hooks/useBrowserDimmingModal.ts`, which is redirected inside the app to `apps/app/src/hooks/useBrowserDimmingModal.ts` by `apps/app/vite-shared-ui-seam.ts` (regex `(^|\/)hooks\/useBrowserDimmingModal(\.js)?$`).
- Produces: `interface BrowserDimmingOverlayCase { name: string; element: (open: boolean) => ReactElement }`, `DIALOG_OVERLAY: BrowserDimmingOverlayCase`, `BROWSER_DIMMING_OVERLAYS: readonly BrowserDimmingOverlayCase[]` (test helper used by Tasks 2-3).

- [ ] **Step 1: Write the overlay helper and the failing test**

`apps/app/src/test/browser-dimming-overlays.tsx`:

```tsx
import { useEffect, useRef, type ReactElement } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { Dialog, DialogContent, DialogTitle } from "@bb/shared-ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@bb/shared-ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@bb/shared-ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";

export interface BrowserDimmingOverlayCase {
  name: string;
  element: (open: boolean) => ReactElement;
}

function ContextMenuOpenedOnMount() {
  const triggerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    triggerRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 4,
        clientY: 4,
      }),
    );
  }, []);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span ref={triggerRef}>Context target</span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>Copy</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const DIALOG_OVERLAY: BrowserDimmingOverlayCase = {
  name: "Dialog",
  element: (open) => (
    <Dialog open={open}>
      <DialogContent>
        <DialogTitle>Overlay dialog</DialogTitle>
      </DialogContent>
    </Dialog>
  ),
};

export const BROWSER_DIMMING_OVERLAYS: readonly BrowserDimmingOverlayCase[] = [
  DIALOG_OVERLAY,
  {
    name: "Popover",
    element: (open) => (
      <Popover open={open}>
        <PopoverTrigger>Popover trigger</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>
    ),
  },
  {
    name: "DropdownMenu",
    element: (open) => (
      <DropdownMenu open={open}>
        <DropdownMenuTrigger>Menu trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Menu item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
  {
    name: "ContextMenu",
    element: (open) =>
      open ? <ContextMenuOpenedOnMount /> : <span>Context target</span>,
  },
  {
    name: "Select",
    element: (open) => (
      <Select open={open} defaultValue="a">
        <SelectTrigger aria-label="Select trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
        </SelectContent>
      </Select>
    ),
  },
  {
    name: "HoverCard",
    element: (open) => (
      <HoverCard open={open}>
        <HoverCardTrigger>Hover trigger</HoverCardTrigger>
        <HoverCardContent>Hover body</HoverCardContent>
      </HoverCard>
    ),
  },
];
```

`apps/app/src/components/ui/overlay.browser-dimming.test.tsx`:

```tsx
// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";
import { BROWSER_DIMMING_OVERLAYS } from "@/test/browser-dimming-overlays";

function DimProbe() {
  return (
    <span data-testid="dim">
      {useIsBrowserDimmingModalOpen() ? "dimmed" : "clear"}
    </span>
  );
}

function dimState(): string | null {
  return screen.getByTestId("dim").textContent;
}

afterEach(cleanup);

describe.each(BROWSER_DIMMING_OVERLAYS)("$name", (overlay) => {
  it("dims the in-app browser only while open", async () => {
    const view = render(
      <>
        {overlay.element(false)}
        <DimProbe />
      </>,
    );
    expect(dimState()).toBe("clear");

    view.rerender(
      <>
        {overlay.element(true)}
        <DimProbe />
      </>,
    );
    await waitFor(() => expect(dimState()).toBe("dimmed"));

    view.rerender(
      <>
        {overlay.element(false)}
        <DimProbe />
      </>,
    );
    await waitFor(() => expect(dimState()).toBe("clear"));
  });
});

it("stops dimming when Escape closes a context menu", async () => {
  render(
    <>
      <ContextMenu>
        <ContextMenuTrigger>Target</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Copy</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <DimProbe />
    </>,
  );
  fireEvent.contextMenu(screen.getByText("Target"));
  await waitFor(() => expect(dimState()).toBe("dimmed"));
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  await waitFor(() => expect(dimState()).toBe("clear"));
});

it("never dims the in-app browser for a tooltip", async () => {
  render(
    <>
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Tip</TooltipTrigger>
          <TooltipContent>Hint</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DimProbe />
    </>,
  );
  await screen.findAllByText("Hint");
  expect(dimState()).toBe("clear");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/ui/overlay.browser-dimming.test.tsx`
Expected: FAIL. The Popover, DropdownMenu, ContextMenu, Select and HoverCard rows (and the Escape case) time out with `expected 'clear' to be 'dimmed'`. The Dialog row and the Tooltip case pass.

- [ ] **Step 3: Implement root-level dimming in shared-ui**

In each of `popover.tsx`, `dropdown-menu.tsx`, `select.tsx`, `context-menu.tsx`, `hover-card.tsx`, add:

```ts
import { useBrowserDimmingModal } from "../../hooks/useBrowserDimmingModal";
```

`popover.tsx`: in `function Popover`, immediately after `const ctx = useResponsiveRoot(controlledOpen, controlledOnChange, defaultOpen);` (before `if (ctx.isCompactViewport)`), add:

```ts
  useBrowserDimmingModal(ctx.open);
```

`dropdown-menu.tsx`: in `function DropdownMenu`, immediately after its `const ctx = useResponsiveRoot(...)`, add the same line.

`select.tsx`: in `function Select`, immediately after `const { isCompactViewport, open, onOpenChange } = overlay;` (line 93), add:

```ts
  useBrowserDimmingModal(open);
```

`context-menu.tsx`: replace line 81 `const ContextMenu = ContextMenuPrimitive.Root;` with:

```tsx
function ContextMenu({
  onOpenChange,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  const [open, setOpen] = React.useState(false);
  useBrowserDimmingModal(open);
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  return (
    <ContextMenuPrimitive.Root {...props} onOpenChange={handleOpenChange} />
  );
}
```

`hover-card.tsx`: replace line 6 `const HoverCard = HoverCardPrimitive.Root;` with:

```tsx
function HoverCard({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  useBrowserDimmingModal(open);
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  return (
    <HoverCardPrimitive.Root
      {...props}
      open={open}
      onOpenChange={handleOpenChange}
    />
  );
}
```

Leave `tooltip.tsx` untouched.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/ui/overlay.browser-dimming.test.tsx src/components/ui/dialog.browser-dimming.test.tsx src/components/ui/select.test.tsx src/views/thread-detail/PaneMaximizeButton.test.tsx`
Expected: PASS.
Run: `pnpm exec turbo run typecheck --filter=@bb/shared-ui --filter=@bb/app`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/test/browser-dimming-overlays.tsx apps/app/src/components/ui/overlay.browser-dimming.test.tsx packages/shared-ui/src/components/ui/popover.tsx packages/shared-ui/src/components/ui/dropdown-menu.tsx packages/shared-ui/src/components/ui/select.tsx packages/shared-ui/src/components/ui/context-menu.tsx packages/shared-ui/src/components/ui/hover-card.tsx
git commit -m "Hide native browser views under shared-ui popovers, menus, selects, and hover cards" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Extract `useNativeBrowserView` and `BrowserView`; start the surface contract table

**Files:**
- Create: `apps/app/src/test/recording-desktop-browser-api.ts`
- Create: `apps/app/src/components/browser/browserViewPlacement.ts`
- Create: `apps/app/src/components/browser/useNativeBrowserView.ts`
- Create: `apps/app/src/components/browser/BrowserViewFallbackCard.tsx`
- Create: `apps/app/src/components/browser/BrowserView.tsx`
- Create: `apps/app/src/components/browser/BrowserView.test.tsx`
- Create: `apps/app/src/components/browser/BrowserView.surfaces.test.tsx`
- Modify: `apps/app/src/components/secondary-panel/BrowserTabContent.tsx` (rewrite as wrapper; all 980 lines replaced)
- Modify: `apps/app/src/components/secondary-panel/BrowserTabDeck.tsx` (`BrowserTabElsewhere`, lines 294-370, plus the imports it alone used)
- Tests that must stay green (they prove no behavior change): `BrowserTabContent.chrome.test.tsx`, `BrowserTabContent.find.test.tsx`, `BrowserTabDeck.browser-view-ordering.test.tsx`, `BrowserTabDeck.test.ts`, `browserViewVisibilityCoordinator.test.ts`, `usePanelBrowser.test.tsx`, `lazySecondaryPanelComponents.test.tsx` (all in `apps/app/src/components/secondary-panel/`).

**Interfaces:**
- Consumes: `BbDesktopBrowserApi` (`packages/desktop-contract/src/browser.ts:326`); `registerBrowserView`, `takeBrowserViewRecreation`, `BrowserViewVisibilityCoordinator` (`secondary-panel/browserViewVisibilityCoordinator.ts`); `useIsBrowserDimmingModalOpen` (`apps/app/src/hooks/useBrowserDimmingModal.ts`).
- Produces:

```ts
export interface BrowserViewOpenTabRequest { url: string }
export interface UseNativeBrowserViewArgs {
  viewId: string;
  ownerId: string;
  environmentId: string | null;
  initialUrl: string;
  canShow: boolean;
  canHandleBrowserCommands: boolean;
  shouldAttachExistingOnly: () => boolean;
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  onState: (state: BbDesktopBrowserState) => void;
  onOpenTab: ((request: BrowserViewOpenTabRequest) => void) | null;
}
export interface NativeBrowserView {
  desktopBrowser: BbDesktopBrowserApi | null;
  slotRef: RefObject<HTMLDivElement | null>;
  state: BbDesktopBrowserState | null;
  control: BbDesktopBrowserControl | null;
  currentUrl: string;
  setCurrentUrl: (url: string) => void;
  snapshotUrl: string | null;
  hasPage: boolean;
  pageLoadErrorText: string | null;
  isVisible: boolean;
  isDimmed: boolean;
}
export function useNativeBrowserView(args: UseNativeBrowserViewArgs): NativeBrowserView;

export type BrowserViewChrome = "full" | "none";
export interface BrowserViewNavigation { url: string; title: string | null }
export interface BrowserViewUnavailableCopy { title: string; body: string }
export interface BrowserViewHandle { beginAddressEdit(): void; focusAddressInput(): void }
export interface BrowserViewProps {
  ref?: Ref<BrowserViewHandle>;
  viewId: string;
  ownerId: string;
  environmentId: string | null;
  initialUrl: string;
  chrome: BrowserViewChrome;
  canShow: boolean;
  canHandleBrowserCommands: boolean;
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  shouldAttachExistingOnly: () => boolean;
  unavailableCopy: BrowserViewUnavailableCopy;
  onNavigate: (navigation: BrowserViewNavigation) => void;
  onOpenTab: ((request: BrowserViewOpenTabRequest) => void) | null;
  onNativeFocus: (() => void) | null;
  className?: string;
}
export function BrowserView(props: BrowserViewProps): ReactNode;

export interface BrowserViewFallbackCardProps {
  title: string;
  body: string;
  url: string;
  onRetry: (() => void) | null;
  className?: string;
}
export function BrowserViewFallbackCard(props: BrowserViewFallbackCardProps): ReactNode;
```

`BrowserTabContentProps` (lines 63-77) and `BrowserAddressFocusRequest` (lines 79-82) keep their exact shapes.

- [ ] **Step 1: Write the recording helper, the contract table, and BrowserView unit tests**

`apps/app/src/test/recording-desktop-browser-api.ts`:

```ts
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserAttachRequest,
  BbDesktopBrowserScopedOpenTabRequest,
  BbDesktopBrowserSetBoundsRequest,
  BbDesktopBrowserSetVisibleRequest,
  BbDesktopBrowserSnapshot,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "./bb-desktop-test-utils";

export type RecordedBrowserCall =
  | { type: "attach"; request: BbDesktopBrowserAttachRequest }
  | { type: "detach"; tabId: string }
  | { type: "setBounds"; request: BbDesktopBrowserSetBoundsRequest }
  | { type: "setVisible"; request: BbDesktopBrowserSetVisibleRequest }
  | {
      type: "setVisibleWithoutFocus";
      request: BbDesktopBrowserSetVisibleRequest;
    };

export interface RecordingDesktopBrowser {
  api: BbDesktopBrowserApi;
  calls: RecordedBrowserCall[];
  attachments(): BbDesktopBrowserAttachRequest[];
  detachments(): string[];
  bounds(tabId: string): BbDesktopBrowserSetBoundsRequest["bounds"][];
  isShown(tabId: string): boolean;
  emitState(state: BbDesktopBrowserState): void;
  emitSnapshot(snapshot: BbDesktopBrowserSnapshot): void;
  emitScopedOpenTab(request: BbDesktopBrowserScopedOpenTabRequest): void;
}

const RECORDING_DESKTOP_INFO = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

export function createRecordingDesktopBrowser(): RecordingDesktopBrowser {
  const calls: RecordedBrowserCall[] = [];
  const stateListeners = new Set<(state: BbDesktopBrowserState) => void>();
  const snapshotListeners = new Set<
    (snapshot: BbDesktopBrowserSnapshot) => void
  >();
  const scopedOpenTabListeners = new Set<
    (request: BbDesktopBrowserScopedOpenTabRequest) => void
  >();
  const api: BbDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    attach(request) {
      calls.push({ type: "attach", request });
    },
    detach(tabId) {
      calls.push({ type: "detach", tabId });
    },
    setBounds(request) {
      calls.push({ type: "setBounds", request });
    },
    setVisible(request) {
      calls.push({ type: "setVisible", request });
    },
    setVisibleWithoutFocus(request) {
      calls.push({ type: "setVisibleWithoutFocus", request });
    },
    onState(listener) {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    onSnapshot(listener) {
      snapshotListeners.add(listener);
      return () => {
        snapshotListeners.delete(listener);
      };
    },
    onScopedOpenTab(listener) {
      scopedOpenTabListeners.add(listener);
      return () => {
        scopedOpenTabListeners.delete(listener);
      };
    },
  };
  return {
    api,
    calls,
    attachments: () =>
      calls.flatMap((call) => (call.type === "attach" ? [call.request] : [])),
    detachments: () =>
      calls.flatMap((call) => (call.type === "detach" ? [call.tabId] : [])),
    bounds: (tabId) =>
      calls.flatMap((call) =>
        call.type === "setBounds" && call.request.tabId === tabId
          ? [call.request.bounds]
          : [],
      ),
    isShown(tabId) {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (call === undefined || call.type === "detach") continue;
        if (call.type === "setBounds") continue;
        if (call.request.tabId === tabId) return call.request.visible;
      }
      return false;
    },
    emitState(state) {
      for (const listener of [...stateListeners]) listener(state);
    },
    emitSnapshot(snapshot) {
      for (const listener of [...snapshotListeners]) listener(snapshot);
    },
    emitScopedOpenTab(request) {
      for (const listener of [...scopedOpenTabListeners]) listener(request);
    },
  };
}

export function installRecordingDesktopBrowser(
  recording: RecordingDesktopBrowser,
): void {
  window.bbDesktop = createBbDesktopApi(RECORDING_DESKTOP_INFO, recording.api);
}
```

`apps/app/src/components/browser/BrowserView.surfaces.test.tsx`. This is the contract table; Task 3 adds a case and Task 5 adds a row:

```tsx
// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import { resetBrowserViewPersistence } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { getPluginPagePanelStateId } from "@/components/plugin/plugin-page-panel-state";
import { BROWSER_DIMMING_OVERLAYS } from "@/test/browser-dimming-overlays";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
  type RecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";

const CONTRACT_URL = "https://example.com/contract";
const SLOT_RECT = new DOMRect(12, 24, 420, 260);

interface BrowserSurfaceCase {
  name: string;
  viewId: string;
  ownerId: string;
  element: () => ReactElement;
}

function panelSurface(
  name: string,
  ownerId: string,
  environmentId: string | null,
): BrowserSurfaceCase {
  const tab: BrowserFixedPanelTab = {
    environmentId,
    id: "browser:contract",
    kind: "browser",
    title: null,
    url: CONTRACT_URL,
  };
  return {
    name,
    viewId: tab.id,
    ownerId,
    element: () => (
      <BrowserTabDeck
        browserTabs={[tab]}
        activeBrowserTabId={tab.id}
        environmentId={environmentId}
        canShowNativeBrowserView
        threadId={ownerId}
        onUpdate={() => {}}
      />
    ),
  };
}

const BROWSER_SURFACES: readonly BrowserSurfaceCase[] = [
  panelSurface("thread panel", "thr_contract", "env-contract"),
  panelSurface("New-thread panel", "thr_new_thread_contract", null),
  panelSurface(
    "plugin page panel",
    getPluginPagePanelStateId({ pluginId: "acme", panelPath: "inbox" }),
    null,
  ),
];

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => SLOT_RECT,
  });
});

afterEach(() => {
  cleanup();
  resetBrowserViewPersistence();
  window.localStorage.clear();
  delete window.bbDesktop;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

describe.each(BROWSER_SURFACES)("browser view on the $name", (surface) => {
  let browser: RecordingDesktopBrowser;

  beforeEach(() => {
    browser = createRecordingDesktopBrowser();
    installRecordingDesktopBrowser(browser);
  });

  it("attaches hidden under the surface's identity and shows only after attaching", async () => {
    render(surface.element());
    await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
    expect(browser.attachments()).toEqual([
      {
        tabId: surface.viewId,
        threadId: surface.ownerId,
        url: CONTRACT_URL,
        bounds: { x: 12, y: 24, width: 420, height: 260 },
        visible: false,
      },
    ]);
    const attachIndex = browser.calls.findIndex(
      (call) => call.type === "attach",
    );
    const showIndex = browser.calls.findIndex(
      (call) =>
        (call.type === "setVisible" ||
          call.type === "setVisibleWithoutFocus") &&
        call.request.tabId === surface.viewId &&
        call.request.visible,
    );
    expect(showIndex).toBeGreaterThan(attachIndex);
  });

  it("hides without detaching when it unmounts", async () => {
    const view = render(surface.element());
    await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
    view.unmount();
    expect(browser.isShown(surface.viewId)).toBe(false);
    expect(browser.detachments()).toEqual([]);
  });

  it.each(BROWSER_DIMMING_OVERLAYS)(
    "hides under an open $name and returns when it closes",
    async (overlay) => {
      const view = render(
        <>
          {surface.element()}
          {overlay.element(false)}
        </>,
      );
      await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
      view.rerender(
        <>
          {surface.element()}
          {overlay.element(true)}
        </>,
      );
      await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(false));
      view.rerender(
        <>
          {surface.element()}
          {overlay.element(false)}
        </>,
      );
      await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
      expect(browser.detachments()).toEqual([]);
    },
  );

  it("offers Open in browser and Copy link without the desktop app", async () => {
    delete window.bbDesktop;
    render(surface.element());
    expect(
      await screen.findByRole("button", { name: "Open in browser" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByText(CONTRACT_URL)).toBeTruthy();
  });
});
```

`apps/app/src/components/browser/BrowserView.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { BbDesktopBrowserState } from "@bb/desktop-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetBrowserViewPersistence } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";
import { BrowserView, type BrowserViewProps } from "./BrowserView";

const VIEW_ID = "plugin-view:acme:inbox";

function viewProps(overrides: Partial<BrowserViewProps> = {}): BrowserViewProps {
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
  resetBrowserViewPersistence();
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
        pageState({ tabId: "plugin-view:acme:other", url: "https://o.example/" }),
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
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" }),
    );
    expect(onOpenTab.mock.calls).toEqual([[{ url: "https://link.example/" }]]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/browser`
Expected: FAIL. `BrowserView.test.tsx` fails to import `./BrowserView`. The contract table's "offers Open in browser and Copy link…" fails on all three rows (`Unable to find role="button" and name "Open in browser"`), because `BrowserUnavailable` (`BrowserTabContent.tsx:307-327`) has no actions. The other contract cases pass against the current code; they are characterization tests for the refactor.

- [ ] **Step 3: Create `browserViewPlacement.ts` (pure move)**

Move from `BrowserTabContent.tsx` into `apps/app/src/components/browser/browserViewPlacement.ts`, verbatim:
- interfaces `BrowserViewBoundsFromElementArgs` (103-105) and `BrowserViewBoundsEqualArgs` (107-110);
- `EMPTY_BROWSER_VIEW_BOUNDS` (129-134), `roundedBoundsFromRect` (136-143), `browserViewportBounds` (145-150), `browserViewBoundsFromElement` (152-159), `browserViewBoundsEqual` (161-168).

Add `export` to `EMPTY_BROWSER_VIEW_BOUNDS`, `browserViewBoundsFromElement` and `browserViewBoundsEqual`. Imports: `import type { BbDesktopBrowserViewportBounds, BbDesktopBrowserViewBounds } from "@bb/desktop-contract"; import { clampBbDesktopBrowserViewBounds } from "@bb/desktop-contract";`.

- [ ] **Step 4: Create `useNativeBrowserView.ts`**

```ts
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  BbDesktopBrowserApi,
  BbDesktopBrowserControl,
  BbDesktopBrowserState,
  BbDesktopBrowserViewBounds,
} from "@bb/desktop-contract";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { BROWSER_VIEW_BOUNDS_SYNC_EVENT } from "@/lib/browser-view-bounds-sync";
import { useIsBrowserDimmingModalOpen } from "@/hooks/useBrowserDimmingModal";
import {
  registerBrowserView,
  type BrowserViewVisibilityCoordinator,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import {
  EMPTY_BROWSER_VIEW_BOUNDS,
  browserViewBoundsEqual,
  browserViewBoundsFromElement,
} from "./browserViewPlacement";

export interface BrowserViewOpenTabRequest {
  url: string;
}

export interface UseNativeBrowserViewArgs {
  viewId: string;
  ownerId: string;
  environmentId: string | null;
  initialUrl: string;
  canShow: boolean;
  canHandleBrowserCommands: boolean;
  shouldAttachExistingOnly: () => boolean;
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  onState: (state: BbDesktopBrowserState) => void;
  onOpenTab: ((request: BrowserViewOpenTabRequest) => void) | null;
}

export interface NativeBrowserView {
  desktopBrowser: BbDesktopBrowserApi | null;
  slotRef: RefObject<HTMLDivElement | null>;
  state: BbDesktopBrowserState | null;
  control: BbDesktopBrowserControl | null;
  currentUrl: string;
  setCurrentUrl: (url: string) => void;
  snapshotUrl: string | null;
  hasPage: boolean;
  pageLoadErrorText: string | null;
  isVisible: boolean;
  isDimmed: boolean;
}

interface AttachedBrowserViewIdentity {
  environmentId: string | null;
  ownerId: string;
  viewId: string;
}

interface SyncPlacementArgs {
  force: boolean;
}

export function useNativeBrowserView({
  viewId,
  ownerId,
  environmentId,
  initialUrl,
  canShow,
  canHandleBrowserCommands,
  shouldAttachExistingOnly,
  visibilityCoordinator,
  onState,
  onOpenTab,
}: UseNativeBrowserViewArgs): NativeBrowserView {
  const desktopBrowser = useMemo<BbDesktopBrowserApi | null>(
    () => getDesktopBrowserApi(),
    [],
  );
  const slotRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BbDesktopBrowserState | null>(null);
  const [control, setControl] = useState<BbDesktopBrowserControl | null>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [attachedIdentity, setAttachedIdentity] =
    useState<AttachedBrowserViewIdentity | null>(null);
  const initialUrlRef = useRef(initialUrl);
  const shouldAttachExistingOnlyRef = useRef(shouldAttachExistingOnly);
  shouldAttachExistingOnlyRef.current = shouldAttachExistingOnly;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const onOpenTabRef = useRef(onOpenTab);
  onOpenTabRef.current = onOpenTab;
  const hasOpenTabHandler = onOpenTab !== null;
  const lastSentBoundsRef = useRef<BbDesktopBrowserViewBounds | null>(null);

  useEffect(() => {
    let current = true;
    let receivedEvent = false;
    setControl(null);
    const accept = (next: {
      tabId: string;
      threadId: string;
      control: BbDesktopBrowserControl | null;
    }) => {
      if (current && next.tabId === viewId && next.threadId === ownerId)
        setControl(next.control);
    };
    const unsubscribe = desktopBrowser?.onControl?.((next) => {
      if (next.tabId !== viewId || next.threadId !== ownerId) return;
      receivedEvent = true;
      accept(next);
    });
    void desktopBrowser
      ?.getControl?.(viewId)
      .then((next) => {
        if (next !== null && !receivedEvent) accept(next);
      })
      .catch(() => undefined);
    return () => {
      current = false;
      unsubscribe?.();
    };
  }, [desktopBrowser, ownerId, viewId]);

  const readBounds = useCallback(() => {
    const element = slotRef.current;
    if (element === null) {
      return null;
    }
    return browserViewBoundsFromElement({ element });
  }, []);

  const sendBounds = useCallback(
    (bounds: BbDesktopBrowserViewBounds) => {
      if (desktopBrowser === null) {
        return;
      }
      lastSentBoundsRef.current = bounds;
      desktopBrowser.setBounds({ tabId: viewId, bounds });
    },
    [desktopBrowser, viewId],
  );

  const syncPlacement = useCallback(
    ({ force }: SyncPlacementArgs) => {
      const bounds = readBounds();
      if (bounds === null) {
        return;
      }
      const lastSentBounds = lastSentBoundsRef.current;
      if (
        !force &&
        lastSentBounds !== null &&
        browserViewBoundsEqual({ a: lastSentBounds, b: bounds })
      ) {
        return;
      }
      sendBounds(bounds);
    },
    [readBounds, sendBounds],
  );

  const syncBounds = useCallback(() => {
    syncPlacement({ force: true });
  }, [syncPlacement]);

  const syncBoundsIfChanged = useCallback(() => {
    syncPlacement({ force: false });
  }, [syncPlacement]);

  const syncInitialBounds = useCallback(() => {
    const bounds = readBounds();
    lastSentBoundsRef.current = bounds;
    return bounds ?? EMPTY_BROWSER_VIEW_BOUNDS;
  }, [readBounds]);

  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    const initialBounds = syncInitialBounds();
    registerBrowserView({ environmentId, tabId: viewId, threadId: ownerId });
    const attachExistingOnly = shouldAttachExistingOnlyRef.current();
    desktopBrowser.attach({
      tabId: viewId,
      threadId: ownerId,
      ...(attachExistingOnly ? { existingOnly: true } : {}),
      url: initialUrlRef.current,
      bounds: initialBounds,
      visible: false,
    });
    setAttachedIdentity({ environmentId, ownerId, viewId });
    const unsubscribeState = desktopBrowser.onState((nextState) => {
      if (nextState.tabId !== viewId) {
        return;
      }
      setState(nextState);
      setCurrentUrl(nextState.url);
      onStateRef.current(nextState);
    });
    const unsubscribeSnapshot = desktopBrowser.onSnapshot?.((snapshot) => {
      if (snapshot.tabId !== viewId) {
        return;
      }
      setSnapshotUrl(snapshot.dataUrl);
    });
    return () => {
      unsubscribeState();
      unsubscribeSnapshot?.();
      visibilityCoordinator?.release(viewId);
    };
  }, [
    desktopBrowser,
    environmentId,
    ownerId,
    syncInitialBounds,
    viewId,
    visibilityCoordinator,
  ]);

  useEffect(() => {
    if (desktopBrowser === null || !hasOpenTabHandler) {
      return;
    }
    return desktopBrowser.onScopedOpenTab?.((request) => {
      if (request.tabId !== viewId) {
        return;
      }
      onOpenTabRef.current?.({ url: request.url });
    });
  }, [desktopBrowser, hasOpenTabHandler, viewId]);

  useEffect(() => {
    const element = slotRef.current;
    if (element === null || desktopBrowser === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      syncBoundsIfChanged();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [desktopBrowser, syncBoundsIfChanged]);

  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    window.addEventListener(BROWSER_VIEW_BOUNDS_SYNC_EVENT, syncBoundsIfChanged);
    window.addEventListener("resize", syncBoundsIfChanged);
    return () => {
      window.removeEventListener(
        BROWSER_VIEW_BOUNDS_SYNC_EVENT,
        syncBoundsIfChanged,
      );
      window.removeEventListener("resize", syncBoundsIfChanged);
    };
  }, [desktopBrowser, syncBoundsIfChanged]);

  const supportsNativePaneFocus =
    desktopBrowser?.focus !== undefined &&
    desktopBrowser.onFocus !== undefined &&
    desktopBrowser.setVisibleWithoutFocus !== undefined;
  const hasPage = currentUrl.length > 0;
  const pageLoadErrorText = hasPage ? (state?.errorText ?? null) : null;
  const isDimmed = useIsBrowserDimmingModalOpen();
  const isAttached =
    attachedIdentity !== null &&
    attachedIdentity.environmentId === environmentId &&
    attachedIdentity.ownerId === ownerId &&
    attachedIdentity.viewId === viewId;
  const isVisible =
    canShow &&
    (canHandleBrowserCommands || supportsNativePaneFocus) &&
    hasPage &&
    pageLoadErrorText === null &&
    isAttached &&
    !isDimmed;

  useLayoutEffect(() => {
    if (visibilityCoordinator === null) {
      return;
    }
    if (isVisible) {
      visibilityCoordinator.show(viewId, syncBounds, { focus: false });
      return () => {
        visibilityCoordinator.hide(viewId);
      };
    }
    visibilityCoordinator.hide(viewId);
  }, [visibilityCoordinator, viewId, isVisible, syncBounds]);

  return {
    desktopBrowser,
    slotRef,
    state,
    control,
    currentUrl,
    setCurrentUrl,
    snapshotUrl,
    hasPage,
    pageLoadErrorText,
    isVisible,
    isDimmed,
  };
}
```

The behavior mapping, for reviewers: control subscription = old 419-446; bounds helpers = old 487-537; attach effect = old 539-621 minus the find-match reset, `onUpdate`, `recordVisit`, `onFindResult` and the find-stop cleanup, all of which move to `BrowserView`; ResizeObserver = old 623-635; window listeners = old 637-655; visibility = old 657-677. The `existingOnly` decision is unchanged and moves into the wrapper's `shouldAttachExistingOnly`. Only `onScopedOpenTab` is new; it is inert when `onOpenTab` is `null`.

- [ ] **Step 5: Create `BrowserViewFallbackCard.tsx`**

Move the JSX body of `BrowserTabElsewhere` (`BrowserTabDeck.tsx:303-369`) into:

```tsx
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";

export interface BrowserViewFallbackCardProps {
  title: string;
  body: string;
  url: string;
  onRetry: (() => void) | null;
  className?: string;
}

export function BrowserViewFallbackCard({
  title,
  body,
  url,
  onRetry,
  className,
}: BrowserViewFallbackCardProps) {
  const parsedUrl = URL.canParse(url) ? new URL(url) : null;
  const canOpenExternally =
    parsedUrl?.protocol === "https:" || parsedUrl?.protocol === "http:";
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center",
        className,
      )}
    >
      {/* moved verbatim from BrowserTabDeck.tsx:309-368, with copy.title -> title and copy.body -> body */}
    </div>
  );
}
```

The JSX-comment line above is a placeholder for the plan only; do not commit it. Replace it with the moved block: the `Globe` badge span; the title `div` rendering `{title}`; the body `<p>` rendering `{body}`; the `url.length > 0` truncated `<p>` with `title={url}`; and the actions `div` (Try again when `onRetry !== null`, Open in browser when `canOpenExternally`, Copy link with `successMessage: "Link copied"`).

Then in `BrowserTabDeck.tsx`, replace `BrowserTabElsewhere`'s body (lines 303-369) with:

```tsx
  const copy = BROWSER_TAB_ELSEWHERE_COPY[reason];
  return (
    <BrowserViewFallbackCard
      className="bg-sidebar"
      title={copy.title}
      body={copy.body}
      url={url}
      onRetry={onRetry}
    />
  );
```

Add `import { BrowserViewFallbackCard } from "@/components/browser/BrowserViewFallbackCard";`. Remove the deck imports that only `BrowserTabElsewhere` used: `COARSE_POINTER_TEXT_SM_CLASS`, `Button`, `Icon`, `cn`, `copyToClipboardWithToast`, `openUrlInExternalBrowser`. The ordering tests "shows a saved %s URL without offering to open it externally" and "explains that desktop tabs need the desktop app on web" (`BrowserTabDeck.browser-view-ordering.test.tsx:482-503`) prove no change.

- [ ] **Step 6: Create `BrowserView.tsx`**

Move verbatim from `BrowserTabContent.tsx` into `BrowserView.tsx` (not exported):
- `BrowserChromeProps` (84-101) and `BrowserChrome` (183-305);
- `BrowserPageLoadErrorProps` (122-127), `browserPageLoadErrorTitle` (170-181) and `BrowserPageLoadError` (329-382).

Delete `BrowserUnavailable` (307-327); the fallback card replaces it. Then add:

```tsx
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import type {
  BbDesktopBrowserFindInPageRequest,
  BbDesktopBrowserState,
} from "@bb/desktop-contract";
import { BB_DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH } from "@bb/desktop-contract";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import {
  getBrowserUrlSecurity,
  getBrowserUrlHost,
  resolveBrowserAddressInput,
} from "@/lib/browser-url";
import { useBrowserHistory } from "@/lib/browser-history";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { PluginBrowserToolbarActions } from "@/components/plugin/PluginBrowserToolbarActions";
import {
  BrowserChromeIconButton,
  BrowserFindBar,
  type BrowserFindMatches,
} from "@/components/secondary-panel/BrowserFindBar";
import { BrowserNewTabScreen } from "@/components/secondary-panel/BrowserNewTabScreen";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "@/components/secondary-panel/panelChromeClasses";
import type { BrowserViewVisibilityCoordinator } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { BrowserViewFallbackCard } from "./BrowserViewFallbackCard";
import {
  useNativeBrowserView,
  type BrowserViewOpenTabRequest,
} from "./useNativeBrowserView";

export type { BrowserViewOpenTabRequest };
export type BrowserViewChrome = "full" | "none";

export interface BrowserViewNavigation {
  url: string;
  title: string | null;
}

export interface BrowserViewUnavailableCopy {
  title: string;
  body: string;
}

export interface BrowserViewHandle {
  beginAddressEdit(): void;
  focusAddressInput(): void;
}

export interface BrowserViewProps {
  ref?: Ref<BrowserViewHandle>;
  viewId: string;
  ownerId: string;
  environmentId: string | null;
  initialUrl: string;
  chrome: BrowserViewChrome;
  canShow: boolean;
  canHandleBrowserCommands: boolean;
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  shouldAttachExistingOnly: () => boolean;
  unavailableCopy: BrowserViewUnavailableCopy;
  onNavigate: (navigation: BrowserViewNavigation) => void;
  onOpenTab: ((request: BrowserViewOpenTabRequest) => void) | null;
  onNativeFocus: (() => void) | null;
  className?: string;
}

export function BrowserView({
  ref,
  viewId,
  ownerId,
  environmentId,
  initialUrl,
  chrome,
  canShow,
  canHandleBrowserCommands,
  visibilityCoordinator,
  shouldAttachExistingOnly,
  unavailableCopy,
  onNavigate,
  onOpenTab,
  onNativeFocus,
  className,
}: BrowserViewProps) {
  const locationShortcut = useAppCommandShortcut("browser.focusLocation");
  const reloadShortcut = useAppCommandShortcut("browser.reload");
  const findShortcut = useAppCommandShortcut("browser.find");
  const addressInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const isCompactViewport = useIsCompactViewport();
  const {
    entries: recent,
    recordVisit,
    clear: clearRecent,
  } = useBrowserHistory(ownerId);
  const [addressDraft, setAddressDraft] = useState(initialUrl);
  const [isEditing, setIsEditing] = useState(false);
  const [isPageFocusPending, setIsPageFocusPending] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const isFindOpenRef = useRef(false);
  isFindOpenRef.current = isFindOpen;
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<BrowserFindMatches | null>(
    null,
  );
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const recordVisitRef = useRef(recordVisit);
  recordVisitRef.current = recordVisit;
  const lastSeenStateRef = useRef<BbDesktopBrowserState | null>(null);
  const handleState = useCallback((nextState: BbDesktopBrowserState) => {
    const lastSeenState = lastSeenStateRef.current;
    if (
      lastSeenState !== null &&
      (lastSeenState.url !== nextState.url ||
        (nextState.isLoading && !lastSeenState.isLoading))
    ) {
      setFindMatches(null);
    }
    lastSeenStateRef.current = nextState;
    onNavigateRef.current({ url: nextState.url, title: nextState.title });
    if (!nextState.isLoading && nextState.url.length > 0) {
      recordVisitRef.current({ url: nextState.url, title: nextState.title });
    }
  }, []);
  const {
    desktopBrowser,
    slotRef,
    state,
    control,
    currentUrl,
    setCurrentUrl,
    snapshotUrl,
    hasPage,
    pageLoadErrorText,
    isVisible,
    isDimmed,
  } = useNativeBrowserView({
    viewId,
    ownerId,
    environmentId,
    initialUrl,
    canShow,
    canHandleBrowserCommands,
    shouldAttachExistingOnly,
    visibilityCoordinator,
    onState: handleState,
    onOpenTab,
  });
  const hasPageLoadError = pageLoadErrorText !== null;

  useEffect(() => {
    if (desktopBrowser === null) {
      return;
    }
    const unsubscribe = desktopBrowser.onFindResult?.((result) => {
      if (result.tabId !== viewId) {
        return;
      }
      setFindMatches({
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });
    return () => {
      unsubscribe?.();
      if (isFindOpenRef.current) {
        desktopBrowser.stopFindInPage?.({
          tabId: viewId,
          action: "clearSelection",
        });
      }
    };
  }, [desktopBrowser, viewId]);

  useImperativeHandle(
    ref,
    () => ({
      beginAddressEdit() {
        setAddressDraft(currentUrl);
        setIsEditing(true);
        addressInputRef.current?.focus({ preventScroll: true });
      },
      focusAddressInput() {
        addressInputRef.current?.focus({ preventScroll: true });
      },
    }),
    [currentUrl],
  );
```

Continue the body with old blocks moved in order, applying these renames everywhere: `tabId → viewId`, `threadId → ownerId`, `canShowNativeBrowserView → canShow`, `isBrowserDimmingModalOpen → isDimmed`, `isViewVisible → isVisible`.
- old 679-702 (`isPageFocusPending` layout effect);
- old 704-711 (`onFocus` effect), with the guard changed to `if (desktopBrowser?.onFocus === undefined || onNativeFocus === null) return;`;
- old 741-787 (`navigateToInput`, `handleAddressSubmit`, `handleAddressFocus`, `handleReloadOrStop`, `handleFocusLocation`), with `handleFocusLocation`'s guard changed to `if (chrome === "none" || !canHandleBrowserCommands || desktopBrowser === null) return false;`;
- old 789 (`useAppCommandHandler("browser.focusLocation", …, 100)`);
- old 791-795 (`canFindInPage`), with `chrome === "full" &&` prefixed;
- old 797-877 (find handlers, find effect, reload command, `handleOpenExternal`).

Old 713-739 (the address-focus-request effect) does **not** move; the wrapper owns it.

Finish with the render:

```tsx
  if (desktopBrowser === null) {
    return (
      <BrowserViewFallbackCard
        className={cn("h-full", className)}
        title={unavailableCopy.title}
        body={unavailableCopy.body}
        url={currentUrl}
        onRetry={null}
      />
    );
  }

  return (
    <div
      data-app-browser
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      {chrome === "full" ? (
        <BrowserChrome
          addressDraft={addressDraft}
          isEditing={isEditing}
          state={state}
          currentUrl={currentUrl}
          addressInputRef={addressInputRef}
          onAddressChange={setAddressDraft}
          onAddressFocus={handleAddressFocus}
          onAddressBlur={() => setIsEditing(false)}
          onSubmit={handleAddressSubmit}
          onBack={() => {
            desktopBrowser.goBack(viewId);
          }}
          onForward={() => {
            desktopBrowser.goForward(viewId);
          }}
          onReloadOrStop={handleReloadOrStop}
          onOpenExternal={handleOpenExternal}
          locationShortcut={locationShortcut}
          reloadShortcut={reloadShortcut}
          pluginActions={
            <PluginBrowserToolbarActions
              threadId={ownerId}
              tabId={viewId}
              url={currentUrl}
              isCompactViewport={isCompactViewport}
            />
          }
        />
      ) : null}
      {/* old 914-952 verbatim (control banner, find bar) with tabId -> viewId */}
      <div
        ref={slotRef}
        data-browser-view-slot=""
        className="relative min-h-0 flex-1"
      >
        {hasPageLoadError ? (
          <BrowserPageLoadError
            errorText={pageLoadErrorText}
            onOpenExternal={handleOpenExternal}
            onRetry={handleReloadOrStop}
            url={currentUrl}
          />
        ) : hasPage && !isDimmed ? null : (
          <BrowserNewTabScreen
            onNavigateInput={navigateToInput}
            recent={recent}
            onClearRecent={clearRecent}
          />
        )}
        {hasPage && snapshotUrl !== null ? (
          <img
            src={snapshotUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full"
          />
        ) : null}
      </div>
    </div>
  );
}
```

The JSX-comment line is a plan placeholder; replace it with old lines 914-952 and do not commit a comment. `setCurrentUrl` is used by the moved `navigateToInput`. `ReactNode` and `RefObject` are used by the moved `BrowserChromeProps`.

- [ ] **Step 7: Rewrite `BrowserTabContent.tsx` as the panel wrapper**

Replace the whole file with:

```tsx
import { useCallback, useEffect, useRef } from "react";
import type { BbDesktopBrowserTarget } from "@bb/desktop-contract";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  BrowserView,
  type BrowserViewHandle,
  type BrowserViewNavigation,
} from "@/components/browser/BrowserView";
import {
  takeBrowserViewRecreation,
  type BrowserViewVisibilityCoordinator,
} from "./browserViewVisibilityCoordinator";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";

interface BrowserTabContentProps {
  tabId: string;
  desktopTarget?: BbDesktopBrowserTarget;
  existingOnly?: true;
  initialUrl: string;
  addressFocusRequest: BrowserAddressFocusRequest | null;
  onAddressFocusRequestConsumed?: (request: BrowserAddressFocusRequest) => void;
  canShowNativeBrowserView: boolean;
  canHandleBrowserCommands?: boolean;
  onNativeFocus?: () => void;
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  environmentId: string | null;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
}

export interface BrowserAddressFocusRequest {
  requestId: number;
  tabId: string;
}

const PANEL_BROWSER_UNAVAILABLE_COPY = {
  title: "Browser tabs need the desktop app",
  body: "The in-app web browser runs in the bb desktop app. Open this thread there to browse the web.",
};

export function BrowserTabContent({
  tabId,
  desktopTarget,
  existingOnly,
  initialUrl,
  addressFocusRequest,
  onAddressFocusRequestConsumed,
  canShowNativeBrowserView,
  canHandleBrowserCommands = canShowNativeBrowserView,
  onNativeFocus,
  visibilityCoordinator,
  environmentId,
  threadId,
  onUpdate,
}: BrowserTabContentProps) {
  const browserViewRef = useRef<BrowserViewHandle>(null);
  const isPointerCoarse = usePointerCoarse();
  const existingOnlyRef = useRef(existingOnly);
  const desktopTargetRef = useRef(desktopTarget);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const shouldAttachExistingOnly = useCallback(() => {
    const target = desktopTargetRef.current;
    return (
      existingOnlyRef.current === true &&
      (target === undefined || !takeBrowserViewRecreation(tabId, target))
    );
  }, [tabId]);

  const handleNavigate = useCallback(
    ({ url, title }: BrowserViewNavigation) => {
      onUpdateRef.current({ tabId, url, title });
    },
    [tabId],
  );

  useEffect(() => {
    if (addressFocusRequest === null || addressFocusRequest.tabId !== tabId) {
      return;
    }
    if (isPointerCoarse) {
      onAddressFocusRequestConsumed?.(addressFocusRequest);
      return;
    }
    browserViewRef.current?.beginAddressEdit();
    const frame = requestAnimationFrame(() => {
      browserViewRef.current?.focusAddressInput();
      onAddressFocusRequestConsumed?.(addressFocusRequest);
    });
    return () => cancelAnimationFrame(frame);
  }, [addressFocusRequest, isPointerCoarse, onAddressFocusRequestConsumed, tabId]);

  return (
    <BrowserView
      ref={browserViewRef}
      viewId={tabId}
      ownerId={threadId}
      environmentId={environmentId}
      initialUrl={initialUrl}
      chrome="full"
      canShow={canShowNativeBrowserView}
      canHandleBrowserCommands={canHandleBrowserCommands}
      visibilityCoordinator={visibilityCoordinator}
      shouldAttachExistingOnly={shouldAttachExistingOnly}
      unavailableCopy={PANEL_BROWSER_UNAVAILABLE_COPY}
      onNavigate={handleNavigate}
      onOpenTab={null}
      onNativeFocus={onNativeFocus ?? null}
    />
  );
}
```

`BrowserTabDeck` keeps rendering `BrowserTabContent` (`BrowserTabDeck.tsx:247-265`) unchanged. `usePanelBrowser.ts:9` keeps importing `BrowserAddressFocusRequest` from here.

- [ ] **Step 8: Run the new and existing browser suites**

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/browser src/components/secondary-panel src/components/ui/dialog.browser-dimming.test.tsx`
Expected: PASS. That covers the new contract table (3 rows), `BrowserView.test.tsx`, and every existing listed suite.
Run: `pnpm exec turbo run typecheck --filter=@bb/app`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/components/browser apps/app/src/test/recording-desktop-browser-api.ts apps/app/src/components/secondary-panel/BrowserTabContent.tsx apps/app/src/components/secondary-panel/BrowserTabDeck.tsx
git commit -m "Extract BrowserView and useNativeBrowserView from BrowserTabContent" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Snapshot while dimmed or clipped; resync on scroll and layout moves; hide when clipped

**Files:**
- Modify: `packages/desktop-contract/src/browser.ts` (`BbDesktopBrowserApi`, after `onSnapshot?` at line 360)
- Modify: `apps/desktop/src/desktop-browser-ipc.ts` (new channel constant)
- Modify: `apps/desktop/src/desktop-browser-main-ipc.ts` (register the channel)
- Modify: `apps/desktop/src/preload.ts` (browser API object near lines 330-370)
- Modify: `apps/desktop/src/desktop-browser-view.ts` (interface 290-322, `startResizeSnapshot` 538-564, returned manager object 1184+)
- Modify: `apps/desktop/test/desktop-browser-view-manager.test.ts`, `apps/desktop/test/desktop-browser-main-ipc.test.ts`, `apps/desktop/test/preload-browser-api.test.ts`
- Modify: `apps/app/src/components/browser/browserViewPlacement.ts`, `useNativeBrowserView.ts`, `BrowserView.tsx`
- Modify: `apps/app/src/test/recording-desktop-browser-api.ts`
- Create: `apps/app/src/components/browser/useNativeBrowserView.placement.test.tsx`
- Modify: `apps/app/src/components/browser/BrowserView.surfaces.test.tsx` (add the snapshot case)

**Interfaces:**
- Produces (contract): `BbDesktopBrowserApi.captureSnapshot?(tabId: string): void`.
- Produces (desktop): `BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL = "bb-desktop:browser:capture-snapshot"` (payload `bbDesktopBrowserTabRefSchema`). `DesktopBrowserViewManager.captureSnapshot(args: HostScopedTabArgs): void` sends `BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL { tabId, dataUrl }` only if the entry is still hidden when the capture resolves.
- Produces (app): `interface BrowserViewPlacement { bounds: BbDesktopBrowserViewBounds; clipped: boolean }` and `readBrowserViewPlacement(element: HTMLElement): BrowserViewPlacement`. These replace `browserViewBoundsFromElement`.

- [ ] **Step 1: Write failing desktop tests**

In `apps/desktop/test/desktop-browser-view-manager.test.ts`, inside `describe("DesktopBrowserViewManager")` after the "keeps hidden views hidden and untouched across a resize burst" test (~3444-3477):

```ts
  it("captures an on-demand snapshot of a hidden view and drops one that resolves after it shows again", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 52,
    });
    const tabId = "plugin-view:acme:inbox";
    manager.attach({
      hostWindow,
      request: {
        threadId: "plugin-view:acme",
        tabId,
        url: "",
        bounds: { x: 0, y: 0, width: 500, height: 350 },
        visible: true,
      },
    });
    const view = electronMock.fakeViews[0];
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.captureSnapshot({ hostWindow, tabId });
    manager.setVisible({ hostWindow, request: { tabId, visible: false } });
    await settlePendingCaptures(view);
    expect(snapshotPushesOf(hostWindow)).toEqual([
      {
        tabId,
        dataUrl: `data:image/jpeg;base64,${Buffer.from("jpeg-bytes").toString("base64")}`,
      },
    ]);

    manager.captureSnapshot({ hostWindow, tabId });
    manager.setVisible({ hostWindow, request: { tabId, visible: true } });
    await settlePendingCaptures(view);
    expect(snapshotPushesOf(hostWindow)).toHaveLength(1);
  });
```

In `apps/desktop/test/desktop-browser-main-ipc.test.ts`:
- import `BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL`;
- in `RecordingDesktopBrowserViewManager`, add `public readonly captureSnapshotCalls: TabCommandCall[] = [];` and `captureSnapshot(args: TabCommandCall): void { this.captureSnapshotCalls.push(args); }`;
- add this test:

```ts
  it("dispatches validated snapshot requests only from BrowserWindow-owned senders", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL,
      payload: { tabId: "plugin-view:acme:inbox" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL,
      payload: { tabId: "" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL,
      payload: { tabId: "plugin-view:acme:inbox" },
      sender: createUntrustedSender(),
    });
    expect(manager.captureSnapshotCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "plugin-view:acme:inbox" },
    ]);
  });
```

In `apps/desktop/test/preload-browser-api.test.ts`, in "exposes only the typed browser commands and forwards them over fixed channels" (213-363):
- add `"captureSnapshot"` to the sorted key list between `"attach"` and `"detach"`;
- add `api.browser.captureSnapshot?.("browser:a");` right after `api.browser.stopFindInPage?.(stopFindRequest);`;
- add `{ channel: BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL, payload: { tabId: "browser:a" } },` to `expect(electronMock.sendCalls)` right after the `BB_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL` entry;
- import the constant from `../src/desktop-browser-ipc.js`.

- [ ] **Step 2: Write failing app tests**

Recording helper (`apps/app/src/test/recording-desktop-browser-api.ts`): add `| { type: "captureSnapshot"; tabId: string }` to `RecordedBrowserCall` and `snapshotRequests(): string[];` to `RecordingDesktopBrowser`. Add `captureSnapshot(tabId) { calls.push({ type: "captureSnapshot", tabId }); },` to `api`. Add `snapshotRequests: () => calls.flatMap((call) => (call.type === "captureSnapshot" ? [call.tabId] : [])),` to the returned object. In `isShown`, also `continue` when `call.type === "captureSnapshot"`.

Contract case in `BrowserView.surfaces.test.tsx`: add `act` to the testing-library import and `import { DIALOG_OVERLAY } from "@/test/browser-dimming-overlays";`. Then add inside the `describe.each`:

```tsx
  it("freezes to a snapshot under a dialog and drops it when the page returns", async () => {
    const snapshot = "data:image/jpeg;base64,c25hcHNob3Q=";
    const view = render(
      <>
        {surface.element()}
        {DIALOG_OVERLAY.element(false)}
      </>,
    );
    await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
    view.rerender(
      <>
        {surface.element()}
        {DIALOG_OVERLAY.element(true)}
      </>,
    );
    await waitFor(() =>
      expect(browser.snapshotRequests()).toEqual([surface.viewId]),
    );
    act(() => browser.emitSnapshot({ tabId: surface.viewId, dataUrl: snapshot }));
    expect(document.querySelector(`img[src="${snapshot}"]`)).not.toBeNull();
    view.rerender(
      <>
        {surface.element()}
        {DIALOG_OVERLAY.element(false)}
      </>,
    );
    await waitFor(() => expect(browser.isShown(surface.viewId)).toBe(true));
    expect(document.querySelector(`img[src="${snapshot}"]`)).toBeNull();
  });
```

`apps/app/src/components/browser/useNativeBrowserView.placement.test.tsx`:

```tsx
// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserViewVisibilityCoordinator,
  resetBrowserViewPersistence,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { DIALOG_OVERLAY } from "@/test/browser-dimming-overlays";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
  type RecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";
import { BrowserView } from "./BrowserView";

const VIEW_ID = "plugin-view:acme:inbox";
const SNAPSHOT = "data:image/jpeg;base64,c25hcHNob3Q=";
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
const pendingFrames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;
const rects = {
  slot: new DOMRect(0, 0, 400, 200),
  scroller: new DOMRect(0, 0, 500, 300),
};

function flushFrames(): void {
  act(() => {
    const queued = [...pendingFrames.values()];
    pendingFrames.clear();
    for (const callback of queued) callback(performance.now());
  });
}

function ScrolledView({
  browser,
  dialogOpen,
}: {
  browser: RecordingDesktopBrowser;
  dialogOpen: boolean;
}) {
  const [coordinator] = useState(() =>
    createBrowserViewVisibilityCoordinator(browser.api),
  );
  return (
    <>
      <div data-testid="scroller" style={{ overflow: "auto" }}>
        <BrowserView
          viewId={VIEW_ID}
          ownerId="plugin-view:acme"
          environmentId={null}
          initialUrl="https://mail.example/"
          chrome="none"
          canShow
          canHandleBrowserCommands
          visibilityCoordinator={coordinator}
          shouldAttachExistingOnly={() => false}
          unavailableCopy={{ title: "Needs desktop", body: "Desktop only" }}
          onNavigate={() => {}}
          onOpenTab={null}
          onNativeFocus={null}
        />
      </div>
      {DIALOG_OVERLAY.element(dialogOpen)}
    </>
  );
}

let browser: RecordingDesktopBrowser;

beforeEach(() => {
  rects.slot = new DOMRect(0, 0, 400, 200);
  rects.scroller = new DOMRect(0, 0, 500, 300);
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Element) {
      if (this.hasAttribute("data-browser-view-slot")) return rects.slot;
      if (this.getAttribute("data-testid") === "scroller") return rects.scroller;
      return new DOMRect(0, 0, 1024, 768);
    },
  });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    nextFrameId += 1;
    pendingFrames.set(nextFrameId, callback);
    return nextFrameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    pendingFrames.delete(id);
  });
  browser = createRecordingDesktopBrowser();
  installRecordingDesktopBrowser(browser);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  pendingFrames.clear();
  resetBrowserViewPersistence();
  delete window.bbDesktop;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

describe("native browser view placement", () => {
  it("requests a snapshot before hiding under a dialog and drops it when the page returns", async () => {
    const view = render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    view.rerender(<ScrolledView browser={browser} dialogOpen />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(false));
    const captureIndex = browser.calls.findIndex(
      (call) => call.type === "captureSnapshot",
    );
    const hideIndex = browser.calls.findLastIndex(
      (call) =>
        call.type === "setVisible" &&
        call.request.tabId === VIEW_ID &&
        !call.request.visible,
    );
    expect(captureIndex).toBeGreaterThanOrEqual(0);
    expect(captureIndex).toBeLessThan(hideIndex);
    act(() => browser.emitSnapshot({ tabId: VIEW_ID, dataUrl: SNAPSHOT }));
    expect(view.container.querySelector(`img[src="${SNAPSHOT}"]`)).not.toBeNull();
    view.rerender(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    expect(view.container.querySelector("img")).toBeNull();
  });

  it("resyncs bounds when an ancestor scroll moves the slot without resizing it", async () => {
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    flushFrames();
    rects.slot = new DOMRect(0, 50, 400, 200);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.bounds(VIEW_ID).at(-1)).toEqual({
      x: 0,
      y: 50,
      width: 400,
      height: 200,
    });
  });

  it("resyncs bounds when a layout change moves the slot", async () => {
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    flushFrames();
    rects.slot = new DOMRect(0, 80, 400, 200);
    await act(async () => {
      document.body.append(document.createElement("div"));
    });
    flushFrames();
    expect(browser.bounds(VIEW_ID).at(-1)).toEqual({
      x: 0,
      y: 80,
      width: 400,
      height: 200,
    });
  });

  it("hides a slot clipped by its scroll container and shows it again once it fits", async () => {
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    flushFrames();
    rects.slot = new DOMRect(0, 150, 400, 200);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(false);
    expect(browser.snapshotRequests()).toEqual([VIEW_ID]);
    rects.slot = new DOMRect(0, 100, 400, 200);
    fireEvent.scroll(screen.getByTestId("scroller"));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(true);
    expect(browser.bounds(VIEW_ID).at(-1)).toEqual({
      x: 0,
      y: 100,
      width: 400,
      height: 200,
    });
  });

  it("never shows a slot taller than its scroll container", async () => {
    rects.slot = new DOMRect(0, 0, 400, 600);
    render(<ScrolledView browser={browser} dialogOpen={false} />);
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    flushFrames();
    expect(browser.isShown(VIEW_ID)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

Run: `pnpm exec turbo run test --filter=@bb/desktop -- test/desktop-browser-view-manager.test.ts test/desktop-browser-main-ipc.test.ts test/preload-browser-api.test.ts`
Expected: FAIL. `manager.captureSnapshot is not a function`; the IPC call list is empty; the preload key list lacks `captureSnapshot`.

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/browser`
Expected: FAIL. No `captureSnapshot` calls are recorded; scroll and move cases keep the old bounds; the clip cases stay shown.

- [ ] **Step 4: Implement the desktop path**

`packages/desktop-contract/src/browser.ts`, in `BbDesktopBrowserApi` after `onSnapshot?(…)`:

```ts
  captureSnapshot?(tabId: string): void;
```

`apps/desktop/src/desktop-browser-ipc.ts`, after `BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL`:

```ts
export const BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL =
  "bb-desktop:browser:capture-snapshot";
```

`apps/desktop/src/desktop-browser-main-ipc.ts`: import the constant, then add after the `BB_DESKTOP_BROWSER_STOP_CHANNEL` registration:

```ts
  registerRequestCommand(
    BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL,
    bbDesktopBrowserTabRefSchema,
    ({ hostWindow, request }) =>
      manager.captureSnapshot({ hostWindow, tabId: request.tabId }),
  );
```

`apps/desktop/src/preload.ts`: import the constant, then add to the browser API object after `onSnapshot`:

```ts
  captureSnapshot(tabId): void {
    ipcRenderer.send(BB_DESKTOP_BROWSER_CAPTURE_SNAPSHOT_CHANNEL, { tabId });
  },
```

`apps/desktop/src/desktop-browser-view.ts`:
- add `type NativeImage` to the `electron` import;
- add `captureSnapshot(args: HostScopedTabArgs): void;` to `DesktopBrowserViewManager` after `stopFindInPage`;
- add a module-level helper before `createDesktopBrowserViewManager`:

```ts
function snapshotDataUrl(image: NativeImage): string {
  return `data:image/jpeg;base64,${image
    .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
    .toString("base64")}`;
}
```

In `startResizeSnapshot` (lines 551-554), replace the inline `const dataUrl = …` expression with `const dataUrl = snapshotDataUrl(image);`. Add to the returned manager object, after `stopFindInPage`:

```ts
    captureSnapshot({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.webContents
          .capturePage(undefined, { stayHidden: true, stayAwake: true })
          .then((image) => {
            if (
              entry.visible ||
              entry.webContents.isDestroyed() ||
              image.isEmpty()
            ) {
              return;
            }
            send(hostWindow, BB_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
              tabId,
              dataUrl: snapshotDataUrl(image),
            });
          })
          .catch(() => {});
      });
    },
```

- [ ] **Step 5: Implement placement and clipping in the app**

`browserViewPlacement.ts`: delete `BrowserViewBoundsFromElementArgs` and `browserViewBoundsFromElement`, and add:

```ts
export interface BrowserViewPlacement {
  bounds: BbDesktopBrowserViewBounds;
  clipped: boolean;
}

const BROWSER_VIEW_CLIP_TOLERANCE_PX = 1;

function clipsOverflow(element: Element): boolean {
  const style = window.getComputedStyle(element);
  const clips = (value: string) => value !== "" && value !== "visible";
  return clips(style.overflowX) || clips(style.overflowY);
}

export function readBrowserViewPlacement(
  element: HTMLElement,
): BrowserViewPlacement {
  const rect = element.getBoundingClientRect();
  let top = Number.NEGATIVE_INFINITY;
  let left = Number.NEGATIVE_INFINITY;
  let right = Number.POSITIVE_INFINITY;
  let bottom = Number.POSITIVE_INFINITY;
  for (
    let ancestor = element.parentElement;
    ancestor !== null &&
    ancestor !== document.body &&
    ancestor !== document.documentElement;
    ancestor = ancestor.parentElement
  ) {
    if (!clipsOverflow(ancestor)) continue;
    const clip = ancestor.getBoundingClientRect();
    top = Math.max(top, clip.top);
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  const clipped =
    rect.top < top - BROWSER_VIEW_CLIP_TOLERANCE_PX ||
    rect.left < left - BROWSER_VIEW_CLIP_TOLERANCE_PX ||
    rect.right > right + BROWSER_VIEW_CLIP_TOLERANCE_PX ||
    rect.bottom > bottom + BROWSER_VIEW_CLIP_TOLERANCE_PX;
  return {
    bounds: clampBbDesktopBrowserViewBounds({
      bounds: roundedBoundsFromRect(rect),
      viewport: browserViewportBounds(),
    }),
    clipped,
  };
}
```

`useNativeBrowserView.ts`:
1. Change the placement import to `{ EMPTY_BROWSER_VIEW_BOUNDS, browserViewBoundsEqual, readBrowserViewPlacement }`.
2. In `readBounds`, replace `return browserViewBoundsFromElement({ element });` with `return readBrowserViewPlacement(element).bounds;`.
3. Replace everything from `const isVisible =` through the end of the visibility `useLayoutEffect` with:

```ts
  const [isClipped, setIsClipped] = useState(false);
  const isDimmedRef = useRef(isDimmed);
  isDimmedRef.current = isDimmed;
  const isClippedRef = useRef(isClipped);
  isClippedRef.current = isClipped;
  const isPlacementTracked =
    desktopBrowser !== null &&
    canShow &&
    (canHandleBrowserCommands || supportsNativePaneFocus) &&
    hasPage &&
    pageLoadErrorText === null &&
    isAttached &&
    !isDimmed;
  const isVisible = isPlacementTracked && !isClipped;

  const checkPlacement = useCallback(() => {
    const element = slotRef.current;
    if (element === null) {
      return;
    }
    const placement = readBrowserViewPlacement(element);
    setIsClipped(placement.clipped);
    if (placement.clipped) {
      return;
    }
    const lastSentBounds = lastSentBoundsRef.current;
    if (
      lastSentBounds === null ||
      !browserViewBoundsEqual({ a: lastSentBounds, b: placement.bounds })
    ) {
      sendBounds(placement.bounds);
    }
  }, [sendBounds]);

  useEffect(() => {
    if (!isPlacementTracked) {
      return;
    }
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        checkPlacement();
      });
    };
    document.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    document.addEventListener("transitionend", schedule, true);
    document.addEventListener("animationend", schedule, true);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    schedule();
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      document.removeEventListener("transitionend", schedule, true);
      document.removeEventListener("animationend", schedule, true);
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [checkPlacement, isPlacementTracked]);

  useLayoutEffect(() => {
    if (visibilityCoordinator === null) {
      return;
    }
    if (!isVisible) {
      visibilityCoordinator.hide(viewId);
      return;
    }
    const element = slotRef.current;
    if (element !== null && readBrowserViewPlacement(element).clipped) {
      setIsClipped(true);
      return;
    }
    visibilityCoordinator.show(viewId, syncBounds, { focus: false });
    setSnapshotUrl(null);
    return () => {
      if (isDimmedRef.current || isClippedRef.current) {
        desktopBrowser?.captureSnapshot?.(viewId);
      }
      visibilityCoordinator.hide(viewId);
    };
  }, [desktopBrowser, isVisible, syncBounds, viewId, visibilityCoordinator]);
```

`BrowserView.tsx`: replace `) : hasPage && !isDimmed ? null : (` with `) : hasPage ? null : (`. A dimmed page now shows its snapshot, or the empty slot until the snapshot arrives, instead of the New Tab screen.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `pnpm exec turbo run test --filter=@bb/desktop -- test/desktop-browser-view-manager.test.ts test/desktop-browser-main-ipc.test.ts test/preload-browser-api.test.ts`
Expected: PASS.
Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/browser src/components/secondary-panel`
Expected: PASS. This includes the existing resize-snapshot desktop tests and all `BrowserTabContent` / `BrowserTabDeck` suites.
Run: `pnpm exec turbo run typecheck --filter=@bb/desktop-contract --filter=@bb/desktop --filter=@bb/app`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop-contract/src/browser.ts apps/desktop/src/desktop-browser-ipc.ts apps/desktop/src/desktop-browser-main-ipc.ts apps/desktop/src/preload.ts apps/desktop/src/desktop-browser-view.ts apps/desktop/test/desktop-browser-view-manager.test.ts apps/desktop/test/desktop-browser-main-ipc.test.ts apps/desktop/test/preload-browser-api.test.ts apps/app/src/components/browser apps/app/src/test/recording-desktop-browser-api.ts
git commit -m "Freeze browser views to a snapshot under overlays and track slot moves and clipping" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Plugin view identity, single ownership, close, unload cleanup, and the plugin-panel leak

**Files:**
- Create: `apps/app/src/components/browser/browserViewMounts.ts`
- Create: `apps/app/src/components/browser/plugin-browser-view-ids.ts`
- Create: `apps/app/src/components/browser/plugin-browser-view-ids.test.ts`
- Create: `apps/app/src/components/browser/BrowserView.lifecycle.test.tsx`
- Modify: `apps/app/src/components/browser/useNativeBrowserView.ts`, `BrowserView.tsx`
- Modify: `apps/app/src/components/browser/BrowserView.surfaces.test.tsx` (add `resetBrowserViewMountsForTest()` to `afterEach`)
- Modify: `apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx` (returned JSX, lines 1160-1170)
- Modify: `apps/app/src/components/plugin/PluginPanelRightPanelHost.test.tsx` (hoisted `browserState` line 86; `@/lib/bb-desktop` mock lines 260-263; deck mock lines 514-529; `beforeEach` ~751)
- Modify: `apps/app/src/lib/plugin-frontend.ts` (`PluginFrontendReconcileDeps` 364-380; removal loop 638-647; `browserReconcileDeps` 923-936)
- Modify: `apps/app/src/lib/plugin-frontend-reload.test.ts` (`TestReconcileDeps` 107-112, `makeDeps` 114-131, the `deps` literal at 244), `apps/app/src/lib/plugin-frontend-load-order.test.ts` (deps factory ~55-70), `apps/app/src/hooks/plugin-startup-recovery.test.ts` (deps literal ~62-75)

**Interfaces:**
- Consumes: `destroyPersistedBrowserView`, `destroyPersistedBrowserViewsForThread`, `registerBrowserView` (`secondary-panel/browserViewVisibilityCoordinator.ts`); `BrowserTabLifecycleObserver` (`secondary-panel/BrowserTabLifecycleObserver.ts`).
- Produces:

```ts
export interface BrowserViewMount { isOwner: boolean; generation: number; claim: () => void }
export function useBrowserViewMount(viewId: string): BrowserViewMount;
export function bumpBrowserViewGeneration(viewId: string): void;
export function resetBrowserViewMountsForTest(): void;

export function isValidPluginBrowserViewKey(viewKey: string): boolean;
export function pluginBrowserViewOwnerId(pluginId: string): string;
export function pluginBrowserViewId(args: { pluginId: string; viewKey: string }): string;
export function closePluginBrowserView(args: { desktopBrowser: BbDesktopBrowserApi | null; pluginId: string; viewKey: string }): boolean;
export function closePluginBrowserViews(args: { desktopBrowser: BbDesktopBrowserApi | null; pluginId: string }): void;

interface PluginFrontendReconcileDeps { /* existing fields */ closePluginBrowserViews: (pluginId: string) => void }
```

`NativeBrowserView` gains `isOwner: boolean; claim: () => void`.

- [ ] **Step 1: Write the failing tests**

`apps/app/src/components/browser/plugin-browser-view-ids.test.ts`:

```ts
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
```

`apps/app/src/components/browser/BrowserView.lifecycle.test.tsx`:

```tsx
// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBrowserViewVisibilityCoordinator,
  resetBrowserViewPersistence,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import {
  createRecordingDesktopBrowser,
  installRecordingDesktopBrowser,
  type RecordingDesktopBrowser,
} from "@/test/recording-desktop-browser-api";
import { BrowserView } from "./BrowserView";
import { resetBrowserViewMountsForTest } from "./browserViewMounts";
import {
  closePluginBrowserView,
  pluginBrowserViewId,
  pluginBrowserViewOwnerId,
} from "./plugin-browser-view-ids";

const VIEW_ID = pluginBrowserViewId({ pluginId: "acme", viewKey: "inbox" });
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
let browser: RecordingDesktopBrowser;

function PluginView() {
  const [coordinator] = useState(() =>
    createBrowserViewVisibilityCoordinator(browser.api),
  );
  return (
    <BrowserView
      viewId={VIEW_ID}
      ownerId={pluginBrowserViewOwnerId("acme")}
      environmentId={null}
      initialUrl="https://mail.example/"
      chrome="none"
      canShow
      canHandleBrowserCommands
      visibilityCoordinator={coordinator}
      shouldAttachExistingOnly={() => false}
      unavailableCopy={{ title: "Needs desktop", body: "Desktop only" }}
      onNavigate={() => {}}
      onOpenTab={null}
      onNativeFocus={null}
    />
  );
}

function TwoPanes({ showB = true }: { showB?: boolean }) {
  return (
    <>
      <div data-testid="pane-a">
        <PluginView />
      </div>
      {showB ? (
        <div data-testid="pane-b">
          <PluginView />
        </div>
      ) : null}
    </>
  );
}

function ClosingTab() {
  const [open, setOpen] = useState(true);
  return (
    <>
      {open ? <PluginView /> : null}
      <button
        type="button"
        onClick={() => {
          closePluginBrowserView({
            desktopBrowser: browser.api,
            pluginId: "acme",
            viewKey: "inbox",
          });
          setOpen(false);
        }}
      >
        Close tab
      </button>
    </>
  );
}

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
  resetBrowserViewPersistence();
  resetBrowserViewMountsForTest();
  delete window.bbDesktop;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: originalGetBoundingClientRect,
  });
});

describe("plugin browser view lifecycle", () => {
  it("lets one of two mounts own the view and moves it on Show here", async () => {
    render(<TwoPanes />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    const paneA = screen.getByTestId("pane-a");
    const paneB = screen.getByTestId("pane-b");
    expect(within(paneB).queryByRole("button", { name: "Show here" })).toBeNull();
    fireEvent.click(within(paneA).getByRole("button", { name: "Show here" }));
    await waitFor(() =>
      expect(
        within(paneB).getByRole("button", { name: "Show here" }),
      ).toBeTruthy(),
    );
    expect(within(paneA).queryByRole("button", { name: "Show here" })).toBeNull();
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    expect(browser.detachments()).toEqual([]);
  });

  it("hands the view to the remaining mount when its owner unmounts", async () => {
    const view = render(<TwoPanes />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    view.rerender(<TwoPanes showB={false} />);
    expect(
      within(screen.getByTestId("pane-a")).queryByRole("button", {
        name: "Show here",
      }),
    ).toBeNull();
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    expect(browser.detachments()).toEqual([]);
  });

  it("reloads a mounted view from its url after close", async () => {
    render(<PluginView />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    act(() => {
      closePluginBrowserView({
        desktopBrowser: browser.api,
        pluginId: "acme",
        viewKey: "inbox",
      });
    });
    await waitFor(() => expect(browser.attachments()).toHaveLength(2));
    expect(browser.detachments()).toEqual([VIEW_ID]);
    expect(browser.attachments()[1]?.url).toBe("https://mail.example/");
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
  });

  it("does not recreate a view closed and unmounted in the same handler", async () => {
    render(<ClosingTab />);
    await waitFor(() => expect(browser.isShown(VIEW_ID)).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
    await act(async () => {});
    expect(browser.detachments()).toEqual([VIEW_ID]);
    expect(browser.attachments()).toHaveLength(1);
  });
});
```

`apps/app/src/lib/plugin-frontend-reload.test.ts`:
- in `TestReconcileDeps`, add `closePluginBrowserViews: Mock<(pluginId: string) => void>;`;
- in `makeDeps`, add `closePluginBrowserViews: vi.fn(),`;
- in the `const deps: PluginFrontendReconcileDeps = {…}` literal at ~244, add `closePluginBrowserViews: () => {},`;
- after "drops registrations, CSS, and record when a plugin disappears from the inventory" (442-454), add:

```ts
  it("closes a plugin's browser views when it leaves the inventory but not when its bundle reloads", async () => {
    const state = createPluginFrontendReconcileState();
    const deps = makeDeps([candidate("hello", "v1")]);
    await reconcilePluginFrontends(state, deps);
    deps.fetchCandidates.mockResolvedValue([candidate("hello", "v2")]);
    await reconcilePluginFrontends(state, deps);
    expect(deps.closePluginBrowserViews).not.toHaveBeenCalled();
    deps.fetchCandidates.mockResolvedValue([]);
    await reconcilePluginFrontends(state, deps);
    expect(deps.closePluginBrowserViews).toHaveBeenCalledTimes(1);
    expect(deps.closePluginBrowserViews).toHaveBeenCalledWith("hello");
  });
```

Add `closePluginBrowserViews: vi.fn(),` to the deps factory in `plugin-frontend-load-order.test.ts`, and `closePluginBrowserViews: () => {},` to the deps literal in `hooks/plugin-startup-recovery.test.ts`.

`apps/app/src/components/plugin/PluginPanelRightPanelHost.test.tsx`:
- line 86 becomes `const browserState = vi.hoisted(() => ({ available: false, api: null as import("@bb/desktop-contract").BbDesktopBrowserApi | null }));`;
- the `@/lib/bb-desktop` mock's `getDesktopBrowserApi: () => null` becomes `getDesktopBrowserApi: () => browserState.api`;
- in the `BrowserTabDeck` mock, add `data-active-tab-id={activeBrowserTabId}` to the `plugin-page-browser` div;
- in `beforeEach`, add `browserState.api = null;`;
- add `import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";`;
- after "opens Browser with address focus without a plugin allowlist" (1395-1417), add:

```ts
  it("detaches a Browser tab's native view when the tab closes", async () => {
    const detach = vi.fn();
    browserState.available = true;
    browserState.api = { ...createNoopDesktopBrowserApi(), detach };
    renderHost();
    fireEvent.click(
      await screen.findByRole("button", { name: "Show right panel" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open browser" }));
    const tabId = (await screen.findByTestId("plugin-page-browser")).getAttribute(
      "data-active-tab-id",
    );
    expect(tabId).toMatch(/^browser:/u);
    expect(detach).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close Browser" }));
    await waitFor(() => expect(detach).toHaveBeenCalledWith(tabId));
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/browser src/lib/plugin-frontend-reload.test.ts src/components/plugin/PluginPanelRightPanelHost.test.tsx`
Expected: FAIL. The ids and lifecycle tests fail on missing modules. The reload test fails because `closePluginBrowserViews` was never called. The host test fails because `detach` was never called (this is the leak).

- [ ] **Step 3: Implement the mount registry**

`apps/app/src/components/browser/browserViewMounts.ts`:

```ts
import {
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

interface BrowserViewMountRecord {
  mounts: symbol[];
  claimed: symbol | null;
  generation: number;
}

export interface BrowserViewMount {
  isOwner: boolean;
  generation: number;
  claim: () => void;
}

const records = new Map<string, BrowserViewMountRecord>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function registerBrowserViewMount(viewId: string, mountId: symbol): () => void {
  const record = records.get(viewId) ?? {
    mounts: [],
    claimed: null,
    generation: 0,
  };
  record.mounts = [...record.mounts, mountId];
  record.claimed = mountId;
  records.set(viewId, record);
  emit();
  return () => {
    const current = records.get(viewId);
    if (current === undefined) return;
    current.mounts = current.mounts.filter((id) => id !== mountId);
    if (current.claimed === mountId) current.claimed = current.mounts.at(-1) ?? null;
    if (current.mounts.length === 0) records.delete(viewId);
    emit();
  };
}

function claimBrowserViewMount(viewId: string, mountId: symbol): void {
  const record = records.get(viewId);
  if (
    record === undefined ||
    record.claimed === mountId ||
    !record.mounts.includes(mountId)
  ) {
    return;
  }
  record.claimed = mountId;
  emit();
}

export function bumpBrowserViewGeneration(viewId: string): void {
  const record = records.get(viewId);
  if (record === undefined) return;
  record.generation += 1;
  emit();
}

export function useBrowserViewMount(viewId: string): BrowserViewMount {
  const [mountId] = useState(() => Symbol("browser-view-mount"));
  useLayoutEffect(
    () => registerBrowserViewMount(viewId, mountId),
    [mountId, viewId],
  );
  const claimed = useSyncExternalStore(
    subscribe,
    () => records.get(viewId)?.claimed ?? null,
    () => null,
  );
  const generation = useSyncExternalStore(
    subscribe,
    () => records.get(viewId)?.generation ?? 0,
    () => 0,
  );
  const claim = useCallback(
    () => claimBrowserViewMount(viewId, mountId),
    [mountId, viewId],
  );
  return { isOwner: claimed === null || claimed === mountId, generation, claim };
}

export function resetBrowserViewMountsForTest(): void {
  records.clear();
}
```

`claimed === null` happens only while no mount is registered, so a lone first render owns the view immediately. That keeps the synchronous address-focus test at `BrowserTabDeck.browser-view-ordering.test.tsx:717-739` green.

- [ ] **Step 4: Implement the plugin ids and close**

`apps/app/src/components/browser/plugin-browser-view-ids.ts`:

```ts
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
```

`closePluginBrowserViews` reuses `destroyPersistedBrowserViewsForThread`, the same path core uses when a thread is deleted.

- [ ] **Step 5: Gate the hook and `BrowserView` on ownership and generation**

`useNativeBrowserView.ts`:
1. Add `import { useBrowserViewMount } from "./browserViewMounts";`, add `isOwner: boolean; claim: () => void;` to `NativeBrowserView`, and after `const desktopBrowser = …` add `const { isOwner, generation, claim } = useBrowserViewMount(viewId);`.
2. Attach effect: change the guard to `if (desktopBrowser === null || !isOwner) {`. Add `setAttachedIdentity(null);` as the last cleanup statement. Add `generation, isOwner` to its deps.
3. Open-tab effect: change the guard to `if (desktopBrowser === null || !hasOpenTabHandler || !isOwner) {` and add `isOwner` to its deps.
4. ResizeObserver effect: guard `if (element === null || desktopBrowser === null || !isOwner) {` and add `isOwner` to deps. Window-listener effect: guard `if (desktopBrowser === null || !isOwner) {` and add `isOwner` to deps.
5. `isPlacementTracked`: prefix with `isOwner &&`.
6. Visibility layout effect: change its first guard to `if (visibilityCoordinator === null || !isOwner) {` and add `isOwner` to deps.
7. Add `isOwner, claim` to the returned object.

`BrowserView.tsx`:
1. Add imports: `import { Button } from "@bb/shared-ui/button";` and `import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";`. Destructure `isOwner, claim` from the hook result.
2. After the hook call, add:

```tsx
  const canRunBrowserCommands = canHandleBrowserCommands && isOwner;
  const isPaneFocused = useOptionalPaneContext()?.isFocused ?? false;
  useEffect(() => {
    if (isPaneFocused) claim();
  }, [claim, isPaneFocused]);
```

3. In the moved handlers and the `isPageFocusPending` effect, replace every **read** of `canHandleBrowserCommands` with `canRunBrowserCommands`. The hook argument stays `canHandleBrowserCommands`.
4. After the `desktopBrowser === null` early return, add:

```tsx
  if (!isOwner) {
    return (
      <div
        data-app-browser
        className={cn(
          "flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center",
          className,
        )}
      >
        <p className={cn("text-muted-foreground", COARSE_POINTER_TEXT_SM_CLASS)}>
          This page is showing in another pane.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={claim}>
          Show here
        </Button>
      </div>
    );
  }
```

5. On the main root `div` (`data-app-browser`), add `onPointerDownCapture={claim}` and `onFocusCapture={claim}`.

In `BrowserView.surfaces.test.tsx`, import `resetBrowserViewMountsForTest` from `./browserViewMounts` and call it in `afterEach`.

- [ ] **Step 6: Wire plugin unload and the panel leak fix**

`apps/app/src/lib/plugin-frontend.ts`:
- add imports: `import { getDesktopBrowserApi } from "@/lib/bb-desktop";` and `import { closePluginBrowserViews } from "@/components/browser/plugin-browser-view-ids";`;
- add `closePluginBrowserViews: (pluginId: string) => void;` to `PluginFrontendReconcileDeps` after `removeRegistrations`;
- in `reconcilePluginFrontends`'s removal loop, directly after `await deactivateCommittedGeneration(pluginId, state, deps);` (line 642), add `deps.closePluginBrowserViews(pluginId);`;
- add to `browserReconcileDeps`:

```ts
  closePluginBrowserViews: (pluginId) =>
    closePluginBrowserViews({ desktopBrowser: getDesktopBrowserApi(), pluginId }),
```

`apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx`: add `import { BrowserTabLifecycleObserver } from "@/components/secondary-panel/BrowserTabLifecycleObserver";`. In the returned JSX (line 1161), render the observer as the first child of `UrlOpenRoutingProvider`:

```tsx
    <UrlOpenRoutingProvider openInAppBrowser={openBrowser}>
      <BrowserTabLifecycleObserver
        browserTabs={browserTabs}
        threadId={panelStateId}
      />
      <AppNavigationHostProvider capabilities={navigationCapabilities}>
```

This matches `ThreadDetailView.tsx:2734-2737`.

- [ ] **Step 7: Run the tests and watch them pass**

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/browser src/components/secondary-panel src/lib/plugin-frontend src/hooks/plugin-startup-recovery.test.ts src/components/plugin/PluginPanelRightPanelHost.test.tsx`
Expected: PASS.
Run: `pnpm exec turbo run typecheck --filter=@bb/app`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/components/browser apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx apps/app/src/components/plugin/PluginPanelRightPanelHost.test.tsx apps/app/src/lib/plugin-frontend.ts apps/app/src/lib/plugin-frontend-reload.test.ts apps/app/src/lib/plugin-frontend-load-order.test.ts apps/app/src/hooks/plugin-startup-recovery.test.ts
git commit -m "Add plugin browser view identity, single ownership, and cleanup" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: SDK surface — `experimental_BrowserView` and `experimental_useBrowserViews`

**Files:**
- Modify: `packages/plugin-sdk/src/app-contract.ts` (new interfaces after `ExperimentalFileLinkProps` ~3372; `PluginSdkApp` members after `experimental_Diff` ~3856)
- Modify: `packages/plugin-sdk/src/app.ts` (after line 147 `experimental_Diff`)
- Modify: `packages/plugin-sdk/src/testing/app.tsx` (type imports ~88; new `TestBrowserView`; runtime object before `} satisfies PluginSdkApp;` at 1465)
- Modify: `packages/plugin-sdk/src/testing/__tests__/app-facade-runtime.test.tsx`
- Create: `apps/app/src/components/browser/BrowserViewHostContext.ts`
- Create: `apps/app/src/components/plugin/PluginBrowserView.tsx`
- Create: `apps/app/src/components/plugin/LazyPluginBrowserView.tsx`
- Create: `apps/app/src/components/plugin/usePluginBrowserViews.ts`
- Create: `apps/app/src/components/plugin/PluginBrowserView.test.tsx`
- Modify: `apps/app/src/lib/plugin-sdk-app-impl.tsx` (implementation object, lines 79-135)
- Modify: `apps/app/.ladle/plugin-sdk-app.ts`
- Modify: `apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx` (`main={children}` at ~1123)
- Modify: `apps/app/src/components/browser/BrowserView.surfaces.test.tsx` (row 4)

**Interfaces:**
- Produces (SDK):

```ts
export interface ExperimentalBrowserViewNavigation { url: string; title: string | null }
export interface ExperimentalBrowserViewOpenTabRequest { url: string }
export interface ExperimentalBrowserViewProps {
  viewKey: string;
  url: string;
  chrome?: "full" | "none";
  onNavigate?: (navigation: ExperimentalBrowserViewNavigation) => void;
  onOpenTab?: (request: ExperimentalBrowserViewOpenTabRequest) => void;
  className?: string;
}
export interface ExperimentalBrowserViews { close(viewKey: string): void }
PluginSdkApp.experimental_BrowserView: ComponentType<ExperimentalBrowserViewProps>;
PluginSdkApp.experimental_useBrowserViews(): ExperimentalBrowserViews;
```

- Produces (app): `interface BrowserViewHost { canShowNativeBrowserView: boolean }`, `BrowserViewHostContext: Context<BrowserViewHost>` (default `{ canShowNativeBrowserView: true }`), `PluginBrowserView(props: ExperimentalBrowserViewProps)`, `LazyPluginBrowserView` (defineSplit), `usePluginBrowserViews(): ExperimentalBrowserViews`.

- [ ] **Step 1: Write the failing tests**

`apps/app/src/components/plugin/PluginBrowserView.test.tsx`:

```tsx
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
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const PluginSdkBrowserView = pluginSdkAppImplementation.experimental_BrowserView;
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
    <PluginSdkBrowserView viewKey="inbox" url="https://mail.example/" {...props} />
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
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" }),
    );
    expect(openUrl.mock.calls).toEqual([[{ url: "https://link.example/" }]]);
  });

  it("hands new-tab links to onOpenTab when the plugin supplies it", async () => {
    const openUrl = vi.fn(() => true);
    const onOpenTab = vi.fn();
    render(<PluginSurface openUrl={openUrl}>{view({ onOpenTab })}</PluginSurface>);
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    act(() =>
      browser.emitScopedOpenTab({ tabId: VIEW_ID, url: "https://link.example/" }),
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
      <BrowserViewHostContext.Provider value={{ canShowNativeBrowserView: false }}>
        <PluginSurface>{view()}</PluginSurface>
      </BrowserViewHostContext.Provider>,
    );
    await waitFor(() => expect(browser.attachments()).toHaveLength(1));
    await act(async () => {});
    expect(browser.isShown(VIEW_ID)).toBe(false);
  });
});

describe("experimental_useBrowserViews", () => {
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
```

Contract row 4 in `BrowserView.surfaces.test.tsx`:
- add imports `import { beforeAll } from "vitest";` (merge into the existing vitest import), `import { PluginContext } from "@/components/plugin/plugin-context";`, `import { LazyPluginBrowserView } from "@/components/plugin/LazyPluginBrowserView";`, `import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";`;
- add `const PluginMainAreaBrowserView = pluginSdkAppImplementation.experimental_BrowserView;` and `beforeAll(async () => { await LazyPluginBrowserView.preload(); });`;
- append to `BROWSER_SURFACES`:

```tsx
  {
    name: "plugin page main area",
    viewId: "plugin-view:acme:inbox",
    ownerId: "plugin-view:acme",
    element: () => (
      <PluginContext.Provider value="acme">
        <PluginMainAreaBrowserView viewKey="inbox" url={CONTRACT_URL} />
      </PluginContext.Provider>
    ),
  },
```

SDK facade test (`packages/plugin-sdk/src/testing/__tests__/app-facade-runtime.test.tsx`): add `experimental_BrowserView` and `experimental_useBrowserViews` to the `../../app.js` import, add `const BrowserView = experimental_BrowserView;`, then add:

```tsx
  it("renders an inert browser view placeholder with a no-op close", () => {
    function BrowserProbe() {
      const views = experimental_useBrowserViews();
      views.close("inbox");
      return (
        <BrowserView viewKey="inbox" url="https://mail.example/" chrome="none" />
      );
    }
    renderSlot({ component: BrowserProbe }, {});
    const placeholder = screen.getByTestId("bb-browser-view");
    expect(placeholder.dataset.viewKey).toBe("inbox");
    expect(placeholder.dataset.url).toBe("https://mail.example/");
    expect(placeholder.dataset.chrome).toBe("none");
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/plugin/PluginBrowserView.test.tsx src/components/browser/BrowserView.surfaces.test.tsx`
Expected: FAIL. `./LazyPluginBrowserView` does not exist and `pluginSdkAppImplementation.experimental_BrowserView` is undefined.
Run: `pnpm exec turbo run build:types test --filter=@get-bb/plugin-sdk -- src/testing/__tests__/app-facade-runtime.test.tsx`
Expected: FAIL. `experimental_BrowserView` is not exported by `../../app.js`.

- [ ] **Step 3: Add the SDK contract, shims and testing runtime**

`app-contract.ts`: after `ExperimentalFileLinkProps`, add:

```ts
/**
 * Live page state a browser view reports while the user browses.
 * Experimental: see docs/api_to_audit.md.
 */
export interface ExperimentalBrowserViewNavigation {
  url: string;
  title: string | null;
}

/**
 * A link the page asked to open in a new tab. Experimental: see
 * docs/api_to_audit.md.
 */
export interface ExperimentalBrowserViewOpenTabRequest {
  url: string;
}

/**
 * Props of the host-owned `experimental_BrowserView` component: bb's native
 * in-app browser for one page, laid out by the plugin. Unmounting hides the
 * page and keeps it alive, so the same `viewKey` returns to it without a
 * reload. The page closes when the window closes, when
 * `experimental_useBrowserViews().close(viewKey)` runs, or when the plugin is
 * disabled or uninstalled. Web clients render Open in browser and Copy link
 * instead. Experimental: see docs/api_to_audit.md.
 */
export interface ExperimentalBrowserViewProps {
  /**
   * Stable plugin-chosen identity matching `[A-Za-z0-9_\-:.]{1,128}`. An
   * invalid key renders an error card instead of a page.
   */
  viewKey: string;
  /**
   * HTTP(S) URL loaded when the view is first created. Later changes are
   * ignored; use another `viewKey` to show another page. Other schemes
   * render an error card.
   */
  url: string;
  /** `"full"` (default) shows bb's browser toolbar; `"none"` shows only the page. */
  chrome?: "full" | "none";
  /** Called with the live URL and title whenever the page state changes. */
  onNavigate?: (navigation: ExperimentalBrowserViewNavigation) => void;
  /**
   * Called when the page opens a link in a new tab. When omitted, the link
   * opens where the current surface opens links: a right-panel Browser tab
   * when the surface has one and the user opens links in bb, otherwise the
   * external browser.
   */
  onOpenTab?: (request: ExperimentalBrowserViewOpenTabRequest) => void;
  className?: string;
}

/**
 * Controller for the calling plugin's browser views. Experimental: see
 * docs/api_to_audit.md.
 */
export interface ExperimentalBrowserViews {
  /**
   * Close one of this plugin's views and discard its page. A mounted view
   * with that key reloads from its `url`. Invalid keys are ignored.
   */
  close(viewKey: string): void;
}
```

In `PluginSdkApp`, after `experimental_Diff: ComponentType<DiffProps>;`:

```ts
  /**
   * bb's native in-app browser for one page (see
   * {@link ExperimentalBrowserViewProps}), the same view bb's right-panel
   * Browser tab renders. Experimental: see docs/api_to_audit.md.
   */
  experimental_BrowserView: ComponentType<ExperimentalBrowserViewProps>;
  /**
   * Close the calling plugin's browser views. Experimental: see
   * docs/api_to_audit.md.
   */
  experimental_useBrowserViews(): ExperimentalBrowserViews;
```

`app.ts`, after line 147:

```ts
export const experimental_BrowserView = runtimeComponent(
  "experimental_BrowserView",
);
export const experimental_useBrowserViews = runtimeFunction(
  "experimental_useBrowserViews",
);
```

`testing/app.tsx`: add `type ExperimentalBrowserViewProps, type ExperimentalBrowserViews,` to the `@get-bb/plugin-sdk` type import. Add next to `TestDiff`:

```tsx
function TestBrowserView({
  viewKey,
  url,
  chrome = "full",
  className,
}: ExperimentalBrowserViewProps) {
  return (
    <div
      data-testid="bb-browser-view"
      data-view-key={viewKey}
      data-url={url}
      data-chrome={chrome}
      className={className}
    />
  );
}

const INERT_BROWSER_VIEWS: ExperimentalBrowserViews = Object.freeze({
  close() {},
});
```

In the runtime object, after `experimental_Diff: TestDiff,`:

```tsx
  experimental_BrowserView: TestBrowserView,
  experimental_useBrowserViews(): ExperimentalBrowserViews {
    return INERT_BROWSER_VIEWS;
  },
```

- [ ] **Step 4: Add the app implementation**

`apps/app/src/components/browser/BrowserViewHostContext.ts`:

```ts
import { createContext } from "react";

export interface BrowserViewHost {
  canShowNativeBrowserView: boolean;
}

export const BrowserViewHostContext = createContext<BrowserViewHost>({
  canShowNativeBrowserView: true,
});
```

`apps/app/src/components/plugin/PluginBrowserView.tsx`:

```tsx
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
```

`apps/app/src/components/plugin/LazyPluginBrowserView.tsx`:

```tsx
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
```

`apps/app/src/components/plugin/usePluginBrowserViews.ts`:

```ts
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
```

`apps/app/src/lib/plugin-sdk-app-impl.tsx`: import `LazyPluginBrowserView` and `usePluginBrowserViews`, then add after `experimental_Diff: PluginDiff,`:

```ts
  experimental_BrowserView: LazyPluginBrowserView,
  experimental_useBrowserViews: usePluginBrowserViews,
```

`apps/app/.ladle/plugin-sdk-app.ts`: add `experimental_BrowserView,` and `experimental_useBrowserViews,` after `experimental_Diff,` in the destructuring list.

`apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx`: import `BrowserViewHostContext` and `type BrowserViewHost`. Before `const page = (`, add:

```tsx
  const mainBrowserViewHost = useMemo<BrowserViewHost>(
    () => ({
      canShowNativeBrowserView:
        !(isCompactViewport && isOpen) && !isPanelFullPage,
    }),
    [isCompactViewport, isOpen, isPanelFullPage],
  );
```

Then replace `main={children}` with:

```tsx
        main={
          <BrowserViewHostContext.Provider value={mainBrowserViewHost}>
            {children}
          </BrowserViewHostContext.Provider>
        }
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm exec turbo run test --filter=@bb/app -- src/components/plugin/PluginBrowserView.test.tsx src/components/browser src/components/plugin/PluginPanelRightPanelHost.test.tsx src/lib/plugin-sdk-app-impl.test.tsx src/lib/plugin-frontend.test.ts`
Expected: PASS. The contract table now runs four rows.
Run: `pnpm exec turbo run build:types test --filter=@get-bb/plugin-sdk`
Expected: PASS, including `src/__tests__/frontend-exports.test.ts` (export parity) and the facade test.
Run: `pnpm exec turbo run typecheck --filter=@get-bb/plugin-sdk --filter=@bb/app`
Expected: PASS. Both `satisfies PluginSdkApp` checks hold.
Note: `apps/server/test/services/plugins/plugin-authoring-docs.test.ts` now fails ("experimental_BrowserView is not documented in the skill"); Task 6 fixes it.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-sdk/src/app-contract.ts packages/plugin-sdk/src/app.ts packages/plugin-sdk/src/testing/app.tsx packages/plugin-sdk/src/testing/__tests__/app-facade-runtime.test.tsx apps/app/src/components/browser apps/app/src/components/plugin/PluginBrowserView.tsx apps/app/src/components/plugin/LazyPluginBrowserView.tsx apps/app/src/components/plugin/usePluginBrowserViews.ts apps/app/src/components/plugin/PluginBrowserView.test.tsx apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx apps/app/src/lib/plugin-sdk-app-impl.tsx apps/app/.ladle/plugin-sdk-app.ts
git commit -m "Add experimental_BrowserView and experimental_useBrowserViews to the plugin SDK" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/api_to_audit.md` (insert a new section immediately after the `## \`experimental_SourceCode\` / \`experimental_Diff\`` section, which starts at line 2757, before the next `## ` heading)
- Modify: `plugins/plugin-api-docs/src/surfaces.ts` (`host-components` card, lines 1353-1416)
- Modify: `plugins/plugin-api-docs/test/surfaces.test.ts`
- Modify: `plugins/bb-guide/skills/bb-plugin-authoring/references/frontend-components.md` (after the `experimental_Diff` entry ending ~152)
- Modify: `plugins/bb-guide/skills/bb-plugin-authoring/references/frontend-api-index.md` (runtime list ~29, hooks ~83, type list ~270)
- Modify: `packages/plugin-sdk/README.md` (after the `experimental_FileLink` paragraph ending line 49)
- Modify: `packages/templates/src/templates/bb-guide-plugins.md` (after the `experimental_FileLink` sentence block ending ~781)

**Interfaces:**
- Consumes: the SDK symbols from Task 5.
- Produces: no code.

- [ ] **Step 1: Write the failing docs test**

In `plugins/plugin-api-docs/test/surfaces.test.ts`, inside `describe("surface card copy")`:

```ts
  it("lists the browser view on the host components card", () => {
    expect(SURFACES_BY_ID.get("host-components")?.apiSymbols).toEqual(
      expect.arrayContaining([
        "experimental_BrowserView",
        "ExperimentalBrowserViewProps",
        "ExperimentalBrowserViewNavigation",
        "ExperimentalBrowserViewOpenTabRequest",
        "experimental_useBrowserViews",
        "ExperimentalBrowserViews",
      ]),
    );
  });
```

- [ ] **Step 2: Run the docs tests and watch them fail**

Run: `pnpm exec turbo run test --filter=bb-plugin-plugin-api-docs -- test/surfaces.test.ts`
Expected: FAIL. The array does not contain `experimental_BrowserView`.
Run: `pnpm exec turbo run test --filter=@bb/server -- test/services/plugins/plugin-authoring-docs.test.ts`
Expected: FAIL. "experimental_BrowserView is not documented in the skill", and the same for the other five names.

- [ ] **Step 3: Write the docs**

`docs/api_to_audit.md`, new section:

```markdown
## `experimental_BrowserView` and `experimental_useBrowserViews` (`@get-bb/plugin-sdk/app`)

**What it does.** `experimental_BrowserView({ viewKey, url, chrome?,
onNavigate?, onOpenTab?, className? })` renders bb's native in-app browser for
one page inside a plugin's layout, such as the main area of a `navPanel` page.
The native view is `plugin-view:<pluginId>:<viewKey>`, owned by
`plugin-view:<pluginId>`, so it cannot collide with panel Browser tabs, threads,
or another plugin's views. `viewKey` matches `[A-Za-z0-9_\-:.]{1,128}`; `url`
must be HTTP(S) and loads only when the view is first created. `chrome: "full"`
(default) shows back, forward, reload, the address bar, find, browser toolbar
actions, and open externally; `"none"` shows only the page. `onNavigate`
receives the live URL and title on every page state change. New-tab links go to
`onOpenTab`, or by default to the current surface's URL routing, the same
routing core's right-panel Browser uses for its own new-tab links. Unmounting
hides the view and keeps it alive. It closes on window close, on
`experimental_useBrowserViews().close(viewKey)` (a mounted view with that key
reloads from its `url`), and when the plugin leaves the frontend inventory
(disable, uninstall, stop). Views hide under bb dialogs, popovers, dropdown,
context and select menus, and hover cards, and when their slot is clipped by a
scroll container; they show a page snapshot meanwhile. If two panes mount the
same key, the most recently focused one shows the page and the other offers
Show here. An invalid key or URL renders an error card; web clients show Open in
browser and Copy link. The SDK test harness renders an inert
`bb-browser-view` placeholder and an inert `close`.

**Core callers.** The right-panel Browser tab on the thread view, New thread
screen, and plugin pages renders through the same `BrowserView` component and
`useNativeBrowserView` hook (`apps/app/src/components/browser/`).
`BrowserView.surfaces.test.tsx` runs one contract table (attach, hide on
unmount, show after attach, every overlay type, snapshot, non-desktop fallback)
against those three panels and the plugin page main area.

**Out of scope.** Agent and `bb browser` CLI access to plugin-owned views
(server browser services are thread-scoped); a host-provided tabbed browser;
keeping views across app restarts (plugins persist their tab lists and
recreate views from `url`).

**Audit before stabilizing.**

1. **Agent and CLI visibility.** Decide whether plugin views join browser
   automation and `bb browser`, and under which owner.
2. **Plugin-bundled overlays.** A plugin's own shadcn wrappers over the shimmed
   Radix modules do not hide the view. Decide between counting the shimmed
   Radix roots and exposing a dimming hook.
3. **Cleanup after a window reload.** Unload closes views the renderer has
   registered this session; views created before a window reload and not
   remounted since stay open until the window closes. Decide whether the
   desktop should close by owner prefix.
4. **Browser commands.** Find, reload, and focus-location run in whichever
   handler answers first when a plugin view and a panel Browser tab share the
   focused pane.
5. **Toolbar actions.** Other plugins' browser toolbar actions render in a
   plugin view's chrome and can evaluate script in its page. Confirm that is
   intended.
6. **Feature detection.** A plugin built against this SDK fails on older bb.
   Decide on a supported capability check.
7. **Consumer count.** Pinned Pages is the only consumer.
```

`plugins/plugin-api-docs/src/surfaces.ts`, `host-components` card:
- add the bullet `"Show a live web page with bb's in-app browser and toolbar"` after `"Render Markdown, code, diffs, and file links, and copy text, the way bb does"`;
- add to `apiSymbols`, after `"BbNavigate.experimental_openFileExternally"`: `"experimental_BrowserView"`, `"ExperimentalBrowserViewProps"`, `"ExperimentalBrowserViewNavigation"`, `"ExperimentalBrowserViewOpenTabRequest"`, `"experimental_useBrowserViews"`, `"ExperimentalBrowserViews"`.

`frontend-components.md`, after the `experimental_Diff` entry:

````markdown
- `experimental_BrowserView` — bb's native in-app browser for one page in
  your own layout, such as a `navPanel` page's main area. Props
  (`ExperimentalBrowserViewProps`):
  `{ viewKey, url, chrome?, onNavigate?, onOpenTab?, className? }`.
  `viewKey` is a stable key matching `[A-Za-z0-9_\-:.]{1,128}`; the same key
  returns to the same live page without a reload. `url` must be HTTP(S) and
  loads only when the view is first created; change `viewKey` to show another
  page. `chrome` is `"full"` (default, bb's toolbar) or `"none"`. `onNavigate`
  receives `ExperimentalBrowserViewNavigation` `{ url, title }` on every page
  state change. `onOpenTab` receives `ExperimentalBrowserViewOpenTabRequest`
  `{ url }` for new-tab links; omit it to open them the way the current
  surface opens links. For a tab strip, render one `BrowserView` per tab and
  mount only the active one; unmounted views stay alive.
  `experimental_useBrowserViews()` returns `ExperimentalBrowserViews`
  `{ close(viewKey) }`, which discards one of this plugin's pages. Views close
  when the plugin is disabled or uninstalled. Give the view a bounded height:
  a view clipped by its scroll container hides, and one taller than its
  container never shows. bb menus, popovers, and dialogs hide the view while
  open. Web clients render Open in browser and Copy link. The testing harness
  renders an inert `bb-browser-view` placeholder. Experimental: see
  `docs/api_to_audit.md`.

  ```tsx
  import { experimental_BrowserView as BrowserView } from "@get-bb/plugin-sdk/app";

  <BrowserView viewKey={tab.id} url={tab.url} onOpenTab={({ url }) => addTab(url)} />;
  ```
````

`frontend-api-index.md`:
- runtime values, after `experimental_Diff`: ``- `experimental_BrowserView` — bb's in-app browser for one page in your layout``;
- after `experimental_copyToClipboard`: ``- `experimental_useBrowserViews` — close this plugin's browser views``;
- type exports, after `ExperimentalFileLinkProps`: `ExperimentalBrowserViewProps`, `ExperimentalBrowserViewNavigation`, `ExperimentalBrowserViewOpenTabRequest`, `ExperimentalBrowserViews` (one bullet each).

`packages/plugin-sdk/README.md`, after the `experimental_FileLink` paragraph:

```markdown
Use `experimental_BrowserView` to show a live web page inside your own layout
with bb's in-app browser and toolbar. Each `viewKey` is one page that stays
alive while unmounted; `url` loads only when the page is created, and
`experimental_useBrowserViews().close(viewKey)` discards it. New-tab links go
to `onOpenTab`, or follow the current surface's link routing. The frontend
harness renders an inert `bb-browser-view` placeholder.
```

`packages/templates/src/templates/bb-guide-plugins.md`, after the `experimental_FileLink` sentences (ending "…without reading the file or discovering editors on mount."):

```markdown
experimental_BrowserView renders bb's in-app browser for one page in your own
layout, with bb's toolbar unless `chrome: "none"`; each `viewKey` keeps its page
alive while unmounted, and `experimental_useBrowserViews().close(viewKey)`
discards it.
```

- [ ] **Step 4: Run the docs tests and watch them pass**

Run: `pnpm exec turbo run test --filter=bb-plugin-plugin-api-docs`
Expected: PASS.
Run: `pnpm exec turbo run test --filter=@bb/server -- test/services/plugins/plugin-authoring-docs.test.ts`
Expected: PASS.
Run: `pnpm exec turbo run test --filter=@bb/cli -- src/__tests__/plugin-guide-docs.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 5: Commit**

```bash
git add docs/api_to_audit.md plugins/plugin-api-docs/src/surfaces.ts plugins/plugin-api-docs/test/surfaces.test.ts plugins/bb-guide/skills/bb-plugin-authoring/references/frontend-components.md plugins/bb-guide/skills/bb-plugin-authoring/references/frontend-api-index.md packages/plugin-sdk/README.md packages/templates/src/templates/bb-guide-plugins.md
git commit -m "Document experimental_BrowserView" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verification (the controller runs this with the human)

**Files:**
- No repo files. Scratch plugin at `/Users/blainecook/Code/bb-browser-view-check/` (never committed).

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full affected-package checks**

Run: `pnpm exec turbo run typecheck test --filter=@bb/shared-ui --filter=@bb/desktop-contract --filter=@bb/desktop --filter=@get-bb/plugin-sdk --filter=@bb/app --filter=bb-plugin-plugin-api-docs > "$TMPDIR/browser-view-verify.log" 2>&1; tail -40 "$TMPDIR/browser-view-verify.log"`
Expected: every task succeeds, including `apps/app/src/bundle-budget.test.ts` (`PluginBrowserView` stays behind `LazyPluginBrowserView`).
Run: `pnpm exec turbo run test --filter=@bb/server -- test/services/plugins/plugin-authoring-docs.test.ts`
Expected: PASS.

If anything fails, fix it, rerun only the failing package, and commit with the trailer.

- [ ] **Step 2: Build the fork SDK and a scratch plugin**

Run: `pnpm exec turbo run build build:types --filter=@get-bb/plugin-sdk`
Run (sandbox off: writes under /Users/blainecook/Code): `cd /Users/blainecook/Code && pnpm bb:dev plugin new bb-browser-view-check`. If `bb:dev` cannot run outside the repo, run it from `/Users/blainecook/Code/bb` with the target path. Then:
- set `"@get-bb/plugin-sdk": "file:/Users/blainecook/Code/bb/packages/plugin-sdk"` in its `package.json`;
- replace `app.tsx` with:

```tsx
import { useState } from "react";
import {
  definePluginApp,
  experimental_BrowserView as BrowserView,
  experimental_useBrowserViews,
} from "@get-bb/plugin-sdk/app";

interface PageTab {
  id: string;
  url: string;
  title: string;
}

function BrowserPage() {
  const views = experimental_useBrowserViews();
  const [tabs, setTabs] = useState<PageTab[]>([
    { id: "gmail", url: "https://mail.google.com/", title: "Gmail" },
  ]);
  const [activeId, setActiveId] = useState("gmail");
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 p-1">
        {tabs.map((tab) => (
          <span key={tab.id} className="flex items-center gap-1">
            <button type="button" onClick={() => setActiveId(tab.id)}>
              {tab.title}
            </button>
            {tab.id === "gmail" ? null : (
              <button
                type="button"
                onClick={() => {
                  views.close(tab.id);
                  setTabs((current) => current.filter((t) => t.id !== tab.id));
                  setActiveId("gmail");
                }}
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {active === undefined ? null : (
        <BrowserView
          key={active.id}
          viewKey={active.id}
          url={active.url}
          className="min-h-0 flex-1"
          onNavigate={({ title }) =>
            setTabs((current) =>
              current.map((t) =>
                t.id === active.id ? { ...t, title: title ?? t.title } : t,
              ),
            )
          }
          onOpenTab={({ url }) => {
            const id = `tab-${Date.now()}`;
            setTabs((current) => [...current, { id, url, title: url }]);
            setActiveId(id);
          }}
        />
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "browser-check",
    title: "Browser check",
    icon: "Globe",
    path: "browser-check",
    component: BrowserPage,
  });
});
```

Run (sandbox off): `cd /Users/blainecook/Code/bb-browser-view-check && npm install && pnpm --dir /Users/blainecook/Code/bb bb:dev plugin build /Users/blainecook/Code/bb-browser-view-check`

- [ ] **Step 3: Launch the isolated desktop build**

Run (sandbox off; long-running, use `run_in_background`): `cd /Users/blainecook/Code/bb && pnpm desktop:worktree`. This uses the checkout's own data dir, deterministic ports, and `$BB_DATA_DIR/desktop` Electron user data; the installed bb keeps running. It refuses to start if its ports are busy (see `docs/debugging-and-qa.md`).

Then run: `pnpm --dir /Users/blainecook/Code/bb bb:dev plugin install path:/Users/blainecook/Code/bb-browser-view-check`. Confirm with `pnpm --dir /Users/blainecook/Code/bb bb:dev plugin list`.

If `open`-style launching is blocked by the sandbox, give the human the exact command to run.

- [ ] **Step 4: Live walkthrough with the human (check each)**

- [ ] Gmail shows in the "Browser check" page's main area with bb's toolbar. Back, forward, reload, the address bar, find (Cmd+F), and open externally all work.
- [ ] Clicking a Gmail link that opens a new tab adds a tab to the plugin's strip (`onOpenTab`); closing that tab removes its page (×).
- [ ] Open a bb dropdown (sidebar row menu), a popover, a context menu, a select, a hover card, and a dialog over the view. The view freezes to a snapshot and never paints over the menu; it returns when the menu closes. A tooltip does not hide it.
- [ ] Navigate to a thread and back. Gmail returns instantly with the same state (no reload).
- [ ] Open the same plugin page in two split panes. One shows the page; the other shows "Show here", and clicking it moves the page. Closing a pane moves the page to the remaining one.
- [ ] Narrow the window to compact width and open the plugin page's right panel drawer. The main-area view hides under the drawer.
- [ ] Disable the plugin in Settings. Its views close (re-enable and return: Gmail reloads fresh).
- [ ] Right-panel Browser tabs on a thread, the New thread screen, and a plugin page behave as before: open, switch, resize, overlays, close. Closing a plugin-page panel Browser tab no longer leaves a stray view.
- [ ] Resize the window while a view is shown. The resize snapshot still covers the slot.

- [ ] **Step 5: Wrap up**

Quit the worktree build. Remove `/Users/blainecook/Code/bb-browser-view-check` only if the human agrees. Report results, and file follow-ups for any unchecked item.

---

## Self-review

**Spec coverage**
- Goal / success criteria → Tasks 2-5. Walkthrough in Task 7.
- Decisions 1-5 → Global Constraints and Tasks 2 and 5 (shared `BrowserView`, `chrome` default, lifetime, one component = one view).
- Shared core (`useNativeBrowserView`, `BrowserView`, thin `BrowserTabContent`, unchanged deck) → Task 2. The deck changes only by delegating `BrowserTabElsewhere` to the shared fallback card.
- SDK surface and identity → Tasks 4 (ids) and 5 (props, validation, default `onOpenTab`, ignored `url` changes).
- Lifecycle (unmount hides, `close`, plugin unload, panel leak fix) → Task 4.
- Visibility and overlays (dimming list, snapshot, scroll/move resync, clip-hide, two mounts) → Tasks 1, 3 and 4.
- Non-desktop clients and testing runtime → Tasks 2 (fallback card) and 5 (inert placeholder).
- Out of scope → audit entry in Task 6.
- Testing (four-surface contract table plus the focused tests, existing suites green) → Tasks 2-5.
- SDK wiring and docs → Tasks 5 and 6.
- Verification → Task 7.

**Type consistency**
- `BrowserViewOpenTabRequest` is defined in `useNativeBrowserView.ts` and re-exported from `BrowserView.tsx`. Its SDK twin `ExperimentalBrowserViewOpenTabRequest` has the same `{ url }` shape.
- `BrowserViewNavigation` matches `ExperimentalBrowserViewNavigation` (`{ url: string; title: string | null }`).
- `BrowserViewProps.onOpenTab` and `UseNativeBrowserViewArgs.onOpenTab` are both `((request: BrowserViewOpenTabRequest) => void) | null`.
- `NativeBrowserView` gains `isOwner` and `claim` in Task 4, and `BrowserView` consumes both there.
- `closePluginBrowserViews` is used both as the ids-module function and as the `PluginFrontendReconcileDeps` property (`(pluginId: string) => void`).
- `pluginBrowserViewId({ pluginId, viewKey })` and `pluginBrowserViewOwnerId(pluginId)` are used identically in Tasks 4 and 5 and the tests.
- `RecordingDesktopBrowser` gains `snapshotRequests()` in Task 3, before any test uses it.

**Spec ambiguities resolved**
- **Default `onOpenTab` routing:** the spec says "right panel, else link preference". Core's own panel Browser actually routes new tabs through the link preference (`usePanelBrowser.openUrl`), so the default uses `useAppNavigationHost().openUrl`. That is the same path, and it opens a right-panel Browser tab under the default preference.
- **"Plugin unload"** means leaving the frontend inventory (disable, uninstall, stop or crash), not a bundle reload or update.
- **Snapshots** also apply when a view is clipped, not only when dimmed. The same freeze path keeps scrolling smooth.
- **Zero-size slots are not treated as hidden.** Plugins render only the active tab's view; the docs say so.
- **Clip-hide applies to core panels too**, because core uses the same hook. A view taller than its scroll container never shows; documented for plugin authors and pinned by a test.
- **Two mounts:** the newest mount owns the view. Pane focus, pointer or focus inside the view, and "Show here" claim it. When the owner unmounts, the remaining mount takes over.
- **`chrome: "none"`** also disables find and the focus-location command.
- **Web-client panel Browser tabs** gain Open in browser / Copy link, because the non-desktop fallback is shared by all four surfaces.
- **Verification step 2** names Pinned Pages v2, which is a separate follow-up; Task 7 uses a scratch plugin built against the fork SDK.
- **Overlays bundled by plugins and feature detection** are not covered by the spec; both are recorded as audit items.

### Critical Files for Implementation
- /Users/blainecook/Code/bb/apps/app/src/components/secondary-panel/BrowserTabContent.tsx
- /Users/blainecook/Code/bb/apps/app/src/components/browser/useNativeBrowserView.ts (new)
- /Users/blainecook/Code/bb/apps/desktop/src/desktop-browser-view.ts
- /Users/blainecook/Code/bb/packages/plugin-sdk/src/app-contract.ts
- /Users/blainecook/Code/bb/apps/app/src/components/plugin/PluginPanelRightPanelHost.tsx
