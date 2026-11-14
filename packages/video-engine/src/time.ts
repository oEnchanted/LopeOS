/** Integer ticks; divisible by production frame rates and 44.1/48/96 kHz audio. */
export const TIME_BASE = 705_600_000;
export interface Rational { num: number; den: number }
export const FRAME_RATES: Rational[] = [{num:24000,den:1001},{num:24,den:1},{num:25,den:1},{num:30000,den:1001},{num:30,den:1},{num:50,den:1},{num:60000,den:1001},{num:60,den:1}];
export function rateValue(rate: Rational) { return rate.num / rate.den; }
export function frameTicks(frame: number, rate: Rational) {
  return Number(BigInt(Math.trunc(frame)) * BigInt(TIME_BASE) * BigInt(rate.den) / BigInt(rate.num));
}
export function ticksToFrames(ticks: number, rate: Rational, rounding: 'floor'|'round'|'ceil' = 'round') {
  return Math[rounding](ticks / TIME_BASE * rate.num / rate.den);
}
export function frameSeconds(frame: number, rate: Rational) { return frameTicks(frame, rate) / TIME_BASE; }
export function sampleAtFrame(frame: number, rate: Rational, sampleRate: number) {
  return Number((BigInt(Math.trunc(frame)) * BigInt(sampleRate) * BigInt(rate.den) + BigInt(Math.floor(rate.num / 2))) / BigInt(rate.num));
}
export function timecode(frames: number, rate: Rational, drop = false) {
  const nominal = Math.round(rateValue(rate)); let n = Math.max(0, Math.round(frames));
  const df = drop && rate.den === 1001 && (rate.num === 30000 || rate.num === 60000);
  if (df) {
    const omitted = nominal === 60 ? 4 : 2, perMinute = nominal * 60 - omitted, perTen = nominal * 600 - omitted * 9;
    const tens = Math.floor(n / perTen), remaining = n % perTen;
    n += omitted * 9 * tens + (remaining >= omitted ? omitted * Math.floor((remaining - omitted) / perMinute) : 0);
  }
  const ff = n % nominal, seconds = Math.floor(n / nominal), s = seconds % 60, m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
  return [h,m,s].map(v=>String(v).padStart(2,'0')).join(':') + (df?';':':') + String(ff).padStart(2,'0');
}
export function parseTimecode(text: string, rate: Rational) {
  const match = /^(\d+):(\d{2}):(\d{2})([:;])(\d{2})$/.exec(text.trim());
  if (!match) throw new Error('Use HH:MM:SS:FF timecode.');
  const [,hh,mm,ss,separator,ff] = match, nominal=Math.round(rateValue(rate));
  const h=+hh,m=+mm,s=+ss,f=+ff;
  if(m>59||s>59||f>=nominal) throw new Error('Timecode is outside the frame rate.');
  let n=((h*60+m)*60+s)*nominal+f;
  if(separator===';') {
    if(rate.den!==1001||![30000,60000].includes(rate.num)) throw new Error('Drop-frame requires 29.97 or 59.94 fps.');
    const skip=nominal===60?4:2,minutes=h*60+m;
    if(m%10!==0&&s===0&&f<skip) throw new Error('This timecode number is omitted in drop-frame numbering.');
    n-=skip*(minutes-Math.floor(minutes/10));
  }
  return n;
}
