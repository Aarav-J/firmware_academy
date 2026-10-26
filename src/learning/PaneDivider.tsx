import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import './pane-divider.css';

const MIN_SHARE = 35;
const MAX_SHARE = 65;

function clampShare(value: number): number {
  return Math.min(MAX_SHARE, Math.max(MIN_SHARE, Number.isFinite(value) ? Math.round(value) : 50));
}

export function PaneDivider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const share = clampShare(value);
  const latestShare = useRef(share);
  const activePointer = useRef<number | null>(null);

  useEffect(() => {
    latestShare.current = share;
  }, [share]);

  function updateShare(nextValue: number) {
    const nextShare = clampShare(nextValue);
    if (nextShare === latestShare.current) return;
    latestShare.current = nextShare;
    onChange(nextShare);
  }

  function updateFromPointer(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    updateShare(((event.clientX - bounds.left) / bounds.width) * 100);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || activePointer.current !== null) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    updateFromPointer(event);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    let nextShare: number;
    switch (event.key) {
      case 'ArrowLeft': nextShare = latestShare.current - step; break;
      case 'ArrowRight': nextShare = latestShare.current + step; break;
      case 'Home': nextShare = MIN_SHARE; break;
      case 'End': nextShare = MAX_SHARE; break;
      default: return;
    }
    event.preventDefault();
    updateShare(nextShare);
  }

  return (
    <div
      className="academy-pane-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize code and hardware panes"
      aria-valuemin={MIN_SHARE}
      aria-valuemax={MAX_SHARE}
      aria-valuenow={share}
      aria-valuetext={`${share}% code, ${100 - share}% hardware`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={() => { activePointer.current = null; }}
      onKeyDown={handleKeyDown}
      onDoubleClick={() => updateShare(50)}
    />
  );
}
