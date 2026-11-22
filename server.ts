import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import { processAdminPurgeRequest } from './netlify/functions/admin-purge';
import { processCardsRequest } from './netlify/functions/cards';
import { processSubscriptionsRequest } from './netlify/functions/subscriptions';

type GatewayStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';
type MobileMoneyOp = 'Airtel Money' | 'Moov Money';
type SingPayTxType = 'deposit' | 'withdrawal' | 'admin_withdrawal';

interface SingPaySession {
  referenceId: string;
  txId: string;
  uid: string;
  type: SingPayTxType;
  operator: MobileMoneyOp;
  phone: string;
  msisdn: string;
  amount: number;
  status: GatewayStatus;
  gatewayConfigured: boolean;
  gatewayTxId: string;
  singpayRoute: string;
  message: string;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

interface AuthenticatedRequest extends Request {
  firebaseUser?: VerifiedFirebaseUser;
  rawBody?: Buffer;
}

interface GatewayConfigStatus {
  gatewayConfigured: boolean;
  webhookConfigured: boolean;
  fullyConfigured: boolean;
  missingCount: number;
}

const SESSION_TTL_MS = 3 * 60 * 1000;
const PORT = Number(process.env.PORT) || 3000;

function loadFirebaseApiKey(): string {
  const envKey = (process.env.FIREBASE_API_KEY || '').trim();
  if (envKey) return envKey;
  try {
    const configPath = path.resolve(import.meta.dirname, 'firebase-applet-config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { apiKey?: string };
    return parsed.apiKey || '';
  } catch {
    return '';
  }
}

const FIREBASE_API_KEY = loadFirebaseApiKey();
const SINGPAY_CLIENT_ID = (process.env.SINGPAY_CLIENT_ID || '').trim();
const SINGPAY_CLIENT_SECRET = (process.env.SINGPAY_CLIENT_SECRET || '').trim();
const SINGPAY_WALLET_ID = (process.env.SINGPAY_WALLET_ID || '').trim();
const SINGPAY_API_URL = (process.env.SINGPAY_API_URL || '').trim().replace(/\/+$/, '');
const SINGPAY_WEBHOOK_URL = (process.env.SINGPAY_WEBHOOK_URL || '').trim();
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/+$/, '');

function getEffectiveWebhookUrl(): string | undefined {
  if (SINGPAY_WEBHOOK_URL) return SINGPAY_WEBHOOK_URL;
  if (APP_URL) return `${APP_URL}/api/payments/singpay/webhook`;
  return undefined;
}

function getGatewayConfigStatus(): GatewayConfigStatus {
  const missingFlags = [
    Boolean(SINGPAY_CLIENT_ID),
    Boolean(SINGPAY_CLIENT_SECRET),
    Boolean(SINGPAY_WALLET_ID),
    Boolean(SINGPAY_API_URL),
    Boolean(SINGPAY_WEBHOOK_URL),
  ];
  const missingCount = missingFlags.filter((present) => !present).length;

  const gatewayConfigured = Boolean(
    SINGPAY_CLIENT_ID && SINGPAY_CLIENT_SECRET && SINGPAY_WALLET_ID && SINGPAY_API_URL
  );
  const webhookConfigured = Boolean(SINGPAY_WEBHOOK_URL || APP_URL);

  return {
    gatewayConfigured,
    webhookConfigured,
    fullyConfigured: gatewayConfigured && Boolean(SINGPAY_WEBHOOK_URL),
    missingCount,
  };
}

// In-memory OAuth 2.0 client_credentials token cache
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getSingPayAccessToken(): Promise<string> {
  if (!SINGPAY_CLIENT_ID || !SINGPAY_CLIENT_SECRET) {
    throw new Error('Identifiants OAuth2 SingPay non configurés.');
  }

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 30_000 > now) {
    return cachedToken.accessToken;
  }

  const candidateUrls: string[] = [`${SINGPAY_API_URL}/oauth/token`];
  try {
    const parsedUrl = new URL(SINGPAY_API_URL);
    const rootTokenUrl = `${parsedUrl.origin}/oauth/token`;
    if (!candidateUrls.includes(rootTokenUrl)) {
      candidateUrls.push(rootTokenUrl);
    }
  } catch {
    // Ignore malformed URL fallback
  }

