import { useCallback, useEffect, useRef, useState } from 'react';

const FLASH_DURATION_MS = 250;
const SOUND_STORAGE_KEY = 'camera-scan-sound';

interface AudioContextLike {
  state: string;
  currentTime: number;
  destination: AudioDestinationNode;
  resume: () => Promise<void>;
  close: () => Promise<void>;
  createOscillator: () => OscillatorNode;
  createGain: () => GainNode;
}

interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof AudioContext !== 'undefined') return AudioContext;
  const wk = globalThis as unknown as WebkitWindow;
  return wk.webkitAudioContext ?? null;
}

function readSoundEnabled(): boolean {
  try {
    const stored = localStorage.getItem(SOUND_STORAGE_KEY);
    return stored !== 'off';
  } catch {
    return true;
  }
}

function writeSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // localStorage unavailable
  }
}

export type ScanFlashType = 'success' | 'unmatched' | null;

export interface UseScanFeedbackReturn {
  /** スキャン結果に応じたフィードバックを発火 */
  triggerFeedback: (type: 'success' | 'unmatched' | 'duplicate') => void;
  /** ビューファインダーのフラッシュタイプ (250ms間だけ非null) */
  scanFlashType: ScanFlashType;
  /** サウンドが有効か */
  soundEnabled: boolean;
  /** サウンドのON/OFF切替 */
  toggleSound: () => void;
  /** iOS Safari 用: ユーザージェスチャ内で呼んで AudioContext をアンロック */
  ensureAudioContext: () => void;
}

export function useScanFeedback(): UseScanFeedbackReturn {
  const audioCtxRef = useRef<AudioContextLike | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [scanFlashType, setScanFlashType] = useState<ScanFlashType>(null);
  const [soundEnabled, setSoundEnabled] = useState(readSoundEnabled);

  const ensureAudioContext = useCallback(() => {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        void audioCtxRef.current.resume();
      }
      return;
    }
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return;
    try {
      audioCtxRef.current = new Ctor();
    } catch {
      // AudioContext creation failed
    }
  }, []);

  const playBeep = useCallback((frequency: number, durationMs: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    try {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const durationSec = durationMs / 1000;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationSec);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + durationSec);
    } catch {
      // Audio playback failed
    }
  }, []);

  const triggerFeedback = useCallback((type: 'success' | 'unmatched' | 'duplicate') => {
    // Visual flash
    const flashType: ScanFlashType = type === 'duplicate' ? null : type;
    if (flashType) {
      setScanFlashType(flashType);
      clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => setScanFlashType(null), FLASH_DURATION_MS);
    }

    if (!soundEnabled) return;

    // Audio beep
    if (type === 'success') {
      playBeep(1200, 150);
    } else if (type === 'unmatched') {
      playBeep(800, 200);
    }
    // duplicate: no beep

    // Haptic vibration (Android only; no-op on iOS)
    if (type !== 'duplicate') {
      navigator.vibrate?.(50);
    }
  }, [playBeep, soundEnabled]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      writeSoundEnabled(next);
      return next;
    });
  }, []);

  useEffect(() => () => {
    clearTimeout(flashTimeoutRef.current);
    void audioCtxRef.current?.close();
  }, []);

  return {
    triggerFeedback,
    scanFlashType,
    soundEnabled,
    toggleSound,
    ensureAudioContext,
  };
}
