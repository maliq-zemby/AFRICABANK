import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Globe,
  Loader2,
  Send,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  X,
} from 'lucide-react';
import {
  calculateCommission,
  formatCardNumber,
  formatFCFA,
  INTERNATIONAL_COUNTRIES,
  isValidGabonPhone,
} from '../lib/formatters';
import {
  fetchMobileMoneyGatewayHealth,
  type GatewayHealthStatus,
  type MobileMoneyGatewayResponse,
  type MobileMoneyGatewayStatus,
} from '../services/financeService';
import type {
  CardDirectoryEntry,
  MobileOperator,
  OperationModalType,
  UserProfile,
} from '../types';

interface PendingMobileMoneyState {
  txId: string;
  referenceId: string;
  type: 'deposit' | 'withdrawal';
  operator: MobileOperator;
  phone: string;
  amount: number;
  gatewayConfigured?: boolean;
  singpayRoute?: string;
  expiresAt?: number;
  message: string;
}

interface OperationsModalProps {
  mode: OperationModalType;
  user: UserProfile;
  onClose: () => void;
  onLookupCard: (cardNumber: string) => Promise<CardDirectoryEntry | null>;
  onStartMobileMoney: (params: {
    type: 'deposit' | 'withdrawal';
    operator: MobileOperator;
    phone: string;
    amount: number;
  }) => Promise<MobileMoneyGatewayResponse>;
  onCheckMobileMoneyStatus: (referenceId: string) => Promise<MobileMoneyGatewayResponse>;
  onCancelMobileMoney: (referenceId: string) => Promise<MobileMoneyGatewayResponse>;
  onConfirmMobileMoney: (params: {
    txId: string;
    type: 'deposit' | 'withdrawal';
    operator: MobileOperator;
    phone: string;
    amount: number;
  }) => Promise<{ becameEligible: boolean }>;
  onFailMobileMoney: (params: {
    txId: string;
    type: 'deposit' | 'withdrawal';
    operator: MobileOperator;
    reason: string;
  }) => Promise<void>;
  onInternalTransfer: (params: { recipient: CardDirectoryEntry; amount: number }) => Promise<{ becameEligible: boolean }>;
  onOnlinePurchase: (params: { merchantName: string; amount: number }) => Promise<{ becameEligible: boolean }>;
  onInternationalTransfer: (params: {
    country: string;
    beneficiaryName: string;
    accountRef: string;
    amount: number;
  }) => Promise<{ becameEligible: boolean }>;
}