  let lastError = 'Échec de l’authentification OAuth 2.0 auprès de SingPay.';

  for (const tokenUrl of candidateUrls) {
    try {
      const formBody = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SINGPAY_CLIENT_ID,
        client_secret: SINGPAY_CLIENT_SECRET,
      });

      let resp = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: formBody.toString(),
      });

      if (resp.status === 415) {
        resp = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: SINGPAY_CLIENT_ID,
            client_secret: SINGPAY_CLIENT_SECRET,
          }),
        });
      }

      if (!resp.ok) {
        lastError = `OAuth SingPay HTTP ${resp.status}`;
        continue;
      }

      const data = (await resp.json().catch(() => ({}))) as {
        access_token?: string;
        token?: string;
        expires_in?: number;
      };

      const token = data.access_token || data.token;
      if (!token) {
        lastError = 'Jeton OAuth SingPay absent dans la réponse.';
        continue;
      }

      const ttlSeconds = Number.isFinite(data.expires_in) && (data.expires_in || 0) > 60
        ? Number(data.expires_in)
        : 3600;
      cachedToken = {
        accessToken: token,
        expiresAt: now + ttlSeconds * 1000,
      };
      return token;
    } catch (err) {
      lastError = err instanceof Error ? err.message : lastError;
    }
  }

  throw new Error(lastError);
}

async function buildSingPayHeaders(): Promise<Record<string, string>> {
  const accessToken = await getSingPayAccessToken();
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'x-client-id': SINGPAY_CLIENT_ID,
    'x-client-secret': SINGPAY_CLIENT_SECRET,
    'x-wallet': SINGPAY_WALLET_ID,
  };
}

const sessions = new Map<string, SingPaySession>();

function isValidGabonPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^(\+241)?0?(6[0-9]|7[0-9])[0-9]{6}$/.test(cleaned);
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-()]/g, '').slice(0, 24);
}

function formatSingPayMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('241') && digits.length === 11) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith('2410') && digits.length === 12) {
    return digits.slice(3);
  }
  if (digits.length === 8 && (digits.startsWith('6') || digits.startsWith('7'))) {
    return `0${digits}`;
  }
  return digits.slice(0, 12);
}

function normalizeSingPayStatus(rawStatus: unknown, rawResult?: unknown): GatewayStatus | null {
  const combined = [rawResult, rawStatus]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().toUpperCase());

  if (combined.length === 0) return null;

  for (const val of combined) {
    if (['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'PAID', 'APPROVED'].includes(val)) {
      return 'SUCCESS';
    }
    if (['TIMEOUTERROR', 'EXPIRED', 'TIMEOUT', 'TIMED_OUT'].includes(val)) {
      return 'EXPIRED';
    }
    if (
      [
        'FAILED',
        'FAIL',
        'CANCELLED',
        'CANCELED',
        'REJECTED',
        'ERROR',
        'DECLINED',
        'PASSWORDERROR',
        'BALANCEERROR',
      ].includes(val)
    ) {
      return 'FAILED';
    }
  }

  for (const val of combined) {
    if (['START', 'PENDING', 'PROCESSING', 'INITIATED', 'WAITING'].includes(val)) {
      return 'PENDING';
    }
    if (val === 'TERMINATE') {
      // If Terminate without explicit result, wait for result or treat safely
      return null;
    }
  }

  return null;
}

interface ParsedSingPayPayload {
  gatewayTxId: string;
  reference: string;
  status: GatewayStatus | null;
  apiSuccess: boolean | null;
  message: string;
}

