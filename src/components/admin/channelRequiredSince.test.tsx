// @vitest-environment jsdom
// vpn1
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ruLocale from '@/locales/ru.json';

/**
 * «Не проверять старых пользователей» на странице обязательных подписок:
 * пишет CHANNEL_REQUIRED_SINCE в бот, спрашивает подтверждение на всё, что
 * может выключить VPN старым, и не отправляет будущую дату.
 */

const rs = ruLocale.admin.channelSubscriptions.requiredSince;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ruLocale);
      if (typeof value !== 'string') return key;
      return value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'ru', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

interface FakeSetting {
  key: string;
  current: unknown;
  env_locked?: boolean;
}

const backend = vi.hoisted(() => ({
  settings: [] as FakeSetting[],
  updates: [] as { key: string; value: unknown }[],
  resets: [] as string[],
  hold: null as null | (() => void),
  fail: false,
  confirmAnswer: true,
  confirms: [] as string[],
  errors: [] as string[],
}));

vi.mock('@/api/adminSettings', () => ({
  adminSettingsApi: {
    getSettings: () =>
      Promise.resolve(
        backend.settings.map((item) => ({
          ...item,
          env_locked: item.env_locked ?? false,
          read_only: false,
        })),
      ),
    updateSetting: (key: string, value: unknown) => {
      backend.updates.push({ key, value });
      if (backend.fail) return Promise.reject(new Error('400'));
      return new Promise((resolve) => {
        const finish = () => resolve({ key, current: value });
        if (backend.hold === null) finish();
        else backend.hold = finish;
      });
    },
    resetSetting: (key: string) => {
      backend.resets.push(key);
      return Promise.resolve({ key, current: null });
    },
  },
}));

