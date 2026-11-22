import React from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Award,
  Globe,
  Landmark,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShoppingBag,
  Star,
} from 'lucide-react';
import {
  formatDateFr,
  formatFCFA,
  formatFullDateFr,
  SUBSCRIPTION_ALERT_WINDOW_DAYS,
  toMillisSafe,
} from '../lib/formatters';
import type {
  AppView,
  CardRevealPayload,
  LoanConfig,
  OperationModalType,
  SubscriptionRecord,
  TransactionRecord,
  UserProfile,
  VirtualCardRecord,
} from '../types';
import { PWAInstallReminder } from './PWAComponents';
import { VirtualCard } from './VirtualCard';

interface DashboardHomeProps {
  user: UserProfile;
  card: VirtualCardRecord | null;
  subscription: SubscriptionRecord | null;
  transactions: TransactionRecord[];
  loanConfig: LoanConfig;
  onOpenOperation: (op: OperationModalType) => void;
  onNavigate: (view: AppView) => void;
  onRevealCard: () => Promise<CardRevealPayload>;
  onRenewCard: () => Promise<void>;
  cardRenewing?: boolean;
  cardRenewFeedback?: { type: 'ok' | 'err'; text: string } | null;
  onRenewSubscription: () => Promise<void>;
  subRenewing?: boolean;
  subRenewFeedback?: { type: 'ok' | 'err'; text: string } | null;
}

