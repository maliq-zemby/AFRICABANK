import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import {
  CARD_RENEWAL_FEE_FCFA,
  formatCardMask,
  formatCardNumber,
  formatFCFA,
  formatFullDateFr,
  toMillisSafe,
} from '../lib/formatters';
import type { CardRevealPayload, UserProfile, VirtualCardRecord } from '../types';

interface VirtualCardProps {
  user: UserProfile;
  card: VirtualCardRecord | null;
  onRevealCard: () => Promise<CardRevealPayload>;
  onRenewCard: () => Promise<void>;
  renewing?: boolean;
  renewFeedback?: { type: 'ok' | 'err'; text: string } | null;
}

export const VirtualCard: React.FC<VirtualCardProps> = ({
  user,
  card,
  onRevealCard,
  onRenewCard,
  renewing = false,
  renewFeedback = null,
}) => {
  const [revealData, setRevealData] = useState<CardRevealPayload | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Reset sensitive reveal cache whenever card changes
  useEffect(() => {
    setRevealData(null);
    setRevealError(null);
  }, [card?.cardId, card?.cycleNumber, card?.status]);

  const cardStatus = card?.status || 'pending_issuance';
  const isPendingIssuance = cardStatus === 'pending_issuance';
  const isActive = cardStatus === 'active';
  const isRevealed = Boolean(
    revealData?.revealed && revealData.revealToken && revealData.pan && revealData.cvv
  );

  const renewableMs = toMillisSafe(card?.renewableAt);
  const issuedMs = toMillisSafe(card?.issuedAt);
  const isRenewalDue = Boolean(renewableMs > 0 && nowMs >= renewableMs);
  const canRenewNow = isRenewalDue && !renewing && (!isPendingIssuance || Boolean(card?.issuerConfigured));
  const remainingDays =
    renewableMs > nowMs ? Math.ceil((renewableMs - nowMs) / (24 * 60 * 60 * 1000)) : 0;

  const handleToggleReveal = async () => {
    setRevealError(null);
    if (isRevealed) {
      setRevealData(null);
      return;
    }
    if (isPendingIssuance) {
      setRevealError("Carte en attente d'activation par l'émetteur.");
      return;
    }
    setRevealing(true);
    try {
      const payload = await onRevealCard();
      if (!payload.revealed || !payload.revealToken || !payload.pan || !payload.cvv) {
        throw new Error("Jeton d'affichage sécurisé refusé par l'émetteur.");
      }
      setRevealData(payload);
    } catch (err) {
      setRevealError(
        err instanceof Error ? err.message : "Impossible d'afficher les identifiants de carte."
      );
    } finally {
      setRevealing(false);
    }
  };

  const handleCopy = async () => {
    if (!isRevealed || !revealData?.pan) {
      setRevealError(
        isPendingIssuance
          ? "Carte en attente d'activation par l'émetteur."
          : 'Affichez d’abord la carte via le jeton sécurisé de l’émetteur pour copier le numéro.'
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(revealData.pan);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silencieux si clipboard indisponible
    }
  };

  const displayedNumber = isRevealed && revealData?.pan
    ? formatCardNumber(revealData.pan, true)
    : formatCardMask(card?.last4);

  const displayedExpiry =
    card?.expiryMonth && card?.expiryYear
      ? `${card.expiryMonth}/${card.expiryYear.slice(-2)}`
      : '••/••';

  const renewalLabel =
    isRenewalDue || card?.renewalStatus === 'eligible_for_renewal'
      ? 'Éligible au renouvellement'
      : card?.renewalStatus === 'renewed'
        ? 'Renouvelée'
        : card?.renewalStatus === 'expired_cycle'
          ? 'Cycle expiré'
          : 'Cycle actif';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-400">Solde disponible</p>
          <p className="text-3xl sm:text-4xl font-bold text-white font-mono-tabular tracking-tight mt-1">
            {formatFCFA(user.balance)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={revealing || isPendingIssuance}
            onClick={handleToggleReveal}
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-[#1E3A63] bg-[#050B18]/80 hover:bg-[#050B18] disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {revealing ? (
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            ) : isRevealed ? (
              <EyeOff className="w-4 h-4 text-amber-400" />
            ) : (
              <Eye className="w-4 h-4 text-blue-400" />
            )}
            <span>{isRevealed ? 'Masquer' : 'Afficher'}</span>
          </button>
          <button
            type="button"
            disabled={!isRevealed}
            onClick={handleCopy}
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-blue-400/40 bg-blue-500/15 hover:bg-blue-500/25 disabled:opacity-45 px-3.5 py-2 text-xs font-medium text-blue-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copié' : 'Copier le numéro'}</span>
          </button>
        </div>
      </div>

      {/* Status Notice when Issuer Not Configured / Pending Issuance */}
      {isPendingIssuance && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-amber-100">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-300">
              Carte en attente d&apos;activation par l&apos;émetteur
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">
              Aucun numéro fictif n&apos;est généré localement. Les identifiants VISA (XAF) seront activés automatiquement dès la connexion au partenaire Card Issuing.
            </p>
          </div>
        </div>
      )}

      {revealError && (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-3.5 py-2.5 flex items-center gap-2 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{revealError}</span>
        </div>
      )}

      {/* Interactive Virtual Card */}
      <div className="relative overflow-hidden rounded-2xl border border-[#1E3A63] shadow-2xl aspect-[1.586/1] max-w-[440px] w-full bg-gradient-to-br from-[#050B18] via-[#0F1D36] to-[#081529]">
        {!imgError && (
          <img
            src="/src/assets/images/card_carbon_emerald_1795186449700.jpg"
            alt="Texture carte virtuelle AFRICABANK"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-35 mix-blend-luminosity"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-tr from-[#050B18]/92 via-[#0F1D36]/65 to-blue-950/60" />

        <div className="relative z-10 h-full p-5 sm:p-6 flex flex-col justify-between">
          {/* Card Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-7 rounded-md bg-gradient-to-br from-amber-300 via-amber-400 to-amber-600 border border-amber-200/40 shadow-inner flex items-center justify-center">
                <div className="w-5 h-3.5 border border-amber-900/40 rounded-sm" />
              </div>
              <Wifi className="w-4 h-4 text-slate-300 rotate-90" />
            </div>

            <div className="flex items-center gap-2.5 text-right">
              <div>
                <p className="font-display font-bold text-xs sm:text-sm tracking-tight text-white">
                  AFRICABANK — Carte Virtuelle {card?.currency || 'XAF'}
                </p>
                <p className="text-[10px] text-amber-300/90 font-medium">
                  Réseau {card?.brand || 'VISA'} ·{' '}
                  {isActive ? 'Active' : cardStatus === 'frozen' ? 'Gelée' : 'En attente émetteur'}
                </p>
              </div>
              <img
                src="/logo-africabank.png"
                alt="Logo AFRICABANK"
                className="w-9 h-9 rounded-lg object-cover bg-[#050B18] border border-[#1E3A63] shrink-0"
              />
            </div>
          </div>

          {/* Card Number */}
          <div className="my-auto">
            <p className="text-[11px] text-slate-400 mb-1">
              {isPendingIssuance ? 'Statut de la carte' : 'Numéro de carte'}
            </p>
            <p className="font-mono-tabular text-base sm:text-xl font-semibold tracking-wider text-white">
              {isPendingIssuance ? 'EN ATTENTE ÉMETTEUR' : displayedNumber}
            </p>
          </div>

          {/* Card Footer */}
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] text-slate-400">Titulaire</p>
              <p className="text-sm font-semibold text-slate-100 truncate uppercase tracking-wide">
                {user.fullName}
              </p>
            </div>
            <div className="flex items-center gap-5 shrink-0">
              <div>
                <p className="text-[10px] text-slate-400">Expire fin</p>
                <p className="font-mono-tabular text-sm font-semibold text-white">
                  {isActive ? displayedExpiry : '••/••'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">CVV</p>
                <p className="font-mono-tabular text-sm font-semibold text-amber-300">
                  {isRevealed && revealData?.cvv ? revealData.cvv : '•••'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 5-Month Card Lifecycle & Renewal Box */}
      <div className="rounded-2xl border border-[#1E3A63] bg-[#050B18]/75 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-xs font-semibold text-white">
              Cycle #{card?.cycleNumber || 1} · {renewalLabel}
            </span>
          </div>
          <span className="text-[11px] text-slate-400 truncate max-w-[200px]">
            {card?.provider || "En attente d'activation émetteur"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-[#1E3A63]/70 bg-[#0F1D36]/50 px-3 py-2">
            <p className="text-[10px] text-slate-400">Date d&apos;émission</p>
            <p className="font-medium text-slate-100 mt-0.5">
              {issuedMs ? formatFullDateFr(issuedMs) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-[#1E3A63]/70 bg-[#0F1D36]/50 px-3 py-2">
            <p className="text-[10px] text-slate-400">Prochain renouvellement (5 mois)</p>
            <p className="font-medium text-amber-300 mt-0.5">
              {renewableMs ? formatFullDateFr(renewableMs) : '—'}
            </p>
          </div>
        </div>

        {renewFeedback && (
          <div
            className={`rounded-xl px-3 py-2 text-xs border flex items-start gap-2 ${
              renewFeedback.type === 'ok'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-red-500/40 bg-red-500/10 text-red-200'
            }`}
          >
            {renewFeedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            )}
            <span>{renewFeedback.text}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {isRenewalDue ? (
              <span className="text-emerald-300 font-medium">
                Renouvellement disponible ({formatFCFA(CARD_RENEWAL_FEE_FCFA)})
              </span>
            ) : (
              <span>
                Disponible dans {remainingDays} jour(s) · Frais : {formatFCFA(CARD_RENEWAL_FEE_FCFA)}
              </span>
            )}
          </p>
          <button
            type="button"
            disabled={!canRenewNow}
            onClick={onRenewCard}
            className="min-h-[38px] inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-xs px-3.5 py-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            {renewing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>
              {renewing
                ? 'Renouvellement...'
                : `Renouveler la carte (${formatFCFA(CARD_RENEWAL_FEE_FCFA)})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
