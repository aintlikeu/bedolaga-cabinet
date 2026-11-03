// vpn1: дата отсечки обязательной подписки (CHANNEL_REQUIRED_SINCE в боте).
// Кто был в боте до этой даты, на каналы не проверяется; новые — проверяются.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminSettingsApi } from '../../api/adminSettings';
import { useHaptic, useNotify } from '../../platform';
import { useNativeDialog } from '../../platform/hooks/useNativeDialog';
import { getApiErrorMessage } from '../../utils/api-error';
import { uiLocale } from '../../utils/uiLocale';

export const CHANNEL_REQUIRED_SINCE_KEY = 'CHANNEL_REQUIRED_SINCE';
const SETTINGS_QUERY_KEY = ['admin-settings', 'CHANNEL'] as const;

/** Значение настройки → Date; пусто или мусор → null. */
export function parseRequiredSince(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Локальное время для <input type="datetime-local"> (YYYY-MM-DDTHH:mm). */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function ChannelRequiredSinceSetting() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const haptic = useHaptic();
  const notify = useNotify();
  const { confirm } = useNativeDialog();
  const [manual, setManual] = useState('');

  // Тот же ключ, что у переключателей выше: запрос один, кэш общий.
  const { data: settings } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => adminSettingsApi.getSettings('CHANNEL'),
  });

  const mutation = useMutation({
    mutationFn: (value: string | null) =>
      value === null
        ? adminSettingsApi.resetSetting(CHANNEL_REQUIRED_SINCE_KEY)
        : adminSettingsApi.updateSetting(CHANNEL_REQUIRED_SINCE_KEY, value),
    onSuccess: () => {
      setManual('');
      queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      haptic.notification('success');
      notify.success(t('admin.channelSubscriptions.requiredSince.saved'));
    },
    onError: (error) => {
      haptic.notification('error');
      notify.error(getApiErrorMessage(error, t('common.error')));
    },
  });

  const setting = settings?.find((s) => s.key === CHANNEL_REQUIRED_SINCE_KEY);
  // Бот старше v5.0.0-vpn1.9 настройку не знает — блок не показываем.
  if (!setting) return null;

  const since = parseRequiredSince(setting.current);
  const requiredOn = settings?.some(
    (s) => s.key === 'CHANNEL_IS_REQUIRED_SUB' && (s.current === true || s.current === 'true'),
  );
  const locked = setting.read_only || setting.env_locked;
  const busy = mutation.isPending;

  const apply = async (value: string | null, confirmText?: string) => {
    if (busy || locked) return;
    if (confirmText && !(await confirm(confirmText))) return;
    mutation.mutate(value);
  };

  const replaceConfirm = since
    ? t('admin.channelSubscriptions.requiredSince.confirmReplace')
    : undefined;

  const handleNow = () => apply('now', replaceConfirm);

  const handleManual = () => {
    if (!manual) return;
    const date = new Date(manual);
    if (Number.isNaN(date.getTime())) {
      notify.error(t('admin.channelSubscriptions.requiredSince.invalid'));
      return;
    }
    if (date.getTime() > Date.now()) {
      notify.error(t('admin.channelSubscriptions.requiredSince.future'));
      return;
    }
    apply(date.toISOString(), replaceConfirm);
  };

  const handleReset = () =>
    apply(
      null,
      requiredOn
        ? t('admin.channelSubscriptions.requiredSince.confirmResetActive')
        : t('admin.channelSubscriptions.requiredSince.confirmReset'),
    );

  const formatted = since
    ? since.toLocaleString(uiLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="mt-3 border-t border-dark-700/50 px-3 pt-3">
      <p className="text-sm font-medium text-dark-200">
        {t('admin.channelSubscriptions.requiredSince.title')}
      </p>
      <p className="mt-0.5 text-xs text-dark-400">
        {t('admin.channelSubscriptions.requiredSince.desc')}
      </p>

      <p className="mt-2 text-sm text-dark-100">
        {formatted
          ? t('admin.channelSubscriptions.requiredSince.current', { date: formatted })
          : t('admin.channelSubscriptions.requiredSince.notSet')}
      </p>

      {!since && requiredOn && (
        <p className="mt-1 text-xs text-warning-400">
          {t('admin.channelSubscriptions.requiredSince.warnActiveWithoutDate')}
        </p>
      )}
      {!since && !requiredOn && (
        <p className="mt-1 text-xs text-dark-500">
          {t('admin.channelSubscriptions.requiredSince.setBeforeEnabling')}
        </p>
      )}
      {locked && (
        <p className="mt-1 text-xs text-warning-400">
          {t('admin.channelSubscriptions.requiredSince.locked')}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleNow}
          disabled={busy || locked}
          className="rounded-lg bg-accent-500 px-3 py-2 text-sm text-on-accent transition-colors hover:bg-accent-600 disabled:opacity-50"
        >
          {t('admin.channelSubscriptions.requiredSince.setNow')}
        </button>
        <input
          type="datetime-local"
          aria-label={t('admin.channelSubscriptions.requiredSince.manualLabel')}
          value={manual}
          max={toDateTimeLocal(new Date())}
          onChange={(e) => setManual(e.target.value)}
          disabled={busy || locked}
          className="rounded-lg border border-dark-600 bg-dark-700 px-3 py-2 text-sm text-dark-100 outline-none transition-colors [color-scheme:dark] focus:border-accent-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleManual}
          disabled={busy || locked || !manual}
          className="rounded-lg bg-dark-700 px-3 py-2 text-sm text-dark-200 transition-colors hover:bg-dark-600 disabled:opacity-50"
        >
          {busy ? t('common.saving') : t('common.save')}
        </button>
        {since && (
          <button
            type="button"
            onClick={handleReset}
            disabled={busy || locked}
            className="rounded-lg bg-error-500/15 px-3 py-2 text-sm text-error-400 transition-colors hover:bg-error-500/25 disabled:opacity-50"
          >
            {t('admin.channelSubscriptions.requiredSince.reset')}
          </button>
        )}
      </div>
    </div>
  );
}
