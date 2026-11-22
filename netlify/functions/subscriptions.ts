import type { Handler } from '@netlify/functions';
import { Timestamp } from 'firebase-admin/firestore';
import {
  getFirebaseAdminContext,
  isAdminSdkPermissionError,
  makeNotificationTimestamps,
  makeServerDocId,
  SUBSCRIPTION_ALERT_WINDOW_DAYS,
  SUBSCRIPTION_RENEWAL_DAYS,
  timestampToMillis,
  verifyCallerToken,
} from './_firebaseAdmin';

export interface SubscriptionsApiResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

function serializeSubscription(data: Record<string, unknown>) {
  const startedAt = timestampToMillis(data.startedAt);
  const expiresAt = timestampToMillis(data.expiresAt);
  const now = Date.now();
  const windowMs = SUBSCRIPTION_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const computedStatus =
    expiresAt <= now
      ? 'expired'
      : expiresAt - now <= windowMs
        ? 'expiring_soon'
        : 'active';

  return {
    uid: String(data.uid || ''),
    plan: String(data.plan || 'AFRICABANK Standard'),
    status: computedStatus,
    startedAt,
    expiresAt,
    lastAlertForExpiryMs: Number(data.lastAlertForExpiryMs || 0),
    updatedAt: timestampToMillis(data.updatedAt),
  };
}

export async function processSubscriptionsRequest(params: {
  method: string;
  authHeader?: string;
  body?: Record<string, unknown>;
}): Promise<SubscriptionsApiResponse> {
  const caller = await verifyCallerToken(params.authHeader);
  if (!caller || !caller.emailVerified) {
    return { statusCode: 401, body: { error: 'Authentification Google vérifiée requise.' } };
  }

  const body = params.body || {};
  const action =
    typeof body.action === 'string'
      ? body.action.trim()
      : params.method === 'GET'
        ? 'status'
        : 'renew';

  let db;
  try {
    db = getFirebaseAdminContext().db;
  } catch (err) {
    return {
      statusCode: 503,
      body: { error: err instanceof Error ? err.message : 'Service Firebase Admin indisponible.' },
    };
  }

  const subRef = db.collection('subscriptions').doc(caller.uid);

  try {
    if (action === 'status') {
      const snap = await subRef.get();
      if (!snap.exists) {
        const now = Date.now();
        const defaultSub = {
          uid: caller.uid,
          plan: 'AFRICABANK Standard',
          status: 'active',
          startedAt: Timestamp.fromMillis(now),
          expiresAt: Timestamp.fromMillis(now + SUBSCRIPTION_RENEWAL_DAYS * 24 * 60 * 60 * 1000),
          lastAlertForExpiryMs: 0,
          updatedAt: Timestamp.fromMillis(now),
        };
        await subRef.set(defaultSub);
        return { statusCode: 200, body: { subscription: serializeSubscription(defaultSub) } };
      }
      return {
        statusCode: 200,
        body: { subscription: serializeSubscription(snap.data() as Record<string, unknown>) },
      };
    }

    if (action === 'renew') {
      const days =
        typeof body.planDays === 'number' && body.planDays >= 7 && body.planDays <= 365
          ? Math.round(body.planDays)
          : SUBSCRIPTION_RENEWAL_DAYS;
      const nowMs = Date.now();
      const notifId = makeServerDocId('notif_sub');
      const notifTs = makeNotificationTimestamps(nowMs);
      let nextSubData: Record<string, unknown> = {};

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(subRef);
        const existing = snap.exists ? (snap.data() as Record<string, unknown>) : null;
        const currentExpiryMs = existing ? timestampToMillis(existing.expiresAt) : 0;
        const baseMs = Math.max(nowMs, currentExpiryMs);
        const nextExpiryMs = baseMs + days * 24 * 60 * 60 * 1000;

        nextSubData = {
          uid: caller.uid,
          plan: existing?.plan ? String(existing.plan) : 'AFRICABANK Standard',
          status: 'active',
          startedAt: existing?.startedAt || Timestamp.fromMillis(nowMs),
          expiresAt: Timestamp.fromMillis(nextExpiryMs),
          lastAlertForExpiryMs: 0,
          updatedAt: Timestamp.fromMillis(nowMs),
        };

        tx.set(subRef, nextSubData);

        const formattedExpiry = new Intl.DateTimeFormat('fr-FR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        }).format(new Date(nextExpiryMs));

        tx.set(db.collection('notifications').doc(notifId), {
          id: notifId,
          userId: caller.uid,
          title: 'Abonnement AFRICABANK renouvelé',
          message: `Votre abonnement a été prolongé de ${days} jours. Nouvelle échéance : ${formattedExpiry}.`,
          category: 'subscription',
          read: false,
          createdAt: notifTs.createdAt,
          expiresAt: notifTs.expiresAt,
        });
      });

      return {
        statusCode: 200,
        body: {
          subscription: serializeSubscription(nextSubData),
          message: `Abonnement prolongé avec succès (${days} jours).`,
        },
      };
    }

    return { statusCode: 400, body: { error: 'Action abonnement non reconnue.' } };
  } catch (err) {
    if (isAdminSdkPermissionError(err)) {
      return {
        statusCode: 503,
        body: {
          error:
            'Credentials Firebase Admin requis côté serveur pour prolonger l’abonnement.',
        },
      };
    }
    return {
      statusCode: 500,
      body: { error: err instanceof Error ? err.message : 'Erreur abonnement serveur.' },
    };
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  let parsedBody: Record<string, unknown> = {};
  if (event.body) {
    try {
      parsedBody = JSON.parse(event.body) as Record<string, unknown>;
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'JSON invalide.' }),
      };
    }
  }

  const result = await processSubscriptionsRequest({
    method: event.httpMethod,
    authHeader: event.headers.authorization || event.headers.Authorization,
    body: parsedBody,
  });

  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
};
