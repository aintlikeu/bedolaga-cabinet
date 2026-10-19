import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { adminSettingsApi, type SettingDefinition } from '../../api/adminSettings';
import { brandingApi } from '../../api/branding';
import {
  NAV_LAYOUT_QUERY_KEY,
  navigationApi,
  type NavItemId,
  type NavLayout,
} from '../../api/navigation';
import { adminWheelApi } from '../../api/wheel';
import { useNotify } from '../../platform/hooks/useNotify';
import { useAuthStore } from '../../store/auth';
import { safeSession } from '../../utils/safeStorage';
import { cn } from '../../lib/utils';

/**
 * Черновик правок страницы настроек: дерево, поиск, избранное и «Функции» больше
 * не применяют изменения сразу. Правки копятся здесь и уходят по «Сохранить» на
 * общей панели внизу; «Отменить» возвращает всё как было.
 *
 * Черновик живёт в sessionStorage: переход в другой раздел админки и обратно его
 * не теряет (роутер без блокировки переходов), а закрытие вкладки спрашивает.
 */

export type DraftChange =
  /**
   * Новое значение настройки — строкой, как её отправляет строка настроек.
   * `secret`: токен, пароль или ключ — такая правка живёт только в памяти.
   */
  | { kind: 'set'; key: string; value: string; label: string; secret?: boolean }
  /** Сброс настройки к значению из .env или кода. */
  | { kind: 'reset'; key: string; label: string }
  /** Флаги с собственными эндпоинтами. */
  | { kind: 'gift' | 'emailAuth' | 'wheel'; value: boolean; label: string }
  /** Видимость пункта навигации кабинета; все такие правки уходят одним PUT. */
  | { kind: 'nav'; id: NavItemId; visible: boolean; label: string };

export function changeId(change: DraftChange): string {
  switch (change.kind) {
    case 'set':
    case 'reset':
      return `setting:${change.key}`;
    case 'nav':
      return `nav:${change.id}`;
    default:
      return change.kind;
  }
}

/** Значение настройки строкой — так его шлёт строка настроек и так сравниваем. */
export function settingValueString(value: unknown): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const STORAGE_KEY = 'admin-settings-draft';

function isDraftChange(value: unknown): value is DraftChange {
  if (typeof value !== 'object' || value === null) return false;
  const change = value as Record<string, unknown>;
  if (typeof change.label !== 'string') return false;
  switch (change.kind) {
    case 'set':
      return typeof change.key === 'string' && typeof change.value === 'string';
    case 'reset':
      return typeof change.key === 'string';
    case 'gift':
    case 'emailAuth':
    case 'wheel':
      return typeof change.value === 'boolean';
    case 'nav':
      return typeof change.id === 'string' && typeof change.visible === 'boolean';
    default:
      return false;
  }
}

interface StoredDraft {
  /** Чей черновик: в той же вкладке может войти другой админ. */
  userId: number;
  changes: unknown[];
}

function loadStored(userId: number | undefined): Map<string, DraftChange> {
  const raw = safeSession.getJson<StoredDraft | null>(STORAGE_KEY, null);
  if (userId === undefined || !raw || raw.userId !== userId || !Array.isArray(raw.changes)) {
    return new Map();
  }
  const changes = raw.changes
    .filter(isDraftChange)
    .filter((change) => !(change.kind === 'set' && change.secret));
  return new Map(changes.map((change) => [changeId(change), change]));
}

/** Состояние строки настройки относительно черновика. */
export type DraftState = 'changed' | 'reset' | undefined;

interface SettingsDraftValue {
  changes: ReadonlyMap<string, DraftChange>;
  count: number;
  isSaving: boolean;
  /** Поставить изменение; совпадающее с сохранённым значением убирает правку. */
  put: (change: DraftChange, serverValue: unknown) => void;
  draftOf: (id: string) => DraftChange | undefined;
  /** Настройка с подставленным значением из черновика (секреты остаются замаскированными). */
  withDraft: (setting: SettingDefinition) => SettingDefinition;
  draftStateOf: (key: string) => DraftState;
  discard: () => void;
  save: () => Promise<void>;
}

const SettingsDraftContext = createContext<SettingsDraftValue | null>(null);

export function useSettingsDraft(): SettingsDraftValue {
  const value = useContext(SettingsDraftContext);
  if (!value) throw new Error('useSettingsDraft: нет SettingsDraftProvider выше по дереву');
  return value;
}

