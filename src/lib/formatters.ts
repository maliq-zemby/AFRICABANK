export const ADMIN_BOOTSTRAP_EMAIL = 'maliqzemby8@gmail.com';
export const ADMIN_SECONDARY_EMAIL = 'maliqzemby@gmail.com';
export const ADMIN_DEFAULT_PROFILE = {
  firstName: 'Maliq',
  lastName: 'ZEMBY',
  fullName: 'ZEMBY Maliq',
  age: 26,
};

export const COMMISSION_RATE = 0.02;
export const CARD_RENEWAL_FEE_FCFA = 500;
export const CARD_RENEWAL_MONTHS = 5;
export const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const SUBSCRIPTION_ALERT_WINDOW_DAYS = 7;
export const SUBSCRIPTION_DEFAULT_DAYS = 30;

export function formatFCFA(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${new Intl.NumberFormat('fr-FR').format(safe)} FCFA`;
}

export function formatCardMask(last4?: string): string {
  const cleanLast4 = (last4 || '').replace(/\D/g, '').slice(-4);
  if (cleanLast4.length === 4) {
    return `•••• •••• •••• ${cleanLast4}`;
  }
  return '•••• •••• •••• ••••';
}

export function formatCardNumber(cardNumber: string, reveal = true): string {
  const clean = (cardNumber || '').replace(/\D/g, '');
  if (clean.length < 4) return '•••• •••• •••• ••••';
  if (!reveal) {
    return `•••• •••• •••• ${clean.slice(-4)}`;
  }
  const padded = clean.slice(0, 16);
  return padded.replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function calculateCommission(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * COMMISSION_RATE);
}

export function toMillisSafe(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === 'object' && value !== null) {
    if ('toMillis' in value && typeof (value as { toMillis: () => number }).toMillis === 'function') {
      return (value as { toMillis: () => number }).toMillis();
    }
    if ('seconds' in value && typeof (value as { seconds: number }).seconds === 'number') {
      const sec = (value as { seconds: number; nanoseconds?: number }).seconds;
      const ns = (value as { nanoseconds?: number }).nanoseconds || 0;
      return sec * 1000 + Math.floor(ns / 1_000_000);
    }
  }
  return 0;
}

export function computeRenewableAt(issuedAt: Date): Date {
  const target = new Date(issuedAt.getTime());
  const originalDay = target.getUTCDate();
  target.setUTCMonth(target.getUTCMonth() + CARD_RENEWAL_MONTHS);
  if (target.getUTCDate() < originalDay) {
    target.setUTCDate(0);
  }
  return target;
}

export function isNotificationActive(
  notif: { createdAt?: unknown; expiresAt?: unknown },
  nowMs = Date.now()
): boolean {
  const expMs = toMillisSafe(notif.expiresAt);
  if (expMs > 0) {
    return expMs > nowMs;
  }
  const createdMs = toMillisSafe(notif.createdAt);
  if (createdMs > 0) {
    return createdMs + NOTIFICATION_TTL_MS > nowMs;
  }
  return true;
}

export function isValidGabonPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(\+241)?0?(6[0-9]|7[0-9])[0-9]{6}$/.test(cleaned);
}

export function formatDateFr(value: unknown): string {
  const ms = toMillisSafe(value);
  if (!ms) return 'À l’instant';
  const date = new Date(ms);
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatFullDateFr(value: unknown): string {
  const ms = toMillisSafe(value);
  if (!ms) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(ms));
}

export function generateDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export interface InternationalCountry {
  code: string;
  name: string;
  currency: string;
  hint: string;
}

export const INTERNATIONAL_COUNTRIES: InternationalCountry[] = [
  { code: 'FR', name: 'France', currency: 'EUR (€)', hint: 'FR76 3000 6000 0112 3456 7890 189' },
  { code: 'CM', name: 'Cameroun', currency: 'XAF (FCFA)', hint: '+237 6XX XXX XXX ou RIB CEMAC' },
  { code: 'CI', name: "Côte d'Ivoire", currency: 'XOF (FCFA)', hint: '+225 07 XX XX XX XX (Orange/Wave)' },
  { code: 'SN', name: 'Sénégal', currency: 'XOF (FCFA)', hint: '+221 77 XXX XX XX (Wave/OM)' },
  { code: 'TG', name: 'Togo', currency: 'XOF (FCFA)', hint: '+228 90 XX XX XX (TMoney/Flooz)' },
  { code: 'BJ', name: 'Bénin', currency: 'XOF (FCFA)', hint: '+229 97 XX XX XX (MTN/Moov)' },
  { code: 'MA', name: 'Maroc', currency: 'MAD (DH)', hint: 'RIB 24 chiffres ou +212 6XX XXX XXX' },
  { code: 'CG', name: 'Congo-Brazzaville', currency: 'XAF (FCFA)', hint: '+242 06 XXX XXXX (Airtel/MTN)' },
  { code: 'GQ', name: 'Guinée Équatoriale', currency: 'XAF (FCFA)', hint: 'IBAN GQ ou +240 222 XXX XXX' },
  { code: 'US', name: 'États-Unis', currency: 'USD ($)', hint: 'Routing + Account Number / ACH' },
  { code: 'CA', name: 'Canada', currency: 'CAD ($)', hint: 'Interac / Transit + Institution' },
];
