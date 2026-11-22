import crypto from 'node:crypto';
import type { Handler } from '@netlify/functions';
import { Timestamp } from 'firebase-admin/firestore';
import {
  CARD_RENEWAL_FEE_FCFA,
  computeRenewableAt,
  getFirebaseAdminContext,
  isAdminSdkPermissionError,
  isVerifiedAdminCaller,
  makeNotificationTimestamps,
  makeServerDocId,
  timestampToMillis,
  verifyCallerToken,
} from './_firebaseAdmin';

export interface CardsApiResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

function getIssuerConfig() {
  const apiUrl = (process.env.CARD_ISSUER_API_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.CARD_ISSUER_API_KEY || '').trim();
  const webhookSecret = (process.env.CARD_ISSUER_WEBHOOK_SECRET || '').trim();
  return {
    apiUrl,
    apiKey,
    webhookSecret,
    configured: Boolean(apiUrl && apiKey),
  };
}

function serializeCard(docData: Record<string, unknown>, issuerConfigured: boolean) {
  const issuedMs = timestampToMillis(docData.issuedAt);
  const renewableMs = timestampToMillis(docData.renewableAt);
  const nowMs = Date.now();
  const eligibleForRenewal = renewableMs > 0 && nowMs >= renewableMs;

  return {
    uid: String(docData.uid || ''),
    cardId: String(docData.cardId || ''),
    last4: String(docData.last4 || ''),
    expiryMonth: String(docData.expiryMonth || ''),
    expiryYear: String(docData.expiryYear || ''),
    status: String(docData.status || 'pending_issuance'),
    brand: 'VISA',
    currency: 'XAF',
    provider: String(docData.provider || "En attente d'activation émetteur"),
    issuedAt: issuedMs,
    renewableAt: renewableMs,
    cycleNumber: Number(docData.cycleNumber || 1),
    renewalStatus:
      eligibleForRenewal && docData.renewalStatus === 'active'
        ? 'eligible_for_renewal'
        : String(docData.renewalStatus || 'active'),
    issuerConfigured,
  };
}

function verifyWebhookSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  if (!secret) return false;
  if (!signatureHeader) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signatureHeader.replace(/^sha256=/i, '').trim();
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export async function processCardsRequest(params: {
  method: string;
  authHeader?: string;
  signatureHeader?: string;
  rawBody?: string;
  body?: Record<string, unknown>;
}): Promise<CardsApiResponse> {
  const issuer = getIssuerConfig();
  const body = params.body || {};
  const action =
    typeof body.action === 'string'
      ? body.action.trim()
      : params.method === 'GET'
        ? 'get'
        : 'get';

  // Webhook callback from Card Issuing provider
  if (action === 'webhook') {
    if (!issuer.webhookSecret) {
      return {
        statusCode: 503,
        body: { error: 'Webhook émetteur de carte non configuré.' },
      };
    }
    const raw = params.rawBody ?? JSON.stringify(body);
    if (!verifyWebhookSignature(raw, params.signatureHeader || '', issuer.webhookSecret)) {
      return { statusCode: 401, body: { error: 'Signature webhook émetteur invalide.' } };
    }
    const targetUid = typeof body.userId === 'string' ? body.userId.trim() : '';
    const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : '';
    const last4 = typeof body.last4 === 'string' ? body.last4.replace(/\D/g, '').slice(-4) : '';
    const expiryMonth = typeof body.expiryMonth === 'string' ? body.expiryMonth.slice(0, 2) : '';
    const expiryYear = typeof body.expiryYear === 'string' ? body.expiryYear.slice(0, 4) : '';
    const status =
      body.status === 'active' || body.status === 'frozen' || body.status === 'pending_issuance'
        ? body.status
        : 'active';
    const provider = typeof body.provider === 'string' ? body.provider.slice(0, 80) : 'Card Issuer';

    if (!targetUid || !cardId || last4.length !== 4) {
      return { statusCode: 400, body: { error: 'Charge utile webhook carte incomplète.' } };
    }

    try {
      const { db } = getFirebaseAdminContext();
      const now = new Date();
      await db.collection('cards').doc(targetUid).set(
        {
          uid: targetUid,
          cardId,
          last4,
          expiryMonth,
          expiryYear,
          status,
          brand: 'VISA',
          currency: 'XAF',
          provider,
          updatedAt: Timestamp.fromDate(now),
        },
        { merge: true }
      );
      await db.collection('messaging_directory').doc(targetUid).set(
        {
          cardLast4: last4,
          updatedAt: Timestamp.fromDate(now),
        },
        { merge: true }
      );
      return { statusCode: 200, body: { received: true } };
    } catch (err) {
      if (isAdminSdkPermissionError(err)) {
        return {
          statusCode: 503,
          body: { error: 'Credentials Firebase Admin requis côté serveur.' },
        };
      }
      return {
        statusCode: 500,
        body: { error: err instanceof Error ? err.message : 'Erreur webhook carte.' },
      };
    }
  }

  // Authenticated actions
  const caller = await verifyCallerToken(params.authHeader);
  if (!caller || !caller.emailVerified) {
    return {
      statusCode: 401,
      body: { error: 'Authentification Google vérifiée requise.' },
    };
  }

  let db;
  try {
    db = getFirebaseAdminContext().db;
  } catch (err) {
    return {
      statusCode: 503,
      body: {
        error: err instanceof Error ? err.message : 'Service Firebase Admin indisponible.',
      },
    };
  }

  try {
    const callerIsAdmin = await isVerifiedAdminCaller(db, caller);
    const requestedUid =
      typeof body.targetUid === 'string' && body.targetUid.trim() && callerIsAdmin
        ? body.targetUid.trim()
        : caller.uid;

    const cardRef = db.collection('cards').doc(requestedUid);
    const userRef = db.collection('users').doc(requestedUid);

    if (action === 'get' || action === 'issue') {
      const [cardSnap, userSnap] = await Promise.all([cardRef.get(), userRef.get()]);
      if (!userSnap.exists) {
        return { statusCode: 404, body: { error: 'Profil utilisateur introuvable.' } };
      }
      const userData = userSnap.data() as Record<string, unknown>;

      if (cardSnap.exists) {
        const existingCard = cardSnap.data() as Record<string, unknown>;
        if (existingCard.status === 'active' || existingCard.status === 'frozen' || !issuer.configured) {
          return {
            statusCode: 200,
            body: {
              card: serializeCard(existingCard, issuer.configured),
              issuerConfigured: issuer.configured,
              message:
                existingCard.status === 'pending_issuance'
                  ? "Carte en attente d'activation par l'émetteur"
                  : 'Carte récupérée avec succès.',
            },
          };
        }
      }

      const now = new Date();
      const renewableAt = computeRenewableAt(now);

      if (!issuer.configured) {
        const pendingRecord = {
          uid: requestedUid,
          cardId: '',
          last4: '',
          expiryMonth: '',
          expiryYear: '',
          status: 'pending_issuance',
          brand: 'VISA',
          currency: 'XAF',
          provider: "En attente d'activation émetteur",
          issuedAt: Timestamp.fromDate(now),
          renewableAt: Timestamp.fromDate(renewableAt),
          cycleNumber: 1,
          renewalStatus: 'active',
          createdAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now),
        };
        if (!cardSnap.exists) {
          await cardRef.set(pendingRecord);
        }
        return {
          statusCode: 200,
          body: {
            card: serializeCard(cardSnap.exists ? (cardSnap.data() as Record<string, unknown>) : pendingRecord, false),
            issuerConfigured: false,
            message: "Carte en attente d'activation par l'émetteur",
          },
        };
      }

      // Real Card Issuing API call
      const issuerResp = await fetch(`${issuer.apiUrl}/cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${issuer.apiKey}`,
        },
        body: JSON.stringify({
          userId: requestedUid,
          holderName: String(userData.fullName || ''),
          email: String(userData.email || ''),
          brand: 'VISA',
          currency: 'XAF',
        }),
      });

      const issuerJson = (await issuerResp.json().catch(() => ({}))) as Record<string, unknown>;
      if (!issuerResp.ok) {
        return {
          statusCode: 502,
          body: {
            error: String(
              issuerJson.message || issuerJson.error || `Émetteur carte HTTP ${issuerResp.status}`
            ),
          },
        };
      }

      const cardId = String(issuerJson.cardId || issuerJson.id || '').trim();
      const last4 = String(issuerJson.last4 || '').replace(/\D/g, '').slice(-4);
      const expiryMonth = String(issuerJson.expiryMonth || '').padStart(2, '0').slice(0, 2);
      const expiryYear = String(issuerJson.expiryYear || '').slice(0, 4);
      const providerName = String(issuerJson.provider || 'Card Issuer Partner').slice(0, 80);

      if (!cardId || last4.length !== 4) {
        return {
          statusCode: 502,
          body: { error: "Réponse invalide du fournisseur d'émission de carte." },
        };
      }

      const issuedRecord = {
        uid: requestedUid,
        cardId,
        last4,
        expiryMonth,
        expiryYear,
        status: issuerJson.status === 'frozen' ? 'frozen' : 'active',
        brand: 'VISA',
        currency: 'XAF',
        provider: providerName,
        issuedAt: Timestamp.fromDate(now),
        renewableAt: Timestamp.fromDate(renewableAt),
        cycleNumber: cardSnap.exists ? Number(cardSnap.data()?.cycleNumber || 1) : 1,
        renewalStatus: 'active',
        createdAt: cardSnap.exists ? cardSnap.data()?.createdAt || Timestamp.fromDate(now) : Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
      };

      await cardRef.set(issuedRecord);
      await db.collection('messaging_directory').doc(requestedUid).set(
        {
          cardLast4: last4,
          updatedAt: Timestamp.fromDate(now),
        },
        { merge: true }
      );

      return {
        statusCode: 200,
        body: {
          card: serializeCard(issuedRecord, true),
          issuerConfigured: true,
          message: 'Carte virtuelle émise par le partenaire.',
        },
      };
    }

    if (action === 'reveal') {
      const cardSnap = await cardRef.get();
      if (!cardSnap.exists) {
        return { statusCode: 404, body: { revealed: false, error: 'Carte introuvable.' } };
      }
      const cardData = cardSnap.data() as Record<string, unknown>;
      if (cardData.status !== 'active' || !cardData.cardId) {
        return {
          statusCode: 400,
          body: {
            revealed: false,
            error: "Affichage sécurisé indisponible : la carte est en attente d'activation par l'émetteur.",
          },
        };
      }
      if (!issuer.configured) {
        return {
          statusCode: 400,
          body: {
            revealed: false,
            error: 'Fournisseur émetteur non configuré côté serveur.',
          },
        };
      }

      const revealResp = await fetch(
        `${issuer.apiUrl}/cards/${encodeURIComponent(String(cardData.cardId))}/reveal-token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${issuer.apiKey}`,
          },
          body: JSON.stringify({ userId: requestedUid }),
        }
      );

      const revealJson = (await revealResp.json().catch(() => ({}))) as Record<string, unknown>;
      const revealToken = String(revealJson.revealToken || revealJson.token || '').trim();
      const pan = String(revealJson.pan || revealJson.cardNumber || '').trim();
      const cvv = String(revealJson.cvv || '').trim();

      if (!revealResp.ok || !revealToken || !pan || !cvv) {
        return {
          statusCode: 502,
          body: {
            revealed: false,
            error: "Jeton d'affichage sécurisé non fourni par l'émetteur.",
          },
        };
      }

      return {
        statusCode: 200,
        body: {
          revealed: true,
          revealToken,
          pan,
          cvv,
          expiryMonth: String(cardData.expiryMonth || ''),
          expiryYear: String(cardData.expiryYear || ''),
        },
      };
    }

    if (action === 'renew') {
      const adminOverride = Boolean(body.adminOverride) && callerIsAdmin;
      const preCardSnap = await cardRef.get();
      if (!preCardSnap.exists) {
        return { statusCode: 404, body: { error: 'Carte virtuelle introuvable.' } };
      }
      const preCard = preCardSnap.data() as Record<string, unknown>;
      const preUserSnap = await userRef.get();
      if (!preUserSnap.exists) {
        return { statusCode: 404, body: { error: 'Profil utilisateur introuvable.' } };
      }
      const preUser = preUserSnap.data() as Record<string, unknown>;
      if (preUser.isBanned === true) {
        return { statusCode: 403, body: { error: 'Compte suspendu : renouvellement impossible.' } };
      }

      const nowMs = Date.now();
      const renewableMs = timestampToMillis(preCard.renewableAt);
      if (!adminOverride && renewableMs > 0 && nowMs < renewableMs) {
        return {
          statusCode: 400,
          body: {
            error: `Renouvellement disponible à partir du ${new Intl.DateTimeFormat('fr-FR', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            }).format(new Date(renewableMs))}.`,
          },
        };
      }

      const currentBalance = Number(preUser.balance || 0);
      if (currentBalance < CARD_RENEWAL_FEE_FCFA) {
        return {
          statusCode: 400,
          body: {
            error: `Solde insuffisant pour renouveler la carte. Frais requis : ${CARD_RENEWAL_FEE_FCFA} FCFA.`,
          },
        };
      }

      if (!issuer.configured && preCard.status === 'pending_issuance' && !adminOverride) {
        return {
          statusCode: 400,
          body: {
            error: "Carte en attente d'activation par l'émetteur : configurez l'émetteur réel avant le renouvellement.",
          },
        };
      }

      let issuerUpdatedFields: Partial<{
        cardId: string;
        last4: string;
        expiryMonth: string;
        expiryYear: string;
        status: string;
        provider: string;
      }> = {};

      if (issuer.configured && preCard.cardId) {
        const renewResp = await fetch(
          `${issuer.apiUrl}/cards/${encodeURIComponent(String(preCard.cardId))}/renew`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${issuer.apiKey}`,
            },
            body: JSON.stringify({
              userId: requestedUid,
              cycleNumber: Number(preCard.cycleNumber || 1) + 1,
            }),
          }
        );
        const renewJson = (await renewResp.json().catch(() => ({}))) as Record<string, unknown>;
        if (!renewResp.ok) {
          return {
            statusCode: 502,
            body: {
              error: String(
                renewJson.message || renewJson.error || `Échec du renouvellement émetteur (HTTP ${renewResp.status})`
              ),
            },
          };
        }
        issuerUpdatedFields = {
          cardId: String(renewJson.cardId || preCard.cardId),
          last4: String(renewJson.last4 || preCard.last4 || '').replace(/\D/g, '').slice(-4),
          expiryMonth: String(renewJson.expiryMonth || preCard.expiryMonth || ''),
          expiryYear: String(renewJson.expiryYear || preCard.expiryYear || ''),
          status: renewJson.status === 'frozen' ? 'frozen' : 'active',
          provider: String(renewJson.provider || preCard.provider || 'Card Issuer Partner'),
        };
      }

      const txId = makeServerDocId('tx_renew');
      const notifId = makeServerDocId('notif');
      const nowDate = new Date();
      const nextRenewableDate = computeRenewableAt(nowDate);
      const nowTs = Timestamp.fromDate(nowDate);
      const nextRenewableTs = Timestamp.fromDate(nextRenewableDate);
      const notifTs = makeNotificationTimestamps(nowDate.getTime());

      let updatedCardResult: Record<string, unknown> = {};

      await db.runTransaction(async (tx) => {
        const [uSnap, cSnap, walletSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(cardRef),
          tx.get(db.collection('admin_stats').doc('wallet')),
        ]);

        if (!uSnap.exists || !cSnap.exists) {
          throw new Error('Compte ou carte introuvable lors de la transaction.');
        }

        const uData = uSnap.data() as Record<string, unknown>;
        const cData = cSnap.data() as Record<string, unknown>;
        const bal = Number(uData.balance || 0);
        if (bal < CARD_RENEWAL_FEE_FCFA) {
          throw new Error(`Solde insuffisant (${bal} FCFA). Requis : ${CARD_RENEWAL_FEE_FCFA} FCFA.`);
        }

        const cRenewableMs = timestampToMillis(cData.renewableAt);
        if (!adminOverride && cRenewableMs > 0 && Date.now() < cRenewableMs) {
          throw new Error('La date de renouvellement de 5 mois n’est pas encore atteinte.');
        }

        const nextCycle = Number(cData.cycleNumber || 1) + 1;

        tx.update(userRef, {
          balance: bal - CARD_RENEWAL_FEE_FCFA,
          totalTransactionsCount: Number(uData.totalTransactionsCount || 0) + 1,
          totalVolume: Number(uData.totalVolume || 0) + CARD_RENEWAL_FEE_FCFA,
          updatedAt: nowTs,
        });

        const walletRef = db.collection('admin_stats').doc('wallet');
        if (walletSnap.exists) {
          const wData = walletSnap.data() as Record<string, unknown>;
          tx.update(walletRef, {
            commissionBalance: Number(wData.commissionBalance || 0) + CARD_RENEWAL_FEE_FCFA,
            totalCommissionsEarned: Number(wData.totalCommissionsEarned || 0) + CARD_RENEWAL_FEE_FCFA,
            updatedAt: nowTs,
          });
        } else {
          tx.set(walletRef, {
            commissionBalance: CARD_RENEWAL_FEE_FCFA,
            totalCommissionsEarned: CARD_RENEWAL_FEE_FCFA,
            totalWithdrawnByAdmin: 0,
            updatedAt: nowTs,
          });
        }

        const txRef = db.collection('transactions').doc(txId);
        tx.set(txRef, {
          id: txId,
          userId: requestedUid,
          userName: String(uData.fullName || 'Utilisateur AFRICABANK'),
          recipientId: '',
          recipientName: 'Administration AFRICABANK',
          type: 'card_renewal',
          operator: 'AFRICABANK Card Issuing',
          phoneOrAccount: cData.last4 ? `•••• ${String(cData.last4)}` : 'Carte Virtuelle',
          country: 'Gabon',
          grossAmount: CARD_RENEWAL_FEE_FCFA,
          feeAmount: CARD_RENEWAL_FEE_FCFA,
          netAmount: CARD_RENEWAL_FEE_FCFA,
          status: 'completed',
          description: `Renouvellement carte virtuelle (Cycle #${nextCycle}) — Frais ${CARD_RENEWAL_FEE_FCFA} FCFA`,
          createdAt: nowTs,
        });

        const cardUpdatePayload = {
          ...cData,
          ...issuerUpdatedFields,
          status: issuer.configured ? issuerUpdatedFields.status || cData.status : cData.status,
          issuedAt: nowTs,
          renewableAt: nextRenewableTs,
          cycleNumber: nextCycle,
          renewalStatus: 'active',
          updatedAt: nowTs,
        };
        tx.set(cardRef, cardUpdatePayload);
        updatedCardResult = cardUpdatePayload;

        tx.set(db.collection('notifications').doc(notifId), {
          id: notifId,
          userId: requestedUid,
          title: 'Carte virtuelle renouvelée',
          message: `Votre carte virtuelle (Cycle #${nextCycle}) a été renouvelée pour 5 mois. Frais débités : ${CARD_RENEWAL_FEE_FCFA} FCFA.`,
          category: 'card',
          read: false,
          createdAt: notifTs.createdAt,
          expiresAt: notifTs.expiresAt,
        });
      });

      return {
        statusCode: 200,
        body: {
          card: serializeCard(updatedCardResult, issuer.configured),
          txId,
          feeCharged: CARD_RENEWAL_FEE_FCFA,
          message: `Renouvellement validé (${CARD_RENEWAL_FEE_FCFA} FCFA débités). Nouveau cycle actif pour 5 mois.`,
        },
      };
    }

    return { statusCode: 400, body: { error: 'Action carte non reconnue.' } };
  } catch (err) {
    if (isAdminSdkPermissionError(err)) {
      return {
        statusCode: 503,
        body: {
          error:
            'Credentials Firebase Admin (FIREBASE_SERVICE_ACCOUNT ou FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) requis pour exécuter cette opération serveur.',
        },
      };
    }
    return {
      statusCode: 400,
      body: { error: err instanceof Error ? err.message : 'Erreur lors du traitement de la carte.' },
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

  const result = await processCardsRequest({
    method: event.httpMethod,
    authHeader: event.headers.authorization || event.headers.Authorization,
    signatureHeader:
      event.headers['x-card-issuer-signature'] ||
      event.headers['x-webhook-signature'] ||
      event.headers['X-Card-Issuer-Signature'],
    rawBody: event.body || '',
    body: parsedBody,
  });

  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
};