export function SettingsDraftProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const userId = useAuthStore((state) => state.user?.id);
  const [changes, setChanges] = useState<Map<string, DraftChange>>(() => loadStored(userId));
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  // Секреты (токены, пароли, ключи) в sessionStorage не пишутся: только память страницы.
  useEffect(() => {
    const persistable = [...changes.values()].filter(
      (change) => !(change.kind === 'set' && change.secret),
    );
    if (persistable.length === 0 || userId === undefined) safeSession.removeItem(STORAGE_KEY);
    else safeSession.setJson(STORAGE_KEY, { userId, changes: persistable } satisfies StoredDraft);
  }, [changes, userId]);

  // Закрытие или перезагрузка вкладки с несохранёнными правками — спросить браузером.
  useEffect(() => {
    if (changes.size === 0) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changes.size]);

  const put = useCallback((change: DraftChange, serverValue: unknown) => {
    setChanges((prev) => {
      const next = new Map(prev);
      const id = changeId(change);
      const sameAsServer =
        change.kind === 'set'
          ? change.value === settingValueString(serverValue)
          : change.kind === 'reset'
            ? false
            : change.kind === 'nav'
              ? change.visible === serverValue
              : change.value === serverValue;
      if (sameAsServer) next.delete(id);
      else next.set(id, change);
      return next;
    });
  }, []);

  const draftOf = useCallback((id: string) => changes.get(id), [changes]);

  const withDraft = useCallback(
    (setting: SettingDefinition): SettingDefinition => {
      const change = changes.get(`setting:${setting.key}`);
      if (!change) return setting;
      if (change.kind === 'reset')
        return { ...setting, current: setting.original, has_override: false };
      if (change.kind !== 'set' || setting.is_secret) return setting;
      const value = setting.type === 'bool' ? change.value === 'true' : (change.value as unknown);
      return { ...setting, current: value };
    },
    [changes],
  );

  const draftStateOf = useCallback(
    (key: string): DraftState => {
      const change = changes.get(`setting:${key}`);
      if (!change) return undefined;
      return change.kind === 'reset' ? 'reset' : 'changed';
    },
    [changes],
  );

  const discard = useCallback(() => setChanges(new Map()), []);

  const save = useCallback(async () => {
    if (savingRef.current || changes.size === 0) return;
    savingRef.current = true;
    setIsSaving(true);
    const failed = new Map<string, DraftChange>();
    const all = [...changes.values()];
    const navChanges = all.filter((change) => change.kind === 'nav');

    for (const change of all) {
      try {
        switch (change.kind) {
          case 'set':
            await adminSettingsApi.updateSetting(change.key, change.value);
            break;
          case 'reset':
            await adminSettingsApi.resetSetting(change.key);
            break;
          case 'gift':
            await brandingApi.updateGiftEnabled(change.value);
            break;
          case 'emailAuth':
            await brandingApi.updateEmailAuthEnabled(change.value);
            break;
          case 'wheel':
            await adminWheelApi.updateConfig({ is_enabled: change.value });
            break;
          case 'nav':
            break; // ниже, одним запросом
        }
      } catch {
        failed.set(changeId(change), change);
      }
    }

    if (navChanges.length > 0) {
      try {
        const layout =
          queryClient.getQueryData<NavLayout>(NAV_LAYOUT_QUERY_KEY) ??
          (await navigationApi.getLayout());
        const visibility = new Map(navChanges.map((change) => [change.id, change.visible]));
        const saved = await navigationApi.updateLayout({
          items: layout.items.map((item) =>
            visibility.has(item.id)
              ? { ...item, visible: visibility.get(item.id) ?? item.visible }
              : item,
          ),
        });
        queryClient.setQueryData(NAV_LAYOUT_QUERY_KEY, saved);
      } catch {
        for (const change of navChanges) failed.set(changeId(change), change);
      }
    }

    await Promise.all(
      [
        ['admin-settings'],
        ['gift-enabled'],
        ['email-auth-enabled'],
        ['admin-wheel-config'],
        ['wheel-config'],
        ['referral-terms'],
        NAV_LAYOUT_QUERY_KEY,
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
    );

    setChanges(failed);
    savingRef.current = false;
    setIsSaving(false);
    if (failed.size === 0) {
      notify.success(t('admin.settingsDraft.saved', { count: all.length }));
    } else {
      notify.error(
        t('admin.settingsDraft.failed', {
          names: [...failed.values()].map((change) => change.label).join(', '),
        }),
      );
    }
  }, [changes, notify, queryClient, t]);

  const value = useMemo<SettingsDraftValue>(
    () => ({
      changes,
      count: changes.size,
      isSaving,
      put,
      draftOf,
      withDraft,
      draftStateOf,
      discard,
      save,
    }),
    [changes, isSaving, put, draftOf, withDraft, draftStateOf, discard, save],
  );

  return <SettingsDraftContext.Provider value={value}>{children}</SettingsDraftContext.Provider>;
}

/** Закреплённая внизу панель: сколько правок, что изменено, «Сохранить» и «Отменить». */
export function SettingsDraftBar({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { changes, count, isSaving, save, discard } = useSettingsDraft();
  const [expanded, setExpanded] = useState(false);
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label={t('admin.settingsDraft.region')}
      className={cn(
        'sticky bottom-3 z-30 rounded-2xl border border-accent-500/30 bg-dark-850/95 p-3 shadow-xl shadow-black/30 backdrop-blur',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="text-sm font-medium text-dark-100 underline-offset-2 hover:underline"
        >
          {t('admin.settingsDraft.count', { count })}
        </button>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={discard}
            disabled={isSaving}
            className="rounded-xl bg-dark-700 px-4 py-2 text-sm font-medium text-dark-300 transition-colors hover:bg-dark-600 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isSaving}
            className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-600 disabled:opacity-50"
          >
            {isSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
      {expanded && (
        <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-dark-300">
          {[...changes.values()].map((change) => (
            <li key={changeId(change)}>
              {change.label}
              {change.kind === 'reset' && (
                <span className="text-dark-500"> — {t('admin.settingsDraft.willReset')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
