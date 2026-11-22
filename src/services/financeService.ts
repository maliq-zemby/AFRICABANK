import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ADMIN_BOOTSTRAP_EMAIL,
  ADMIN_DEFAULT_PROFILE,
  ADMIN_SECONDARY_EMAIL,
  calculateCommission,
  computeRenewableAt,
  formatFCFA,
  formatFullDateFr,
  generateDocId,
  isNotificationActive,
  NOTIFICATION_TTL_MS,
  SUBSCRIPTION_ALERT_WINDOW_DAYS,
  SUBSCRIPTION_DEFAULT_DAYS,
  toMillisSafe,
} from '../lib/formatters';
import type {
  CardDirectoryEntry,
  CardRevealPayload,
  LoanConfig,
  LoanRequest,
  MobileOperator,
  SubscriptionRecord,
  UserProfile,
  VirtualCardRecord,
} from '../types';

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return lower === ADMIN_BOOTSTRAP_EMAIL.toLowerCase() || lower === ADMIN_SECONDARY_EMAIL.toLowerCase();
}

export const DEFAULT_LOAN_CONFIG: LoanConfig = {
  minTransactionsCount: 5,
  minCumulativeVolume: 100000,
  maxLoanAmount: 1000000,
  updatedAt: new Date(),
};

function buildNotificationExpiresAt(nowMs = Date.now()): Timestamp {
  return Timestamp.fromMillis(nowMs + NOTIFICATION_TTL_MS);
}

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const msg = (err as { message?: string }).message || '';
  return code === 'not-found' || msg.includes('No document to update');
}

