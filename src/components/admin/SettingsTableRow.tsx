import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyIcon } from '@/components/icons';
import { copyToClipboard } from '@/utils/clipboard';
import type { SettingDefinition } from '../../api/adminSettings';
import { cn } from '../../lib/utils';
import { StarIcon, LockIcon, RefreshIcon } from './icons';
import { SettingInput } from './SettingInput';
import { Toggle } from './Toggle';
import { formatSettingKey, stripHtml } from './utils';

interface SettingsTableRowProps {
  setting: SettingDefinition;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onUpdate: (value: string) => void;
  onReset: () => void;
  isUpdating?: boolean;
  isResetting?: boolean;
  isLast?: boolean;
  className?: string;
}

export function SettingsTableRow({
  setting,
  isFavorite,
  onToggleFavorite,
  onUpdate,
  onReset,
  isUpdating,
  isResetting,
  isLast,
  className,
}: SettingsTableRowProps) {
  const { t } = useTranslation();
  const [keyCopied, setKeyCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyKey = async () => {
    try {
      await copyToClipboard(setting.key);
    } catch {
      return; // Буфер недоступен (http, запрет браузера): ключ остаётся в подсказке кнопки.
    }
    setKeyCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setKeyCopied(false), 1500);
  };

  const formattedKey = formatSettingKey(setting.name || setting.key);
  const displayName = t(`admin.settings.settingNames.${formattedKey}`, formattedKey);
  const description = setting.hint?.description ? stripHtml(setting.hint.description) : null;
  const isModified = setting.has_override;
  // Значение из .env или кода, которое переопределила админка. У секретов там маска — не показываем.
  const defaultHint = setting.is_secret
    ? null
    : t('admin.settings.defaultValue', { value: formatDefaultValue(setting.original, t) });
  const isBool = setting.type === 'bool';
  const boolChecked = setting.current === true || setting.current === 'true';
  // env-locked keys are pinned in .env and shadow the DB — show value, no input.
  const locked = setting.read_only || setting.env_locked;

  const isLongValue = (() => {
    const val = String(setting.current ?? '');
    const key = setting.key.toLowerCase();
    return (
      val.length > 50 ||
      val.includes('\n') ||
      val.startsWith('[') ||
      val.startsWith('{') ||
      key.includes('_items') ||
      key.includes('_config') ||
      key.includes('_keywords') ||
      key.includes('_template') ||
      key.includes('_packages') ||
      key.includes('_list') ||
      key.includes('_json') ||
      key.includes('_periods') ||
      key.includes('_discounts')
    );
  })();

  return (
    <div
      className={cn(
        'group px-4 py-3 transition-colors hover:bg-dark-800/40',
        isModified && 'bg-warning-500/[0.02]',
        !isLast && 'border-b border-dark-700/30',
        className,
      )}
    >
      <div
        className={cn(
          isLongValue ? 'space-y-3' : 'flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4',
        )}
      >
        {/* Left side: name, badges, key */}
        <div className={cn('min-w-0', !isLongValue && 'lg:flex-1')}>
          {/* Name + badges row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-dark-100">{displayName}</span>

            {/* Одна пометка вместо «Изменено» + «БД»: они всегда появлялись вместе. */}
            {isModified && (
              <span
                className="rounded-full bg-warning-500/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-warning-400"
                title={defaultHint ?? undefined}
              >
                {t('admin.settings.modified')}
              </span>
            )}

            {setting.env_locked && (
              <span
                className="flex items-center gap-0.5 rounded-full bg-warning-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-warning-400"
                title={t('admin.settings.envLockedHint')}
              >
                {t('admin.settings.badgeEnv')}
                <LockIcon className="h-3 w-3" />
              </span>
            )}
          </div>

          {/* Технический ключ — по кнопке: нужен для .env и поддержки, а не для чтения. */}
          <button
            type="button"
            onClick={copyKey}
            title={setting.key}
            aria-label={t('admin.settings.copyKey', { key: setting.key })}
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-dark-600 transition-colors hover:text-dark-300"
          >
            <CopyIcon className="h-3 w-3" />
            <span className="font-mono">
              {keyCopied ? t('admin.settings.keyCopied') : t('admin.settings.keyLabel')}
            </span>
          </button>

          {/* Description: у переключателей и коротких полей это единственное объяснение настройки */}
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-dark-400">{description}</p>
          )}
          {setting.env_locked && (
            <p className="mt-0.5 text-[11px] text-warning-400/80">
              {t('admin.settings.envLockedShort')}
            </p>
          )}

          {isModified && defaultHint && (
            <p className="mt-0.5 text-[11px] text-dark-500">{defaultHint}</p>
          )}
        </div>

        {/* Right side: control + action buttons */}
        <div
          className={cn(
            // На телефоне правая часть во всю ширину строки и справа: выровненная
            // self-end, она не помещалась и уезжала за левый край таблицы.
            'flex min-w-0 items-center gap-2',
            isLongValue ? 'w-full' : 'max-lg:w-full max-lg:justify-end lg:flex-shrink-0',
          )}
        >
          {locked ? (
            <span className="max-w-[240px] truncate rounded bg-dark-700/30 px-3 py-1.5 font-mono text-xs text-dark-400">
              {isBool
                ? boolChecked
                  ? t('admin.settings.enabled')
                  : t('admin.settings.disabled')
                : String(setting.current ?? '-')}
            </span>
          ) : isBool ? (
            <Toggle
              checked={boolChecked}
              onChange={() => onUpdate(boolChecked ? 'false' : 'true')}
              disabled={isUpdating}
              aria-label={displayName}
            />
          ) : (
            <div
              className={cn('min-w-0', isLongValue ? 'flex-1' : 'max-lg:flex max-lg:justify-end')}
            >
              <SettingInput setting={setting} onUpdate={onUpdate} disabled={isUpdating} />
            </div>
          )}

          {/* Reset button -- hover-reveal when has_override */}
          {isModified && !locked && (
            <button
              onClick={onReset}
              disabled={isResetting}
              className="flex-shrink-0 rounded-lg p-1.5 text-dark-500 opacity-0 transition-all hover:bg-dark-700 hover:text-dark-200 disabled:opacity-50 group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100 [@media(hover:none)]:opacity-100"
              title={t('admin.settings.reset')}
              aria-label={t('admin.settings.reset')}
            >
              <RefreshIcon />
            </button>
          )}

          {/* Favorite button -- visible if favorited, hover-reveal otherwise */}
          <button
            onClick={onToggleFavorite}
            className={cn(
              'flex-shrink-0 rounded-lg p-1.5 transition-all',
              isFavorite
                ? 'text-warning-400 hover:bg-warning-500/15'
                : 'text-dark-500 opacity-0 hover:bg-dark-700/50 hover:text-warning-400 group-focus-within:opacity-100 group-hover:opacity-100 max-lg:opacity-100 [@media(hover:none)]:opacity-100',
            )}
            title={
              isFavorite
                ? t('admin.settings.removeFromFavorites')
                : t('admin.settings.addToFavorites')
            }
            aria-label={
              isFavorite
                ? t('admin.settings.removeFromFavorites')
                : t('admin.settings.addToFavorites')
            }
          >
            <StarIcon filled={isFavorite} />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDefaultValue(value: unknown, t: (key: string) => string): string {
  if (value === true || value === 'true') return t('admin.settings.enabled');
  if (value === false || value === 'false') return t('admin.settings.disabled');
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}
