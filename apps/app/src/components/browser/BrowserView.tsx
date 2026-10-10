import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
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
import { isMacKeyboardPlatform } from "@bb/domain";
import {
  browserPlatform,
  type AppShortcutPresentation,
} from "@/lib/app-keybindings";
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
  onOpenInNewTab?: ((url: string) => void) | null;
  onNativeFocus: (() => void) | null;
  className?: string;
}

interface BrowserChromeProps {
  addressDraft: string;
  isEditing: boolean;
  state: BbDesktopBrowserState | null;
  currentUrl: string;
  addressInputRef: RefObject<HTMLInputElement | null>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onAddressKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  onOpenExternal: () => void;
  locationShortcut: AppShortcutPresentation | null;
  reloadShortcut: AppShortcutPresentation | null;
  pluginActions: ReactNode;
}

interface BrowserPageLoadErrorProps {
  errorText: string;
  onOpenExternal: () => void;
  onRetry: () => void;
  url: string;
}

function browserPageLoadErrorTitle(args: {
  errorText: string;
  url: string;
}): string {
  if (isLocalOnlyUrl(args.url)) {
    return "Server not reachable";
  }
  if (args.errorText.includes("ERR_BLOCKED_BY_CLIENT")) {
    return "Page blocked";
  }
  return "Page unavailable";
}

