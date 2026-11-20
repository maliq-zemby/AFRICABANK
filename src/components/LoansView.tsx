import React, { useState } from 'react';
import { Award, CheckCircle2, Clock, Landmark, Lock, XCircle } from 'lucide-react';
import { formatDateFr, formatFCFA } from '../lib/formatters';
import type { LoanConfig, LoanRequest, UserProfile } from '../types';

interface LoansViewProps {
  user: UserProfile;
  loanConfig: LoanConfig;
  loans: LoanRequest[];
  onSubmitLoan: (params: { amount: number; durationMonths: number; reason: string }) => Promise<void>;
}

export const LoansView: React.FC<LoansViewProps> = ({
  user,
  loanConfig,
  loans,
  onSubmitLoan,
}) => {
  const [amountStr, setAmountStr] = useState('50000');
  const [durationMonths, setDurationMonths] = useState('6');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const txProgress = Math.min(100, Math.round((user.totalTransactionsCount / loanConfig.minTransactionsCount) * 100));
  const volProgress = Math.min(100, Math.round((user.totalVolume / loanConfig.minCumulativeVolume) * 100));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const amount = Math.round(Number(amountStr) || 0);
    const months = Math.round(Number(durationMonths) || 3);

    if (amount < 5000 || amount > loanConfig.maxLoanAmount) {
      setFeedback({
        type: 'err',
        text: `Montant autorisé entre 5 000 FCFA et ${formatFCFA(loanConfig.maxLoanAmount)}.`,
      });
      return;
    }
    if (reason.trim().length < 5) {
      setFeedback({ type: 'err', text: 'Veuillez préciser le motif de votre demande de prêt.' });
      return;
    }

    setSubmitting(true);
    try {
      await onSubmitLoan({ amount, durationMonths: months, reason: reason.trim() });
      setReason('');
      setFeedback({ type: 'ok', text: 'Votre demande de prêt a été transmise à l’administration.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erreur lors de l’envoi de la demande.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Micro-prêts &amp; Fidélité</h1>
          <p className="text-sm text-slate-400 mt-1">
            Débloquez l’accès au crédit instantané grâce à votre activité régulière sur AFRICABANK.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium">
          {user.loanEligible ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400">
              <Award className="w-4 h-4" />
              <span>Éligible aux prêts</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-amber-400">
              <Lock className="w-4 h-4" />
              <span>Progression en cours</span>
            </span>
          )}
        </div>
      </div>

      {/* Loyalty Progress Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300 font-medium">Nombre d’opérations</span>
            <span className="font-mono-tabular text-white font-semibold">
              {user.totalTransactionsCount} / {loanConfig.minTransactionsCount}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${txProgress}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">
            Dépôts effectués : <span className="font-mono-tabular text-slate-200">{user.totalDepositsCount}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300 font-medium">Volume cumulé</span>
            <span className="font-mono-tabular text-white font-semibold">
              {formatFCFA(user.totalVolume)} / {formatFCFA(loanConfig.minCumulativeVolume)}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-all duration-300"
              style={{ width: `${volProgress}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">
            Plafond de prêt autorisé : <span className="font-mono-tabular text-slate-200">{formatFCFA(loanConfig.maxLoanAmount)}</span>
          </p>
        </div>
      </div>

      {/* Loan Application or Locked Notice */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-5">
          <div className="flex items-center gap-3">
            <Landmark className="w-5 h-5 text-emerald-400" />
            <h2 className="font-display text-lg font-semibold text-white">Soumettre une demande de prêt</h2>
          </div>

          {!user.loanEligible ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 space-y-2">
              <p className="text-sm font-semibold text-amber-300">Seuil de fidélité non encore atteint</p>
              <p className="text-xs text-slate-300 leading-relaxed">
                Effectuez au moins <strong>{loanConfig.minTransactionsCount} transactions</strong> pour un volume cumulé de{' '}
                <strong>{formatFCFA(loanConfig.minCumulativeVolume)}</strong> afin de recevoir votre notification d’éligibilité automatique.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Montant souhaité (FCFA)</label>
                  <input
                    type="number"
                    required
                    min={5000}
                    max={loanConfig.maxLoanAmount}
                    step={1000}
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2 text-sm text-white font-mono-tabular focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Durée de remboursement</label>
                  <select
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="1">1 mois</option>
                    <option value="3">3 mois</option>
                    <option value="6">6 mois</option>
                    <option value="12">12 mois</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Motif du financement</label>
                <textarea
                  required
                  rows={3}
                  maxLength={400}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex: Approvisionnement commerce Libreville, frais médicaux..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {feedback && (
                <p
                  className={`text-xs rounded-xl p-3 border ${
                    feedback.type === 'ok'
                      ? 'text-emerald-200 bg-emerald-500/10 border-emerald-500/30'
                      : 'text-red-300 bg-red-500/10 border-red-500/30'
                  }`}
                >
                  {feedback.text}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
              >
                {submitting ? 'Envoi en cours...' : 'Envoyer la demande de prêt'}
              </button>
            </form>
          )}
        </div>

        {/* User Loan History */}
        <div className="lg:col-span-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
          <h2 className="font-display text-lg font-semibold text-white">Vos demandes de prêts</h2>
          {loans.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">
              Aucune demande de prêt soumise pour le moment.
            </p>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {loans.map((loan) => (
                <div key={loan.id} className="py-4 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono-tabular font-semibold text-white">
                      {formatFCFA(loan.amount)}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-medium ${
                        loan.status === 'approved'
                          ? 'text-emerald-400'
                          : loan.status === 'rejected'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {loan.status === 'approved' && <CheckCircle2 className="w-3.5 h-3.5" />}
                      {loan.status === 'rejected' && <XCircle className="w-3.5 h-3.5" />}
                      {loan.status === 'pending' && <Clock className="w-3.5 h-3.5" />}
                      {loan.status === 'approved'
                        ? 'Approuvé'
                        : loan.status === 'rejected'
                          ? 'Refusé'
                          : 'En attente'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{loan.reason}</p>
                  <p className="text-xs text-slate-500">
                    {loan.durationMonths} mois · {formatDateFr(loan.createdAt)}
                    {loan.adminNote ? ` · Note : ${loan.adminNote}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
