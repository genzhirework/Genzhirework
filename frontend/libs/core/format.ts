import { Pipe, PipeTransform } from '@angular/core';

const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN');
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** ₹6,00,000 — money arrives from the API as integer paise. */
export const inr = (paise?: number | null) => (paise === null || paise === undefined ? '—' : inrFmt.format(paise / 100));
export const num = (n?: number | null) => (n === null || n === undefined ? '—' : numFmt.format(n));

/** 600000 rupees → "6 LPA", 350000 → "3.5 LPA". */
export const lpa = (paise?: number | null) => {
  if (!paise) return null;
  const v = paise / 100 / 100000;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} LPA`;
};

export const salaryRange = (min?: number | null, max?: number | null, period = 'ANNUAL') => {
  if (!min && !max) return 'Not disclosed';
  if (period === 'MONTHLY') {
    const f = (p?: number | null) => (p ? inr(p) : '');
    return min && max && min !== max ? `${f(min)}–${f(max)} /month` : `${f(min || max)} /month`;
  }
  const a = lpa(min), b = lpa(max);
  if (a && b && a !== b) return `${a.replace(' LPA', '')}–${b}`;
  return a ?? b ?? 'Not disclosed';
};

export const expRange = (min?: number | null, max?: number | null) => {
  const y = (m: number) => (m % 12 === 0 ? `${m / 12}` : (m / 12).toFixed(1));
  if (!min && (!max || max <= 12)) return max ? `Fresher – ${y(max)} yr` : 'Fresher';
  if (max === null || max === undefined) return `${y(min ?? 0)}+ yrs`;
  return `${y(min ?? 0)}–${y(max)} yrs`;
};

export const months = (m?: number | null) => {
  if (!m) return 'Fresher';
  if (m < 12) return `${m} mo`;
  const y = Math.floor(m / 12), r = m % 12;
  return r ? `${y} yr ${r} mo` : `${y} yr${y > 1 ? 's' : ''}`;
};

export const fmtDate = (d?: string | Date | null) => (d ? dateFmt.format(new Date(d)) : '—');
export const fmtDateTime = (d?: string | Date | null) => (d ? dateTimeFmt.format(new Date(d)) : '—');

export const ago = (d?: string | Date | null) => {
  if (!d) return '';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const units: [number, string][] = [[60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  let v = s / 60;
  for (const [step, unit] of units) {
    if (v < step) {
      const n = Math.floor(v);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
    v /= step;
  }
  return fmtDate(d);
};

/** Paise ⇄ rupee helpers for forms (users type rupees; API wants paise). */
export const rupeesToPaise = (r: number | string | null | undefined) =>
  r === null || r === undefined || r === '' ? undefined : Math.round(Number(r) * 100);
export const paiseToRupees = (p?: number | null) => (p === null || p === undefined ? null : Math.round(p / 100));
export const lpaToPaise = (l: number | string | null | undefined) =>
  l === null || l === undefined || l === '' ? undefined : Math.round(Number(l) * 100000 * 100);
export const paiseToLpa = (p?: number | null) => (p ? Math.round((p / 100 / 100000) * 10) / 10 : null);

@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform = inr;
}
@Pipe({ name: 'lpa' })
export class LpaPipe implements PipeTransform {
  transform = lpa;
}
@Pipe({ name: 'ghDate' })
export class DatePipe implements PipeTransform {
  transform(d?: string | Date | null, withTime = false) {
    return withTime ? fmtDateTime(d) : fmtDate(d);
  }
}
@Pipe({ name: 'ago' })
export class AgoPipe implements PipeTransform {
  transform = ago;
}
@Pipe({ name: 'months' })
export class MonthsPipe implements PipeTransform {
  transform = months;
}
@Pipe({ name: 'num' })
export class NumPipe implements PipeTransform {
  transform = num;
}

export const FORMAT_PIPES = [InrPipe, LpaPipe, DatePipe, AgoPipe, MonthsPipe, NumPipe] as const;
