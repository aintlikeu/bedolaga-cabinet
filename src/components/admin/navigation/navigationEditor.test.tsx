// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ruLocale from '@/locales/ru.json';
import { ToastProvider } from '@/components/Toast';
import { PlatformProvider } from '@/platform/PlatformProvider';
import { moveItem, sameOrderAndVisibility } from '../OrderedToggleList';

/** Редактор навигации кабинета: порядок, скрытие, обязательные пункты и предпросмотр. */

const e = ruLocale.admin.navEditor;
const nav = ruLocale.nav;

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

const IDS = [
  'dashboard',
  'subscription',
  'balance',
  'referral',
  'gift',
  'wheel',
  'contests',
  'polls',
  'support',
  'info',
  'profile',
];

const backend = vi.hoisted(() => ({
  items: [] as { id: string; visible: boolean }[],
  puts: [] as { id: string; visible: boolean }[][],
}));

vi.mock('@/api/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/navigation')>();
  return {
    ...actual,
    navigationApi: {
      getLayout: () => Promise.resolve({ items: structuredClone(backend.items) }),
      updateLayout: (layout: { items: { id: string; visible: boolean }[] }) => {
        backend.puts.push(structuredClone(layout.items));
        backend.items = structuredClone(layout.items);
        return Promise.resolve(structuredClone(layout));
      },
    },
  };
});

// Флаги функций: колесо выключено, рефералы включены.
vi.mock('@/hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({
    referralEnabled: true,
    wheelEnabled: false,
    hasContests: false,
    hasPolls: false,
    giftEnabled: true,
  }),
}));

beforeEach(() => {
  backend.items = IDS.map((id) => ({ id, visible: true }));
  backend.puts = [];
});
afterEach(cleanup);

async function renderEditor() {
  const { NavigationEditor } = await import('./NavigationEditor');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PlatformProvider>
          <NavigationEditor />
        </PlatformProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  // Под нагрузкой (полный прогон) первая отрисовка бывает дольше секунды по умолчанию.
  await screen.findByText(e.intro, undefined, { timeout: 5000 });
}

function visibilitySwitch(title: string): HTMLButtonElement {
  return screen.getByRole('switch', { name: `${title}: ${e.visible}` }) as HTMLButtonElement;
}

function bottomBar(): HTMLElement {
  const label = screen.getByText(e.preview.bottomBar);
  const bar = label.nextElementSibling;
  if (!(bar instanceof HTMLElement)) throw new Error('нижняя панель не найдена');
  return bar;
}

describe('NavigationEditor', () => {
  it('скрывает и переставляет пункты, сохраняет раскладку целиком', async () => {
    await renderEditor();

    fireEvent.click(visibilitySwitch(nav.balance));
    fireEvent.click(screen.getByRole('button', { name: `${nav.support}: ${e.moveUp}` }));
    fireEvent.click(screen.getByRole('button', { name: ruLocale.common.save }));
    await vi.waitFor(() => expect(backend.puts).toHaveLength(1), { timeout: 5000 });

    const sent = backend.puts[0];
    expect(sent).toHaveLength(IDS.length);
    expect(sent.find((item) => item.id === 'balance')?.visible).toBe(false);
    expect(sent.findIndex((item) => item.id === 'support')).toBe(IDS.indexOf('support') - 1);
  });

  it('обязательные пункты не скрываются', async () => {
    await renderEditor();

    for (const title of [nav.dashboard, nav.subscription, nav.profile]) {
      expect(visibilitySwitch(title).disabled).toBe(true);
    }
    expect(screen.getAllByText(e.alwaysVisible)).toHaveLength(3);
  });

  it('предпросмотр нижней панели сразу учитывает скрытие', async () => {
    await renderEditor();
    expect(within(bottomBar()).getByText(nav.balance)).toBeTruthy();
    // Колесо выключено — слот у рефералов.
    expect(within(bottomBar()).getByText(nav.referral)).toBeTruthy();

    fireEvent.click(visibilitySwitch(nav.balance));
    fireEvent.click(visibilitySwitch(nav.referral));

    expect(within(bottomBar()).queryByText(nav.balance)).toBeNull();
    expect(within(bottomBar()).queryByText(nav.referral)).toBeNull();
    expect(backend.puts).toHaveLength(0);
  });

  it('пункт выключенной функции помечен в предпросмотре меню', async () => {
    await renderEditor();
    expect(screen.getAllByText(e.preview.featureOff).length).toBeGreaterThan(0);
  });
});

describe('moveItem / sameOrderAndVisibility', () => {
  it('переставляет соседей и не выходит за края', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it('сравнивает порядок и видимость', () => {
    const a = [
      { id: 'x', visible: true },
      { id: 'y', visible: false },
    ];
    expect(sameOrderAndVisibility(a, structuredClone(a))).toBe(true);
    expect(sameOrderAndVisibility(a, [a[1], a[0]])).toBe(false);
    expect(sameOrderAndVisibility(a, [{ id: 'x', visible: false }, a[1]])).toBe(false);
  });
});