export const DashboardHome: React.FC<DashboardHomeProps> = ({
  user,
  card,
  subscription,
  transactions,
  loanConfig,
  onOpenOperation,
  onNavigate,
  onRevealCard,
  onRenewCard,
  cardRenewing = false,
  cardRenewFeedback = null,
  onRenewSubscription,
  subRenewing = false,
  subRenewFeedback = null,
}) => {
  const quickActions: {
    label: string;
    icon: React.ReactNode;
    accent: string;
    onClick: () => void;
  }[] = [
    {
      label: 'Dépôt',
      icon: <ArrowDownLeft className="w-5 h-5 text-emerald-400" />,
      accent: 'hover:border-blue-400/50',
      onClick: () => onOpenOperation('deposit'),
    },
    {
      label: 'Retrait',
      icon: <ArrowUpRight className="w-5 h-5 text-amber-400" />,
      accent: 'hover:border-amber-400/50',
      onClick: () => onOpenOperation('withdrawal'),
    },
    {
      label: 'Envoyer',
      icon: <Send className="w-5 h-5 text-blue-400" />,
      accent: 'hover:border-blue-400/50',
      onClick: () => onOpenOperation('transfer_internal'),
    },
    {
      label: 'International',
      icon: <Globe className="w-5 h-5 text-sky-400" />,
      accent: 'hover:border-sky-400/50',
      onClick: () => onOpenOperation('transfer_international'),
    },
    {
      label: 'Achat en ligne',
      icon: <ShoppingBag className="w-5 h-5 text-amber-400" />,
      accent: 'hover:border-amber-400/50',
      onClick: () => onOpenOperation('online_purchase'),
    },
    {
      label: 'Prêts',
      icon: <Landmark className="w-5 h-5 text-blue-400" />,
      accent: 'hover:border-blue-400/50',
      onClick: () => onNavigate('loans'),
    },
    {
      label: 'Messagerie',
      icon: <MessageSquare className="w-5 h-5 text-sky-400" />,
      accent: 'hover:border-sky-400/50',
      onClick: () => onNavigate('messages'),
    },
    {
      label: 'Avis',
      icon: <Star className="w-5 h-5 text-amber-400" />,
      accent: 'hover:border-amber-400/50',
      onClick: () => onNavigate('reviews'),
    },
  ];

  const subExpiryMs = toMillisSafe(subscription?.expiresAt);
  const nowMs = Date.now();
  const alertWindowMs = SUBSCRIPTION_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const isSubAlertVisible = Boolean(
    subscription && subExpiryMs > 0 && subExpiryMs - nowMs <= alertWindowMs
  );
  const isSubExpired = Boolean(subExpiryMs > 0 && subExpiryMs <= nowMs);
  const subDaysLeft = subExpiryMs > nowMs ? Math.ceil((subExpiryMs - nowMs) / (24 * 60 * 60 * 1000)) : 0;

  return (
    <div className="space-y-8">
      {/* Subscription Expiry Alert Banner */}
      {isSubAlertVisible && subscription && (
        <div
          className={`rounded-2xl border p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 ${
            isSubExpired
              ? 'border-red-500/45 bg-red-500/10'
              : 'border-amber-500/45 bg-amber-500/10'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle
              className={`w-5 h-5 shrink-0 mt-0.5 ${
                isSubExpired ? 'text-red-400' : 'text-amber-400'
              }`}
            />
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-white">
                {isSubExpired
                  ? `Abonnement ${subscription.plan} expiré`
                  : `Votre abonnement ${subscription.plan} expire dans ${subDaysLeft} jour(s)`}
              </p>
              <p className="text-xs text-slate-300">
                Échéance : {formatFullDateFr(subExpiryMs)} · Renouvelez votre abonnement pour éviter toute interruption de service.
              </p>
              {subRenewFeedback && (
                <p
                  className={`text-xs font-medium pt-1 ${
                    subRenewFeedback.type === 'ok' ? 'text-emerald-300' : 'text-red-300'
                  }`}
                >
                  {subRenewFeedback.text}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={subRenewing}
            onClick={onRenewSubscription}
            className="min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-semibold text-xs px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {subRenewing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>{subRenewing ? 'Renouvellement...' : "Renouveler l'abonnement"}</span>
          </button>
        </div>
      )}

      {/* Top Hero Split: Virtual Card + Quick Actions */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        <div className="xl:col-span-5 rounded-3xl border border-[#1E3A63] bg-[#0F1D36]/75 p-6">
          <VirtualCard
            user={user}
            card={card}
            onRevealCard={onRevealCard}
            onRenewCard={onRenewCard}
            renewing={cardRenewing}
            renewFeedback={cardRenewFeedback}
          />
        </div>

        <div className="xl:col-span-7 space-y-6">
          <div className="space-y-3">
            <h2 className="font-display text-base font-semibold text-white">Actions rapides</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {quickActions.map((act) => (
                <button
                  key={act.label}
                  type="button"
                  onClick={act.onClick}
                  className={`min-h-[82px] rounded-2xl border border-[#1E3A63] bg-[#0F1D36]/70 ${act.accent} p-3.5 flex flex-col items-start justify-between gap-2 transition-colors cursor-pointer text-left`}
                >
                  <div className="w-9 h-9 rounded-xl bg-[#050B18]/80 border border-[#1E3A63] flex items-center justify-center">
                    {act.icon}
                  </div>
                  <span className="text-xs font-semibold text-slate-100 whitespace-nowrap">
                    {act.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Loyalty Status Strip */}
          <div className="rounded-2xl border border-[#1E3A63] bg-[#0F1D36]/65 p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <Award className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {user.loanEligible
                    ? 'Fidélité débloquée : vous êtes éligible aux prêts'
                    : 'Programme Fidélité AFRICABANK'}
                </p>
                <p className="text-xs text-slate-300 mt-0.5 font-mono-tabular">
                  {user.totalTransactionsCount}/{loanConfig.minTransactionsCount} opérations ·{' '}
                  {formatFCFA(user.totalVolume)} / {formatFCFA(loanConfig.minCumulativeVolume)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('loans')}
              className="min-h-[40px] rounded-xl border border-blue-400/40 bg-blue-500/10 hover:bg-blue-500/20 px-4 py-2 text-xs font-semibold text-blue-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {user.loanEligible ? 'Demander un prêt' : 'Voir ma progression'}
            </button>
          </div>

          <PWAInstallReminder />
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="rounded-2xl border border-[#1E3A63] bg-[#0F1D36]/75 overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1E3A63] flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-white">Historique récent</h2>
            <p className="text-xs text-slate-400">
              Entrées, sorties et détail des frais de 2% en temps réel
            </p>
          </div>
          <span className="text-xs text-slate-300 font-mono-tabular">
            {transactions.length} opération(s)
          </span>
        </div>

        {transactions.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-400">Aucune transaction enregistrée sur cette carte.</p>
            <button
              type="button"
              onClick={() => onOpenOperation('deposit')}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-xs px-4 py-2.5 transition-colors cursor-pointer"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>Effectuer mon premier dépôt</span>
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[#1E3A63]/60">
            {transactions.map((tx) => {
              const isIncoming =
                tx.type === 'deposit' ||
                tx.type === 'loan_disbursement' ||
                (tx.type === 'transfer_internal' && tx.recipientId === user.uid);

              const displayedAmount =
                tx.type === 'deposit'
                  ? tx.netAmount
                  : tx.type === 'transfer_internal' && tx.recipientId === user.uid
                    ? tx.grossAmount
                    : tx.type === 'loan_disbursement'
                      ? tx.grossAmount
                      : tx.netAmount;

              const isPending = tx.status === 'pending';
              const isFailed = tx.status === 'failed';
              const statusLabel = isPending
                ? 'En attente'
                : isFailed
                  ? 'Échoué / Annulé'
                  : 'Validé';
              const statusClass = isPending
                ? 'text-amber-400'
                : isFailed
                  ? 'text-red-400'
                  : 'text-slate-400';

              const amountClass = isPending
                ? 'text-amber-300'
                : isFailed
                  ? 'text-slate-400 line-through'
                  : isIncoming
                    ? 'text-emerald-400'
                    : 'text-red-400';

              return (
                <div
                  key={tx.id}
                  className="px-6 py-4 flex items-center justify-between gap-4 hover:bg-[#050B18]/40 transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isPending
                          ? 'bg-amber-500/15 text-amber-400'
                          : isFailed
                            ? 'bg-slate-800 text-slate-400'
                            : isIncoming
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {isIncoming ? (
                        <ArrowDownLeft className="w-5 h-5" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-medium text-white truncate">{tx.description}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {tx.operator} · {formatDateFr(tx.createdAt)}
                        {tx.feeAmount > 0 && !(tx.type === 'transfer_internal' && tx.recipientId === user.uid)
                          ? ` · Frais : ${formatFCFA(tx.feeAmount)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-bold font-mono-tabular ${amountClass}`}>
                      {isPending || isFailed ? '' : isIncoming ? '+' : '-'}
                      {formatFCFA(displayedAmount)}
                    </p>
                    <p className={`text-[11px] font-medium ${statusClass}`}>{statusLabel}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