async function commitBatchWithAdminCommission(
  feeAmount: number,
  buildOperations: (batch: WriteBatch) => void
): Promise<void> {
  const walletRef = doc(db, 'admin_stats', 'wallet');
  const batch1 = writeBatch(db);
  buildOperations(batch1);
  if (feeAmount > 0) {
    batch1.update(walletRef, {
      commissionBalance: increment(feeAmount),
      totalCommissionsEarned: increment(feeAmount),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch1.commit();
  } catch (error) {
    if (feeAmount > 0 && isNotFoundError(error)) {
      const batch2 = writeBatch(db);
      buildOperations(batch2);
      batch2.set(walletRef, {
        commissionBalance: feeAmount,
        totalCommissionsEarned: feeAmount,
        totalWithdrawnByAdmin: 0,
        updatedAt: serverTimestamp(),
      });
      try {
        await batch2.commit();
        return;
      } catch (err2) {
        handleFirestoreError(err2, OperationType.WRITE, 'admin_stats/wallet');
      }
    }
    handleFirestoreError(error, OperationType.WRITE, 'transactions');
  }
}

export async function completeUserOnboarding(params: {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  age: number;
  acceptedTerms: boolean;
}): Promise<void> {
  const { uid, email, firstName, lastName, age, acceptedTerms } = params;
  const isPrimaryAdmin = email.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();
  const cleanFirst = (isPrimaryAdmin ? ADMIN_DEFAULT_PROFILE.firstName : firstName.trim()).slice(0, 60);
  const cleanLast = (isPrimaryAdmin ? ADMIN_DEFAULT_PROFILE.lastName : lastName.trim()).slice(0, 60);
  const fullName = (isPrimaryAdmin ? ADMIN_DEFAULT_PROFILE.fullName : `${cleanFirst} ${cleanLast}`).trim().slice(0, 120);
  const finalAge = isPrimaryAdmin ? ADMIN_DEFAULT_PROFILE.age : Math.floor(age);
  const isBootstrapAdmin = isAdminEmail(email);

  const nowDate = new Date();
  const renewableAtDate = computeRenewableAt(nowDate);
  const subExpiryDate = new Date(nowDate.getTime() + SUBSCRIPTION_DEFAULT_DAYS * 24 * 60 * 60 * 1000);

  const batch = writeBatch(db);
  const userRef = doc(db, 'users', uid);
  const cardRef = doc(db, 'cards', uid);
  const subRef = doc(db, 'subscriptions', uid);
  const msgDirRef = doc(db, 'messaging_directory', uid);
  const welcomeNotifId = generateDocId('notif');
  const notifRef = doc(db, 'notifications', welcomeNotifId);

  batch.set(userRef, {
    uid,
    email: email.slice(0, 120),
    firstName: cleanFirst,
    lastName: cleanLast,
    fullName,
    age: finalAge,
    acceptedTerms,
    role: isBootstrapAdmin ? 'admin' : 'user',
    isBanned: false,
    banReason: '',
    balance: 0,
    totalDepositsCount: 0,
    totalDepositsVolume: 0,
    totalWithdrawalsVolume: 0,
    totalTransactionsCount: 0,
    totalVolume: 0,
    loanEligible: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Card initialized cleanly as pending_issuance (no fake PAN or CVV generated client-side)
  batch.set(cardRef, {
    uid,
    cardId: '',
    last4: '',
    expiryMonth: '',
    expiryYear: '',
    status: 'pending_issuance',
    brand: 'VISA',
    currency: 'XAF',
    provider: "En attente d'activation émetteur",
    issuedAt: Timestamp.fromDate(nowDate),
    renewableAt: Timestamp.fromDate(renewableAtDate),
    cycleNumber: 1,
    renewalStatus: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(subRef, {
    uid,
    plan: 'AFRICABANK Standard',
    status: 'active',
    startedAt: Timestamp.fromDate(nowDate),
    expiresAt: Timestamp.fromDate(subExpiryDate),
    lastAlertForExpiryMs: 0,
    updatedAt: serverTimestamp(),
  });

  batch.set(msgDirRef, {
    uid,
    displayName: fullName,
    cardLast4: '0000',
    role: isBootstrapAdmin ? 'admin' : 'user',
    updatedAt: serverTimestamp(),
  });

  batch.set(notifRef, {
    id: welcomeNotifId,
    userId: uid,
    title: 'Bienvenue sur AFRICABANK',
    message:
      "Votre compte AFRICABANK est créé. Votre carte virtuelle est en attente d'activation par l'émetteur réel et vos dépôts Airtel / Moov Money passent par validation sécurisée.",
    category: 'security',
    read: false,
    createdAt: serverTimestamp(),
    expiresAt: buildNotificationExpiresAt(nowDate.getTime()),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }

  if (isBootstrapAdmin) {
    await ensureAdminBootstrapDocs();
  }
}

export async function ensureUserCardAndSubscriptionInitialized(uid: string): Promise<void> {
  const nowDate = new Date();
  const cardRef = doc(db, 'cards', uid);
  const subRef = doc(db, 'subscriptions', uid);

  try {
    const [cardSnap, subSnap] = await Promise.all([getDoc(cardRef), getDoc(subRef)]);
    if (!cardSnap.exists()) {
      await setDoc(cardRef, {
        uid,
        cardId: '',
        last4: '',
        expiryMonth: '',
        expiryYear: '',
        status: 'pending_issuance',
        brand: 'VISA',
        currency: 'XAF',
        provider: "En attente d'activation émetteur",
        issuedAt: Timestamp.fromDate(nowDate),
        renewableAt: Timestamp.fromDate(computeRenewableAt(nowDate)),
        cycleNumber: 1,
        renewalStatus: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    if (!subSnap.exists()) {
      await setDoc(subRef, {
        uid,
        plan: 'AFRICABANK Standard',
        status: 'active',
        startedAt: Timestamp.fromDate(nowDate),
        expiresAt: Timestamp.fromMillis(nowDate.getTime() + SUBSCRIPTION_DEFAULT_DAYS * 24 * 60 * 60 * 1000),
        lastAlertForExpiryMs: 0,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Migration silencieuse si déjà en place
  }
}

async function ensureAdminBootstrapDocs(): Promise<void> {
  try {
    const configRef = doc(db, 'settings', 'loan_config');
    const configSnap = await getDoc(configRef);
    if (!configSnap.exists()) {
      await setDoc(configRef, {
        minTransactionsCount: DEFAULT_LOAN_CONFIG.minTransactionsCount,
        minCumulativeVolume: DEFAULT_LOAN_CONFIG.minCumulativeVolume,
        maxLoanAmount: DEFAULT_LOAN_CONFIG.maxLoanAmount,
        updatedAt: serverTimestamp(),
      });
    }
    const walletRef = doc(db, 'admin_stats', 'wallet');
    const walletSnap = await getDoc(walletRef);
    if (!walletSnap.exists()) {
      await setDoc(walletRef, {
        commissionBalance: 0,
        totalCommissionsEarned: 0,
        totalWithdrawnByAdmin: 0,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Initialisation silencieuse si déjà créée
  }
}

export async function ensurePrimaryAdminProfile(uid: string, email: string): Promise<void> {
  if (!isAdminEmail(email)) return;
  const isBootstrapPrimary = email.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    if (isBootstrapPrimary) {
      await completeUserOnboarding({
        uid,
        email,
        firstName: ADMIN_DEFAULT_PROFILE.firstName,
        lastName: ADMIN_DEFAULT_PROFILE.lastName,
        age: ADMIN_DEFAULT_PROFILE.age,
        acceptedTerms: true,
      });
    }
    return;
  }

  const data = snap.data() as UserProfile;
  if (data.role !== 'admin') {
    await updateDoc(userRef, {
      role: 'admin',
      updatedAt: serverTimestamp(),
    });
  }
  await ensureAdminBootstrapDocs();
}

export async function cleanupExpiredNotifications(uid: string): Promise<number> {
  try {
    const snap = await getDocs(query(collection(db, 'notifications'), where('userId', '==', uid)));
    const nowMs = Date.now();
    let deletedCount = 0;
    for (const d of snap.docs) {
      const data = d.data() as { createdAt?: unknown; expiresAt?: unknown };
      if (!isNotificationActive(data, nowMs)) {
        await deleteDoc(d.ref).catch(() => undefined);
        deletedCount += 1;
      }
    }
    return deletedCount;
  } catch {
    return 0;
  }
}

export async function ensureSubscriptionExpiryAlert(sub: SubscriptionRecord): Promise<void> {
  const expiresMs = toMillisSafe(sub.expiresAt);
  if (!expiresMs) return;
  const nowMs = Date.now();
  const windowMs = SUBSCRIPTION_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const remainingMs = expiresMs - nowMs;

  if (remainingMs > windowMs) {
    return;
  }

  const nextStatus = remainingMs <= 0 ? 'expired' : 'expiring_soon';
  const alreadyAlerted = Number(sub.lastAlertForExpiryMs || 0) === expiresMs;
  if (alreadyAlerted && sub.status === nextStatus) {
    return;
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'subscriptions', sub.uid), {
    status: nextStatus,
    lastAlertForExpiryMs: expiresMs,
    updatedAt: serverTimestamp(),
  });

  if (!alreadyAlerted) {
    const notifId = generateDocId('notif_sub');
    const daysLeft = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: sub.uid,
      title: remainingMs <= 0 ? 'Abonnement AFRICABANK expiré' : 'Abonnement bientôt expiré',
      message:
        remainingMs <= 0
          ? `Votre abonnement ${sub.plan} a expiré le ${formatFullDateFr(expiresMs)}. Renouvelez-le pour conserver vos services.`
          : `Votre abonnement ${sub.plan} expire dans ${daysLeft} jour(s) (${formatFullDateFr(expiresMs)}). Pensez à le renouveler.`,
      category: 'subscription',
      read: false,
      createdAt: serverTimestamp(),
      expiresAt: buildNotificationExpiresAt(nowMs),
    });
  }

  try {
    await batch.commit();
  } catch {
    // Ignore concurrent deduplication updates
  }
}

export async function fetchOrIssueVirtualCard(idToken: string): Promise<{
  card: VirtualCardRecord | null;
  issuerConfigured: boolean;
  message: string;
}> {
  const resp = await fetch('/api/cards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action: 'issue' }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    card?: VirtualCardRecord;
    issuerConfigured?: boolean;
    message?: string;
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || 'Impossible de contacter le service émetteur de cartes.');
  }
  return {
    card: data.card || null,
    issuerConfigured: Boolean(data.issuerConfigured),
    message: data.message || '',
  };
}

export async function revealVirtualCard(idToken: string): Promise<CardRevealPayload> {
  const resp = await fetch('/api/cards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action: 'reveal' }),
  });
  const data = (await resp.json().catch(() => ({}))) as CardRevealPayload;
  if (!resp.ok || !data.revealed) {
    throw new Error(data.error || "Affichage sécurisé refusé par l'émetteur.");
  }
  return data;
}

export async function renewVirtualCardServer(idToken: string): Promise<{
  card: VirtualCardRecord;
  txId: string;
  feeCharged: number;
  message: string;
}> {
  const resp = await fetch('/api/cards', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action: 'renew' }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    card?: VirtualCardRecord;
    txId?: string;
    feeCharged?: number;
    message?: string;
    error?: string;
  };
  if (!resp.ok || !data.card) {
    throw new Error(data.error || 'Échec du renouvellement de la carte.');
  }
  return {
    card: data.card,
    txId: data.txId || '',
    feeCharged: Number(data.feeCharged || 500),
    message: data.message || 'Carte renouvelée avec succès.',
  };
}

export async function renewSubscriptionServer(idToken: string): Promise<{
  subscription: SubscriptionRecord;
  message: string;
}> {
  const resp = await fetch('/api/subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ action: 'renew' }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    subscription?: SubscriptionRecord;
    message?: string;
    error?: string;
  };
  if (!resp.ok || !data.subscription) {
    throw new Error(data.error || "Échec du renouvellement de l'abonnement.");
  }
  return {
    subscription: data.subscription,
    message: data.message || 'Abonnement renouvelé avec succès.',
  };
}

export async function adminPurgeTestData(idToken: string): Promise<{
  deletedTransactions: number;
  resetUsers: number;
  deletedExpiredNotifications: number;
  walletReset: boolean;
  message: string;
}> {
  const resp = await fetch('/api/admin/purge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ resetBalances: true }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    deletedTransactions?: number;
    resetUsers?: number;
    deletedExpiredNotifications?: number;
    walletReset?: boolean;
    message?: string;
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || 'Échec de la purge administrateur.');
  }
  return {
    deletedTransactions: Number(data.deletedTransactions || 0),
    resetUsers: Number(data.resetUsers || 0),
    deletedExpiredNotifications: Number(data.deletedExpiredNotifications || 0),
    walletReset: Boolean(data.walletReset),
    message: data.message || 'Purge effectuée avec succès.',
  };
}

export async function lookupCardDirectory(cardNumber: string): Promise<CardDirectoryEntry | null> {
  const clean = cardNumber.replace(/\D/g, '');
  if (!/^\d{16}$/.test(clean)) return null;
  try {
    const snap = await getDoc(doc(db, 'card_directory', clean));
    if (!snap.exists()) return null;
    return snap.data() as CardDirectoryEntry;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `card_directory/${clean}`);
  }
}

function evaluateLoanEligibility(
  user: UserProfile,
  addedTxCount: number,
  addedVolume: number,
  config: LoanConfig
): boolean {
  if (user.loanEligible) return true;
  const nextCount = user.totalTransactionsCount + addedTxCount;
  const nextVolume = user.totalVolume + addedVolume;
  return nextCount >= config.minTransactionsCount && nextVolume >= config.minCumulativeVolume;
}

export type MobileMoneyGatewayStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED';

export interface GatewayHealthStatus {
  ok: boolean;
  gatewayConfigured: boolean;
  webhookConfigured: boolean;
  fullyConfigured: boolean;
  missingCount: number;
}

export async function fetchMobileMoneyGatewayHealth(): Promise<GatewayHealthStatus> {
  try {
    const resp = await fetch('/api/health');
    if (!resp.ok) {
      return {
        ok: false,
        gatewayConfigured: false,
        webhookConfigured: false,
        fullyConfigured: false,
        missingCount: 5,
      };
    }
    const data = (await resp.json()) as Partial<GatewayHealthStatus>;
    return {
      ok: Boolean(data.ok),
      gatewayConfigured: Boolean(data.gatewayConfigured),
      webhookConfigured: Boolean(data.webhookConfigured),
      fullyConfigured: Boolean(data.fullyConfigured),
      missingCount: typeof data.missingCount === 'number' ? data.missingCount : 0,
    };
  } catch {
    return {
      ok: false,
      gatewayConfigured: false,
      webhookConfigured: false,
      fullyConfigured: false,
      missingCount: 5,
    };
  }
}

export interface MobileMoneyGatewayResponse {
  referenceId: string;
  txId: string;
  status: MobileMoneyGatewayStatus;
  gatewayConfigured?: boolean;
  singpayRoute?: string;
  expiresAt?: number;
  message: string;
}

export async function createPendingMobileMoneyTransaction(params: {
  user: UserProfile;
  type: 'deposit' | 'withdrawal';
  operator: MobileOperator;
  phone: string;
  amount: number;
}): Promise<{ txId: string; fee: number; netAmount: number }> {
  const { user, type, operator, phone, amount } = params;
  const fee = calculateCommission(amount);
  const netAmount = type === 'deposit' ? amount - fee : amount + fee;

  if (type === 'withdrawal' && user.balance < netAmount) {
    throw new Error(`Solde insuffisant. Requis : ${formatFCFA(netAmount)} (dont 2% de frais).`);
  }

  const txId = generateDocId('tx');
  const label = type === 'deposit' ? 'Dépôt' : 'Retrait';
  const description = `${label} ${operator} (${phone.slice(0, 24)}) — En attente de confirmation`.slice(0, 240);

  try {
    await setDoc(doc(db, 'transactions', txId), {
      id: txId,
      userId: user.uid,
      userName: user.fullName,
      recipientId: '',
      recipientName: '',
      type,
      operator,
      phoneOrAccount: phone.slice(0, 100),
      country: 'Gabon',
      grossAmount: amount,
      feeAmount: fee,
      netAmount,
      status: 'pending',
      description,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `transactions/${txId}`);
  }

  return { txId, fee, netAmount };
}

export async function initiateMobileMoneyGateway(params: {
  idToken: string;
  txId: string;
  type: 'deposit' | 'withdrawal' | 'admin_withdrawal';
  operator: MobileOperator;
  phone: string;
  amount: number;
}): Promise<MobileMoneyGatewayResponse> {
  const resp = await fetch('/api/payments/singpay/initiate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.idToken}`,
    },
    body: JSON.stringify({
      txId: params.txId,
      type: params.type,
      operator: params.operator,
      phone: params.phone,
      amount: params.amount,
    }),
  });

  const data = (await resp.json().catch(() => ({}))) as Partial<MobileMoneyGatewayResponse> & {
    error?: string;
  };

  if (!resp.ok && data.status !== 'FAILED') {
    throw new Error(data.error || data.message || 'Impossible d’initier la demande SingPay.');
  }

  return {
    referenceId: data.referenceId || '',
    txId: data.txId || params.txId,
    status: data.status || 'PENDING',
    gatewayConfigured: data.gatewayConfigured,
    singpayRoute: data.singpayRoute,
    expiresAt: data.expiresAt,
    message: data.message || 'En attente de validation sur votre téléphone...',
  };
}

export async function pollMobileMoneyStatus(params: {
  idToken: string;
  referenceId: string;
}): Promise<MobileMoneyGatewayResponse> {
  const resp = await fetch(
    `/api/payments/singpay/status/${encodeURIComponent(params.referenceId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${params.idToken}`,
      },
    }
  );
  const data = (await resp.json().catch(() => ({}))) as Partial<MobileMoneyGatewayResponse> & {
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || 'Erreur lors de la vérification du statut SingPay.');
  }
  return {
    referenceId: data.referenceId || params.referenceId,
    txId: data.txId || '',
    status: data.status || 'PENDING',
    gatewayConfigured: data.gatewayConfigured,
    singpayRoute: data.singpayRoute,
    expiresAt: data.expiresAt,
    message: data.message || '',
  };
}

export async function cancelMobileMoneyGateway(params: {
  idToken: string;
  referenceId: string;
}): Promise<MobileMoneyGatewayResponse> {
  const resp = await fetch('/api/payments/singpay/cancel', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.idToken}`,
    },
    body: JSON.stringify({ referenceId: params.referenceId }),
  });
  const data = (await resp.json().catch(() => ({}))) as Partial<MobileMoneyGatewayResponse> & {
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || 'Impossible d’annuler la demande SingPay.');
  }
  return {
    referenceId: data.referenceId || params.referenceId,
    txId: data.txId || '',
    status: data.status || 'FAILED',
    message: data.message || 'Paiement annulé / échoué.',
  };
}

export async function finalizeConfirmedMobileMoneyTransaction(params: {
  user: UserProfile;
  txId: string;
  type: 'deposit' | 'withdrawal';
  operator: MobileOperator;
  phone: string;
  amount: number;
  loanConfig: LoanConfig;
}): Promise<{ fee: number; netAmount: number; becameEligible: boolean }> {
  const { user, txId, type, operator, phone, amount, loanConfig } = params;
  const fee = calculateCommission(amount);
  const netAmount = type === 'deposit' ? amount - fee : amount + fee;

  if (type === 'withdrawal' && user.balance < netAmount) {
    throw new Error(`Solde insuffisant au moment de la confirmation. Requis : ${formatFCFA(netAmount)}.`);
  }

  const becameEligible = !user.loanEligible && evaluateLoanEligibility(user, 1, amount, loanConfig);
  const nextEligible = user.loanEligible || becameEligible;
  const notifId = generateDocId('notif');
  const expiresAt = buildNotificationExpiresAt();

  await commitBatchWithAdminCommission(fee, (batch) => {
    if (type === 'deposit') {
      batch.update(doc(db, 'users', user.uid), {
        balance: increment(netAmount),
        totalDepositsCount: increment(1),
        totalDepositsVolume: increment(amount),
        totalTransactionsCount: increment(1),
        totalVolume: increment(amount),
        loanEligible: nextEligible,
        updatedAt: serverTimestamp(),
      });

      batch.update(doc(db, 'transactions', txId), {
        status: 'completed',
        description: `Recharge ${operator} (${phone}) — Net crédité ${formatFCFA(netAmount)}`.slice(0, 240),
      });

      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: user.uid,
        title: 'Dépôt confirmé',
        message: `Votre dépôt de ${formatFCFA(amount)} via ${operator} a été confirmé. ${formatFCFA(netAmount)} crédités (frais 2% : ${formatFCFA(fee)}).`,
        category: 'transaction',
        read: false,
        createdAt: serverTimestamp(),
        expiresAt,
      });
    } else {
      batch.update(doc(db, 'users', user.uid), {
        balance: increment(-netAmount),
        totalWithdrawalsVolume: increment(amount),
        totalTransactionsCount: increment(1),
        totalVolume: increment(amount),
        loanEligible: nextEligible,
        updatedAt: serverTimestamp(),
      });

      batch.update(doc(db, 'transactions', txId), {
        status: 'completed',
        description: `Retrait vers ${operator} (${phone}) — Confirmé`.slice(0, 240),
      });

      batch.set(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: user.uid,
        title: 'Retrait effectué',
        message: `${formatFCFA(amount)} envoyés vers ${operator} (${phone}). Débit total : ${formatFCFA(netAmount)}.`,
        category: 'transaction',
        read: false,
        createdAt: serverTimestamp(),
        expiresAt,
      });
    }

    if (becameEligible) {
      const loyaltyNotifId = generateDocId('notif');
      batch.set(doc(db, 'notifications', loyaltyNotifId), {
        id: loyaltyNotifId,
        userId: user.uid,
        title: 'Éligibilité aux prêts débloquée',
        message: "Félicitations, votre fidélité vous permet d'effectuer des prêts !",
        category: 'loan',
        read: false,
        createdAt: serverTimestamp(),
        expiresAt,
      });
    }
  });

  return { fee, netAmount, becameEligible };
}

export async function failMobileMoneyTransaction(params: {
  txId: string;
  operator: MobileOperator;
  type: 'deposit' | 'withdrawal';
  reason: string;
}): Promise<void> {
  const { txId, operator, type, reason } = params;
  const label = type === 'deposit' ? 'Dépôt' : 'Retrait';
  try {
    await updateDoc(doc(db, 'transactions', txId), {
      status: 'failed',
      description: `${label} ${operator} échoué : ${reason}`.slice(0, 240),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `transactions/${txId}`);
  }
}

export async function executeInternalTransfer(params: {
  user: UserProfile;
  recipient: CardDirectoryEntry;
  amount: number;
  loanConfig: LoanConfig;
}): Promise<{ fee: number; totalDebited: number; becameEligible: boolean }> {
  const { user, recipient, amount, loanConfig } = params;
  if (recipient.uid === user.uid) {
    throw new Error('Vous ne pouvez pas transférer vers votre propre carte.');
  }
  const fee = calculateCommission(amount);
  const totalDebited = amount + fee;
  if (user.balance < totalDebited) {
    throw new Error(`Solde insuffisant. Requis : ${formatFCFA(totalDebited)} (frais 2% inclus).`);
  }

  const becameEligible = !user.loanEligible && evaluateLoanEligibility(user, 1, amount, loanConfig);
  const nextEligible = user.loanEligible || becameEligible;
  const txId = generateDocId('tx');
  const recipientNotifId = generateDocId('notif');
  const expiresAt = buildNotificationExpiresAt();

  await commitBatchWithAdminCommission(fee, (batch) => {
    batch.update(doc(db, 'users', user.uid), {
      balance: increment(-totalDebited),
      totalTransactionsCount: increment(1),
      totalVolume: increment(amount),
      loanEligible: nextEligible,
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(db, 'users', recipient.uid), {
      balance: increment(amount),
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'transactions', txId), {
      id: txId,
      userId: user.uid,
      userName: user.fullName,
      recipientId: recipient.uid,
      recipientName: recipient.holderName,
      type: 'transfer_internal',
      operator: 'Carte Virtuelle',
      phoneOrAccount: recipient.cardNumber,
      country: 'Gabon',
      grossAmount: amount,
      feeAmount: fee,
      netAmount: totalDebited,
      status: 'completed',
      description: `Transfert carte à carte vers ${recipient.holderName}`,
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', recipientNotifId), {
      id: recipientNotifId,
      userId: recipient.uid,
      title: 'Fonds reçus',
      message: `Vous avez reçu ${formatFCFA(amount)} de ${user.fullName} sur votre carte virtuelle.`,
      category: 'transaction',
      read: false,
      createdAt: serverTimestamp(),
      expiresAt,
    });

    if (becameEligible) {
      const loyaltyNotifId = generateDocId('notif');
      batch.set(doc(db, 'notifications', loyaltyNotifId), {
        id: loyaltyNotifId,
        userId: user.uid,
        title: 'Éligibilité aux prêts débloquée',
        message: "Félicitations, votre fidélité vous permet d'effectuer des prêts !",
        category: 'loan',
        read: false,
        createdAt: serverTimestamp(),
        expiresAt,
      });
    }
  });

  return { fee, totalDebited, becameEligible };
}

export async function executeOnlinePurchase(params: {
  user: UserProfile;
  cardLast4: string;
  merchantName: string;
  amount: number;
  loanConfig: LoanConfig;
}): Promise<{ fee: number; totalDebited: number; becameEligible: boolean }> {
  const { user, cardLast4, merchantName, amount, loanConfig } = params;
  const fee = calculateCommission(amount);
  const totalDebited = amount + fee;
  if (user.balance < totalDebited) {
    throw new Error(`Solde insuffisant. Requis : ${formatFCFA(totalDebited)} (frais 2% inclus).`);
  }

  const becameEligible = !user.loanEligible && evaluateLoanEligibility(user, 1, amount, loanConfig);
  const nextEligible = user.loanEligible || becameEligible;
  const txId = generateDocId('tx');
  const notifId = generateDocId('notif');
  const expiresAt = buildNotificationExpiresAt();
  const maskedLast4 = cardLast4 ? `•••• ${cardLast4}` : 'Carte Virtuelle';

  await commitBatchWithAdminCommission(fee, (batch) => {
    batch.update(doc(db, 'users', user.uid), {
      balance: increment(-totalDebited),
      totalTransactionsCount: increment(1),
      totalVolume: increment(amount),
      loanEligible: nextEligible,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'transactions', txId), {
      id: txId,
      userId: user.uid,
      userName: user.fullName,
      recipientId: '',
      recipientName: merchantName.slice(0, 120),
      type: 'online_purchase',
      operator: 'Carte Virtuelle',
      phoneOrAccount: maskedLast4,
      country: 'E-Commerce',
      grossAmount: amount,
      feeAmount: fee,
      netAmount: totalDebited,
      status: 'completed',
      description: `Paiement en ligne — ${merchantName.slice(0, 100)}`,
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: user.uid,
      title: 'Paiement en ligne autorisé',
      message: `Achat de ${formatFCFA(amount)} chez ${merchantName} validé (commission 2% : ${formatFCFA(fee)}).`,
      category: 'transaction',
      read: false,
      createdAt: serverTimestamp(),
      expiresAt,
    });

    if (becameEligible) {
      const loyaltyNotifId = generateDocId('notif');
      batch.set(doc(db, 'notifications', loyaltyNotifId), {
        id: loyaltyNotifId,
        userId: user.uid,
        title: 'Éligibilité aux prêts débloquée',
        message: "Félicitations, votre fidélité vous permet d'effectuer des prêts !",
        category: 'loan',
        read: false,
        createdAt: serverTimestamp(),
        expiresAt,
      });
    }
  });

  return { fee, totalDebited, becameEligible };
}

export async function executeInternationalTransfer(params: {
  user: UserProfile;
  country: string;
  beneficiaryName: string;
  accountRef: string;
  amount: number;
  loanConfig: LoanConfig;
}): Promise<{ fee: number; totalDebited: number; becameEligible: boolean }> {
  const { user, country, beneficiaryName, accountRef, amount, loanConfig } = params;
  const fee = calculateCommission(amount);
  const totalDebited = amount + fee;
  if (user.balance < totalDebited) {
    throw new Error(`Solde insuffisant. Requis : ${formatFCFA(totalDebited)} (frais 2% inclus).`);
  }

  const becameEligible = !user.loanEligible && evaluateLoanEligibility(user, 1, amount, loanConfig);
  const nextEligible = user.loanEligible || becameEligible;
  const txId = generateDocId('tx');
  const notifId = generateDocId('notif');
  const expiresAt = buildNotificationExpiresAt();

  await commitBatchWithAdminCommission(fee, (batch) => {
    batch.update(doc(db, 'users', user.uid), {
      balance: increment(-totalDebited),
      totalTransactionsCount: increment(1),
      totalVolume: increment(amount),
      loanEligible: nextEligible,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, 'transactions', txId), {
      id: txId,
      userId: user.uid,
      userName: user.fullName,
      recipientId: '',
      recipientName: beneficiaryName.slice(0, 120),
      type: 'transfer_international',
      operator: 'International',
      phoneOrAccount: accountRef.slice(0, 100),
      country: country.slice(0, 60),
      grossAmount: amount,
      feeAmount: fee,
      netAmount: totalDebited,
      status: 'completed',
      description: `Transfert international vers ${beneficiaryName} (${country})`,
      createdAt: serverTimestamp(),
    });

    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: user.uid,
      title: 'Transfert international envoyé',
      message: `${formatFCFA(amount)} expédiés vers ${beneficiaryName} (${country}). Statut : Exécuté.`,
      category: 'transaction',
      read: false,
      createdAt: serverTimestamp(),
      expiresAt,
    });

    if (becameEligible) {
      const loyaltyNotifId = generateDocId('notif');
      batch.set(doc(db, 'notifications', loyaltyNotifId), {
        id: loyaltyNotifId,
        userId: user.uid,
        title: 'Éligibilité aux prêts débloquée',
        message: "Félicitations, votre fidélité vous permet d'effectuer des prêts !",
        category: 'loan',
        read: false,
        createdAt: serverTimestamp(),
        expiresAt,
      });
    }
  });

  return { fee, totalDebited, becameEligible };
}

export async function submitLoanRequest(params: {
  user: UserProfile;
  amount: number;
  durationMonths: number;
  reason: string;
}): Promise<void> {
  const { user, amount, durationMonths, reason } = params;
  if (!user.loanEligible) {
    throw new Error('Vous devez d’abord atteindre le seuil de fidélité pour demander un prêt.');
  }
  const loanId = generateDocId('loan');
  const notifId = generateDocId('notif');
  const batch = writeBatch(db);

  batch.set(doc(db, 'loans', loanId), {
    id: loanId,
    userId: user.uid,
    userName: user.fullName,
    amount,
    durationMonths,
    reason: reason.trim().slice(0, 400),
    status: 'pending',
    adminNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: user.uid,
    title: 'Demande de prêt enregistrée',
    message: `Votre demande de prêt de ${formatFCFA(amount)} sur ${durationMonths} mois est en cours d'analyse.`,
    category: 'loan',
    read: false,
    createdAt: serverTimestamp(),
    expiresAt: buildNotificationExpiresAt(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `loans/${loanId}`);
  }
}

export async function adminProcessLoan(params: {
  loan: LoanRequest;
  decision: 'approved' | 'rejected';
  adminNote: string;
}): Promise<void> {
  const { loan, decision, adminNote } = params;
  const batch = writeBatch(db);

  batch.update(doc(db, 'loans', loan.id), {
    status: decision,
    adminNote: adminNote.trim().slice(0, 300),
    updatedAt: serverTimestamp(),
  });

  if (decision === 'approved') {
    batch.update(doc(db, 'users', loan.userId), {
      balance: increment(loan.amount),
      updatedAt: serverTimestamp(),
    });

    const txId = generateDocId('tx');
    batch.set(doc(db, 'transactions', txId), {
      id: txId,
      userId: loan.userId,
      userName: loan.userName,
      recipientId: loan.userId,
      recipientName: loan.userName,
      type: 'loan_disbursement',
      operator: 'Prêt AFRICABANK',
      phoneOrAccount: 'Crédit carte virtuelle',
      country: 'Gabon',
      grossAmount: loan.amount,
      feeAmount: 0,
      netAmount: loan.amount,
      status: 'completed',
      description: `Décaissement prêt approuvé (${loan.durationMonths} mois)`,
      createdAt: serverTimestamp(),
    });
  }

  const notifId = generateDocId('notif');
  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: loan.userId,
    title: decision === 'approved' ? 'Prêt approuvé et crédité' : 'Demande de prêt refusée',
    message:
      decision === 'approved'
        ? `Votre prêt de ${formatFCFA(loan.amount)} a été approuvé. Les fonds sont disponibles sur votre carte.`
        : `Votre demande de prêt de ${formatFCFA(loan.amount)} a été refusée. ${adminNote || ''}`.trim(),
    category: 'loan',
    read: false,
    createdAt: serverTimestamp(),
    expiresAt: buildNotificationExpiresAt(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `loans/${loan.id}`);
  }
}

export async function createPendingAdminWithdrawalTransaction(params: {
  adminUid: string;
  adminName: string;
  operator: MobileOperator;
  phone: string;
  amount: number;
  currentBalance: number;
}): Promise<{ txId: string }> {
  const { adminUid, adminName, operator, phone, amount, currentBalance } = params;
  if (amount < 500 || amount > currentBalance) {
    throw new Error('Montant invalide (minimum 500 FCFA) ou supérieur au solde des commissions disponibles.');
  }
  const txId = generateDocId('tx');
  try {
    await setDoc(doc(db, 'transactions', txId), {
      id: txId,
      userId: adminUid,
      userName: adminName,
      recipientId: '',
      recipientName: adminName,
      type: 'admin_withdrawal',
      operator,
      phoneOrAccount: phone.slice(0, 100),
      country: 'Gabon',
      grossAmount: amount,
      feeAmount: 0,
      netAmount: amount,
      status: 'pending',
      description: `Retrait commissions Admin vers ${operator} (${phone}) — En attente SingPay`.slice(0, 240),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `transactions/${txId}`);
  }
  return { txId };
}

export async function finalizeConfirmedAdminWithdrawal(params: {
  txId: string;
  operator: MobileOperator;
  phone: string;
  amount: number;
  currentBalance: number;
}): Promise<void> {
  const { txId, operator, phone, amount, currentBalance } = params;
  if (amount <= 0 || amount > currentBalance) {
    throw new Error('Solde des commissions insuffisant lors de la confirmation SingPay.');
  }
  const batch = writeBatch(db);
  const walletRef = doc(db, 'admin_stats', 'wallet');

  batch.update(walletRef, {
    commissionBalance: increment(-amount),
    totalWithdrawnByAdmin: increment(amount),
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'transactions', txId), {
    status: 'completed',
    description: `Retrait commissions Admin vers ${operator} (${phone}) — Confirmé SingPay`.slice(0, 240),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'admin_stats/wallet');
  }
}

export async function failAdminWithdrawalTransaction(params: {
  txId: string;
  operator: MobileOperator;
  reason: string;
}): Promise<void> {
  const { txId, operator, reason } = params;
  try {
    await updateDoc(doc(db, 'transactions', txId), {
      status: 'failed',
      description: `Retrait commissions ${operator} échoué : ${reason}`.slice(0, 240),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `transactions/${txId}`);
  }
}

export async function adminToggleUserBan(params: {
  targetUserId: string;
  isBanned: boolean;
  banReason: string;
}): Promise<void> {
  const { targetUserId, isBanned, banReason } = params;
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', targetUserId), {
    isBanned,
    banReason: isBanned ? banReason.trim().slice(0, 500) : '',
    updatedAt: serverTimestamp(),
  });

  const notifId = generateDocId('notif');
  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: targetUserId,
    title: isBanned ? 'Compte suspendu' : 'Compte réactivé',
    message: isBanned
      ? `Votre compte a été banni. Motif : ${banReason}`
      : 'Votre compte a été réactivé par l’administration.',
    category: 'security',
    read: false,
    createdAt: serverTimestamp(),
    expiresAt: buildNotificationExpiresAt(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${targetUserId}`);
  }
}

export async function adminUpdateLoanConfig(config: {
  minTransactionsCount: number;
  minCumulativeVolume: number;
  maxLoanAmount: number;
}): Promise<void> {
  try {
    await setDoc(doc(db, 'settings', 'loan_config'), {
      minTransactionsCount: Math.max(1, Math.floor(config.minTransactionsCount)),
      minCumulativeVolume: Math.max(0, config.minCumulativeVolume),
      maxLoanAmount: Math.max(10000, config.maxLoanAmount),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/loan_config');
  }
}

export async function adminSendBroadcast(params: {
  title: string;
  message: string;
  userIds: string[];
}): Promise<void> {
  const { title, message, userIds } = params;
  const batch = writeBatch(db);
  const expiresAt = buildNotificationExpiresAt();
  for (const uid of userIds) {
    const notifId = generateDocId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: uid,
      title: title.trim().slice(0, 120),
      message: message.trim().slice(0, 500),
      category: 'broadcast',
      read: false,
      createdAt: serverTimestamp(),
      expiresAt,
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'notifications');
  }
}

export async function markNotificationRead(notifId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notifId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notifId}`);
  }
}

