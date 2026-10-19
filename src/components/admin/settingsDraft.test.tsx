// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ruLocale from '@/locales/ru.json';
import { ToastProvider } from '@/components/Toast';
import { PlatformProvider } from '@/platform/PlatformProvider';
import { useAuthStore } from '@/store/auth';
import type { User } from '@/types';
import type { SettingDefinition } from '../../api/adminSettings';

/**
 * Строки дерева настроек пишут в черновик страницы: правка и сброс уходят по
 * «Сохранить», кнопка в строке отменяет несохранённую правку.
 */

const d = ruLocale.admin.settingsDraft;
const s = ruLocale.admin.settings;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown> | string) => {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ruLocale);
      if (typeof value !== 'string') return typeof options === 'string' ? options : key;
      return value.replace(/\{\{(\w+)\}\}/g, (_, name) =>
        String((options as Record<string, unknown>)?.[name] ?? ''),
      );
    },
    i18n: { language: 'ru', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const api = vi.hoisted(() => ({
  updates: [] as { key: string; value: unknown }[],
  resets: [] as string[],
}));

vi.mock('@/api/adminSettings', () => ({
  adminSettingsApi: {
    updateSetting: (key: string, value: unknown) => {
      api.updates.push({ key, value });
      return Promise.resolve({ key, current: value });
    },
    resetSetting: (key: string) => {
      api.resets.push(key);
      return Promise.resolve({ key });
    },
  },
}));

beforeEach(() => {
  api.updates = [];
  api.resets = [];
  window.sessionStorage.clear();
  useAuthStore.setState({ user: { id: 1 } as User });
});
afterEach(cleanup);

function setting(partial: Partial<SettingDefinition> & { key: string }): SettingDefinition {
  return {
    name: partial.key
      .split('_')
      .map((part) => part[0] + part.slice(1).toLowerCase())
      .join(' '),
    category: { key: 'X', label: 'X' },
    type: 'bool',
    is_optional: false,
    current: true,
    original: true,
    has_override: false,
    read_only: false,
    env_locked: false,
    choices: [],
    hint: null,
    ...partial,
  };
}

async function renderRows(settings: SettingDefinition[]) {
  const { DraftSettingRow } = await import('./DraftSettingRow');
  const { SettingsDraftBar, SettingsDraftProvider } = await import('./settingsDraft');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PlatformProvider>
          <SettingsDraftProvider>
            {settings.map((item) => (
              <DraftSettingRow
                key={item.key}
                setting={item}
                isFavorite={false}
                onToggleFavorite={() => {}}
              />
            ))}
            <SettingsDraftBar />
          </SettingsDraftProvider>
        </PlatformProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function bar() {
  return screen.getByRole('region', { name: d.region });
}

describe('черновик строк настроек', () => {
  it('правка переключателя видна сразу, а уходит по «Сохранить»', async () => {
    await renderRows([setting({ key: 'INFO_BUTTON_VISIBLE' })]);
    const toggle = screen.getByRole('switch');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(d.unsaved)).toBeTruthy();
    expect(api.updates).toEqual([]);

    fireEvent.click(within(bar()).getByRole('button', { name: ruLocale.common.save }));
    await vi.waitFor(() =>
      expect(api.updates).toEqual([{ key: 'INFO_BUTTON_VISIBLE', value: 'false' }]),
    );
  });

  it('кнопка в строке отменяет несохранённую правку', async () => {
    await renderRows([setting({ key: 'INFO_BUTTON_VISIBLE' })]);
    fireEvent.click(screen.getByRole('switch'));

    fireEvent.click(screen.getByRole('button', { name: d.undo }));

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('region', { name: d.region })).toBeNull();
  });

  it('сброс к значению по умолчанию тоже копится и уходит DELETE', async () => {
    await renderRows([
      setting({ key: 'INFO_BUTTON_VISIBLE', current: false, original: true, has_override: true }),
    ]);

    fireEvent.click(screen.getByRole('button', { name: s.reset }));
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(d.willReset)).toBeTruthy();

    fireEvent.click(within(bar()).getByRole('button', { name: ruLocale.common.save }));
    await vi.waitFor(() => expect(api.resets).toEqual(['INFO_BUTTON_VISIBLE']));
  });

  it('испорченный черновик в sessionStorage не ломает страницу', async () => {
    window.sessionStorage.setItem(
      'admin-settings-draft',
      JSON.stringify([{ kind: 'set', key: 1 }, 'мусор', { kind: 'nav', id: 'balance' }]),
    );
    await renderRows([setting({ key: 'INFO_BUTTON_VISIBLE' })]);

    expect(screen.queryByRole('region', { name: d.region })).toBeNull();
  });

  it('секрет не попадает в sessionStorage, остальные правки — да', async () => {
    const { SettingsDraftProvider, useSettingsDraft } = await import('./settingsDraft');
    function PutSecret() {
      const draft = useSettingsDraft();
      return (
        <button
          type="button"
          onClick={() => {
            draft.put(
              {
                kind: 'set',
                key: 'LAVA_SECRET_KEY',
                value: 'sk-live-123',
                label: 'k',
                secret: true,
              },
              '••••',
            );
            draft.put(
              { kind: 'set', key: 'INFO_BUTTON_VISIBLE', value: 'false', label: 'i' },
              true,
            );
          }}
        >
          put
        </button>
      );
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <PlatformProvider>
            <SettingsDraftProvider>
              <PutSecret />
            </SettingsDraftProvider>
          </PlatformProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'put' }));
    const stored = () => window.sessionStorage.getItem('admin-settings-draft') ?? '';

    await vi.waitFor(() => expect(stored()).toContain('INFO_BUTTON_VISIBLE'));
    expect(stored()).not.toContain('sk-live-123');
    expect(stored()).not.toContain('LAVA_SECRET_KEY');
  });

  it('черновик другого админа в той же вкладке не подхватывается', async () => {
    window.sessionStorage.setItem(
      'admin-settings-draft',
      JSON.stringify({
        userId: 2,
        changes: [{ kind: 'set', key: 'INFO_BUTTON_VISIBLE', value: 'false', label: 'x' }],
      }),
    );
    await renderRows([setting({ key: 'INFO_BUTTON_VISIBLE' })]);

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('region', { name: d.region })).toBeNull();
  });
});
