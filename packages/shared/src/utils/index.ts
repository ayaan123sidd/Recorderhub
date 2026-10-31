export * from './call-analytics';

/**
 * Cleanses and normalizes phone numbers into E.164 standard format (+91...)
 */
export function normalizePhoneNumber(rawPhone: string, defaultCountryCode = '+91'): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${defaultCountryCode}${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  if (rawPhone.startsWith('+')) {
    return `+${digits}`;
  }
  return `${defaultCountryCode}${digits.slice(-10)}`;
}

/**
 * Masks phone numbers for non-privileged viewers (e.g. +91 ****** 4321)
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone) return '';
  const normalized = normalizePhoneNumber(phone);
  if (normalized.length < 10) return '***-***-****';
  const prefix = normalized.slice(0, 3);
  const suffix = normalized.slice(-4);
  return `${prefix} ****** ${suffix}`;
}

/**
 * Formats seconds into HH:MM:SS or MM:SS
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const pad = (num: number) => num.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}