export const OperationsModal: React.FC<OperationsModalProps> = ({
  mode,
  user,
  onClose,
  onLookupCard,
  onStartMobileMoney,
  onCheckMobileMoneyStatus,
  onCancelMobileMoney,
  onConfirmMobileMoney,
  onFailMobileMoney,
  onInternalTransfer,
  onOnlinePurchase,
  onInternationalTransfer,
}) => {
  const [operator, setOperator] = useState<MobileOperator>('Airtel Money');
  const [phone, setPhone] = useState('077458812');
  const [amountStr, setAmountStr] = useState('25000');
  const [targetCard, setTargetCard] = useState('');
  const [recipientInfo, setRecipientInfo] = useState<CardDirectoryEntry | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [merchantName, setMerchantName] = useState('Canal+ Gabon');
  const [cvvInput, setCvvInput] = useState('');

  const [country, setCountry] = useState(INTERNATIONAL_COUNTRIES[0].name);
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [accountRef, setAccountRef] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [failedMsg, setFailedMsg] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<PendingMobileMoneyState | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealthStatus | null>(null);

  const finalizedRef = useRef<string | null>(null);

  useEffect(() => {
    setError(null);
    setSuccessMsg(null);
    setFailedMsg(null);
    setPendingSession(null);
    setCvvInput('');
    setRecipientInfo(null);
    finalizedRef.current = null;

    if (mode === 'deposit' || mode === 'withdrawal') {
      let active = true;
      fetchMobileMoneyGatewayHealth().then((status) => {
        if (active) setGatewayHealth(status);
      });
      return () => {
        active = false;
      };
    }
    setGatewayHealth(null);
  }, [mode]);

  // Poll real Mobile Money gateway status while session is PENDING and gateway is configured
  useEffect(() => {
    if (!pendingSession || !pendingSession.gatewayConfigured) return;
    let active = true;

    const handleGatewayOutcome = async (
      status: MobileMoneyGatewayStatus,
      message: string,
      session: PendingMobileMoneyState
    ) => {
      if (status === 'PENDING' || !active) return;
      if (finalizedRef.current === session.txId) return;
      finalizedRef.current = session.txId;

      if (status === 'SUCCESS') {
        try {
          const confirmed = await onConfirmMobileMoney({
            txId: session.txId,
            type: session.type,
            operator: session.operator,
            phone: session.phone,
            amount: session.amount,
          });
          if (!active) return;
          setPendingSession(null);
          setSuccessMsg(
            session.type === 'deposit'
              ? confirmed.becameEligible
                ? 'Dépôt confirmé ! Félicitations, votre fidélité vous permet désormais d’effectuer des prêts.'
                : 'Dépôt confirmé. Votre carte AFRICABANK (montant - 2 %) et les frais ont été mis à jour.'
              : confirmed.becameEligible
                ? 'Retrait confirmé via SingPay ! Félicitations, votre fidélité vous permet désormais d’effectuer des prêts.'
                : 'Retrait confirmé via SingPay. Votre solde AFRICABANK a été mis à jour.'
          );
        } catch (err) {
          if (!active) return;
          const msg = err instanceof Error ? err.message : 'Erreur lors de la finalisation du solde.';
          await onFailMobileMoney({
            txId: session.txId,
            type: session.type,
            operator: session.operator,
            reason: msg,
          }).catch(() => undefined);
          setPendingSession(null);
          setFailedMsg(msg);
        }
      } else {
        const failReason =
          message ||
          (status === 'EXPIRED'
            ? 'Paiement annulé / échoué : délai de validation expiré.'
            : 'Paiement annulé / échoué');
        await onFailMobileMoney({
          txId: session.txId,
          type: session.type,
          operator: session.operator,
          reason: failReason,
        }).catch(() => undefined);
        if (!active) return;
        setPendingSession(null);
        setFailedMsg(failReason);
      }
    };

    const interval = window.setInterval(async () => {
      try {
        const res = await onCheckMobileMoneyStatus(pendingSession.referenceId);
        if (!active) return;
        if (res.status !== 'PENDING') {
          await handleGatewayOutcome(res.status, res.message, pendingSession);
        } else if (res.message && res.message !== pendingSession.message) {
          setPendingSession((prev) => (prev ? { ...prev, message: res.message } : null));
        }
      } catch {
        // Conserve l'état PENDING tant que le délai n'a pas expiré
      }
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pendingSession, onCheckMobileMoneyStatus, onConfirmMobileMoney, onFailMobileMoney]);

  useEffect(() => {
    if (mode !== 'transfer_internal') return;
    const clean = targetCard.replace(/\D/g, '');
    if (clean.length !== 16) {
      setRecipientInfo(null);
      return;
    }
    let active = true;
    setLookingUp(true);
    onLookupCard(clean)
      .then((res) => {
        if (active) setRecipientInfo(res);
      })
      .catch(() => {
        if (active) setRecipientInfo(null);
      })
      .finally(() => {
        if (active) setLookingUp(false);
      });
    return () => {
      active = false;
    };
  }, [targetCard, mode, onLookupCard]);

  if (!mode) return null;

  const amount = Math.max(0, Math.round(Number(amountStr) || 0));
  const fee = calculateCommission(amount);
  const isDeposit = mode === 'deposit';
  const netCredited = isDeposit ? Math.max(0, amount - fee) : amount;
  const totalDebited = isDeposit ? amount : amount + fee;

  const selectedCountryMeta =
    INTERNATIONAL_COUNTRIES.find((c) => c.name === country) || INTERNATIONAL_COUNTRIES[0];

  const handleCancelPending = async () => {
    if (!pendingSession || cancelling) return;
    setCancelling(true);
    try {
      const res = await onCancelMobileMoney(pendingSession.referenceId);
      finalizedRef.current = pendingSession.txId;
      await onFailMobileMoney({
        txId: pendingSession.txId,
        type: pendingSession.type,
        operator: pendingSession.operator,
        reason: res.message || 'Annulé par l’utilisateur.',
      }).catch(() => undefined);
      setPendingSession(null);
      setFailedMsg(res.message || 'Paiement annulé / échoué. Aucun solde n’a été modifié.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’annulation.');
    } finally {
      setCancelling(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount < 500) {
      setError('Le montant minimum est de 500 FCFA.');
      return;
    }

    if (!isDeposit && user.balance < totalDebited) {
      setError(`Solde insuffisant. Requis : ${formatFCFA(totalDebited)} (frais de 2% inclus).`);
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'deposit' || mode === 'withdrawal') {
        if (!isValidGabonPhone(phone)) {
          throw new Error('Numéro Mobile Money gabonais invalide (format 07X ou 06X attendu).');
        }
        const cleanPhone = phone.replace(/[\s\-()]/g, '');
        const gateway = await onStartMobileMoney({
          type: mode,
          operator,
          phone: cleanPhone,
          amount,
        });

        if (gateway.status === 'SUCCESS') {
          const confirmed = await onConfirmMobileMoney({
            txId: gateway.txId,
            type: mode,
            operator,
            phone: cleanPhone,
            amount,
          });
          setSuccessMsg(
            mode === 'deposit'
              ? confirmed.becameEligible
                ? 'Dépôt confirmé ! Félicitations, votre fidélité vous permet désormais d’effectuer des prêts.'
                : 'Dépôt confirmé.'
              : confirmed.becameEligible
                ? 'Retrait confirmé ! Félicitations, votre fidélité vous permet désormais d’effectuer des prêts.'
                : 'Retrait confirmé.'
          );
          return;
        }

        if (gateway.status === 'FAILED' || gateway.status === 'EXPIRED') {
          await onFailMobileMoney({
            txId: gateway.txId,
            type: mode,
            operator,
            reason: gateway.message,
          }).catch(() => undefined);
          setFailedMsg(gateway.message || 'Paiement annulé / échoué');
          return;
        }

        setPendingSession({
          txId: gateway.txId,
          referenceId: gateway.referenceId,
          type: mode,
          operator,
          phone: cleanPhone,
          amount,
          gatewayConfigured: gateway.gatewayConfigured,
          singpayRoute: gateway.singpayRoute,
          expiresAt: gateway.expiresAt,
          message: gateway.message,
        });
        return;
      }

      let result = { becameEligible: false };
      if (mode === 'transfer_internal') {
        if (!recipientInfo) {
          throw new Error('Veuillez saisir un numéro de carte AFRICABANK à 16 chiffres valide.');
        }
        if (recipientInfo.uid === user.uid) {
          throw new Error('Impossible d’effectuer un transfert vers votre propre carte.');
        }
        result = await onInternalTransfer({ recipient: recipientInfo, amount });
      } else if (mode === 'online_purchase') {
        if (!merchantName.trim()) {
          throw new Error('Veuillez indiquer le nom du marchand.');
        }
        if (cvvInput !== user.cardCvv) {
          throw new Error('Code CVV à 3 chiffres incorrect.');
        }
        result = await onOnlinePurchase({ merchantName: merchantName.trim(), amount });
      } else if (mode === 'transfer_international') {
        if (!beneficiaryName.trim() || !accountRef.trim()) {
          throw new Error('Veuillez compléter le nom et les coordonnées du bénéficiaire.');
        }
        result = await onInternationalTransfer({
          country,
          beneficiaryName: beneficiaryName.trim(),
          accountRef: accountRef.trim(),
          amount,
        });
      }

      setSuccessMsg(
        result.becameEligible
          ? 'Opération réussie ! Félicitations, votre fidélité vous permet désormais d’effectuer des prêts.'
          : 'Opération exécutée avec succès.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’opération.');
    } finally {
      setSubmitting(false);
    }
  };

  const titles: Record<Exclude<OperationModalType, null>, { label: string; subtitle: string; icon: React.ReactNode }> = {
    deposit: {
      label: 'Dépôt Mobile Money',
      subtitle: 'Recharger votre carte virtuelle · Commission 2%',
      icon: <ArrowDownLeft className="w-5 h-5 text-emerald-400" />,
    },
    withdrawal: {
      label: 'Retrait vers Mobile Money',
      subtitle: 'Transférer vers Airtel ou Moov · Commission 2%',
      icon: <ArrowUpRight className="w-5 h-5 text-amber-400" />,
    },
    transfer_internal: {
      label: 'Transfert Carte à Carte',
      subtitle: 'Envoi instantané vers une autre carte AFRICABANK · 2%',
      icon: <Send className="w-5 h-5 text-blue-400" />,
    },
    online_purchase: {
      label: 'Paiement en ligne',
      subtitle: 'Achat e-commerce sécurisé avec carte virtuelle · 2%',
      icon: <ShoppingBag className="w-5 h-5 text-amber-400" />,
    },
    transfer_international: {
      label: 'Transfert International',
      subtitle: 'Envoi multi-devises vers l’étranger · Commission 2%',
      icon: <Globe className="w-5 h-5 text-sky-400" />,
    },
  };

  const meta = titles[mode];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4">
      <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-[#1E3A63] bg-[#0F1D36] p-6 space-y-5 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1 bg-[#1E3A63] rounded-full mx-auto sm:hidden" />

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#050B18] border border-[#1E3A63] flex items-center justify-center shrink-0">
              {meta.icon}
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-white">{meta.label}</h2>
              <p className="text-xs text-slate-400">{meta.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-[#050B18]/70 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {successMsg ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-white">Transaction confirmée</p>
              <p className="text-sm text-slate-300 leading-relaxed">{successMsg}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
            >
              Retour au tableau de bord
            </button>
          </div>
        ) : failedMsg ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-white">Paiement non abouti</p>
              <p className="text-sm text-red-200 leading-relaxed">{failedMsg}</p>
              <p className="text-xs text-slate-400">
                Aucun crédit ni débit n’a été appliqué à votre carte AFRICABANK.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setFailedMsg(null)}
                className="flex-1 min-h-[46px] rounded-xl border border-[#1E3A63] bg-[#050B18] hover:border-blue-400/50 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                Réessayer
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[46px] rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : pendingSession ? (
          <div className="py-4 space-y-5">
            <div className="rounded-2xl border border-amber-500/35 bg-[#050B18]/85 p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">
                    {pendingSession.type === 'deposit'
                      ? 'En attente de validation sur votre téléphone...'
                      : 'En attente de confirmation SingPay...'}
                  </p>
                  <p className="text-xs text-slate-400 font-mono-tabular truncate">
                    Réf : {pendingSession.referenceId}
                    {pendingSession.singpayRoute ? ` · ${pendingSession.singpayRoute}` : ''}
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-200 leading-relaxed">{pendingSession.message}</p>

              <div className="border-t border-[#1E3A63]/70 pt-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Opérateur &amp; Numéro</span>
                  <span className="text-slate-100 font-mono-tabular">
                    {pendingSession.operator} · {pendingSession.phone}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Montant demandé</span>
                  <span className="text-amber-300 font-semibold font-mono-tabular">
                    {formatFCFA(pendingSession.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>Statut passerelle</span>
                  <span className="text-amber-400 font-semibold inline-flex items-center gap-1.5">
                    {pendingSession.gatewayConfigured ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Clock className="w-3.5 h-3.5" />
                    )}
                    {pendingSession.gatewayConfigured
                      ? 'PENDING'
                      : 'PENDING (passerelle en attente de configuration)'}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Votre carte AFRICABANK et les frais de 2% ne seront mis à jour qu’après réception du statut réel <strong>SUCCESS</strong>.
              </p>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                {error}
              </p>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                disabled={cancelling}
                onClick={handleCancelPending}
                className="flex-1 min-h-[46px] rounded-xl border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-60 text-red-200 font-semibold text-sm transition-colors cursor-pointer"
              >
                {cancelling ? 'Annulation...' : 'Annuler la demande'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 min-h-[46px] rounded-xl border border-[#1E3A63] bg-[#050B18] hover:border-blue-400/50 text-slate-200 font-semibold text-sm transition-colors cursor-pointer"
              >
                Fermer (suivi dans Historique)
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Operator selector & Phone for Deposit / Withdrawal (NO PIN FIELD) */}
            {(mode === 'deposit' || mode === 'withdrawal') && (
              <>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Opérateur Mobile Money</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setOperator('Airtel Money')}
                      className={`min-h-[48px] flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                        operator === 'Airtel Money'
                          ? 'border-red-500 bg-red-500/15 text-red-200'
                          : 'border-[#1E3A63] bg-[#050B18]/70 text-slate-300 hover:border-blue-400/50'
                      }`}
                    >
                      <Smartphone className="w-4 h-4 text-red-400" />
                      <span>Airtel Money</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setOperator('Moov Money')}
                      className={`min-h-[48px] flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${
                        operator === 'Moov Money'
                          ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                          : 'border-[#1E3A63] bg-[#050B18]/70 text-slate-300 hover:border-blue-400/50'
                      }`}
                    >
                      <Smartphone className="w-4 h-4 text-sky-400" />
                      <span>Moov Money</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Numéro Mobile Money (Gabon 07/06)
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="077 45 88 12"
                    className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white font-mono-tabular focus:border-blue-400 focus:outline-none"
                  />
                </div>

                <div className="rounded-xl border border-blue-500/25 bg-[#050B18]/70 p-3 flex items-start gap-2.5 text-xs text-slate-300">
                  <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    Aucun code PIN n’est saisi dans AFRICABANK. La demande de validation officielle est envoyée directement sur votre téléphone par {operator}.
                  </p>
                </div>

                {gatewayHealth && !gatewayHealth.fullyConfigured && (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5 flex items-start gap-2.5 text-xs text-amber-100">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-amber-300">
                        Passerelle SingPay en attente de configuration
                      </p>
                      <p className="leading-relaxed text-slate-200">
                        Variables SingPay non renseignées ({gatewayHealth.apiUrl}) :{' '}
                        <span className="font-mono-tabular text-amber-200">
                          {gatewayHealth.missing.join(', ')}
                        </span>
                        . Toute opération reste au statut <strong>PENDING</strong> sans modification de solde ni commission de 2 % jusqu’à confirmation réelle (SUCCESS).
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Internal Card-to-Card */}
            {mode === 'transfer_internal' && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-300">
                  Numéro de carte du bénéficiaire (16 chiffres)
                </label>
                <input
                  type="text"
                  required
                  maxLength={19}
                  value={targetCard}
                  onChange={(e) => setTargetCard(e.target.value.replace(/[^\d\s]/g, ''))}
                  placeholder="4532 9901 5520 1184"
                  className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white font-mono-tabular focus:border-blue-400 focus:outline-none"
                />
                {lookingUp && (
                  <p className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Vérification du titulaire...
                  </p>
                )}
                {recipientInfo && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-200 flex items-center justify-between">
                    <span>Bénéficiaire vérifié : <strong>{recipientInfo.holderName}</strong></span>
                    <CreditCard className="w-4 h-4 text-emerald-400 shrink-0" />
                  </div>
                )}
                {!lookingUp && targetCard.replace(/\D/g, '').length === 16 && !recipientInfo && (
                  <p className="text-xs text-red-400">Aucune carte AFRICABANK active trouvée pour ce numéro.</p>
                )}
              </div>
            )}

            {/* Online Purchase */}
            {mode === 'online_purchase' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Marchand en ligne</label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={merchantName}
                    onChange={(e) => setMerchantName(e.target.value)}
                    placeholder="Ex: Canal+ Gabon, Netflix, Amazon..."
                    className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">Carte utilisée</label>
                    <div className="min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/50 px-3.5 py-2.5 text-xs text-slate-300 font-mono-tabular flex items-center">
                      {formatCardNumber(user.cardNumber, false)}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">
                      Confirmation CVV carte (3 chiffres)
                    </label>
                    <input
                      type="password"
                      required
                      maxLength={3}
                      value={cvvInput}
                      onChange={(e) => setCvvInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="•••"
                      className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white font-mono-tabular focus:border-blue-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* International Transfer */}
            {mode === 'transfer_international' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Pays de destination</label>
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/90 px-3.5 py-2.5 text-sm text-white focus:border-blue-400 focus:outline-none"
                  >
                    {INTERNATIONAL_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.name}>
                        {c.name} — {c.currency}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Nom complet du bénéficiaire</label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={beneficiaryName}
                    onChange={(e) => setBeneficiaryName(e.target.value)}
                    placeholder="Ex: Jean-Baptiste Kouassi"
                    className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white focus:border-blue-400 focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    IBAN / Compte / Mobile Money international
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={accountRef}
                    onChange={(e) => setAccountRef(e.target.value)}
                    placeholder={selectedCountryMeta.hint}
                    className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white font-mono-tabular focus:border-blue-400 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Amount Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-300">Montant (FCFA)</label>
                <span className="text-xs text-slate-400 font-mono-tabular">
                  Solde : {formatFCFA(user.balance)}
                </span>
              </div>
              <input
                type="number"
                required
                min={500}
                step={100}
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-4 py-2.5 text-lg font-bold text-white font-mono-tabular focus:border-blue-400 focus:outline-none"
              />
            </div>

            {/* Commission Breakdown */}
            <div className="rounded-2xl border border-[#1E3A63] bg-[#050B18]/70 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between text-slate-400">
                <span>Montant de l’opération</span>
                <span className="font-mono-tabular text-slate-200">{formatFCFA(amount)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-400">
                <span>Commission plateforme (2%)</span>
                <span className="font-mono-tabular text-amber-400">{formatFCFA(fee)}</span>
              </div>
              <div className="border-t border-[#1E3A63]/70 pt-2 flex items-center justify-between font-semibold text-sm">
                <span className="text-slate-200">
                  {isDeposit ? 'Net crédité après confirmation' : 'Total débité'}
                </span>
                <span className="font-mono-tabular text-emerald-400">
                  {formatFCFA(isDeposit ? netCredited : totalDebited)}
                </span>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-60 text-white font-semibold text-sm transition-colors px-4 py-3 cursor-pointer"
            >
              {submitting
                ? 'Initialisation sécurisée...'
                : mode === 'deposit' || mode === 'withdrawal'
                  ? `Initier via ${operator}`
                  : 'Confirmer l’opération'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