function parseSingPayPayload(payload: unknown): ParsedSingPayPayload {
  if (!payload || typeof payload !== 'object') {
    return { gatewayTxId: '', reference: '', status: null, apiSuccess: null, message: '' };
  }
  const obj = payload as Record<string, unknown>;
  const txObj =
    obj.transaction && typeof obj.transaction === 'object'
      ? (obj.transaction as Record<string, unknown>)
      : obj.data && typeof obj.data === 'object'
        ? (obj.data as Record<string, unknown>)
        : obj;
  const statusBlock =
    obj.status && typeof obj.status === 'object' ? (obj.status as Record<string, unknown>) : null;

  const gatewayTxId = String(txObj._id || txObj.id || obj._id || obj.id || obj.transactionId || '').trim();
  const reference = String(txObj.reference || obj.reference || obj.referenceId || '').trim();
  const rawStatus = txObj.status ?? (typeof obj.status === 'string' ? obj.status : undefined);
  const rawResult = txObj.result ?? obj.result ?? statusBlock?.result_code;
  const apiSuccess =
    typeof statusBlock?.success === 'boolean'
      ? statusBlock.success
      : typeof obj.success === 'boolean'
        ? obj.success
        : null;
  const message = String(
    statusBlock?.message || txObj.message || obj.message || ''
  )
    .trim()
    .slice(0, 300);

  let normalized = normalizeSingPayStatus(rawStatus, rawResult);
  if (!normalized && apiSuccess === false) {
    normalized = 'FAILED';
  }

  return {
    gatewayTxId,
    reference,
    status: normalized,
    apiSuccess,
    message,
  };
}

async function fetchSingPayTransactionStatus(gatewayTxId: string): Promise<ParsedSingPayPayload | null> {
  if (!gatewayTxId) return null;
  const headers = await buildSingPayHeaders();
  const resp = await fetch(
    `${SINGPAY_API_URL}/transaction/api/status/${encodeURIComponent(gatewayTxId)}`,
    {
      method: 'GET',
      headers,
    }
  );
  if (!resp.ok) return null;
  const json = await resp.json().catch(() => null);
  return parseSingPayPayload(json);
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  if (!idToken || !FIREBASE_API_KEY) return null;
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
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

async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Authentification requise (jeton manquant).' });
    return;
  }
  const verified = await verifyFirebaseIdToken(match[1].trim());
  if (!verified || !verified.emailVerified) {
    res.status(401).json({ error: 'Session Google invalide ou non vérifiée.' });
    return;
  }
  req.firebaseUser = verified;
  next();
}

