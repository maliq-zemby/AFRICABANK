import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applicationDefault, cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

export const ADMIN_BOOTSTRAP_EMAIL = 'maliqzemby8@gmail.com';
export const ADMIN_SECONDARY_EMAIL = 'maliqzemby@gmail.com';

export const CARD_RENEWAL_FEE_FCFA = 500;
export const CARD_RENEWAL_MONTHS = 5;
export const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const SUBSCRIPTION_ALERT_WINDOW_DAYS = 7;
export const SUBSCRIPTION_RENEWAL_DAYS = 30;

export interface VerifiedCaller {
  uid: string;
  email: string;
  emailVerified: boolean;
}

interface AppletConfig {
  projectId?: string;
  apiKey?: string;
  firestoreDatabaseId?: string;
}

function readAppletConfig(): AppletConfig {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(import.meta.dirname, '../../firebase-applet-config.json'),
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw) as AppletConfig;
      }
    } catch {
      // Ignore unreadable candidate
    }
  }
  return {};
}

let cachedAdminApp: App | null = null;
let cachedAdminDb: Firestore | null = null;

export function getFirebaseAdminContext(): {
  app: App;
  db: Firestore;
  hasExplicitCredentials: boolean;
  apiKey: string;
  databaseId: string;
} {
  const appletCfg = readAppletConfig();
  const projectId = (process.env.FIREBASE_PROJECT_ID || appletCfg.projectId || '').trim();
  const databaseId = (process.env.FIREBASE_DATABASE_ID || appletCfg.firestoreDatabaseId || '(default)').trim();
  const apiKey = (process.env.FIREBASE_API_KEY || appletCfg.apiKey || '').trim();

  const rawServiceAccount = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const clientEmail = (process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKeyRaw = (process.env.FIREBASE_PRIVATE_KEY || '').trim();
  const hasExplicitCredentials = Boolean(rawServiceAccount || (clientEmail && privateKeyRaw && projectId));

  if (!cachedAdminApp) {
    if (getApps().length > 0) {
      cachedAdminApp = getApp();
    } else if (rawServiceAccount) {
      const parsed = JSON.parse(rawServiceAccount) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      cachedAdminApp = initializeApp({
        credential: cert({
          projectId: parsed.project_id || projectId,
          clientEmail: parsed.client_email,
          privateKey: (parsed.private_key || '').replace(/\\n/g, '\n'),
        }),
        projectId: parsed.project_id || projectId,
      });
    } else if (clientEmail && privateKeyRaw && projectId) {
      cachedAdminApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey: privateKeyRaw.replace(/\\n/g, '\n'),
        }),
        projectId,
      });
    } else {
      cachedAdminApp = initializeApp({
        credential: applicationDefault(),
        ...(projectId ? { projectId } : {}),
      });
    }
  }

  if (!cachedAdminDb) {
    cachedAdminDb =
      databaseId && databaseId !== '(default)'
        ? getFirestore(cachedAdminApp, databaseId)
        : getFirestore(cachedAdminApp);
  }

  return {
    app: cachedAdminApp,
    db: cachedAdminDb,
    hasExplicitCredentials,
    apiKey,
    databaseId,
  };
}

export async function verifyCallerToken(authHeader?: string): Promise<VerifiedCaller | null> {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const idToken = match[1].trim();
  if (!idToken) return null;

  const { app, apiKey } = getFirebaseAdminContext();

  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email || '',
      emailVerified: Boolean(decoded.email_verified),
    };
  } catch {
    if (!apiKey) return null;
    try {
      const resp = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!resp.ok) return null;
      const data = (await resp.json()) as {
        users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
      };
      const user = data.users?.[0];
      if (!user?.localId) return null;
      return {
        uid: user.localId,
        email: user.email || '',
        emailVerified: Boolean(user.emailVerified),
      };
    } catch {
      return null;
    }
  }
}

export async function isVerifiedAdminCaller(
  db: Firestore,
  caller: VerifiedCaller
): Promise<boolean> {
  if (!caller.emailVerified) return false;
  const lower = caller.email.toLowerCase();
  if (
    lower === ADMIN_BOOTSTRAP_EMAIL.toLowerCase() ||
    lower === ADMIN_SECONDARY_EMAIL.toLowerCase()
  ) {
    return true;
  }
  try {
    const adminSnap = await db.collection('admins').doc(caller.uid).get();
    if (adminSnap.exists) return true;
    const userSnap = await db.collection('users').doc(caller.uid).get();
    return userSnap.exists && userSnap.data()?.role === 'admin';
  } catch {
    return false;
  }
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

export function makeServerDocId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

export function makeNotificationTimestamps(nowMs = Date.now()): {
  createdAt: Timestamp;
  expiresAt: Timestamp;
} {
  return {
    createdAt: Timestamp.fromMillis(nowMs),
    expiresAt: Timestamp.fromMillis(nowMs + NOTIFICATION_TTL_MS),
  };
}

export function timestampToMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (
    typeof value === 'object' &&
    value !== null &&
    'toMillis' in value &&
    typeof (value as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function isAdminSdkPermissionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('Could not load the default credentials') ||
    msg.includes('Unable to detect a Project Id') ||
    msg.includes('7 PERMISSION_DENIED') ||
    msg.includes('UNAUTHENTICATED')
  );
}
