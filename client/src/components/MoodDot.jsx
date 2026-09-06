import clsx from 'clsx';

const SCALE = {
  1: { bg: 'bg-mood-1', label: 'Very low' },
  2: { bg: 'bg-mood-2', label: 'Low' },
  3: { bg: 'bg-mood-3', label: 'Okay' },
  4: { bg: 'bg-mood-4', label: 'Good' },
  5: { bg: 'bg-mood-5', label: 'Very good' },
};

/**
 * The one place saturated color appears in the interface, so a mood
 * reads before any text does.
 */
export default function MoodDot({ level, size = 'md', showLabel = false }) {
  const tone = SCALE[level] ?? { bg: 'bg-line-strong', label: 'No entry' };
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={clsx('rounded-full shrink-0', tone.bg,
          size === 'sm' ? 'w-2.5 h-2.5' : size === 'lg' ? 'w-5 h-5' : 'w-3.5 h-3.5')}
        aria-hidden="true"
      />
      <span className={showLabel ? 'text-sm text-ink-soft' : 'sr-only'}>{tone.label}</span>
    </span>
  );
}

export { SCALE as MOOD_SCALE };
