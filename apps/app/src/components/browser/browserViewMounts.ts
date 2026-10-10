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
    if (current.claimed === mountId)
      current.claimed = current.mounts.at(-1) ?? null;
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
  return {
    isOwner: claimed === null || claimed === mountId,
    generation,
    claim,
  };
}

export function resetBrowserViewMountsForTest(): void {
  records.clear();
}