export async function sendPrivateMessage(params: {
  senderId: string;
  senderName: string;
  recipientId: string;
  recipientName: string;
  text: string;
  isAdminSupport?: boolean;
}): Promise<string> {
  const { senderId, senderName, recipientId, recipientName, text, isAdminSupport = false } = params;
  const sortedIds = isAdminSupport
    ? ['ADMIN', recipientId]
    : [senderId, recipientId].sort();
  const convId = `conv_${sortedIds[0]}_${sortedIds[1]}`.slice(0, 128);
  const convRef = doc(db, 'conversations', convId);

  try {
    const existingConv = await getDoc(convRef);
    const cleanText = text.trim().slice(0, 1000);
    const msgId = generateDocId('msg');

    if (!existingConv.exists()) {
      await setDoc(convRef, {
        id: convId,
        participantIds: sortedIds,
        participantLabels: isAdminSupport
          ? ['Administration', recipientName]
          : sortedIds[0] === senderId
            ? [senderName, recipientName]
            : [recipientName, senderName],
        isAdminSupport,
        lastMessage: cleanText.slice(0, 300),
        lastSenderId: senderId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const batch = writeBatch(db);
    batch.set(doc(db, 'conversations', convId, 'messages', msgId), {
      id: msgId,
      senderId,
      senderName: senderName.slice(0, 120),
      text: cleanText,
      createdAt: serverTimestamp(),
    });

    if (existingConv.exists()) {
      batch.update(convRef, {
        lastMessage: cleanText.slice(0, 300),
        lastSenderId: senderId,
        updatedAt: serverTimestamp(),
      });
    }

    const notifId = generateDocId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: recipientId,
      title: isAdminSupport ? 'Message de l’Administration' : `Message de ${senderName}`,
      message: cleanText.slice(0, 200),
      category: isAdminSupport ? 'admin' : 'transaction',
      read: false,
      createdAt: serverTimestamp(),
      expiresAt: buildNotificationExpiresAt(),
    });

    await batch.commit();
    return convId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `conversations/${convId}`);
  }
}

export async function postPublicComment(params: {
  userId: string;
  authorName: string;
  rating: number;
  content: string;
}): Promise<void> {
  const commentId = generateDocId('cmt');
  try {
    await setDoc(doc(db, 'comments', commentId), {
      id: commentId,
      userId: params.userId,
      authorName: params.authorName.slice(0, 100),
      rating: Math.min(5, Math.max(1, Math.round(params.rating))),
      content: params.content.trim().slice(0, 500),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `comments/${commentId}`);
  }
}

export async function deletePublicComment(commentId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'comments', commentId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `comments/${commentId}`);
  }
}
