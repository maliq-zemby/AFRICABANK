import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Landmark,
  Loader2,
  Megaphone,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlock,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { formatDateFr, formatFCFA, isValidGabonPhone } from '../lib/formatters';
import {
  fetchMobileMoneyGatewayHealth,
  type GatewayHealthStatus,
  type MobileMoneyGatewayResponse,
} from '../services/financeService';
import type {
  AdminWallet,
  LoanConfig,
  LoanRequest,
  MobileOperator,
  TransactionRecord,
  UserProfile,
} from '../types';

interface AdminDashboardProps {
  wallet: AdminWallet;
  users: UserProfile[];
  transactions: TransactionRecord[];
  loans: LoanRequest[];
  loanConfig: LoanConfig;
  onStartAdminWithdrawal: (params: { operator: MobileOperator; phone: string; amount: number }) => Promise<MobileMoneyGatewayResponse>;
  onCheckAdminWithdrawalStatus: (referenceId: string) => Promise<MobileMoneyGatewayResponse>;
  onCancelAdminWithdrawal: (referenceId: string) => Promise<MobileMoneyGatewayResponse>;
  onConfirmAdminWithdrawal: (params: { txId: string; operator: MobileOperator; phone: string; amount: number }) => Promise<void>;
  onFailAdminWithdrawal: (params: { txId: string; operator: MobileOperator; reason: string }) => Promise<void>;
  onSendAdminMessage: (params: { targetUser: UserProfile; text: string }) => Promise<void>;
  onToggleBan: (params: { targetUser: UserProfile; isBanned: boolean; banReason: string }) => Promise<void>;
  onProcessLoan: (params: { loan: LoanRequest; decision: 'approved' | 'rejected'; adminNote: string }) => Promise<void>;
  onUpdateLoanConfig: (config: { minTransactionsCount: number; minCumulativeVolume: number; maxLoanAmount: number }) => Promise<void>;
  onSendBroadcast: (params: { title: string; message: string }) => Promise<void>;
  onPurgeTestData: () => Promise<{ message: string }>;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  wallet,
  users,
  transactions,
  loans,
  loanConfig,
  onStartAdminWithdrawal,
  onCheckAdminWithdrawalStatus,
  onCancelAdminWithdrawal,
  onConfirmAdminWithdrawal,
  onFailAdminWithdrawal,
  onSendAdminMessage,
  onToggleBan,
  onProcessLoan,
  onUpdateLoanConfig,
  onSendBroadcast,
  onPurgeTestData,
}) => {
  const [adminTab, setAdminTab] = useState<'overview' | 'users' | 'loans' | 'broadcast'>('overview');
  const [txFilter, setTxFilter] = useState<string>('all');
  const [txSearch, setTxSearch] = useState('');
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState<string | null>(null);

  // Commission withdrawal modal via SingPay POST /transfert
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawOp, setWithdrawOp] = useState<MobileOperator>('Airtel Money');
  const [withdrawPhone, setWithdrawPhone] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealthStatus | null>(null);
  const [pendingAdminWithdraw, setPendingAdminWithdraw] = useState<{
    txId: string;
    referenceId: string;
    operator: MobileOperator;
    phone: string;
    amount: number;
    gatewayConfigured?: boolean;
    message: string;
  } | null>(null);
  const finalizedWithdrawRef = useRef<string | null>(null);

  // User action modals
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [banModalUser, setBanModalUser] = useState<UserProfile | null>(null);
  const [banReasonInput, setBanReasonInput] = useState('');
  const [msgModalUser, setMsgModalUser] = useState<UserProfile | null>(null);
  const [adminMsgText, setAdminMsgText] = useState('');

  // Loan Config form
  const [minTx, setMinTx] = useState(String(loanConfig.minTransactionsCount));
  const [minVol, setMinVol] = useState(String(loanConfig.minCumulativeVolume));
  const [maxLoan, setMaxLoan] = useState(String(loanConfig.maxLoanAmount));

  // Broadcast form
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 3500);
  };

  const filteredTx = useMemo(() => {
    const q = txSearch.trim().toLowerCase();
    return transactions.filter((t) => {
      if (txFilter !== 'all' && t.type !== txFilter) return false;
      if (!q) return true;
      return (
        (t.userName || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.operator || '').toLowerCase().includes(q)
      );
    });
  }, [transactions, txFilter, txSearch]);

  useEffect(() => {
    if (!showWithdrawModal) {
      setPendingAdminWithdraw(null);
      setWithdrawErr(null);
      finalizedWithdrawRef.current = null;
      return;
    }
    let active = true;
    fetchMobileMoneyGatewayHealth().then((status) => {
      if (active) setGatewayHealth(status);
    });
    return () => {
      active = false;
    };
  }, [showWithdrawModal]);

  useEffect(() => {
    if (!pendingAdminWithdraw || !pendingAdminWithdraw.gatewayConfigured) return;
    let active = true;

    const interval = window.setInterval(async () => {
      try {
        const res = await onCheckAdminWithdrawalStatus(pendingAdminWithdraw.referenceId);
        if (!active || res.status === 'PENDING') return;
        if (finalizedWithdrawRef.current === pendingAdminWithdraw.txId) return;
        finalizedWithdrawRef.current = pendingAdminWithdraw.txId;

        if (res.status === 'SUCCESS') {
          await onConfirmAdminWithdrawal({
            txId: pendingAdminWithdraw.txId,
            operator: pendingAdminWithdraw.operator,
            phone: pendingAdminWithdraw.phone,
            amount: pendingAdminWithdraw.amount,
          });
          if (!active) return;
          setPendingAdminWithdraw(null);
          setShowWithdrawModal(false);
          setWithdrawAmount('');
          showToast(`Retrait confirmé : ${formatFCFA(pendingAdminWithdraw.amount)} vers ${pendingAdminWithdraw.operator}.`);
        } else {
          const reason = res.message || 'Paiement annulé / échoué';
          await onFailAdminWithdrawal({
            txId: pendingAdminWithdraw.txId,
            operator: pendingAdminWithdraw.operator,
            reason,
          }).catch(() => undefined);
          if (!active) return;
          setPendingAdminWithdraw(null);
          setWithdrawErr(reason);
        }
      } catch {
        // Garde l'état PENDING tant que SingPay n'a pas statué
      }
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [
    pendingAdminWithdraw,
    onCheckAdminWithdrawalStatus,
    onConfirmAdminWithdrawal,
    onFailAdminWithdrawal,
  ]);

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawErr(null);
    const amount = Math.round(Number(withdrawAmount) || 0);
    if (!isValidGabonPhone(withdrawPhone)) {
      setWithdrawErr('Numéro Mobile Money gabonais invalide.');
      return;
    }
    if (amount < 500 || amount > wallet.commissionBalance) {
      setWithdrawErr('Montant invalide (minimum 500 FCFA) ou supérieur au solde disponible.');
      return;
    }
    setWithdrawSubmitting(true);
    try {
      const cleanPhone = withdrawPhone.replace(/[\s\-()]/g, '');
      const gateway = await onStartAdminWithdrawal({
        operator: withdrawOp,
        phone: cleanPhone,
        amount,
      });

      if (gateway.status === 'SUCCESS') {
        await onConfirmAdminWithdrawal({
          txId: gateway.txId,
          operator: withdrawOp,
          phone: cleanPhone,
          amount,
        });
        setShowWithdrawModal(false);
        setWithdrawAmount('');
        showToast(`Retrait confirmé : ${formatFCFA(amount)} envoyés vers ${withdrawOp}.`);
        return;
      }

      if (gateway.status === 'FAILED' || gateway.status === 'EXPIRED') {
        await onFailAdminWithdrawal({
          txId: gateway.txId,
          operator: withdrawOp,
          reason: gateway.message,
        }).catch(() => undefined);
        setWithdrawErr(gateway.message || 'Paiement annulé / échoué');
        return;
      }

      setPendingAdminWithdraw({
        txId: gateway.txId,
        referenceId: gateway.referenceId,
        operator: withdrawOp,
        phone: cleanPhone,
        amount,
        gatewayConfigured: gateway.gatewayConfigured,
        message: gateway.message,
      });
    } catch (err) {
      setWithdrawErr(err instanceof Error ? err.message : 'Erreur lors du retrait SingPay.');
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  const handleConfirmBan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!banModalUser || !banReasonInput.trim()) return;
    await onToggleBan({
      targetUser: banModalUser,
      isBanned: true,
      banReason: banReasonInput.trim(),
    });
    showToast(`Compte ${banModalUser.fullName} banni.`);
    setBanModalUser(null);
    setBanReasonInput('');
    setSelectedUser(null);
  };

  const handleConfirmAdminMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgModalUser || !adminMsgText.trim()) return;
    await onSendAdminMessage({ targetUser: msgModalUser, text: adminMsgText.trim() });
    showToast(`Message envoyé à ${msgModalUser.fullName}.`);
    setMsgModalUser(null);
    setAdminMsgText('');
    setSelectedUser(null);
  };

  const handleConfigSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateLoanConfig({
      minTransactionsCount: Math.max(1, Number(minTx) || 5),
      minCumulativeVolume: Math.max(0, Number(minVol) || 100000),
      maxLoanAmount: Math.max(10000, Number(maxLoan) || 1000000),
    });
    showToast('Paramètres d’éligibilité aux prêts mis à jour.');
  };

  const handleBroadcastSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastMsg.trim()) return;
    await onSendBroadcast({ title: broadcastTitle.trim(), message: broadcastMsg.trim() });
    setBroadcastTitle('');
    setBroadcastMsg('');
    showToast(`Diffusion envoyée à ${users.length} utilisateur(s).`);
  };

  return (
    <div className="space-y-8">
      {/* Header & Commission Wallet Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <p className="text-xs font-medium text-amber-400">Console Administrateur</p>
          <h1 className="font-display text-2xl font-bold text-white mt-0.5">
            Supervision &amp; Commissions (2%)
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setPurgeError(null);
              setShowPurgeModal(true);
            }}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-200 font-semibold text-xs sm:text-sm px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Purger données de test</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setWithdrawAmount(String(Math.floor(wallet.commissionBalance)));
              setShowWithdrawModal(true);
            }}
            disabled={wallet.commissionBalance <= 0}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-sm px-4 py-2.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Wallet className="w-4 h-4" />
            <span>Retirer mes commissions</span>
          </button>
        </div>
      </div>

      {toast && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 space-y-1">
          <p className="text-xs text-slate-400">Solde commissions disponible</p>
          <p className="text-2xl font-bold text-amber-400 font-mono-tabular">
            {formatFCFA(wallet.commissionBalance)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 space-y-1">
          <p className="text-xs text-slate-400">Total commissions perçues</p>
          <p className="text-2xl font-bold text-emerald-400 font-mono-tabular">
            {formatFCFA(wallet.totalCommissionsEarned)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 space-y-1">
          <p className="text-xs text-slate-400">Total retiré (Admin)</p>
          <p className="text-2xl font-bold text-white font-mono-tabular">
            {formatFCFA(wallet.totalWithdrawnByAdmin)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/75 p-5 space-y-1">
          <p className="text-xs text-slate-400">Utilisateurs inscrits</p>
          <p className="text-2xl font-bold text-white font-mono-tabular">{users.length}</p>
        </div>
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl w-fit">
        {[
          { id: 'overview', label: 'Transactions globales' },
          { id: 'users', label: `Utilisateurs (${users.length})` },
          { id: 'loans', label: `Prêts (${loans.filter((l) => l.status === 'pending').length})` },
          { id: 'broadcast', label: 'Diffusion générale' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAdminTab(t.id as typeof adminTab)}
            className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              adminTab === t.id
                ? 'bg-emerald-500 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: GLOBAL TRANSACTIONS */}
      {adminTab === 'overview' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={txSearch}
                onChange={(e) => setTxSearch(e.target.value)}
                placeholder="Filtrer par utilisateur, opérateur ou libellé..."
                className="w-full min-h-[40px] rounded-xl border border-slate-700 bg-slate-950/70 pl-10 pr-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <select
              value={txFilter}
              onChange={(e) => setTxFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">Toutes les opérations</option>
              <option value="deposit">Dépôts Mobile Money</option>
              <option value="withdrawal">Retraits Mobile Money</option>
              <option value="transfer_internal">Transferts Carte à Carte</option>
              <option value="transfer_international">Transferts Internationaux</option>
              <option value="online_purchase">Achats en ligne</option>
              <option value="card_renewal">Renouvellements Carte (500 FCFA)</option>
              <option value="subscription_renewal">Renouvellements Abonnement</option>
              <option value="loan_disbursement">Décaissements Prêts</option>
              <option value="admin_withdrawal">Retraits Admin</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400">
                  <th className="py-3 px-4 font-medium">Date</th>
                  <th className="py-3 px-4 font-medium">Utilisateur</th>
                  <th className="py-3 px-4 font-medium">Opération</th>
                  <th className="py-3 px-4 font-medium">Statut</th>
                  <th className="py-3 px-4 font-medium text-right">Montant brut</th>
                  <th className="py-3 px-4 font-medium text-right">Commission (2%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {filteredTx.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Aucune transaction enregistrée.
                    </td>
                  </tr>
                ) : (
                  filteredTx.map((tx) => {
                    const isCompleted = tx.status === 'completed';
                    const isPending = tx.status === 'pending';
                    return (
                      <tr key={tx.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 text-slate-400 whitespace-nowrap font-mono-tabular">
                          {formatDateFr(tx.createdAt)}
                        </td>
                        <td className="py-3 px-4 text-white font-medium">{tx.userName}</td>
                        <td className="py-3 px-4 text-slate-300">
                          {tx.operator} · {tx.description}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-medium">
                          <span
                            className={
                              isCompleted
                                ? 'text-emerald-400'
                                : isPending
                                  ? 'text-amber-400'
                                  : 'text-red-400'
                            }
                          >
                            {isCompleted ? 'Validé' : isPending ? 'En attente' : 'Échoué'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-white whitespace-nowrap">
                          {formatFCFA(tx.grossAmount)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular whitespace-nowrap">
                          {isCompleted ? (
                            <span className="text-amber-400 font-semibold">
                              +{formatFCFA(tx.feeAmount)}
                            </span>
                          ) : (
                            <span className="text-slate-500">
                              {isPending ? 'En attente' : 'Non perçue'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: USERS & MODERATION */}
      {adminTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-400" />
              <h2 className="font-display text-sm font-semibold text-white">Comptes utilisateurs</h2>
            </div>
            <div className="divide-y divide-slate-800/80">
              {users.map((u) => (
                <button
                  key={u.uid}
                  type="button"
                  onClick={() => setSelectedUser(u)}
                  className={`w-full text-left p-4 hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-4 ${
                    selectedUser?.uid === u.uid ? 'bg-slate-800/70' : ''
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white truncate">{u.fullName}</span>
                      {u.isBanned && (
                        <span className="text-xs font-semibold text-red-400">· Banni</span>
                      )}
                      {u.role === 'admin' && (
                        <span className="text-xs font-semibold text-amber-400">· Admin</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">
                      {u.email} · {u.age} ans · {u.totalTransactionsCount} op.
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono-tabular font-semibold text-emerald-400">
                      {formatFCFA(u.balance)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {u.loanEligible ? 'Prêt débloqué' : 'Prêt verrouillé'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 h-fit">
            {!selectedUser ? (
              <div className="py-12 text-center text-sm text-slate-400">
                Cliquez sur un utilisateur dans la liste pour accéder aux actions de modération et messagerie.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-1 border-b border-slate-800 pb-4">
                  <h3 className="font-display text-lg font-bold text-white">{selectedUser.fullName}</h3>
                  <p className="text-xs text-slate-400">{selectedUser.email} · {selectedUser.age} ans</p>
                  <p className="text-xs font-mono-tabular text-slate-300 pt-1">
                    Carte :{' '}
                    {selectedUser.cardNumber
                      ? `•••• ${selectedUser.cardNumber.slice(-4)}`
                      : 'Gérée via Card Issuing'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
                    <p className="text-slate-400">Solde</p>
                    <p className="font-mono-tabular font-semibold text-white mt-0.5">
                      {formatFCFA(selectedUser.balance)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3">
                    <p className="text-slate-400">Volume cumulé</p>
                    <p className="font-mono-tabular font-semibold text-white mt-0.5">
                      {formatFCFA(selectedUser.totalVolume)}
                    </p>
                  </div>
                </div>

                {selectedUser.isBanned && (
                  <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-200 space-y-1">
                    <p className="font-semibold">Compte actuellement banni</p>
                    <p>Motif : {selectedUser.banReason}</p>
                  </div>
                )}

                <div className="space-y-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setMsgModalUser(selectedUser)}
                    className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-sm font-medium transition-colors"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Envoyer un message privé</span>
                  </button>

                  {selectedUser.isBanned ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await onToggleBan({ targetUser: selectedUser, isBanned: false, banReason: '' });
                        showToast(`Compte ${selectedUser.fullName} débanni.`);
                        setSelectedUser(null);
                      }}
                      className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold transition-colors"
                    >
                      <Unlock className="w-4 h-4" />
                      <span>Débannir le compte</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBanModalUser(selectedUser)}
                      className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm font-medium transition-colors"
                    >
                      <Ban className="w-4 h-4" />
                      <span>Bannir le compte</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: LOANS & CONFIG */}
      {adminTab === 'loans' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-emerald-400" />
              <h2 className="font-display text-base font-semibold text-white">Demandes de prêts</h2>
            </div>

            {loans.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">Aucune demande de prêt reçue.</p>
            ) : (
              <div className="divide-y divide-slate-800">
                {loans.map((loan) => (
                  <div key={loan.id} className="py-4 first:pt-0 last:pb-0 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-white">{loan.userName}</p>
                        <p className="text-xs text-slate-400">
                          {loan.durationMonths} mois · {formatDateFr(loan.createdAt)}
                        </p>
                      </div>
                      <span className="font-mono-tabular font-bold text-amber-400">
                        {formatFCFA(loan.amount)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">{loan.reason}</p>

                    {loan.status === 'pending' ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={async () => {
                            await onProcessLoan({
                              loan,
                              decision: 'approved',
                              adminNote: 'Approuvé par l’administration',
                            });
                            showToast(`Prêt de ${formatFCFA(loan.amount)} approuvé et crédité.`);
                          }}
                          className="min-h-[40px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Approuver &amp; Créditer</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await onProcessLoan({
                              loan,
                              decision: 'rejected',
                              adminNote: 'Dossier non retenu pour le moment.',
                            });
                            showToast('Demande de prêt refusée.');
                          }}
                          className="min-h-[40px] flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-semibold transition-colors"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>Refuser</span>
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs font-medium text-slate-400">
                        Statut : {loan.status === 'approved' ? 'Approuvé & Crédité' : 'Refusé'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={handleConfigSubmit}
            className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4 h-fit"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-amber-400" />
              <h2 className="font-display text-base font-semibold text-white">Seuils d’éligibilité auto</h2>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Transactions minimum</label>
              <input
                type="number"
                min={1}
                max={100}
                value={minTx}
                onChange={(e) => setMinTx(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2 text-sm text-white font-mono-tabular focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Volume cumulé minimum (FCFA)</label>
              <input
                type="number"
                min={0}
                step={5000}
                value={minVol}
                onChange={(e) => setMinVol(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2 text-sm text-white font-mono-tabular focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Montant maximum de prêt (FCFA)</label>
              <input
                type="number"
                min={10000}
                step={10000}
                value={maxLoan}
                onChange={(e) => setMaxLoan(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2 text-sm text-white font-mono-tabular focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              className="w-full min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors"
            >
              Enregistrer les seuils
            </button>
          </form>
        </div>
      )}

      {/* TAB 4: BROADCAST */}
      {adminTab === 'broadcast' && (
        <form
          onSubmit={handleBroadcastSubmit}
          className="max-w-xl rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-amber-400" />
            <h2 className="font-display text-lg font-semibold text-white">Diffusion Générale (Broadcast)</h2>
          </div>
          <p className="text-xs text-slate-400">
            Ce message apparaîtra instantanément dans l’espace de notifications privé de tous les utilisateurs inscrits ({users.length}).
          </p>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Titre de l’annonce</label>
            <input
              type="text"
              required
              maxLength={120}
              value={broadcastTitle}
              onChange={(e) => setBroadcastTitle(e.target.value)}
              placeholder="Ex: Maintenance Airtel Money programmée"
              className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Message</label>
            <textarea
              required
              rows={4}
              maxLength={500}
              value={broadcastMsg}
              onChange={(e) => setBroadcastMsg(e.target.value)}
              placeholder="Rédigez votre communiqué officiel..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="w-full min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors"
          >
            Diffuser à tous les utilisateurs
          </button>
        </form>
      )}

      {/* MODAL: WITHDRAW COMMISSIONS VIA SINGPAY POST /transfert */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#1E3A63] bg-[#0F1D36] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">Retirer mes commissions</h3>
              <button
                type="button"
                onClick={() => setShowWithdrawModal(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {pendingAdminWithdraw ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-500/35 bg-[#050B18]/85 p-4 space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    {pendingAdminWithdraw.gatewayConfigured ? (
                      <Loader2 className="w-5 h-5 text-amber-400 animate-spin shrink-0" />
                    ) : (
                      <Clock className="w-5 h-5 text-amber-400 shrink-0" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {pendingAdminWithdraw.gatewayConfigured
                          ? 'Transfert SingPay en attente de confirmation...'
                          : 'PENDING (passerelle SingPay en attente de configuration)'}
                      </p>
                      <p className="text-[11px] font-mono-tabular text-slate-400">
                        Réf : {pendingAdminWithdraw.referenceId} · POST /transfert
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{pendingAdminWithdraw.message}</p>
                  <p className="text-[11px] text-slate-400">
                    Le portefeuille des commissions ne sera débité qu’après confirmation <strong>SUCCESS</strong> par SingPay.
                  </p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await onCancelAdminWithdrawal(pendingAdminWithdraw.referenceId).catch(() => null);
                      await onFailAdminWithdrawal({
                        txId: pendingAdminWithdraw.txId,
                        operator: pendingAdminWithdraw.operator,
                        reason: res?.message || 'Annulé par l’administrateur.',
                      }).catch(() => undefined);
                      setPendingAdminWithdraw(null);
                      setWithdrawErr(res?.message || 'Paiement annulé / échoué.');
                    }}
                    className="flex-1 min-h-[44px] rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 text-xs font-semibold cursor-pointer"
                  >
                    Annuler la demande
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWithdrawModal(false)}
                    className="flex-1 min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18] text-slate-200 text-xs font-semibold cursor-pointer"
                  >
                    Fermer
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleWithdrawSubmit} className="space-y-4">
                <p className="text-xs text-slate-400">
                  Disponible : <strong className="text-amber-400 font-mono-tabular">{formatFCFA(wallet.commissionBalance)}</strong>
                </p>

                {gatewayHealth && !gatewayHealth.fullyConfigured && (
                  <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 flex items-start gap-2 text-xs text-amber-100">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      Passerelle SingPay en attente de configuration côté serveur. Aucun solde ne sera débité sans confirmation réelle.
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {(['Airtel Money', 'Moov Money'] as MobileOperator[]).map((op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => setWithdrawOp(op)}
                      className={`min-h-[44px] rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                        withdrawOp === op
                          ? 'border-amber-500 bg-amber-500/15 text-amber-200'
                          : 'border-[#1E3A63] text-slate-300'
                      }`}
                    >
                      <Smartphone className="w-4 h-4" />
                      <span>{op}</span>
                    </button>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Numéro Mobile Money Admin</label>
                  <input
                    type="tel"
                    required
                    value={withdrawPhone}
                    onChange={(e) => setWithdrawPhone(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2 text-sm text-white font-mono-tabular"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Montant (FCFA)</label>
                  <input
                    type="number"
                    required
                    min={500}
                    max={wallet.commissionBalance}
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2 text-sm text-white font-mono-tabular"
                  />
                </div>
                {withdrawErr && <p className="text-xs text-red-400">{withdrawErr}</p>}
                <button
                  type="submit"
                  disabled={withdrawSubmitting}
                  className="w-full min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-semibold text-sm cursor-pointer"
                >
                  {withdrawSubmitting ? 'Envoi vers SingPay (/transfert)...' : `Transférer vers ${withdrawOp}`}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL: BAN USER (MANDATORY REASON) */}
      {banModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleConfirmBan}
            className="w-full max-w-md rounded-2xl border border-red-500/40 bg-slate-900 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-white">Bannir {banModalUser.fullName}</h3>
              <button
                type="button"
                onClick={() => setBanModalUser(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-300">
              Veuillez saisir le motif exact du bannissement. Ce motif sera affiché en rouge à l’utilisateur à chaque ouverture de l’application.
            </p>
            <textarea
              required
              rows={3}
              maxLength={500}
              value={banReasonInput}
              onChange={(e) => setBanReasonInput(e.target.value)}
              placeholder="Ex: Activité suspecte détectée ou usurpation d’identité."
              className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white focus:border-red-500 focus:outline-none"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setBanModalUser(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-700 text-slate-300 text-sm"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!banReasonInput.trim()}
                className="flex-1 min-h-[44px] rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-semibold text-sm"
              >
                Confirmer le bannissement
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: ADMIN PRIVATE MESSAGE */}
      {msgModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleConfirmAdminMsg}
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <h3 className="font-display text-base font-bold text-white">
                  Message à {msgModalUser.fullName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMsgModalUser(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Ce message apparaîtra dans la messagerie privée de l’utilisateur sous l’expéditeur <strong>Administration</strong>.
            </p>
            <textarea
              required
              rows={4}
              maxLength={1000}
              value={adminMsgText}
              onChange={(e) => setAdminMsgText(e.target.value)}
              placeholder="Rédigez votre message officiel..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              className="w-full min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm"
            >
              Envoyer sous « Administration »
            </button>
          </form>
        </div>
      )}

      {/* MODAL: ADMIN PURGE TEST DATA */}
      {showPurgeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[#0F1D36] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-400" />
                <h3 className="font-display text-lg font-bold text-white">
                  Purger les données de test
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPurgeModal(false)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Cette action serveur supprime les transactions marquées <strong>pending</strong> ou{' '}
              <strong>isTest</strong>, nettoie les notifications expirées et réinitialise les soldes de test et le portefeuille des commissions à <strong>0 FCFA</strong>, sans supprimer les comptes administrateurs.
            </p>
            {purgeError && (
              <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                {purgeError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                disabled={purging}
                onClick={() => setShowPurgeModal(false)}
                className="flex-1 min-h-[44px] rounded-xl border border-[#1E3A63] text-slate-300 text-sm cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={purging}
                onClick={async () => {
                  setPurgeError(null);
                  setPurging(true);
                  try {
                    const res = await onPurgeTestData();
                    setShowPurgeModal(false);
                    showToast(res.message);
                  } catch (err) {
                    setPurgeError(err instanceof Error ? err.message : 'Erreur lors de la purge.');
                  } finally {
                    setPurging(false);
                  }
                }}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-semibold text-sm cursor-pointer"
              >
                {purging && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{purging ? 'Purge en cours...' : 'Confirmer la purge'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
