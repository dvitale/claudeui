import assert from 'node:assert/strict';

import type { TFunction } from 'i18next';
import { test } from 'vitest';

import {
  formatFullDate,
  getProjectLastActivity,
  getSessionNameTooltip,
  sortProjects,
} from '@/modules/sidebar/utils/sidebarProjectFormatting';
import type { Project } from '@/shared/types';

/**
 * The backend reports a project's last activity across all of its sessions,
 * while the sidebar only holds the first page of them plus live updates; the
 * project's date must be the later of the two.
 */

const project = (overrides: Partial<Project>): Project => ({
  projectId: 'p',
  displayName: 'p',
  fullPath: '/p',
  sessions: [],
  ...overrides,
});

test('uses the backend lastActivity when the loaded sessions are older', () => {
  const result = getProjectLastActivity(project({
    lastActivity: '2026-03-02T09:30:00.000Z',
    sessions: [{ id: 's1', lastActivity: '2026-01-01T00:00:00.000Z' }],
  }));
  assert.equal(result.toISOString(), '2026-03-02T09:30:00.000Z');
});

test('a live session update newer than the fetched list wins', () => {
  const result = getProjectLastActivity(project({
    lastActivity: '2026-03-02T09:30:00.000Z',
    sessions: [{ id: 's1', lastActivity: '2026-03-05T12:00:00.000Z' }],
  }));
  assert.equal(result.toISOString(), '2026-03-05T12:00:00.000Z');
});

test('a project without sessions or dates reports the epoch', () => {
  assert.equal(getProjectLastActivity(project({ lastActivity: null })).getTime(), 0);
  assert.equal(getProjectLastActivity(project({ lastActivity: 'not a date' })).getTime(), 0);
});

test('date sorting follows the backend lastActivity', () => {
  const older = project({ projectId: 'older', lastActivity: '2026-01-01T00:00:00.000Z' });
  const newer = project({ projectId: 'newer', lastActivity: '2026-02-01T00:00:00.000Z' });
  assert.deepEqual(sortProjects([older, newer], 'date').map((entry) => entry.projectId), ['newer', 'older']);
});

// Echoes the key and the interpolated date, so assertions do not depend on translations.
const t = ((key: string, options?: { date?: string }) => (options?.date ? `${key}=${options.date}` : key)) as unknown as TFunction;

test('the session-name tooltip lists the full name, creation and last activity', () => {
  const created = '2026-03-01T08:00:00.000Z';
  const updated = '2026-03-02T09:30:00.000Z';
  assert.equal(
    getSessionNameTooltip({ id: 's1', summary: 'Fix login', createdAt: created, lastActivity: updated, __provider: 'claude' }, t),
    [
      'Fix login',
      `sessions.createdAt=${formatFullDate(new Date(created))}`,
      `sessions.lastActivity=${formatFullDate(new Date(updated))}`,
    ].join('\n'),
  );
});

test('the session-name tooltip skips dates that are missing or invalid', () => {
  assert.equal(
    getSessionNameTooltip({ id: 's1', summary: 'Fix login', lastActivity: 'garbage', __provider: 'claude' }, t),
    'Fix login',
  );
});
