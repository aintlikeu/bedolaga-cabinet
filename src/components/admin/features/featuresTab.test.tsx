// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ruLocale from '@/locales/ru.json';
import { ToastProvider } from '@/components/Toast';
import { PlatformProvider } from '@/platform/PlatformProvider';
import { useAuthStore } from '@/store/auth';
import type { User } from '@/types';

/**
 * Раздел «Функции»: переключатели пишут в те же ключи, что дерево настроек,
 * «Брендинг» и колесо, и честно показывают, когда переключатель ничего не даст.
 */

const f = ruLocale.admin.features;

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
  gift: false,
  updates: [] as { key: string; value: unknown }[],
  giftUpdates: [] as boolean[],
  /** Держит PUT настройки «в полёте», пока тест его не отпустит. */
  hold: null as null | (() => void),
  /** Ключи, сохранение которых падает. */
  failKeys: new Set<string>(),
  nav: { items: [] as { id: string; visible: boolean }[] },
  navPuts: [] as { id: string; visible: boolean }[][],
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
      if (backend.failKeys.has(key)) return Promise.reject(new Error('500'));
      return new Promise((resolve) => {
        const finish = () => {
          const item = backend.settings.find((s) => s.key === key);
          if (item) item.current = value;
          resolve({ key, current: value });
        };
        if (backend.hold === null) finish();
        else backend.hold = finish;
      });
    },
  },
}));

vi.mock('@/api/branding', () => ({
  brandingApi: {
    getGiftEnabled: () => Promise.resolve({ enabled: backend.gift }),
    updateGiftEnabled: (enabled: boolean) => {
      backend.giftUpdates.push(enabled);
      backend.gift = enabled;
      return Promise.resolve({ enabled });
    },
    getEmailAuthEnabled: () => Promise.resolve({ enabled: true }),
    updateEmailAuthEnabled: (enabled: boolean) => Promise.resolve({ enabled }),
  },
}));

vi.mock('@/api/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/navigation')>();
  return {
    ...actual,
    navigationApi: {
      getLayout: () => Promise.resolve(structuredClone(backend.nav)),
      updateLayout: (layout: { items: { id: string; visible: boolean }[] }) => {
        backend.navPuts.push(structuredClone(layout.items));
        backend.nav = structuredClone(layout);
        return Promise.resolve(structuredClone(layout));
      },
    },
  };
});

vi.mock('@/api/wheel', () => ({
  adminWheelApi: {
    getConfig: () => Promise.resolve({ is_enabled: false }),
    updateConfig: (data: { is_enabled: boolean }) => Promise.resolve(data),
  },
}));

beforeEach(() => {
  backend.settings = [
    { key: 'MAIN_MENU_MODE', current: 'default' },
    { key: 'SIMPLE_SUBSCRIPTION_ENABLED', current: false },
    { key: 'CONTESTS_ENABLED', current: false },
    { key: 'CONTESTS_BUTTON_VISIBLE', current: true },
    { key: 'BALANCE_BUTTON_VISIBLE', current: true, env_locked: true },
    { key: 'INFO_BUTTON_VISIBLE', current: true },
    { key: 'GIFT_BUTTON_VISIBLE', current: true },
    { key: 'OAUTH_GOOGLE_ENABLED', current: true },
    { key: 'OAUTH_GOOGLE_CLIENT_ID', current: '' },
    { key: 'OAUTH_GOOGLE_CLIENT_SECRET', current: '' },
  ];
  backend.gift = false;
  backend.updates = [];
  backend.giftUpdates = [];
  backend.hold = null;
  backend.nav = {
    items: ['dashboard', 'subscription', 'balance', 'support', 'info', 'profile'].map((id) => ({
      id,
      visible: true,
    })),
  };
  backend.navPuts = [];
  backend.failKeys = new Set();
  window.sessionStorage.clear();
  useAuthStore.setState({ user: { id: 1 } as User });
});
afterEach(cleanup);

async function renderTab(onOpenSection?: (section: string) => void) {
  const { FeaturesTab } = await import('./FeaturesTab');
  const { SettingsDraftBar, SettingsDraftProvider } = await import('../settingsDraft');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PlatformProvider>
          <MemoryRouter>
            <SettingsDraftProvider>
              <FeaturesTab onOpenSection={onOpenSection} />
              <SettingsDraftBar />
            </SettingsDraftProvider>
          </MemoryRouter>
        </PlatformProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(f.intro);
  return view;
}

const d = ruLocale.admin.settingsDraft;

/** Нажать «Сохранить» на панели черновика. */
function saveDraft() {
  const bar = screen.getByRole('region', { name: d.region });
  fireEvent.click(within(bar).getByRole('button', { name: ruLocale.common.save }));
}

/** Дождаться, пока переключатель станет доступен (данные загружены). */
async function ready(toggle: HTMLElement) {
  await vi.waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
}

function card(featureId: keyof typeof f.items): HTMLElement {
  const heading = screen.getByRole('heading', { name: f.items[featureId].title });
  const article = heading.closest('article');
  if (!article) throw new Error(`карточка ${featureId} не найдена`);
  return article;
}

function switchIn(featureId: keyof typeof f.items, label: string): HTMLElement {
  return within(card(featureId)).getByRole('switch', {
    name: `${f.items[featureId].title}: ${label}`,
  });
}

