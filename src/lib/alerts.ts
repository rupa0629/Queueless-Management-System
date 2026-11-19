export function playTurnAlertChime(urgent = false): void {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const notes = urgent ? [659.25, 880, 1046.5] : [523.25, 659.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + idx * 0.14;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.28);
    });
  } catch {
    // Ignore autoplay blocks prior to user gesture
  }
}

export function formatCountdown(targetIso: string | null, nowMs: number): {
  formatted: string;
  remainingMs: number;
  expired: boolean;
} {
  if (!targetIso) {
    return { formatted: '00:00', remainingMs: 0, expired: true };
  }
  const diff = new Date(targetIso).getTime() - nowMs;
  if (diff <= 0) {
    return { formatted: '00:00', remainingMs: 0, expired: true };
  }
  const totalSecs = Math.ceil(diff / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return {
    formatted: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    remainingMs: diff,
    expired: false,
  };
}
