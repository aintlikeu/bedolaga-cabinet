import { useTranslation } from 'react-i18next';
import type { SettingDefinition } from '../../api/adminSettings';
import { settingValueString, useSettingsDraft } from './settingsDraft';
import { SettingsTableRow } from './SettingsTableRow';
import { settingDisplayName } from './utils';

interface DraftSettingRowProps {
  setting: SettingDefinition;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isLast?: boolean;
}

/** Строка настройки, которая пишет в черновик страницы, а не сразу в бота. */
export function DraftSettingRow({
  setting,
  isFavorite,
  onToggleFavorite,
  isLast,
}: DraftSettingRowProps) {
  const { t } = useTranslation();
  const draft = useSettingsDraft();
  const label = settingDisplayName(setting, (key, fallback) => t(key, fallback));
  const draftState = draft.draftStateOf(setting.key);

  return (
    <SettingsTableRow
      setting={draft.withDraft(setting)}
      draftState={draftState}
      isFavorite={isFavorite}
      onToggleFavorite={onToggleFavorite}
      onUpdate={(value) =>
        draft.put({ kind: 'set', key: setting.key, value, label }, setting.current)
      }
      onReset={() =>
        draftState
          ? // Несохранённая правка: кнопка отменяет её (значение как на сервере снимает правку).
            draft.put(
              { kind: 'set', key: setting.key, value: settingValueString(setting.current), label },
              setting.current,
            )
          : draft.put({ kind: 'reset', key: setting.key, label }, null)
      }
      isUpdating={draft.isSaving}
      isResetting={draft.isSaving}
      isLast={isLast}
    />
  );
}
