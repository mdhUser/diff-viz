import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../cn';
import { useI18n } from '../i18n';

interface ResizeHandleProps {
  position: 'left' | 'right';
  label: string;
  onStart?: () => void;
  onDelta: (delta: number) => void;
  onEnd?: () => void;
  onStep: (delta: number) => void;
  onReset: () => void;
}

/**
 * A thin splitter that sits on a panel edge. The edge moves with the pointer;
 * the parent decides how that delta maps to a width.
 */
export function ResizeHandle({
  position,
  label,
  onStart,
  onDelta,
  onEnd,
  onStep,
  onReset,
}: ResizeHandleProps) {
  const { t } = useI18n();
  const dragging = useRef(false);
  const startX = useRef(0);
  const direction = position === 'left' ? -1 : 1;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging.current = true;
    startX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing');
    onStart?.();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onDelta((event.clientX - startX.current) * direction);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.classList.remove('is-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onEnd?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onStep(16 * direction);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onStep(-16 * direction);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onReset();
    }
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      title={t('拖动调整宽度，双击重置')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      className={cn(
        'group absolute inset-y-0 z-40 w-2 cursor-col-resize touch-none outline-none',
        position === 'left' ? '-left-1' : '-right-1',
      )}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[#cfc6b5] transition group-hover:bg-accent/45 group-focus-visible:bg-accent/60" />
      <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-9 w-[7px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[3px] rounded-full border border-line bg-[#fffdf8]/95 opacity-50 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="h-[2px] w-[2px] rounded-full bg-mist-500" />
        <span className="h-[2px] w-[2px] rounded-full bg-mist-500" />
        <span className="h-[2px] w-[2px] rounded-full bg-mist-500" />
      </span>
    </div>
  );
}
