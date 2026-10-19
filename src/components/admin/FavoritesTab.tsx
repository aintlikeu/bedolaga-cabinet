import { useTranslation } from 'react-i18next';
import type { SettingDefinition } from '../../api/adminSettings';
import { StarIcon } from './icons';
import { DraftSettingRow } from './DraftSettingRow';

interface FavoritesTabProps {
  settings: SettingDefinition[];
  isFavorite: (key: string) => boolean;
  toggleFavorite: (key: string) => void;
}

export function FavoritesTab({ settings, isFavorite, toggleFavorite }: FavoritesTabProps) {
  const { t } = useTranslation();
  if (settings.length === 0) {
    return (
      <div className="rounded-2xl border border-dark-700/30 bg-dark-800/30 p-12 text-center">
        <div className="mb-4 flex justify-center text-dark-500">
          <StarIcon filled={false} />
        </div>
        <p className="text-dark-400">{t('admin.settings.favoritesEmpty')}</p>
        <p className="mt-1 text-sm text-dark-500">{t('admin.settings.favoritesHint')}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-dark-700/40">
      {settings.map((setting, idx) => (
        <DraftSettingRow
          key={setting.key}
          setting={setting}
          isFavorite={isFavorite(setting.key)}
          onToggleFavorite={() => toggleFavorite(setting.key)}
          isLast={idx === settings.length - 1}
        />
      ))}
    </div>
  );
}
