export const ADMIN_BOOTSTRAP_EMAIL = 'maliqzemby8@gmail.com';
export const ADMIN_SECONDARY_EMAIL = 'maliqzemby@gmail.com';
export const ADMIN_DEFAULT_PROFILE = {
  firstName: 'Maliq',
  lastName: 'ZEMBY',
  fullName: 'ZEMBY Maliq',
  age: 26,
};
export const COMMISSION_RATE = 0.02;

export function formatFCFA(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${new Intl.NumberFormat('fr-FR').format(safe)} FCFA`;
}

export function formatCardNumber(cardNumber: string, reveal = true): string {
  const clean = cardNumber.replace(/\D/g, '').padEnd(16, '0').slice(0, 16);
  if (!reveal) {
    return `${clean.slice(0, 4)} •••• •••• ${clean.slice(12, 16)}`;
  }
  return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ${clean.slice(8, 12)} ${clean.slice(12, 16)}`;
}

export function calculateCommission(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * COMMISSION_RATE);
}

export function generateVirtualCard(): {
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
} {
  let digits = '4532';
  for (let i = 0; i < 12; i++) {
    digits += Math.floor(Math.random() * 10).toString();
  }
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String((now.getFullYear() + 4) % 100).padStart(2, '0');
  const cvv = String(Math.floor(100 + Math.random() * 900));
  return {
    cardNumber: digits,
    cardExpiry: `${month}/${year}`,
    cardCvv: cvv,
  };
}

export function isValidGabonPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(\+241)?0?(6[0-9]|7[0-9])[0-9]{6}$/.test(cleaned);
}

export function formatDateFr(value: unknown): string {
  if (!value) return 'À l’instant';
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    date = (value as { toDate: () => Date }).toDate();
  } else if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else {
    return 'À l’instant';
  }
  if (Number.isNaN(date.getTime())) return 'À l’instant';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