describe('FeaturesTab', () => {
  it('правка копится в черновике и уходит только по «Сохранить»', async () => {
    await renderTab();
    const toggle = switchIn('simple_subscription', f.toggles.enabled);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(within(card('simple_subscription')).getByText(d.unsaved)).toBeTruthy();
    expect(backend.updates).toEqual([]);

    saveDraft();
    await vi.waitFor(() =>
      expect(backend.updates).toEqual([{ key: 'SIMPLE_SUBSCRIPTION_ENABLED', value: 'true' }]),
    );
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: d.region })).toBeNull());
  });

  it('повторный клик возвращает как было и снимает правку', async () => {
    await renderTab();
    const toggle = switchIn('simple_subscription', f.toggles.enabled);

    fireEvent.click(toggle);
    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByRole('region', { name: d.region })).toBeNull();
  });

  it('«Отменить» на панели сбрасывает все правки', async () => {
    await renderTab();
    fireEvent.click(switchIn('simple_subscription', f.toggles.enabled));
    fireEvent.click(switchIn('info', f.toggles.botButton));

    const bar = screen.getByRole('region', { name: d.region });
    expect(within(bar).getByText(d.count.replace('{{count}}', '2'))).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: ruLocale.common.cancel }));

    expect(switchIn('simple_subscription', f.toggles.enabled).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(backend.updates).toEqual([]);
  });

  it('подарки сохраняются через эндпоинт брендинга, кнопка — своей настройкой', async () => {
    await renderTab();
    await ready(switchIn('gifts', f.toggles.enabled));

    fireEvent.click(switchIn('gifts', f.toggles.enabled));
    fireEvent.click(switchIn('gifts', f.toggles.botButton));
    saveDraft();

    await vi.waitFor(() => expect(backend.giftUpdates).toEqual([true]));
    expect(backend.updates).toEqual([{ key: 'GIFT_BUTTON_VISIBLE', value: 'false' }]);
  });

  it('пока идёт сохранение, переключатели заблокированы', async () => {
    await renderTab();
    backend.hold = () => {};
    const toggle = switchIn('simple_subscription', f.toggles.enabled);

    fireEvent.click(toggle);
    saveDraft();
    await vi.waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(toggle);

    expect(backend.updates).toHaveLength(1);
    backend.hold?.();
  });

  it('при ошибке упавшая правка остаётся в черновике, остальные сохранены', async () => {
    backend.failKeys = new Set(['INFO_BUTTON_VISIBLE']);
    await renderTab();
    fireEvent.click(switchIn('simple_subscription', f.toggles.enabled));
    fireEvent.click(switchIn('info', f.toggles.botButton));

    saveDraft();
    await vi.waitFor(() => expect(backend.updates).toHaveLength(2));

    const bar = await screen.findByRole('region', { name: d.region });
    expect(within(bar).getByText(d.count.replace('{{count}}', '1'))).toBeTruthy();
    expect(switchIn('info', f.toggles.botButton).getAttribute('aria-checked')).toBe('false');
  });

  it('черновик переживает уход со страницы', async () => {
    const first = await renderTab();
    fireEvent.click(switchIn('simple_subscription', f.toggles.enabled));
    first.unmount();

    await renderTab();
    expect(switchIn('simple_subscription', f.toggles.enabled).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('region', { name: d.region })).toBeTruthy();
  });

  it('ключ из .env заблокирован и объясняет почему', async () => {
    await renderTab();
    const toggle = switchIn('balance', f.toggles.botButton) as HTMLButtonElement;

    expect(toggle.disabled).toBe(true);
    expect(within(card('balance')).getByText(f.hints.envLocked)).toBeTruthy();
  });

  it('кнопка выключенной функции помечена как недействующая', async () => {
    await renderTab();
    // Кнопка в боте и пункт в кабинете — оба ждут включения функции.
    expect(within(card('contests')).getAllByText(f.hints.dependsOnEnabled)).toHaveLength(2);
  });

  it('включённый вход без ключей — «Не настроено» с подсказкой', async () => {
    await renderTab();
    const google = within(card('oauth_google'));

    expect(google.getByText(f.status.needsSetup)).toBeTruthy();
    expect(google.getByText(f.requires.oauthKeys)).toBeTruthy();
  });

  it('в режиме cabinet предупреждает про кнопки главного меню', async () => {
    backend.settings[0].current = 'cabinet';
    const onOpenSection = vi.fn();
    await renderTab(onOpenSection);

    expect(screen.getByText(f.cabinetMode.title)).toBeTruthy();
    expect(within(card('info')).getByText(f.hints.cabinetMode)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: f.cabinetMode.open }));
    expect(onOpenSection).toHaveBeenCalledWith('buttons');
  });

  it('«Настроить» открывает раздел дерева', async () => {
    const onOpenSection = vi.fn();
    await renderTab(onOpenSection);

    fireEvent.click(within(card('simple_subscription')).getByRole('button', { name: f.configure }));
    expect(onOpenSection).toHaveBeenCalledWith('subs_simple');
  });

  it('поиск оставляет только подходящие карточки', async () => {
    await renderTab();
    fireEvent.change(screen.getByRole('searchbox', { name: f.search }), {
      target: { value: 'колесо' },
    });

    expect(screen.getByRole('heading', { name: f.items.wheel.title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: f.items.gifts.title })).toBeNull();
  });

  it('правки навигации кабинета уходят одним запросом с целой раскладкой', async () => {
    await renderTab();
    await ready(switchIn('balance', f.toggles.cabinet));

    fireEvent.click(switchIn('balance', f.toggles.cabinet));
    fireEvent.click(switchIn('info', f.toggles.cabinet));
    saveDraft();
    await vi.waitFor(() => expect(backend.navPuts).toHaveLength(1));

    const sent = backend.navPuts[0];
    expect(sent.map((item) => item.id)).toEqual([
      'dashboard',
      'subscription',
      'balance',
      'support',
      'info',
      'profile',
    ]);
    expect(
      sent
        .filter((item) => !item.visible)
        .map((item) => item.id)
        .sort(),
    ).toEqual(['balance', 'info']);
  });
});
