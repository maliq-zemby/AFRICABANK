import type { Handler } from '@netlify/functions';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  ADMIN_BOOTSTRAP_EMAIL,
  ADMIN_SECONDARY_EMAIL,
  getFirebaseAdminContext,
  isAdminSdkPermissionError,
  isVerifiedAdminCaller,
  verifyCallerToken,
} from './_firebaseAdmin';

export interface PurgeResult {
  deletedTransactions: number;
  resetUsers: number;
  deletedExpiredNotifications: number;
  walletReset: boolean;
}

export async function runServerTestDataPurge(
  db: Firestore,
  options: { resetBalances?: boolean } = {}
): Promise<PurgeResult> {
  const resetBalances = options.resetBalances !== false;
  const nowTs = Timestamp.now();

  // 1. Delete transactions where status === 'pending' OR isTest === true
  const [pendingSnap, testSnap] = await Promise.all([
    db.collection('transactions').where('status', '==', 'pending').get(),
    db.collection('transactions').where('isTest', '==', true).get(),
  ]);

  const txRefsToDelete = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const d of pendingSnap.docs) txRefsToDelete.set(d.id, d.ref);
  for (const d of testSnap.docs) txRefsToDelete.set(d.id, d.ref);

  let deletedTransactions = 0;
  const txRefs = Array.from(txRefsToDelete.values());
  for (let i = 0; i < txRefs.length; i += 400) {
    const batch = db.batch();
    const chunk = txRefs.slice(i, i + 400);
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    deletedTransactions += chunk.length;
  }

  // 2. Delete expired notifications (expiresAt <= now)
  const expiredNotifSnap = await db
    .collection('notifications')
    .where('expiresAt', '<=', nowTs)
    .get();
  let deletedExpiredNotifications = 0;
  for (let i = 0; i < expiredNotifSnap.docs.length; i += 400) {
    const batch = db.batch();
    const chunk = expiredNotifSnap.docs.slice(i, i + 400);
    for (const d of chunk) batch.delete(d.ref);
    await batch.commit();
    deletedExpiredNotifications += chunk.length;
  }

  // 3. Reset balances & counters WITHOUT deleting admin accounts
  let resetUsers = 0;
  let walletReset = false;

  if (resetBalances) {
    const usersSnap = await db.collection('users').get();
    for (let i = 0; i < usersSnap.docs.length; i += 400) {
      const batch = db.batch();
      const chunk = usersSnap.docs.slice(i, i + 400);
      for (const d of chunk) {
        const data = d.data() as { email?: string; role?: string };
        const emailLower = String(data.email || '').toLowerCase();
        const isAdminAccount =
          data.role === 'admin' ||
          emailLower === ADMIN_BOOTSTRAP_EMAIL.toLowerCase() ||
          emailLower === ADMIN_SECONDARY_EMAIL.toLowerCase();

        // Preserve admin accounts (keep role === 'admin' intact, zero out test financial balances)
        batch.update(d.ref, {
          balance: 0,
          totalDepositsCount: 0,
          totalDepositsVolume: 0,
          totalWithdrawalsVolume: 0,
          totalTransactionsCount: 0,
          totalVolume: 0,
          loanEligible: false,
          ...(isAdminAccount ? { role: 'admin', isBanned: false, banReason: '' } : {}),
          updatedAt: nowTs,
        });
        resetUsers += 1;
      }
      await batch.commit();
    }

    await db.collection('admin_stats').doc('wallet').set({
      commissionBalance: 0,
      totalCommissionsEarned: 0,
      totalWithdrawnByAdmin: 0,
      updatedAt: nowTs,
    });
    walletReset = true;
  }

  return {
    deletedTransactions,
    resetUsers,
    deletedExpiredNotifications,
    walletReset,
  };
}

export async function processAdminPurgeRequest(params: {
  authHeader?: string;
  body?: Record<string, unknown>;
}): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const caller = await verifyCallerToken(params.authHeader);
  if (!caller || !caller.emailVerified) {
    return { statusCode: 401, body: { error: 'Authentification Google vérifiée requise.' } };
  }

  let db;
  try {
    db = getFirebaseAdminContext().db;
  } catch (err) {
    return {
      statusCode: 503,
      body: { error: err instanceof Error ? err.message : 'Service Firebase Admin indisponible.' },
    };
  }

  try {
    const isAdmin = await isVerifiedAdminCaller(db, caller);
    if (!isAdmin) {
      return {
        statusCode: 403,
        body: { error: 'Accès refusé : action réservée à l’administrateur principal.' },
      };
    }

    const resetBalances = params.body?.resetBalances !== false;
    const summary = await runServerTestDataPurge(db, { resetBalances });
    return {
      statusCode: 200,
      body: {
        ok: true,
        ...summary,
        message: `Purge terminée : ${summary.deletedTransactions} transaction(s) test/en attente supprimée(s), ${summary.resetUsers} compte(s) réinitialisé(s), ${summary.deletedExpiredNotifications} alerte(s) expirée(s) nettoyée(s).`,
      },
    };
  } catch (err) {
    if (isAdminSdkPermissionError(err)) {
      return {
        statusCode: 503,
        body: {
          error:
            'Credentials Firebase Admin requis côté serveur pour exécuter la purge globale.',
        },
      };
    }
    return {
      statusCode: 500,
      body: { error: err instanceof Error ? err.message : 'Erreur lors de la purge des données.' },
    };
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Méthode POST requise.' }),
    };
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

  const result = await processAdminPurgeRequest({
    authHeader: event.headers.authorization || event.headers.Authorization,
    body: parsedBody,
  });

  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
};
