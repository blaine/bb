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
  readBrowserViewPlacement,
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
    return readBrowserViewPlacement(element).bounds;
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
    window.addEventListener(
      BROWSER_VIEW_BOUNDS_SYNC_EVENT,
      syncBoundsIfChanged,
    );
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
