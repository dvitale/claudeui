import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { normalizeRemoteNodeUrl } from '@/modules/remote-nodes/ConnectRemoteNodeModal';
import { parseStoredRemoteNodes } from '@/modules/remote-nodes/context/RemoteNodesContext';
import { RemoteNodesShell, useRemoteNodes } from '@/modules/remote-nodes';
import { readUserPreference, resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Remote nodes are other CloudCLI servers shown as tabs, each embedding that
 * server's own UI. The local UI must stay mounted while a remote tab is showing,
 * and a node's iframe must not be created until its tab is first opened.
 */

const NODE = { id: 'n1', name: 'Build box', url: 'http://192.168.1.10:3001' };

const fetchMock = vi.fn();

beforeEach(() => {
  resetUserPreferences();
  fetchMock.mockReset();
  // The preference store pushes writes to the server; keep those off the network.
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ConnectButton() {
  const remoteNodes = useRemoteNodes();
  return <button onClick={remoteNodes?.openConnectDialog}>open-connect</button>;
}

const renderShell = () =>
  render(
    <RemoteNodesShell>
      <div data-testid="local-ui">local</div>
      <ConnectButton />
    </RemoteNodesShell>,
  );

test('normalizeRemoteNodeUrl defaults to http, keeps a path prefix and rejects other schemes', () => {
  assert.equal(normalizeRemoteNodeUrl('192.168.1.10:3001'), 'http://192.168.1.10:3001');
  assert.equal(normalizeRemoteNodeUrl(' https://box.lan/ai/?x=1#y '), 'https://box.lan/ai');
  assert.equal(normalizeRemoteNodeUrl('http://box.lan/'), 'http://box.lan');
  assert.equal(normalizeRemoteNodeUrl('ftp://box.lan'), null);
  assert.equal(normalizeRemoteNodeUrl(''), null);
});

test('parseStoredRemoteNodes drops malformed entries', () => {
  assert.deepEqual(parseStoredRemoteNodes(null), []);
  assert.deepEqual(parseStoredRemoteNodes([NODE, { id: 1 }, 'x']), [NODE]);
});

test('without saved nodes the local UI renders with no tab strip', () => {
  renderShell();
  assert.ok(screen.getByTestId('local-ui'));
  assert.equal(screen.queryByRole('tablist'), null);
});

test('a node tab creates its iframe on first open and keeps both UIs mounted when switching', () => {
  writeUserPreference('remoteNodes', [NODE]);
  const { container } = renderShell();

  assert.ok(screen.getByRole('tablist'));
  assert.equal(container.querySelector('iframe'), null, 'iframe must not load before the tab is opened');

  fireEvent.click(screen.getByTitle(NODE.url));
  const iframe = container.querySelector('iframe');
  assert.ok(iframe);
  assert.equal(iframe.getAttribute('src'), `${NODE.url}/`);
  assert.ok(screen.getByTestId('local-ui').parentElement?.classList.contains('hidden'));

  fireEvent.click(screen.getByRole('tab', { name: /localTab/ }));
  assert.equal(container.querySelector('iframe'), iframe, 'iframe stays mounted on the local tab');
  assert.ok(iframe.classList.contains('hidden'));
  assert.ok(!screen.getByTestId('local-ui').parentElement?.classList.contains('hidden'));
});

test('removing a node after confirmation deletes it and returns to the local tab', () => {
  writeUserPreference('remoteNodes', [NODE]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { container } = renderShell();

  fireEvent.click(screen.getByTitle(NODE.url));
  fireEvent.click(screen.getByLabelText('remoteNodes.remove'));

  assert.deepEqual(readUserPreference('remoteNodes', null), []);
  assert.equal(container.querySelector('iframe'), null);
  assert.equal(screen.queryByRole('tablist'), null);
});

test('connecting probes /health, then saves the node and opens its tab', async () => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
    String(input).endsWith('/health')
      ? new Response(JSON.stringify({ status: 'ok', version: '1.37.4' }), { status: 200 })
      : new Response('{}', { status: 200 }),
  );
  const { container } = renderShell();

  fireEvent.click(screen.getByText('open-connect'));
  fireEvent.change(screen.getByPlaceholderText('http://192.168.1.10:3001'), {
    target: { value: '10.0.0.5:3001' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'remoteNodes.connect' }));
  });

  assert.ok(fetchMock.mock.calls.some(([input]) => String(input) === 'http://10.0.0.5:3001/health'));
  const saved = readUserPreference<Array<{ name: string; url: string }>>('remoteNodes', []);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].url, 'http://10.0.0.5:3001');
  assert.equal(saved[0].name, '10.0.0.5:3001', 'name falls back to the host');
  assert.equal(container.querySelector('iframe')?.getAttribute('src'), 'http://10.0.0.5:3001/');
});

test('an unreachable node is not saved until the user chooses to add it anyway', async () => {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/health')) throw new TypeError('Failed to fetch');
    return new Response('{}', { status: 200 });
  });
  renderShell();

  fireEvent.click(screen.getByText('open-connect'));
  fireEvent.change(screen.getByPlaceholderText('http://192.168.1.10:3001'), {
    target: { value: 'http://10.0.0.6:3001' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'remoteNodes.connect' }));
  });

  assert.ok(screen.getByRole('alert'));
  assert.deepEqual(readUserPreference('remoteNodes', []), []);

  fireEvent.click(screen.getByRole('button', { name: 'remoteNodes.connectAnyway' }));
  assert.equal(readUserPreference<unknown[]>('remoteNodes', []).length, 1);
});
