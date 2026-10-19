import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { adminSettingsApi } from '../../../api/adminSettings';
import { cn } from '../../../lib/utils';
import { MenuEditorTab } from '../MenuEditorTab';
import { BotMenuEditor } from './BotMenuEditor';

type MenuMode = 'default' | 'cabinet';

const MODES: MenuMode[] = ['default', 'cabinet'];

interface ButtonsSectionProps {
  /** Открыть раздел настроек по id из дерева (переключение режима меню). */
  onOpenSection?: (section: string) => void;
}

/**
 * Вкладка «Кнопки»: редактор меню того режима, что включён в боте, и второй —
 * чтобы подготовить меню заранее. У каждого режима свой редактор, потому что
 * бот читает только раскладку активного режима.
 */
export function ButtonsSection({ onOpenSection }: ButtonsSectionProps) {
  const { t } = useTranslation();
  const modeQuery = useQuery({
    queryKey: ['admin-settings', 'MAIN_MENU_MODE'],
    queryFn: () => adminSettingsApi.getSetting('MAIN_MENU_MODE'),
    staleTime: 60000,
    retry: false,
  });
  // Без прав на настройки режим неизвестен: открываем «Полное меню», без пометок.
  const activeMode: MenuMode | null = modeQuery.data
    ? modeQuery.data.current === 'cabinet'
      ? 'cabinet'
      : 'default'
    : null;
  const [selected, setSelected] = useState<MenuMode | null>(null);
  const shown = selected ?? activeMode ?? 'default';

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label={t('admin.botMenu.mode.label')}
      >
        {MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={shown === mode}
            onClick={() => setSelected(mode)}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
              shown === mode
                ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                : 'border-dark-600 bg-dark-700/50 text-dark-300 hover:border-dark-500',
            )}
          >
            {t(`admin.botMenu.mode.${mode}`)}
            {activeMode === mode && (
              <span className="rounded-full bg-success-500/15 px-1.5 py-0.5 text-[10px] font-medium text-success-400">
                {t('admin.botMenu.mode.active')}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeMode && shown !== activeMode && (
        <div className="rounded-xl border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-warning-400">{t('admin.botMenu.mode.inactiveTitle')}</p>
          <p className="mt-1 text-dark-300">
            {t('admin.botMenu.mode.inactiveBody', {
              active: t(`admin.botMenu.mode.${activeMode}`),
            })}
          </p>
          {onOpenSection && (
            <button
              type="button"
              onClick={() => onOpenSection('iface_general')}
              className="mt-2 text-sm font-medium text-accent-400 transition-colors hover:text-accent-300"
            >
              {t('admin.botMenu.mode.switch')}
            </button>
          )}
        </div>
      )}

      {shown === 'default' ? <BotMenuEditor /> : <MenuEditorTab />}
    </div>
  );
}
