import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';
import { useRemoteNodes } from '@/modules/remote-nodes/context/RemoteNodesContext';

const HEALTH_PROBE_TIMEOUT_MS = 5000;

/**
 * Turns user input such as `192.168.1.10:3001` or `https://box.lan/ai/` into the
 * base URL stored for a node: scheme defaults to http, query and hash are
 * dropped, a reverse-proxy path prefix is kept, and the trailing slash removed.
 * Returns null for anything that is not an http(s) URL.
 * Exported for this module's tests.
 */
export function normalizeRemoteNodeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

type ProbeResult = { ok: true; version: string | null } | { ok: false };

/** Asks the node's public /health endpoint (CORS-enabled on CloudCLI servers) whether it is reachable. */
async function probeRemoteNode(baseUrl: string): Promise<ProbeResult> {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) });
    if (!response.ok) return { ok: false };
    const payload = (await response.json()) as { status?: unknown; version?: unknown };
    if (payload.status !== 'ok') return { ok: false };
    return { ok: true, version: typeof payload.version === 'string' ? payload.version : null };
  } catch {
    return { ok: false };
  }
}

/** Rendered by RemoteNodesShell; collects a node's address, checks it answers, and adds it as a tab. */
export default function ConnectRemoteNodeModal() {
  const { t } = useTranslation('common');
  const remoteNodes = useRemoteNodes();

  // Controlled form fields; the name is optional and falls back to the host.
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  // Validation or reachability message shown under the form.
  const [error, setError] = useState<string | null>(null);
  // True while /health is being probed, to disable the form and show a spinner.
  const [isProbing, setIsProbing] = useState(false);
  // Set after a failed probe so the user can still add a node that is behind a proxy without CORS.
  const [canConnectAnyway, setCanConnectAnyway] = useState(false);

  if (!remoteNodes) return null;
  const { isConnectDialogOpen, closeConnectDialog, addNode } = remoteNodes;

  const reset = () => {
    setName('');
    setAddress('');
    setError(null);
    setIsProbing(false);
    setCanConnectAnyway(false);
  };

  const close = () => {
    reset();
    closeConnectDialog();
  };

  const finish = (url: string) => {
    addNode({ name: name.trim() || new URL(url).host, url });
    close();
  };

  const handleSubmit = async (event: FormEvent, skipProbe = false) => {
    event.preventDefault();
    setCanConnectAnyway(false);

    const url = normalizeRemoteNodeUrl(address);
    if (!url) {
      setError(t('remoteNodes.errors.invalidUrl'));
      return;
    }
    if (new URL(url).origin === window.location.origin) {
      setError(t('remoteNodes.errors.sameNode'));
      return;
    }
    // Browsers block an http page inside an https one (mixed content); the tab would stay blank.
    if (window.location.protocol === 'https:' && url.startsWith('http:')) {
      setError(t('remoteNodes.errors.mixedContent'));
      return;
    }
    if (skipProbe) {
      finish(url);
      return;
    }

    setError(null);
    setIsProbing(true);
    const result = await probeRemoteNode(url);
    setIsProbing(false);

    if (result.ok) {
      finish(url);
    } else {
      setError(t('remoteNodes.errors.unreachable', { url }));
      setCanConnectAnyway(true);
    }
  };

  return (
    <Dialog open={isConnectDialogOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md p-6">
        <DialogTitle className="not-sr-only text-lg font-semibold">{t('remoteNodes.dialogTitle')}</DialogTitle>
        <p className="mt-1 text-sm text-muted-foreground">{t('remoteNodes.dialogDescription')}</p>

        <form className="mt-4 space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('remoteNodes.addressLabel')}</span>
            <Input
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setCanConnectAnyway(false);
              }}
              placeholder="http://192.168.1.10:3001"
              autoComplete="off"
              spellCheck={false}
              disabled={isProbing}
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t('remoteNodes.nameLabel')}</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('remoteNodes.namePlaceholder')}
              disabled={isProbing}
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={close}>
              {t('buttons.cancel')}
            </Button>
            {canConnectAnyway && (
              <Button type="button" variant="outline" onClick={(event) => void handleSubmit(event, true)}>
                {t('remoteNodes.connectAnyway')}
              </Button>
            )}
            <Button type="submit" disabled={isProbing}>
              {isProbing && <Loader2 className="animate-spin" />}
              {t('remoteNodes.connect')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