async function startServer(): Promise<void> {
  const app = express();

  app.use(
    express.json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as AuthenticatedRequest).rawBody = buf;
      },
    })
  );

  // Health endpoint (non-blocking if SingPay env vars are not set yet)
  app.get('/api/health', (_req: Request, res: Response) => {
    const gatewayStatus = getGatewayConfigStatus();
    res.json({
      ok: true,
      service: 'AFRICABANK SingPay Gateway',
      ...gatewayStatus,
    });
  });

  // 1. Initiate SingPay Deposit (USSD Push POST /74/paiement or /62/paiement)
  //    or Withdrawal / Admin Commission Transfer (POST /transfert)
  const handleInitiateSingPay = async (req: AuthenticatedRequest, res: Response) => {
    const user = req.firebaseUser;
    if (!user) {
      res.status(401).json({ error: 'Utilisateur non authentifié.' });
      return;
    }

    const body = req.body as {
      txId?: unknown;
      type?: unknown;
      operator?: unknown;
      phone?: unknown;
      amount?: unknown;
    };

    const txId = typeof body.txId === 'string' ? body.txId.trim() : '';
    const type =
      body.type === 'deposit' || body.type === 'withdrawal' || body.type === 'admin_withdrawal'
        ? body.type
        : null;
    const operator =
      body.operator === 'Airtel Money' || body.operator === 'Moov Money' ? body.operator : null;
    const rawPhone = typeof body.phone === 'string' ? body.phone : '';
    const amount = typeof body.amount === 'number' ? Math.round(body.amount) : NaN;

    if (!txId || !/^[a-zA-Z0-9_-]{3,128}$/.test(txId)) {
      res.status(400).json({ error: 'Identifiant de transaction invalide.' });
      return;
    }
    if (!type) {
      res.status(400).json({ error: 'Type d’opération SingPay invalide.' });
      return;
    }
    if (!operator) {
      res.status(400).json({ error: 'Opérateur Mobile Money non pris en charge.' });
      return;
    }
    if (!isValidGabonPhone(rawPhone)) {
      res.status(400).json({ error: 'Numéro Mobile Money gabonais invalide (07X ou 06X).' });
      return;
    }
    if (!Number.isFinite(amount) || amount < 500 || amount > 100000000) {
      res.status(400).json({ error: 'Montant invalide (minimum 500 FCFA).' });
      return;
    }

    const phone = normalizePhone(rawPhone);
    const msisdn = formatSingPayMsisdn(rawPhone);
    const referenceId = `sp_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    const { gatewayConfigured } = getGatewayConfigStatus();

    const singpayRoute =
      type === 'deposit'
        ? operator === 'Airtel Money'
          ? '/74/paiement'
          : '/62/paiement'
        : '/transfert';

    const session: SingPaySession = {
      referenceId,
      txId,
      uid: user.uid,
      type,
      operator,
      phone,
      msisdn,
      amount,
      status: 'PENDING',
      gatewayConfigured,
      gatewayTxId: '',
      singpayRoute,
      message: gatewayConfigured
        ? type === 'deposit'
          ? `En attente de validation sur votre téléphone (${operator} · ${phone})...`
          : `Demande de transfert SingPay envoyée vers ${operator} (${phone}). En attente de confirmation...`
        : `Opération enregistrée en attente (${operator} · ${phone}). La passerelle SingPay est en attente de configuration : aucun solde ni commission de 2 % n’a été modifié.`,
      createdAt: now,
      expiresAt,
      updatedAt: now,
    };

    if (gatewayConfigured) {
      try {
        const headers = await buildSingPayHeaders();
        const callbackUrl = getEffectiveWebhookUrl();

        const upstreamPayload =
          type === 'deposit'
            ? {
                amount,
                reference: referenceId,
                client_msisdn: msisdn,
                portefeuille: SINGPAY_WALLET_ID,
                disbursement: SINGPAY_WALLET_ID,
                isTransfer: false,
                callback_url: callbackUrl,
                webhook_url: callbackUrl,
              }
            : {
                amount,
                reference: referenceId,
                client_msisdn: msisdn,
                operator: operator === 'Airtel Money' ? 'airtel' : 'moov',
                channel: operator === 'Airtel Money' ? '74' : '62',
                portefeuille: SINGPAY_WALLET_ID,
                wallet_id: SINGPAY_WALLET_ID,
                disbursement: SINGPAY_WALLET_ID,
                callback_url: callbackUrl,
                webhook_url: callbackUrl,
              };

        const upstreamResp = await fetch(`${SINGPAY_API_URL}${singpayRoute}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(upstreamPayload),
        });

        const upstreamJson = await upstreamResp.json().catch(() => ({}));
        const parsed = parseSingPayPayload(upstreamJson);

        if (!upstreamResp.ok || parsed.apiSuccess === false || parsed.status === 'FAILED') {
          session.status = 'FAILED';
          session.gatewayTxId = parsed.gatewayTxId;
          session.message =
            parsed.message ||
            `Paiement annulé / échoué (${operator} · HTTP ${upstreamResp.status}). Aucun solde modifié.`;
          session.updatedAt = Date.now();
          sessions.set(referenceId, session);
          res.status(upstreamResp.ok ? 200 : 502).json({
            referenceId,
            txId,
            status: 'FAILED',
            gatewayConfigured,
            singpayRoute,
            expiresAt,
            message: session.message,
          });
          return;
        }

        session.gatewayTxId = parsed.gatewayTxId || referenceId;
        if (parsed.status && parsed.status !== 'PENDING') {
          session.status = parsed.status;
        }
        if (parsed.message && session.status !== 'PENDING') {
          session.message = parsed.message;
        }
        session.updatedAt = Date.now();
      } catch (err) {
        session.status = 'FAILED';
        session.message =
          err instanceof Error
            ? `Paiement annulé / échoué : ${err.message}`
            : `Impossible de joindre SingPay (${singpayRoute}). Aucun solde modifié.`;
        session.updatedAt = Date.now();
        sessions.set(referenceId, session);
        res.status(502).json({
          referenceId,
          txId,
          status: 'FAILED',
          gatewayConfigured,
          singpayRoute,
          expiresAt,
          message: session.message,
        });
        return;
      }
    }

    sessions.set(referenceId, session);
    res.status(202).json({
      referenceId: session.referenceId,
      txId: session.txId,
      status: session.status,
      gatewayConfigured: session.gatewayConfigured,
      singpayRoute: session.singpayRoute,
      expiresAt: session.expiresAt,
      message: session.message,
    });
  };

  app.post('/api/payments/singpay/initiate', requireAuth, handleInitiateSingPay);
  app.post('/api/payments/mobile-money/initiate', requireAuth, handleInitiateSingPay);

  // 2. Poll SingPay Transaction Status via GET /transaction/api/status/{id}
  const handleStatusSingPay = async (req: AuthenticatedRequest, res: Response) => {
    const user = req.firebaseUser;
    const referenceId = String(req.params.referenceId || '').trim();
    const session = sessions.get(referenceId);

    if (!session || !user || session.uid !== user.uid) {
      res.status(404).json({ error: 'Demande de paiement introuvable.' });
      return;
    }

    if (session.status === 'PENDING' && Date.now() > session.expiresAt) {
      session.status = 'EXPIRED';
      session.message = 'Paiement annulé / échoué : le délai de validation sur votre téléphone a expiré.';
      session.updatedAt = Date.now();
    } else if (session.status === 'PENDING' && session.gatewayConfigured && session.gatewayTxId) {
      try {
        const parsed = await fetchSingPayTransactionStatus(session.gatewayTxId);
        if (parsed?.status && parsed.status !== 'PENDING') {
          session.status = parsed.status;
          session.updatedAt = Date.now();
          session.message =
            parsed.status === 'SUCCESS'
              ? session.type === 'deposit'
                ? 'Dépôt confirmé'
                : 'Retrait confirmé'
              : parsed.message || 'Paiement annulé / échoué';
        }
      } catch {
        // Keep PENDING on transient network errors until confirmed or expired
      }
    }

    res.json({
      referenceId: session.referenceId,
      txId: session.txId,
      status: session.status,
      gatewayConfigured: session.gatewayConfigured,
      singpayRoute: session.singpayRoute,
      expiresAt: session.expiresAt,
      message: session.message,
    });
  };

  app.get('/api/payments/singpay/status/:referenceId', requireAuth, handleStatusSingPay);
  app.get('/api/payments/mobile-money/status/:referenceId', requireAuth, handleStatusSingPay);

  // 3. Cancel pending SingPay request locally before confirmation
  const handleCancelSingPay = (req: AuthenticatedRequest, res: Response) => {
    const user = req.firebaseUser;
    const body = req.body as { referenceId?: unknown };
    const referenceId = typeof body.referenceId === 'string' ? body.referenceId.trim() : '';
    const session = sessions.get(referenceId);

    if (!session || !user || session.uid !== user.uid) {
      res.status(404).json({ error: 'Demande de paiement introuvable.' });
      return;
    }

    if (session.status === 'PENDING') {
      session.status = 'FAILED';
      session.message = 'Paiement annulé / échoué avant confirmation SingPay. Aucun solde modifié.';
      session.updatedAt = Date.now();
    }

    res.json({
      referenceId: session.referenceId,
      txId: session.txId,
      status: session.status,
      message: session.message,
    });
  };

  app.post('/api/payments/singpay/cancel', requireAuth, handleCancelSingPay);
  app.post('/api/payments/mobile-money/cancel', requireAuth, handleCancelSingPay);

  // 4. Official SingPay Webhook Receiver (verifies real transaction status with GET /transaction/api/status/{id})
  const handleSingPayWebhook = async (req: AuthenticatedRequest, res: Response) => {
    const parsed = parseSingPayPayload(req.body);

    let target: SingPaySession | undefined = parsed.reference
      ? sessions.get(parsed.reference)
      : undefined;

    if (!target && parsed.gatewayTxId) {
      for (const s of sessions.values()) {
        if (s.gatewayTxId === parsed.gatewayTxId || s.txId === parsed.gatewayTxId) {
          target = s;
          break;
        }
      }
    }

    if (!target) {
      res.status(404).json({ error: 'Session SingPay introuvable.' });
      return;
    }

    let authoritativeStatus = parsed.status;
    let authoritativeMessage = parsed.message;

    // Server-to-server verification against SingPay status endpoint before accepting SUCCESS
    if (target.gatewayConfigured && (target.gatewayTxId || parsed.gatewayTxId)) {
      const lookupId = target.gatewayTxId || parsed.gatewayTxId;
      try {
        const verified = await fetchSingPayTransactionStatus(lookupId);
        if (verified?.status) {
          authoritativeStatus = verified.status;
          if (verified.message) authoritativeMessage = verified.message;
        }
      } catch {
        // Keep parsed status if transient lookup error occurs on non-SUCCESS update
        if (authoritativeStatus === 'SUCCESS') {
          res.status(503).json({ error: 'Impossible de vérifier la transaction auprès de SingPay.' });
          return;
        }
      }
    } else if (authoritativeStatus === 'SUCCESS' && !target.gatewayConfigured) {
      res.status(403).json({ error: 'Passerelle SingPay non configurée.' });
      return;
    }

    if (!authoritativeStatus) {
      res.status(400).json({ error: 'Statut webhook SingPay invalide.' });
      return;
    }

    if (target.status === 'PENDING' && authoritativeStatus !== 'PENDING') {
      target.status = authoritativeStatus;
      target.updatedAt = Date.now();
      target.message =
        authoritativeStatus === 'SUCCESS'
          ? target.type === 'deposit'
            ? 'Dépôt confirmé'
            : 'Retrait confirmé'
          : authoritativeMessage || 'Paiement annulé / échoué';
    }

    res.json({
      received: true,
      referenceId: target.referenceId,
      status: target.status,
    });
  };

  app.post('/api/payments/singpay/webhook', handleSingPayWebhook);
  app.post('/api/payments/mobile-money/webhook', handleSingPayWebhook);

  // Virtual Card Issuing, Reveal & 5-Month Renewal (Netlify Function parity)
  app.all('/api/cards', async (req: AuthenticatedRequest, res: Response) => {
    const result = await processCardsRequest({
      method: req.method,
      authHeader: req.headers.authorization,
      signatureHeader:
        (req.headers['x-card-issuer-signature'] as string | undefined) ||
        (req.headers['x-webhook-signature'] as string | undefined),
      rawBody: req.rawBody ? req.rawBody.toString('utf8') : undefined,
      body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
    });
    res.status(result.statusCode).json(result.body);
  });

  // Subscription Status & Server Renewal (Netlify Function parity)
  app.all('/api/subscriptions', async (req: AuthenticatedRequest, res: Response) => {
    const result = await processSubscriptionsRequest({
      method: req.method,
      authHeader: req.headers.authorization,
      body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
    });
    res.status(result.statusCode).json(result.body);
  });

  // Admin Secure Test-Data Purge (Netlify Function parity)
  app.post('/api/admin/purge', async (req: AuthenticatedRequest, res: Response) => {
    const result = await processAdminPurgeRequest({
      authHeader: req.headers.authorization,
      body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
    });
    res.status(result.statusCode).json(result.body);
  });

  // JSON 404 fallback for unknown /api/* routes so they never hit SPA HTML fallback
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Point de terminaison API introuvable.' });
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    const status = getGatewayConfigStatus();
    if (status.fullyConfigured) {
      console.log(`AFRICABANK server listening on http://0.0.0.0:${PORT} (passerelle SingPay active)`);
    } else {
      console.log(
        `AFRICABANK server listening on http://0.0.0.0:${PORT} (passerelle SingPay en attente de configuration)`
      );
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start AFRICABANK server:', err);
  process.exit(1);
});
