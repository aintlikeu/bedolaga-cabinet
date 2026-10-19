import { useTranslation } from 'react-i18next';
import type { SettingDefinition } from '../../api/adminSettings';
import { DraftSettingRow } from './DraftSettingRow';
import { QuickToggles } from './QuickToggles';
import { useSettingsDraft } from './settingsDraft';
import { settingDisplayName } from './utils';

interface CategoryGroup {
  key: string;
  label: string;
  settings: SettingDefinition[];
}

interface SettingsTabProps {
  categories: CategoryGroup[];
  searchQuery: string;
  filteredSettings: SettingDefinition[];
  isFavorite: (key: string) => boolean;
  toggleFavorite: (key: string) => void;
}

export function SettingsTab({
  categories,
  searchQuery,
  filteredSettings,
  isFavorite,
  toggleFavorite,
}: SettingsTabProps) {
  const { t } = useTranslation();
  const draft = useSettingsDraft();

  // Search mode: flat list of filtered results
  if (searchQuery.trim()) {
    if (filteredSettings.length === 0) {
      return (
        <div className="rounded-xl border border-dark-700/30 bg-dark-800/30 p-12 text-center">
          <p className="text-dark-400">{t('admin.settings.noSettings')}</p>
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-xl border border-dark-700/40">
        {filteredSettings.map((setting, idx) => (
          <DraftSettingRow
            key={setting.key}
            setting={setting}
            isFavorite={isFavorite(setting.key)}
            onToggleFavorite={() => toggleFavorite(setting.key)}
            isLast={idx === filteredSettings.length - 1}
          />
        ))}
      </div>
    );
  }

  // Normal mode: QuickToggles + settings by category
  const allCategorySettings = categories.flatMap((c) => c.settings);

  if (allCategorySettings.length === 0) {
    return (
      <div className="rounded-xl border border-dark-700/30 bg-dark-800/30 p-12 text-center">
        <p className="text-dark-400">{t('admin.settings.noSettings')}</p>
      </div>
    );
  }

  return (
    <div>
      <QuickToggles
        settings={allCategorySettings.map(draft.withDraft)}
        onUpdate={(key, value) => {
          const setting = allCategorySettings.find((item) => item.key === key);
          if (!setting) return;
          const label = settingDisplayName(setting, (k, fallback) => t(k, fallback));
          draft.put({ kind: 'set', key, value, label }, setting.current);
        }}
        disabled={draft.isSaving}
      />
      {categories.map((category) => {
        if (category.settings.length === 0) return null;
        return (
          <div key={category.key} className="mb-4">
            {categories.length > 1 && (
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-dark-200">{category.label}</h3>
                <span className="text-xs text-dark-500">{category.settings.length}</span>
              </div>
            )}
            <div className="overflow-hidden rounded-xl border border-dark-700/40">
              {category.settings.map((setting, idx) => (
                <DraftSettingRow
                  key={setting.key}
                  setting={setting}
                  isFavorite={isFavorite(setting.key)}
                  onToggleFavorite={() => toggleFavorite(setting.key)}
                  isLast={idx === category.settings.length - 1}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
