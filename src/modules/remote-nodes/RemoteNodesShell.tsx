import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Monitor, Plus, RotateCw, Server, X } from 'lucide-react';

import { cn } from '@/shared/utils';
import ConnectRemoteNodeModal from '@/modules/remote-nodes/ConnectRemoteNodeModal';
import {
  LOCAL_TAB_ID,
  REMOTE_NODES_AVAILABLE,
  RemoteNodesProvider,
  useRemoteNodes,
} from '@/modules/remote-nodes/context/RemoteNodesContext';

function RemoteNodesLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation('common');
  // Non-null: this component only renders inside RemoteNodesProvider.
  const remoteNodes = useRemoteNodes()!;
  const { nodes, activeTabId, openedNodeIds, selectTab, removeNode, openConnectDialog } = remoteNodes;

  // Bumped per node by the reload button; a new iframe key forces a fresh load of that node only.
  const [reloadCounters, setReloadCounters] = useState<Record<string, number>>({});

  const activeNode = nodes.find((node) => node.id === activeTabId) ?? null;

  const handleRemove = (nodeId: string, nodeName: string) => {
    if (window.confirm(t('remoteNodes.confirmRemove', { name: nodeName }))) {
      removeNode(nodeId);
    }
  };

  const tabClassName = (isActive: boolean) =>
    cn(
      'group flex h-full max-w-[14rem] flex-shrink-0 items-center gap-1.5 border-r border-border/60 px-3 text-sm transition-colors',
      isActive
        ? 'bg-background text-foreground'
        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
    );

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      {/* The strip appears only once a node exists, so a single-node install looks unchanged. */}
      {nodes.length > 0 && (
        <div
          role="tablist"
          aria-label={t('remoteNodes.tabsLabel')}
          className="flex h-9 flex-shrink-0 items-stretch border-b border-border bg-muted/40"
        >
          <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
            <button
              type="button"
              role="tab"
              aria-selected={activeTabId === LOCAL_TAB_ID}
              className={tabClassName(activeTabId === LOCAL_TAB_ID)}
              onClick={() => selectTab(LOCAL_TAB_ID)}
              title={window.location.host}
            >
              <Monitor className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{t('remoteNodes.localTab')}</span>
            </button>

            {nodes.map((node) => {
              const isActive = node.id === activeTabId;
              return (
                <div key={node.id} className={tabClassName(isActive)}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className="flex min-w-0 items-center gap-1.5"
                    onClick={() => selectTab(node.id)}
                    title={node.url}
                  >
                    <Server className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{node.name}</span>
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 opacity-60 hover:bg-accent hover:opacity-100"
                    onClick={() => handleRemove(node.id, node.name)}
                    aria-label={t('remoteNodes.remove', { name: node.name })}
                    title={t('remoteNodes.remove', { name: node.name })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              className="flex flex-shrink-0 items-center px-2.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              onClick={openConnectDialog}
              aria-label={t('remoteNodes.connectTitle')}
              title={t('remoteNodes.connectTitle')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {activeNode && (
            <div className="flex flex-shrink-0 items-center gap-0.5 px-1.5">
              <button
                type="button"
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() =>
                  setReloadCounters((previous) => ({ ...previous, [activeNode.id]: (previous[activeNode.id] ?? 0) + 1 }))
                }
                aria-label={t('remoteNodes.reload')}
                title={t('remoteNodes.reload')}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <a
                href={`${activeNode.url}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t('remoteNodes.openInNewWindow')}
                title={t('remoteNodes.openInNewWindow')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {/* Layout containment makes this box the containing block for the local
            UI's `fixed inset-0` shell, so it sits below the tab strip instead of
            under it. Hidden, not unmounted: the local session keeps running. */}
        <div className={cn('absolute inset-0 [contain:layout]', activeTabId !== LOCAL_TAB_ID && 'hidden')}>
          {children}
        </div>

        {nodes
          .filter((node) => openedNodeIds.has(node.id))
          .map((node) => (
            <iframe
              key={`${node.id}:${reloadCounters[node.id] ?? 0}`}
              src={`${node.url}/`}
              title={node.name}
              allow="clipboard-read; clipboard-write; microphone; fullscreen"
              className={cn('absolute inset-0 h-full w-full border-0 bg-background', node.id !== activeTabId && 'hidden')}
            />
          ))}
      </div>

      <ConnectRemoteNodeModal />
    </div>
  );
}

/**
 * Used by App to wrap the authenticated UI. Adds a tab per saved remote node,
 * each embedding that node's own CloudCLI UI, next to a tab for this server.
 * In platform mode or inside an embedded node it renders its children untouched.
 */
export function RemoteNodesShell({ children }: { children: ReactNode }) {
  if (!REMOTE_NODES_AVAILABLE) return <>{children}</>;

  return (
    <RemoteNodesProvider>
      <RemoteNodesLayout>{children}</RemoteNodesLayout>
    </RemoteNodesProvider>
  );
}
