import { ArrowDownIcon, ArrowUpIcon, LockIcon } from '@/components/icons';
import { cn } from '../../lib/utils';
import { Toggle } from './Toggle';

/** Элемент упорядочиваемого списка: порядок стрелками, видимость переключателем. */
export interface OrderedToggleItem {
  id: string;
  title: string;
  visible: boolean;
  hint?: string;
  badge?: string;
  /** Видимость не меняется здесь; `lockedNote` объясняет почему. */
  locked?: boolean;
  lockedNote?: string;
  /** Предупреждение о последствиях текущего состояния (например, скрытой ключевой кнопки). */
  warning?: string;
}

interface OrderedToggleListProps {
  items: OrderedToggleItem[];
  onMove: (index: number, delta: -1 | 1) => void;
  onToggle: (id: string) => void;
  disabled?: boolean;
  /** Подписи для экранных читалок: «выше», «ниже», «показывать». */
  labels: { moveUp: string; moveDown: string; visible: string };
}

/** Общий список для редакторов меню бота и навигации кабинета. */
export function OrderedToggleList({
  items,
  onMove,
  onToggle,
  disabled,
  labels,
}: OrderedToggleListProps) {
  return (
    <ol className="space-y-2">
      {items.map((item, index) => (
        <li
          key={item.id}
          className={cn(
            'flex items-center gap-2 rounded-xl border border-dark-700/50 bg-dark-800/50 px-2 py-1.5',
            !item.visible && 'opacity-60',
          )}
        >
          <div className="flex shrink-0 flex-col">
            <MoveButton
              label={`${item.title}: ${labels.moveUp}`}
              disabled={disabled || index === 0}
              onClick={() => onMove(index, -1)}
            >
              <ArrowUpIcon className="h-3.5 w-3.5" />
            </MoveButton>
            <MoveButton
              label={`${item.title}: ${labels.moveDown}`}
              disabled={disabled || index === items.length - 1}
              onClick={() => onMove(index, 1)}
            >
              <ArrowDownIcon className="h-3.5 w-3.5" />
            </MoveButton>
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium text-dark-100">
              {item.title}
              {item.badge && (
                <span className="rounded bg-dark-600 px-1.5 py-0.5 text-[10px] font-medium text-dark-300">
                  {item.badge}
                </span>
              )}
              {item.locked && <LockIcon className="h-3 w-3 text-warning-400" />}
            </p>
            {item.hint && <p className="text-[11px] text-dark-500">{item.hint}</p>}
            {item.locked && item.lockedNote && (
              <p className="text-[11px] text-dark-500">{item.lockedNote}</p>
            )}
            {item.warning && <p className="text-[11px] text-warning-400">{item.warning}</p>}
          </div>
          <Toggle
            checked={item.visible}
            onChange={() => onToggle(item.id)}
            disabled={disabled || item.locked}
            aria-label={`${item.title}: ${labels.visible}`}
          />
        </li>
      ))}
    </ol>
  );
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-md p-1 text-dark-400 transition-colors hover:bg-dark-700/50 hover:text-dark-200 disabled:cursor-default disabled:text-dark-700"
    >
      {children}
    </button>
  );
}

/** Переставить элемент на соседнюю позицию; за краем списка — без изменений. */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Совпадают ли порядок и видимость двух списков. */
export function sameOrderAndVisibility(
  a: readonly { id: string; visible: boolean }[],
  b: readonly { id: string; visible: boolean }[],
): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => item.id === b[index].id && item.visible === b[index].visible)
  );
}
