import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { IS_PLATFORM } from '@/shared/utils';
import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type { RemoteNode } from '@/shared/types';

/** Tab id of this server's own UI; every other tab id is a RemoteNode id. Used by RemoteNodesShell. */
export const LOCAL_TAB_ID = 'local';

type RemoteNodesContextValue = {
  nodes: RemoteNode[];
  activeTabId: string;
  /** Node ids whose iframe has been created; kept mounted so switching tabs never reloads them. */
  openedNodeIds: ReadonlySet<string>;
  isConnectDialogOpen: boolean;
  selectTab: (tabId: string) => void;
  addNode: (node: Omit<RemoteNode, 'id'>) => void;
  removeNode: (nodeId: string) => void;
  openConnectDialog: () => void;
  closeConnectDialog: () => void;
};

const RemoteNodesContext = createContext<RemoteNodesContextValue | null>(null);

/**
 * Remote tabs make no sense in the hosted platform, and a node already embedded
 * in another node's tab must not offer tabs of its own (tabs inside tabs).
 * Neither condition changes at runtime, so it is evaluated once. Used by
 * RemoteNodesShell to decide whether to mount the provider at all.
 */
export const REMOTE_NODES_AVAILABLE = (() => {
  if (IS_PLATFORM || typeof window === 'undefined') return false;
  try {
    return window.self === window.top;
  } catch {
    // Cross-origin parent: reading window.top throws, so we are framed.
    return false;
  }
})();

/** Drops malformed entries, since the stored value is synced from the server and may predate this shape. Exported for this module's tests. */
export function parseStoredRemoteNodes(value: unknown): RemoteNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is RemoteNode =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.id === 'string' &&
      typeof entry.name === 'string' &&
      typeof entry.url === 'string',
  );
}

const readRawRemoteNodes = () => readUserPreference<unknown>('remoteNodes', null);

// crypto.randomUUID is unavailable on plain-http LAN addresses (not a secure context).
const createNodeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Rendered by RemoteNodesShell; owns the saved node list and which tab is showing. */
export function RemoteNodesProvider({ children }: { children: ReactNode }) {
  // The raw preference keeps a stable reference until it changes, which useSyncExternalStore requires.
  const rawNodes = useSyncExternalStore(subscribeToUserPreferences, readRawRemoteNodes);
  const nodes = useMemo(() => parseStoredRemoteNodes(rawNodes), [rawNodes]);

  // Which tab is visible; the local UI stays mounted underneath while a remote tab shows.
  const [selectedTabId, setSelectedTabId] = useState<string>(LOCAL_TAB_ID);
  // Iframes are created on first visit only, so saved nodes do not all load at startup.
  const [openedNodeIds, setOpenedNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  // Whether the "connect to remote node" form is showing.
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);

  // A node removed on another device falls back to the local tab instead of a blank panel.
  const activeTabId = nodes.some((node) => node.id === selectedTabId) ? selectedTabId : LOCAL_TAB_ID;

  const selectTab = useCallback((tabId: string) => {
    setSelectedTabId(tabId);
    if (tabId !== LOCAL_TAB_ID) {
      setOpenedNodeIds((previous) => (previous.has(tabId) ? previous : new Set(previous).add(tabId)));
    }
  }, []);

  const addNode = useCallback(
    (node: Omit<RemoteNode, 'id'>) => {
      const existing = nodes.find((candidate) => candidate.url === node.url);
      if (existing) {
        selectTab(existing.id);
        return;
      }
      const created: RemoteNode = { ...node, id: createNodeId() };
      writeUserPreference('remoteNodes', [...nodes, created]);
      selectTab(created.id);
    },
    [nodes, selectTab],
  );

  const removeNode = useCallback(
    (nodeId: string) => {
      writeUserPreference(
        'remoteNodes',
        nodes.filter((node) => node.id !== nodeId),
      );
      setOpenedNodeIds((previous) => {
        const next = new Set(previous);
        next.delete(nodeId);
        return next;
      });
    },
    [nodes],
  );

  const value = useMemo<RemoteNodesContextValue>(
    () => ({
      nodes,
      activeTabId,
      openedNodeIds,
      isConnectDialogOpen,
      selectTab,
      addNode,
      removeNode,
      openConnectDialog: () => setIsConnectDialogOpen(true),
      closeConnectDialog: () => setIsConnectDialogOpen(false),
    }),
    [nodes, activeTabId, openedNodeIds, isConnectDialogOpen, selectTab, addNode, removeNode],
  );

  return <RemoteNodesContext.Provider value={value}>{children}</RemoteNodesContext.Provider>;
}

/**
 * Used by the sidebar module (connect button) and by this module's shell and form.
 * Returns null outside the provider — in platform mode, inside an embedded node,
 * and in tests that render a consumer alone — so callers simply hide the feature.
 */
export function useRemoteNodes(): RemoteNodesContextValue | null {
  return useContext(RemoteNodesContext);
}