vi.mock('@/api/adminChannels', () => ({
  adminChannelsApi: {
    list: () => Promise.resolve({ items: [], total: 0 }),
    toggle: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/platform', () => ({
  useHaptic: () => ({ impact: () => {}, notification: () => {} }),
  useNotify: () => ({
    success: () => {},
    error: (message: string) => backend.errors.push(message),
  }),
}));

vi.mock('@/platform/hooks/useNativeDialog', () => ({
  useNativeDialog: () => ({
    confirm: (message: string) => {
      backend.confirms.push(message);
      return Promise.resolve(backend.confirmAnswer);
    },
  }),
}));

vi.mock('@/components/admin', () => ({ AdminBackButton: () => null }));

const KEY = 'CHANNEL_REQUIRED_SINCE';

beforeEach(() => {
  backend.settings = [
    { key: 'CHANNEL_IS_REQUIRED_SUB', current: false },
    { key: 'CHANNEL_DISABLE_TRIAL_ON_UNSUBSCRIBE', current: true },
    { key: 'CHANNEL_REQUIRED_FOR_ALL', current: false },
    { key: KEY, current: null },
  ];
  backend.updates = [];
  backend.resets = [];
  backend.hold = null;
  backend.fail = false;
  backend.confirmAnswer = true;
  backend.confirms = [];
  backend.errors = [];
});

afterEach(cleanup);

async function renderPage() {
  const { default: Page } = await import('@/pages/AdminChannelSubscriptions');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const setting = (key: string): FakeSetting => {
  const found = backend.settings.find((s) => s.key === key);
  if (!found) throw new Error(`нет настройки ${key}`);
  return found;
};

describe('дата отсечки обязательной подписки', () => {
  it('бот без настройки — блока нет', async () => {
    backend.settings = backend.settings.filter((s) => s.key !== KEY);
    await renderPage();
    await screen.findByText(ruLocale.admin.channelSubscriptions.globalSettings.channelRequired);
    expect(screen.queryByText(rs.title)).toBeNull();
  });

  it('не задана: подсказка и «сейчас» без подтверждения', async () => {
    await renderPage();
    await screen.findByText(rs.notSet);
    expect(screen.getByText(rs.setBeforeEnabling)).toBeTruthy();
    expect(screen.queryByText(rs.reset)).toBeNull();

    fireEvent.click(screen.getByText(rs.setNow));
    await vi.waitFor(() => expect(backend.updates).toEqual([{ key: KEY, value: 'now' }]));
    expect(backend.confirms).toEqual([]);
  });

  it('задана: показывает дату, замена спрашивает, отказ ничего не шлёт', async () => {
    setting(KEY).current = '2026-11-03T20:15:00+00:00';
    await renderPage();
    await screen.findByText(/^Действует с /);

    backend.confirmAnswer = false;
    fireEvent.click(screen.getByText(rs.setNow));
    await vi.waitFor(() => expect(backend.confirms).toEqual([rs.confirmReplace]));
    expect(backend.updates).toEqual([]);
  });

  it('сброс при включённой подписке предупреждает о VPN', async () => {
    setting(KEY).current = '2026-11-03T20:15:00+00:00';
    setting('CHANNEL_IS_REQUIRED_SUB').current = true;
    await renderPage();

    fireEvent.click(await screen.findByText(rs.reset));
    await vi.waitFor(() => expect(backend.resets).toEqual([KEY]));
    expect(backend.confirms).toEqual([rs.confirmResetActive]);
  });

  it('включена подписка без даты — предупреждение', async () => {
    setting('CHANNEL_IS_REQUIRED_SUB').current = true;
    await renderPage();
    expect(await screen.findByText(rs.warnActiveWithoutDate)).toBeTruthy();
  });

  it('дата в будущем не отправляется', async () => {
    await renderPage();
    const input = await screen.findByLabelText(rs.manualLabel);
    fireEvent.change(input, { target: { value: '2999-01-01T10:00' } });
    fireEvent.click(screen.getByText(ruLocale.common.save));

    expect(backend.errors).toEqual([rs.future]);
    expect(backend.updates).toEqual([]);
  });

  it('дата в прошлом уходит в ISO UTC', async () => {
    await renderPage();
    const input = await screen.findByLabelText(rs.manualLabel);
    fireEvent.change(input, { target: { value: '2026-10-05T15:00' } });
    fireEvent.click(screen.getByText(ruLocale.common.save));

    await vi.waitFor(() => expect(backend.updates).toHaveLength(1));
    const sent = backend.updates[0].value as string;
    expect(sent).toMatch(/Z$/);
    expect(new Date(sent).getTime()).toBe(new Date('2026-10-05T15:00').getTime());
  });

  it('повторный клик во время сохранения не шлёт второй запрос', async () => {
    backend.hold = () => {};
    await renderPage();
    const button = await screen.findByText(rs.setNow);

    fireEvent.click(button);
    await vi.waitFor(() => expect(backend.updates).toHaveLength(1));
    await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    expect(backend.updates).toHaveLength(1);

    backend.hold?.();
  });

  it('ошибка бэка показывается', async () => {
    backend.fail = true;
    await renderPage();
    fireEvent.click(await screen.findByText(rs.setNow));
    await vi.waitFor(() => expect(backend.errors).toEqual([ruLocale.common.error]));
  });
});

describe('включение «Требовать подписку»', () => {
  const toggleOf = async () => {
    const label = await screen.findByText(
      ruLocale.admin.channelSubscriptions.globalSettings.channelRequired,
    );
    const toggle = label.closest('div')?.parentElement?.querySelector('button');
    if (!toggle) throw new Error('переключатель не найден');
    await vi.waitFor(() => expect(toggle.disabled).toBe(false));
    return toggle;
  };

  it('без даты спрашивает, отказ ничего не включает', async () => {
    await renderPage();
    backend.confirmAnswer = false;
    fireEvent.click(await toggleOf());

    await vi.waitFor(() => expect(backend.confirms).toEqual([rs.confirmEnableWithoutDate]));
    expect(backend.updates).toEqual([]);
  });

  it('с датой включается без вопросов', async () => {
    setting(KEY).current = '2026-11-03T20:15:00+00:00';
    await renderPage();
    fireEvent.click(await toggleOf());

    await vi.waitFor(() =>
      expect(backend.updates).toEqual([{ key: 'CHANNEL_IS_REQUIRED_SUB', value: true }]),
    );
    expect(backend.confirms).toEqual([]);
  });
});
