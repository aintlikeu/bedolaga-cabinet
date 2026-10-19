// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ruLocale from '@/locales/ru.json';
import { ToastProvider } from '@/components/Toast';
import { PlatformProvider } from '@/platform/PlatformProvider';

/**
 * Раздел «Функции»: переключатели пишут в те же ключи, что дерево настроек,
 * «Брендинг» и колесо, и честно показывают, когда переключатель ничего не даст.
 */

const f = ruLocale.admin.features;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ruLocale);
      return typeof value === 'string' ? value : key;
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
  nav: { items: [] as { id: string; visible: boolean }[] },
  navPuts: [] as { id: string; visible: boolean }[][],
  /** Ответы на PUT раскладки, отпускаемые тестом по одному. */
  navRelease: [] as (() => void)[],
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
        return new Promise((resolve) => {
          backend.navRelease.push(() => {
            backend.nav = structuredClone(layout);
            resolve(structuredClone(layout));
          });
        });
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
  backend.navRelease = [];
});
afterEach(cleanup);

async function renderTab(onOpenSection?: (section: string) => void) {
  const { FeaturesTab } = await import('./FeaturesTab');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PlatformProvider>
          <MemoryRouter>
            <FeaturesTab onOpenSection={onOpenSection} />
          </MemoryRouter>
        </PlatformProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  await screen.findByText(f.intro);
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
  it('включает функцию через её настройку бота', async () => {
    await renderTab();
    const toggle = switchIn('simple_subscription', f.toggles.enabled);
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);

    await vi.waitFor(() =>
      expect(backend.updates).toEqual([{ key: 'SIMPLE_SUBSCRIPTION_ENABLED', value: 'true' }]),
    );
  });

  it('подарки включаются через эндпоинт брендинга, кнопка — своей настройкой', async () => {
    await renderTab();
    await vi.waitFor(() =>
      expect((switchIn('gifts', f.toggles.enabled) as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(switchIn('gifts', f.toggles.enabled));
    await vi.waitFor(() => expect(backend.giftUpdates).toEqual([true]));

    fireEvent.click(switchIn('gifts', f.toggles.botButton));
    await vi.waitFor(() =>
      expect(backend.updates).toEqual([{ key: 'GIFT_BUTTON_VISIBLE', value: 'false' }]),
    );
  });

  it('повторный клик, пока запрос в полёте, не отправляет второй', async () => {
    await renderTab();
    backend.hold = () => {};
    const toggle = switchIn('simple_subscription', f.toggles.enabled);

    fireEvent.click(toggle);
    await vi.waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(toggle);

    expect(backend.updates).toHaveLength(1);
    backend.hold?.();
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
    expect(within(card('balance')).queryByText(f.hints.envLocked)).toBeTruthy();
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

  it('скрывает пункт навигации кабинета, отправляя раскладку целиком', async () => {
    await renderTab();
    const toggle = switchIn('balance', f.toggles.cabinet);
    await vi.waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(toggle);
    await vi.waitFor(() => expect(backend.navPuts).toHaveLength(1));
    backend.navRelease.shift()?.();

    const sent = backend.navPuts[0];
    expect(sent.map((item) => item.id)).toEqual(backend.nav.items.map((item) => item.id));
    expect(sent.find((item) => item.id === 'balance')?.visible).toBe(false);
    expect(sent.filter((item) => !item.visible)).toHaveLength(1);
  });

  it('две быстрые правки навигации подряд не затирают друг друга', async () => {
    await renderTab();
    const balance = switchIn('balance', f.toggles.cabinet);
    const info = switchIn('info', f.toggles.cabinet);
    await vi.waitFor(() => expect((info as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(balance);
    fireEvent.click(info);
    await vi.waitFor(() => expect(backend.navPuts).toHaveLength(2));
    backend.navRelease.shift()?.();
    backend.navRelease.shift()?.();

    // Второй PUT несёт обе правки: он посчитан от уже обновлённого кэша.
    const hidden = backend.navPuts[1].filter((item) => !item.visible).map((item) => item.id);
    expect(hidden.sort()).toEqual(['balance', 'info']);
  });
});
