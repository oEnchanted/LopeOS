import { useCallback, useEffect, useState } from 'react';
import type { SettingsService } from '../../../../../packages/contracts/src';

export interface WriterPreferences {
  theme: 'white' | 'aluminum' | 'colorful' | 'dark';
  darkPage: boolean;
  animations: boolean;
  eventSounds: boolean;
  showExtensions: boolean;
  showGallery: boolean;
  measurementUnit: 'in' | 'cm';
  modernComments: boolean;
  ruler: boolean;
  verticalRuler: boolean;
  formattingMarks: boolean;
  bookmarks: boolean;
  horizontalScrollbar: boolean;
  verticalScrollbar: boolean;
  groupTitles: boolean;
  showPasteOptions: boolean;
  defaultPictureWrap: 'inline' | 'square' | 'topAndBottom';
  recoveryEnabled: boolean;
  recoveryDelay: number;
  autoCorrect: boolean;
  replacements: Array<{ from: string; to: string }>;
  printBackgrounds: boolean;
  printDrawings: boolean;
  reversePrint: boolean;
  updateFields: boolean;
  printReview: 'review' | 'final' | 'original';
  warnReviewPrint: boolean;
  largerControls: boolean;
  userName: string;
  userInitials: string;
  userEmail: string;
  company: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
  documentsFolder: string;
  pride: 'none' | 'rainbow' | 'trans' | 'nonbinary';
}
export const defaultPreferences: WriterPreferences = {
  theme: 'white', darkPage: false, animations: true, eventSounds: false,
  showExtensions: true, showGallery: false, measurementUnit: 'in', modernComments: true,
  ruler: false, verticalRuler: false, formattingMarks: false, bookmarks: false,
  horizontalScrollbar: true, verticalScrollbar: true, groupTitles: true, showPasteOptions: true,
  defaultPictureWrap: 'inline', recoveryEnabled: true, recoveryDelay: 1.6,
  autoCorrect: false, replacements: [{ from: '-->', to: '→' }, { from: '(c)', to: '©' }, { from: '(r)', to: '®' }, { from: 'teh', to: 'the' }],
  printBackgrounds: true, printDrawings: true, reversePrint: false, updateFields: false,
  printReview: 'review', warnReviewPrint: false, largerControls: false,
  userName: 'LopeOS User', userInitials: 'L', userEmail: 'local@lopeos.invalid', company: '',
  address: '', city: '', region: '', postalCode: '', country: '', phone: '', documentsFolder: '/', pride: 'none',
};
const key = 'writer.preferences';
export function readPreferences(settings: SettingsService): WriterPreferences {
  const saved = settings.get<Partial<WriterPreferences>>(key, {}) || {};
  const result = { ...defaultPreferences };
  for (const name of Object.keys(defaultPreferences) as Array<keyof WriterPreferences>) {
    const value = saved?.[name];
    if (typeof value === typeof defaultPreferences[name] && !Array.isArray(value)) (result as unknown as Record<string, unknown>)[name] = value;
  }
  const enums = { theme: ['white','aluminum','colorful','dark'], measurementUnit: ['in','cm'], defaultPictureWrap: ['inline','square','topAndBottom'], printReview: ['review','final','original'], pride: ['none','rainbow','trans','nonbinary'] };
  for (const [name, values] of Object.entries(enums)) if (!values.includes(String(result[name as keyof WriterPreferences]))) (result as unknown as Record<string, unknown>)[name] = defaultPreferences[name as keyof WriterPreferences];
  result.recoveryDelay = Math.max(.5, Math.min(600, Number(result.recoveryDelay) || 1.6));
  if (Array.isArray(saved.replacements)) result.replacements = saved.replacements.filter(rule => typeof rule?.from === 'string' && typeof rule?.to === 'string' && rule.from.length > 0 && rule.from.length <= 64 && rule.to.length <= 256).slice(0, 200);
  return result;
}
export function useWriterPreferences(settings: SettingsService) {
  const [preferences, setPreferences] = useState(() => readPreferences(settings));
  useEffect(() => settings.subscribe(() => setPreferences(previous => {
    const next = readPreferences(settings);
    return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
  })), [settings]);
  const update = useCallback(<K extends keyof WriterPreferences>(name: K, value: WriterPreferences[K]) => {
    // Read before each write, so separate Writer windows do not replace each other's changes.
    const next = { ...readPreferences(settings), [name]: value };
    settings.set(key, next); setPreferences(next);
  }, [settings]);
  return [preferences, update] as const;
}
let audio: AudioContext | undefined;
export function playWriterSound(enabled: boolean) {
  if (!enabled) return;
  try {
    audio ??= new AudioContext();
    void audio.resume().then(() => {
      const oscillator = audio!.createOscillator(), gain = audio!.createGain(), now = audio!.currentTime;
      oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(660, now);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.025, now + .008); gain.gain.exponentialRampToValueAtTime(.0001, now + .12);
      oscillator.connect(gain); gain.connect(audio!.destination); oscillator.start(now); oscillator.stop(now + .13);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }).catch(() => {});
  } catch { /* A device without audio still opens, saves, and prints normally. */ }
}
