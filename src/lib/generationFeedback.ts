import { KeepAwake } from "@capawesome/capacitor-keep-awake";

export type GenerationOutcome = "success" | "error" | "cancelled";

let activeGenerations = 0;

async function keepScreenAwake(): Promise<void> {
  try {
    const { available } = await KeepAwake.isAvailable();
    if (available) await KeepAwake.keepAwake();
  } catch {
    // В браузере или на устройстве без поддержки генерация продолжает работать без Wake Lock.
  }
}

async function allowScreenSleep(): Promise<void> {
  try {
    await KeepAwake.allowSleep();
  } catch {
    // Нативная настройка не должна мешать завершению генерации.
  }
}

function tone(frequency: number, startAt: number, duration: number, gain: number): void {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + startAt);
    volume.gain.setValueAtTime(0.0001, context.currentTime + startAt);
    volume.gain.exponentialRampToValueAtTime(gain, context.currentTime + startAt + 0.015);
    volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + startAt + duration);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(context.currentTime + startAt);
    oscillator.stop(context.currentTime + startAt + duration + 0.02);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Аудио — дополнительная обратная связь, не ошибка генерации.
  }
}

export function playGenerationSignal(outcome: GenerationOutcome): void {
  if (typeof window === "undefined") return;
  if (outcome === "success") {
    tone(659, 0, 0.13, 0.09);
    tone(880, 0.16, 0.2, 0.09);
    return;
  }
  if (outcome === "error") {
    tone(392, 0, 0.18, 0.08);
    tone(330, 0.22, 0.22, 0.08);
    return;
  }
  tone(440, 0, 0.12, 0.07);
}

/** Вызывать после начала реального сетевого запроса генерации. */
export async function generationStarted(): Promise<void> {
  activeGenerations += 1;
  if (activeGenerations === 1) await keepScreenAwake();
}

/** Всегда вызывать из finally: снимает Wake Lock, когда завершилась последняя генерация. */
export async function generationFinished(outcome: GenerationOutcome): Promise<void> {
  activeGenerations = Math.max(0, activeGenerations - 1);
  if (activeGenerations === 0) await allowScreenSleep();
  playGenerationSignal(outcome);
}
