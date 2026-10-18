// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ruLocale from '@/locales/ru.json';
import { PlatformProvider } from '@/platform/PlatformProvider';
import { ToastProvider } from '@/components/Toast';

/**
 * Бот читает раскладку редактора «Кнопки» только в режиме меню «Cabinet».
 * В «Полном меню» правки ни на что не влияют, поэтому редактор обязан об этом
 * предупредить и отвести туда, где кнопки скрываются на самом деле.
 */

const banner = ruLocale.admin.menuEditor.modeBanner;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], ruLocale) ??
      key,
    i18n: { language: 'ru', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// Режим меню, который «вернёт бэкенд»; 'forbidden' — у админа нет прав на настройки.
const backend = vi.hoisted(() => ({ mode: 'default' as string, calls: 0 }));

vi.mock('@/api/adminSettings', () => ({
  adminSettingsApi: {
    getSetting: (key: string) => {
      backend.calls += 1;
      return backend.mode === 'forbidden'
        ? Promise.reject(new Error('403'))
        : Promise.resolve({ key, current: backend.mode });
    },
  },
}));

vi.mock('@/api/menuLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/menuLayout')>();
  return {
    ...actual,
    menuLayoutApi: {
      getConfig: () => Promise.resolve({ rows: [] }),
      updateConfig: (config: unknown) => Promise.resolve(config),
      resetConfig: () => Promise.resolve({ rows: [] }),
    },
  };
});

beforeEach(() => {
  backend.mode = 'default';
  backend.calls = 0;
});
afterEach(cleanup);

async function renderEditor(onOpenSection?: (section: string) => void) {
  const { MenuEditorTab } = await import('./MenuEditorTab');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PlatformProvider>
          <MenuEditorTab onOpenSection={onOpenSection} />
        </PlatformProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  // Редактор отрисован: подсказка про перетаскивание есть в любом режиме.
  await screen.findByText(ruLocale.admin.menuEditor.dragHint);
}

describe('MenuEditorTab — баннер режима меню', () => {
  it('в «Полном меню» предупреждает и ведёт в «Интерфейс → Основные»', async () => {
    const onOpenSection = vi.fn();
    await renderEditor(onOpenSection);

    expect(await screen.findByText(banner.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: banner.openInterface }));
    expect(onOpenSection).toHaveBeenCalledWith('iface_general');
  });

  it('в режиме cabinet баннера нет', async () => {
    backend.mode = 'cabinet';
    await renderEditor();
    await vi.waitFor(() => expect(backend.calls).toBe(1));

    expect(screen.queryByText(banner.title)).toBeNull();
  });

  it('без прав на настройки редактор работает, а баннер не показывается', async () => {
    backend.mode = 'forbidden';
    await renderEditor();
    // Один запрос без повторов: retry: false не даёт долбить 403.
    await vi.waitFor(() => expect(backend.calls).toBe(1));

    expect(screen.queryByText(banner.title)).toBeNull();
  });
});