function BrowserChrome({
  addressDraft,
  isEditing,
  state,
  currentUrl,
  addressInputRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onAddressKeyDown,
  onSubmit,
  onBack,
  onForward,
  onReloadOrStop,
  onOpenExternal,
  locationShortcut,
  reloadShortcut,
  pluginActions,
}: BrowserChromeProps) {
  const isLoading = state?.isLoading ?? false;
  const security = getBrowserUrlSecurity(currentUrl);
  const addressValue = isEditing ? addressDraft : currentUrl;
  const selectAddressOnMouseUpRef = useRef(false);
  return (
    <div
      role="region"
      aria-label="Browser navigation"
      tabIndex={-1}
      className={cn(
        "relative h-11 shrink-0 overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring max-md:pointer-coarse:h-[52px]",
        SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS,
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 flex h-11 translate-y-0 items-center gap-1 py-1.5 pl-2 pr-4 opacity-100 max-md:pointer-coarse:h-[52px]",
        )}
      >
        <BrowserChromeIconButton
          icon="ChevronLeft"
          label="Go back"
          disabled={!(state?.canGoBack ?? false)}
          onClick={onBack}
        />
        <BrowserChromeIconButton
          icon="ChevronRight"
          label="Go forward"
          disabled={!(state?.canGoForward ?? false)}
          onClick={onForward}
        />
        <BrowserChromeIconButton
          icon={isLoading ? "X" : "RotateCcw"}
          label={isLoading ? "Stop loading" : "Reload"}
          shortcut={isLoading ? null : reloadShortcut}
          onClick={onReloadOrStop}
        />
        <form onSubmit={onSubmit} className="min-w-0 flex-1">
          <div className="flex h-8 items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 max-md:pointer-coarse:h-10">
            {security === "secure" ? (
              <Icon
                name="Lock"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-success",
                )}
                aria-label="Secure connection"
              />
            ) : security === "insecure" ? (
              <Icon
                name="AlertTriangle"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-warning",
                )}
                aria-label="Connection not secure"
              />
            ) : (
              <Icon
                name="Search"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-muted-foreground",
                )}
                aria-hidden
              />
            )}
            <input
              ref={addressInputRef}
              type="text"
              value={addressValue}
              onChange={(event) => onAddressChange(event.target.value)}
              onMouseDown={(event) => {
                selectAddressOnMouseUpRef.current =
                  document.activeElement !== event.currentTarget;
              }}
              onMouseUp={(event) => {
                if (!selectAddressOnMouseUpRef.current) return;
                selectAddressOnMouseUpRef.current = false;
                const input = event.currentTarget;
                if (input.selectionStart !== input.selectionEnd) return;
                event.preventDefault();
                input.select();
              }}
              onFocus={(event) => {
                event.currentTarget.select();
                onAddressFocus();
              }}
              onBlur={onAddressBlur}
              onKeyDown={onAddressKeyDown}
              placeholder="Enter a URL"
              aria-label={
                locationShortcut
                  ? `Address and search bar (${locationShortcut.label})`
                  : "Address and search bar"
              }
              aria-keyshortcuts={locationShortcut?.ariaKeyshortcuts}
              autoComplete="off"
              spellCheck={false}
              className={cn(
                "min-w-0 flex-1 bg-transparent font-mono text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            />
          </div>
        </form>
        {pluginActions}
        <BrowserChromeIconButton
          icon="ExternalLink"
          label="Open in external browser"
          disabled={currentUrl.length === 0}
          onClick={onOpenExternal}
        />
        {isLoading ? (
          <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
            <span className="block h-full w-1/3 animate-pulse bg-ring/70 motion-reduce:animate-none" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function BrowserPageLoadError({
  errorText,
  onOpenExternal,
  onRetry,
  url,
}: BrowserPageLoadErrorProps) {
  const host = getBrowserUrlHost(url);
  const title = browserPageLoadErrorTitle({ errorText, url });
  const message = isLocalOnlyUrl(url)
    ? `The browser could not reach ${host || "this local server"}. Start the server, then reload.`
    : "The browser could not load this page. Try reloading or opening it externally.";

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface-recessed text-muted-foreground">
          <Icon name="Globe" className="size-6" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p
            className={cn(
              "mt-1 text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            {message}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-state-hover"
          >
            <Icon name="RotateCcw" className="size-3.5" aria-hidden />
            Reload
          </button>
          <button
            type="button"
            onClick={onOpenExternal}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="ExternalLink" className="size-3.5" aria-hidden />
            Open externally
          </button>
        </div>
        <p className="max-w-full truncate pt-1 font-mono text-[11px] text-subtle-foreground">
          {errorText}
        </p>
      </div>
    </div>
  );
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
  onOpenInNewTab = null,
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

  useLayoutEffect(() => {
    if (!isPageFocusPending) return;
    if (!canShow || !canHandleBrowserCommands || hasPageLoadError || isDimmed) {
      setIsPageFocusPending(false);
      return;
    }
    if (!isVisible) return;
    setIsPageFocusPending(false);
    desktopBrowser?.focus?.(viewId);
  }, [
    isPageFocusPending,
    canShow,
    canHandleBrowserCommands,
    hasPageLoadError,
    isDimmed,
    isVisible,
    desktopBrowser,
    viewId,
  ]);

  useEffect(() => {
    if (desktopBrowser?.onFocus === undefined || onNativeFocus === null) {
      return;
    }
    return desktopBrowser.onFocus((focusedTabId) => {
      if (focusedTabId === viewId) onNativeFocus();
    });
  }, [desktopBrowser, onNativeFocus, viewId]);

  const navigateToInput = useCallback(
    (rawInput: string) => {
      const url = resolveBrowserAddressInput(rawInput);
      if (url === null) {
        return;
      }
      setCurrentUrl(url);
      setIsEditing(false);
      addressInputRef.current?.blur();
      desktopBrowser?.navigate({ tabId: viewId, url });
      setIsPageFocusPending(true);
    },
    [desktopBrowser, setCurrentUrl, viewId],
  );

  const handleAddressSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      navigateToInput(addressDraft);
    },
    [addressDraft, navigateToInput],
  );

  const handleAddressKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (
        onOpenInNewTab === null ||
        event.key !== "Enter" ||
        event.nativeEvent.isComposing ||
        event.shiftKey ||
        event.ctrlKey
      ) {
        return;
      }
      const isMac = isMacKeyboardPlatform(browserPlatform());
      const opensNewTab = isMac
        ? event.metaKey && !event.altKey
        : event.altKey && !event.metaKey;
      if (!opensNewTab) return;
      event.preventDefault();
      const url = resolveBrowserAddressInput(addressDraft);
      if (url === null) return;
      setAddressDraft(currentUrl);
      setIsEditing(false);
      addressInputRef.current?.blur();
      onOpenInNewTab(url);
    },
    [addressDraft, currentUrl, onOpenInNewTab],
  );

  const handleAddressFocus = useCallback(() => {
    setAddressDraft(currentUrl);
    setIsEditing(true);
  }, [currentUrl]);

  const handleReloadOrStop = useCallback(() => {
    if (state?.isLoading ?? false) {
      desktopBrowser?.stop(viewId);
      return;
    }
    desktopBrowser?.reload(viewId);
  }, [desktopBrowser, state?.isLoading, viewId]);

  const handleFocusLocation = useCallback((): boolean => {
    if (
      chrome === "none" ||
      !canHandleBrowserCommands ||
      desktopBrowser === null
    )
      return false;
    setAddressDraft(currentUrl);
    setIsEditing(true);
    addressInputRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      addressInputRef.current?.focus({ preventScroll: true });
      addressInputRef.current?.select();
    });
    return true;
  }, [canHandleBrowserCommands, chrome, currentUrl, desktopBrowser]);

  useAppCommandHandler("browser.focusLocation", handleFocusLocation, 100);

  const canFindInPage =
    chrome === "full" &&
    canShow &&
    desktopBrowser !== null &&
    desktopBrowser.findInPage !== undefined &&
    hasPage;

  const runFind = useCallback(
    (args: Omit<BbDesktopBrowserFindInPageRequest, "tabId">) => {
      desktopBrowser?.findInPage?.({ tabId: viewId, ...args });
    },
    [desktopBrowser, viewId],
  );

  const clearFind = useCallback(() => {
    desktopBrowser?.stopFindInPage?.({
      tabId: viewId,
      action: "clearSelection",
    });
    setFindMatches(null);
  }, [desktopBrowser, viewId]);

  const focusFindInput = useCallback(() => {
    findInputRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus({ preventScroll: true });
      findInputRef.current?.select();
    });
  }, []);

  const handleFindQueryChange = useCallback(
    (rawQuery: string) => {
      const query = rawQuery.slice(0, BB_DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH);
      setFindQuery(query);
      if (query.length === 0) {
        clearFind();
        return;
      }
      runFind({ text: query, forward: true, newSession: true });
    },
    [clearFind, runFind],
  );

  const handleFindNext = useCallback(() => {
    if (findQuery.length === 0) return;
    runFind({ text: findQuery, forward: true, newSession: false });
  }, [findQuery, runFind]);

  const handleFindPrevious = useCallback(() => {
    if (findQuery.length === 0) return;
    runFind({ text: findQuery, forward: false, newSession: false });
  }, [findQuery, runFind]);

  const handleCloseFind = useCallback(() => {
    setIsFindOpen(false);
    clearFind();
  }, [clearFind]);

  const handleOpenFind = useCallback((): boolean => {
    if (!canFindInPage) return false;
    setIsFindOpen(true);
    if (findQuery.length > 0) {
      runFind({ text: findQuery, forward: true, newSession: true });
    }
    focusFindInput();
    return true;
  }, [canFindInPage, findQuery, focusFindInput, runFind]);

  useAppCommandHandler("browser.find", handleOpenFind, 100);

  useEffect(() => {
    if (isFindOpen && !canFindInPage) {
      setIsFindOpen(false);
      clearFind();
    }
  }, [canFindInPage, clearFind, isFindOpen]);
  useAppCommandHandler(
    "browser.reload",
    () => {
      if (!canHandleBrowserCommands || desktopBrowser === null || !hasPage) {
        return false;
      }
      desktopBrowser.reload(viewId);
      return true;
    },
    100,
  );

  const handleOpenExternal = useCallback(() => {
    getBbDesktopInfo()?.openExternalUrl(currentUrl);
  }, [currentUrl]);

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
          onAddressKeyDown={handleAddressKeyDown}
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
      {control !== null ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-recessed px-3 py-2 text-xs"
        >
          <span className="min-w-0 flex-1 truncate">
            {control.controllerLabel} is controlling this tab
          </span>
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-state-hover"
            onClick={() => desktopBrowser.releaseControl?.(viewId)}
          >
            Stop
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 hover:bg-state-hover"
            onClick={() => {
              desktopBrowser.releaseControl?.(viewId);
              desktopBrowser.focus?.(viewId);
            }}
          >
            Take over
          </button>
        </div>
      ) : null}
      {isFindOpen ? (
        <BrowserFindBar
          inputRef={findInputRef}
          query={findQuery}
          matches={findMatches}
          onQueryChange={handleFindQueryChange}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          onClose={handleCloseFind}
          shortcut={findShortcut}
        />
      ) : null}
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
        ) : hasPage ? null : (
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
