import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  Globe,
  Home,
  Landmark,
  LogOut,
  MessageSquare,
  Send,
  Shield,
  ShoppingBag,
  Star,
  Wallet,
} from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthScreen, OnboardingForm } from './components/AuthAndOnboarding';
import { BannedScreen } from './components/BannedScreen';
import { DashboardHome } from './components/DashboardHome';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoansView } from './components/LoansView';
import { MessagingView, ReviewsView } from './components/MessagingAndReviews';
import { NotificationsView } from './components/NotificationsView';
import { OperationsModal } from './components/OperationsModal';
import { OfflineBlockingScreen, PWAInstallButton } from './components/PWAComponents';
import { auth, db, googleProvider, handleFirestoreError, OperationType, testConnection } from './lib/firebase';
import { ADMIN_BOOTSTRAP_EMAIL, formatCardNumber } from './lib/formatters';
import {
  adminProcessLoan,
  adminSendBroadcast,
  adminToggleUserBan,
  adminUpdateLoanConfig,
  cancelMobileMoneyGateway,
  completeUserOnboarding,
  createPendingAdminWithdrawalTransaction,
  createPendingMobileMoneyTransaction,
  DEFAULT_LOAN_CONFIG,
  deletePublicComment,
  ensurePrimaryAdminProfile,
  executeInternalTransfer,
  executeInternationalTransfer,
  executeOnlinePurchase,
  failAdminWithdrawalTransaction,
  failMobileMoneyTransaction,
  finalizeConfirmedAdminWithdrawal,
  finalizeConfirmedMobileMoneyTransaction,
  initiateMobileMoneyGateway,
  isAdminEmail,
  lookupCardDirectory,
  markNotificationRead,
  pollMobileMoneyStatus,
  postPublicComment,
  sendPrivateMessage,
  submitLoanRequest,
} from './services/financeService';
import type {
  AdminWallet,
  AppView,
  CardDirectoryEntry,
  ChatMessage,
  CommentReview,
  Conversation,
  LoanConfig,
  LoanRequest,
  MessagingDirectoryEntry,
  MobileOperator,
  NotificationItem,
  OperationModalType,
  TransactionRecord,
  UserProfile,
} from './types';

function toMillis(val: unknown): number {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  if (
    typeof val === 'object' &&
    val !== null &&
    'toMillis' in val &&
    typeof (val as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (val as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function MainApp() {
  // Firebase Auth state
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [liveProfile, setLiveProfile] = useState<UserProfile | null>(null);

  // Live Firestore collections
  const [liveSentTx, setLiveSentTx] = useState<TransactionRecord[]>([]);
  const [liveRecvTx, setLiveRecvTx] = useState<TransactionRecord[]>([]);
  const [liveLoans, setLiveLoans] = useState<LoanRequest[]>([]);
  const [liveNotifications, setLiveNotifications] = useState<NotificationItem[]>([]);
  const [liveConversations, setLiveConversations] = useState<Conversation[]>([]);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [liveContacts, setLiveContacts] = useState<MessagingDirectoryEntry[]>([]);
  const [liveComments, setLiveComments] = useState<CommentReview[]>([]);
  const [liveLoanConfig, setLiveLoanConfig] = useState<LoanConfig>(DEFAULT_LOAN_CONFIG);

  // Admin Live Firestore collections
  const [liveAdminWallet, setLiveAdminWallet] = useState<AdminWallet>({
    commissionBalance: 0,
    totalCommissionsEarned: 0,
    totalWithdrawnByAdmin: 0,
    updatedAt: new Date(),
  });
  const [liveAllUsers, setLiveAllUsers] = useState<UserProfile[]>([]);
  const [liveAllTx, setLiveAllTx] = useState<TransactionRecord[]>([]);
  const [liveAllLoans, setLiveAllLoans] = useState<LoanRequest[]>([]);

  // Navigation & UI state
  const [activeView, setActiveView] = useState<AppView>('dashboard');
  const [operationModal, setOperationModal] = useState<OperationModalType>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [liveViewMode, setLiveViewMode] = useState<'user' | 'admin'>('user');
  const [fatalError, setFatalError] = useState<Error | null>(null);

  const reportListenerError = (err: unknown, op: OperationType, path: string) => {
    if (!auth.currentUser) return;
    try {
      handleFirestoreError(err, op, path);
    } catch (wrapped) {
      setFatalError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
    }
  };

  if (fatalError) {
    throw fatalError;
  }

  // Test Firestore connection at boot
  useEffect(() => {
    testConnection();
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setLiveProfile(null);
        setProfileLoading(false);
        setFatalError(null);
      } else {
        setProfileLoading(true);
        if (isAdminEmail(user.email)) {
          try {
            await ensurePrimaryAdminProfile(user.uid, user.email || '');
            setLiveViewMode('admin');
            setActiveView('admin');
          } catch {
            // Géré par le listener profil
          }
        }
      }
    });
    return unsub;
  }, []);

  // User profile listener
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const path = `users/${firebaseUser.uid}`;
    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          setLiveProfile(snap.data() as UserProfile);
        } else {
          setLiveProfile(null);
        }
        setProfileLoading(false);
      },
      (err) => {
        setProfileLoading(false);
        reportListenerError(err, OperationType.GET, path);
      }
    );
    return unsub;
  }, [authReady, firebaseUser]);

  // User data listeners (only when profile exists and not banned)
  useEffect(() => {
    if (!authReady || !firebaseUser || !liveProfile || liveProfile.isBanned) return;
    const uid = firebaseUser.uid;

    const unsubSent = onSnapshot(
      query(collection(db, 'transactions'), where('userId', '==', uid)),
      (snap) => setLiveSentTx(snap.docs.map((d) => d.data() as TransactionRecord)),
      (err) => reportListenerError(err, OperationType.LIST, 'transactions')
    );

    const unsubRecv = onSnapshot(
      query(collection(db, 'transactions'), where('recipientId', '==', uid)),
      (snap) => setLiveRecvTx(snap.docs.map((d) => d.data() as TransactionRecord)),
      (err) => reportListenerError(err, OperationType.LIST, 'transactions')
    );

    const unsubLoans = onSnapshot(
      query(collection(db, 'loans'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as LoanRequest);
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setLiveLoans(list);
      },
      (err) => reportListenerError(err, OperationType.LIST, 'loans')
    );

    const unsubNotifs = onSnapshot(
      query(collection(db, 'notifications'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as NotificationItem);
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setLiveNotifications(list);
      },
      (err) => reportListenerError(err, OperationType.LIST, 'notifications')
    );

    const unsubConvs = onSnapshot(
      query(collection(db, 'conversations'), where('participantIds', 'array-contains', uid)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Conversation);
        list.sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
        setLiveConversations(list);
      },
      (err) => reportListenerError(err, OperationType.LIST, 'conversations')
    );

    const unsubContacts = onSnapshot(
      query(collection(db, 'messaging_directory'), where('uid', '!=', '')),
      (snap) => setLiveContacts(snap.docs.map((d) => d.data() as MessagingDirectoryEntry)),
      (err) => reportListenerError(err, OperationType.LIST, 'messaging_directory')
    );

    const unsubComments = onSnapshot(
      query(collection(db, 'comments'), where('rating', '>=', 1), where('rating', '<=', 5)),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as CommentReview);
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setLiveComments(list);
      },
      (err) => reportListenerError(err, OperationType.LIST, 'comments')
    );

    const unsubConfig = onSnapshot(
      doc(db, 'settings', 'loan_config'),
      (snap) => {
        if (snap.exists()) setLiveLoanConfig(snap.data() as LoanConfig);
      },
      (err) => reportListenerError(err, OperationType.GET, 'settings/loan_config')
    );

    return () => {
      unsubSent();
      unsubRecv();
      unsubLoans();
      unsubNotifs();
      unsubConvs();
      unsubContacts();
      unsubComments();
      unsubConfig();
    };
  }, [authReady, firebaseUser, liveProfile]);

  // Active conversation messages listener
  useEffect(() => {
    if (!authReady || !firebaseUser || !liveProfile || !selectedConvId) return;
    const path = `conversations/${selectedConvId}/messages`;
    const unsub = onSnapshot(
      query(collection(db, 'conversations', selectedConvId, 'messages'), orderBy('createdAt', 'asc')),
      (snap) => setLiveMessages(snap.docs.map((d) => d.data() as ChatMessage)),
      (err) => reportListenerError(err, OperationType.LIST, path)
    );
    return unsub;
  }, [authReady, firebaseUser, liveProfile, selectedConvId]);

  // Admin listeners (only when liveProfile.role === 'admin')
  useEffect(() => {
    if (!authReady || !firebaseUser || liveProfile?.role !== 'admin') return;

    const unsubWallet = onSnapshot(
      doc(db, 'admin_stats', 'wallet'),
      (snap) => {
        if (snap.exists()) setLiveAdminWallet(snap.data() as AdminWallet);
      },
      (err) => reportListenerError(err, OperationType.GET, 'admin_stats/wallet')
    );

    const unsubUsers = onSnapshot(
      collection(db, 'users'),
      (snap) => setLiveAllUsers(snap.docs.map((d) => d.data() as UserProfile)),
      (err) => reportListenerError(err, OperationType.LIST, 'users')
    );

    const unsubAllTx = onSnapshot(
      collection(db, 'transactions'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as TransactionRecord);
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setLiveAllTx(list);
      },
      (err) => reportListenerError(err, OperationType.LIST, 'transactions')
    );

    const unsubAllLoans = onSnapshot(
      collection(db, 'loans'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as LoanRequest);
        list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setLiveAllLoans(list);
      },
      (err) => reportListenerError(err, OperationType.LIST, 'loans')
    );

    return () => {
      unsubWallet();
      unsubUsers();
      unsubAllTx();
      unsubAllLoans();
    };
  }, [authReady, firebaseUser, liveProfile?.role]);

  // Merged user transactions
  const userTransactions = useMemo(() => {
    const map = new Map<string, TransactionRecord>();
    for (const t of liveSentTx) map.set(t.id, t);
    for (const t of liveRecvTx) map.set(t.id, t);
    return Array.from(map.values()).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [liveSentTx, liveRecvTx]);

  const currentUser = liveProfile;
  const isAdminActor = currentUser?.role === 'admin';
  const unreadCount = liveNotifications.filter((n) => !n.read).length;

  // Handlers
  const handleGoogleLogin = async () => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Échec de la connexion Google.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    setActiveView('dashboard');
    setSelectedConvId(null);
  };

  const getValidIdToken = async (): Promise<string> => {
    if (!auth.currentUser) {
      throw new Error('Session expirée. Veuillez vous reconnecter avec Google.');
    }
    return auth.currentUser.getIdToken();
  };

  const handleLookupCard = async (cardNumber: string): Promise<CardDirectoryEntry | null> => {
    return lookupCardDirectory(cardNumber.replace(/\D/g, ''));
  };

  const handleStartMobileMoney = async (p: {
    type: 'deposit' | 'withdrawal';
    operator: MobileOperator;
    phone: string;
    amount: number;
  }) => {
    if (!currentUser) throw new Error('Utilisateur non connecté.');
    const idToken = await getValidIdToken();
    const { txId } = await createPendingMobileMoneyTransaction({
      user: currentUser,
      type: p.type,
      operator: p.operator,
      phone: p.phone,
      amount: p.amount,
    });
    try {
      return await initiateMobileMoneyGateway({
        idToken,
        txId,
        type: p.type,
        operator: p.operator,
        phone: p.phone,
        amount: p.amount,
      });
    } catch (err) {
      await failMobileMoneyTransaction({
        txId,
        operator: p.operator,
        type: p.type,
        reason: err instanceof Error ? err.message : 'Erreur d’initiation passerelle',
      }).catch(() => undefined);
      throw err;
    }
  };

  const handleCheckMobileMoneyStatus = async (referenceId: string) => {
    const idToken = await getValidIdToken();
    return pollMobileMoneyStatus({ idToken, referenceId });
  };

  const handleCancelMobileMoney = async (referenceId: string) => {
    const idToken = await getValidIdToken();
    return cancelMobileMoneyGateway({ idToken, referenceId });
  };

  const handleConfirmMobileMoney = async (p: {
    txId: string;
    type: 'deposit' | 'withdrawal';
    operator: MobileOperator;
    phone: string;
    amount: number;
  }) => {
    if (!currentUser) throw new Error('Utilisateur non connecté.');
    return finalizeConfirmedMobileMoneyTransaction({
      user: currentUser,
      txId: p.txId,
      type: p.type,
      operator: p.operator,
      phone: p.phone,
      amount: p.amount,
      loanConfig: liveLoanConfig,
    });
  };

  const handleFailMobileMoney = async (p: {
    txId: string;
    type: 'deposit' | 'withdrawal';
    operator: MobileOperator;
    reason: string;
  }) => {
    return failMobileMoneyTransaction(p);
  };

  const handleInternalTransfer = async (p: { recipient: CardDirectoryEntry; amount: number }) => {
    if (!currentUser) throw new Error('Utilisateur non connecté.');
    return executeInternalTransfer({ user: currentUser, ...p, loanConfig: liveLoanConfig });
  };

  const handleOnlinePurchase = async (p: { merchantName: string; amount: number }) => {
    if (!currentUser) throw new Error('Utilisateur non connecté.');
    return executeOnlinePurchase({ user: currentUser, ...p, loanConfig: liveLoanConfig });
  };

  const handleInternationalTransfer = async (p: {
    country: string;
    beneficiaryName: string;
    accountRef: string;
    amount: number;
  }) => {
    if (!currentUser) throw new Error('Utilisateur non connecté.');
    return executeInternationalTransfer({ user: currentUser, ...p, loanConfig: liveLoanConfig });
  };

  const handleStartConversation = async (contact: MessagingDirectoryEntry) => {
    if (!currentUser) return;
    const isAdminContact = contact.role === 'admin';
    const ids = isAdminContact ? ['ADMIN', currentUser.uid] : [currentUser.uid, contact.uid].sort();
    const convId = `conv_${ids[0]}_${ids[1]}`;
    const existing = liveConversations.find((c) => c.id === convId);
    if (existing) {
      setSelectedConvId(existing.id);
      return;
    }
    const createdId = await sendPrivateMessage({
      senderId: currentUser.uid,
      senderName: currentUser.fullName,
      recipientId: contact.uid,
      recipientName: contact.displayName,
      text: `Bonjour ${contact.displayName}`,
      isAdminSupport: isAdminContact,
    });
    setSelectedConvId(createdId);
  };

  const handleSendMessage = async (params: {
    recipientId: string;
    recipientName: string;
    text: string;
    isAdminSupport?: boolean;
  }) => {
    if (!currentUser) return;
    const convId = await sendPrivateMessage({
      senderId: currentUser.uid,
      senderName: currentUser.fullName,
      ...params,
    });
    setSelectedConvId(convId);
  };

  // Loading state with fixed AFRICABANK logo
  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#050B18] flex items-center justify-center p-6">
        <OfflineBlockingScreen />
        <div className="text-center space-y-4">
          <img
            src="/logo-africabank.png"
            alt="Logo AFRICABANK"
            className="w-20 h-20 rounded-2xl object-cover bg-[#050B18] border border-[#1E3A63] mx-auto"
          />
          <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm text-slate-300">Connexion sécurisée à AFRICABANK...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!firebaseUser) {
    return (
      <>
        <OfflineBlockingScreen />
        <AuthScreen
          onGoogleLogin={handleGoogleLogin}
          loading={authLoading}
          error={authError}
        />
      </>
    );
  }

  // Authenticated via Google, loading Firestore profile
  if (profileLoading) {
    return (
      <div className="min-h-screen bg-[#050B18] flex items-center justify-center p-6">
        <OfflineBlockingScreen />
        <div className="text-center space-y-4">
          <img
            src="/logo-africabank.png"
            alt="Logo AFRICABANK"
            className="w-20 h-20 rounded-2xl object-cover bg-[#050B18] border border-[#1E3A63] mx-auto"
          />
          <div className="w-8 h-8 rounded-full border-2 border-blue-400 border-t-transparent animate-spin mx-auto" />
          <p className="text-sm text-slate-300">Vérification du compte AFRICABANK...</p>
        </div>
      </div>
    );
  }

  // First login onboarding (bypassed automatically if primary admin email maliqzemby8@gmail.com)
  if (!liveProfile) {
    const isPrimaryAdmin =
      firebaseUser.email?.toLowerCase() === ADMIN_BOOTSTRAP_EMAIL.toLowerCase();
    if (isPrimaryAdmin) {
      return (
        <div className="min-h-screen bg-[#050B18] flex items-center justify-center p-6">
          <OfflineBlockingScreen />
          <div className="text-center space-y-4">
            <img
              src="/logo-africabank.png"
              alt="Logo AFRICABANK"
              className="w-20 h-20 rounded-2xl object-cover bg-[#050B18] border border-[#1E3A63] mx-auto"
            />
            <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mx-auto" />
            <p className="text-sm text-slate-300">Activation du profil Administrateur ZEMBY Maliq...</p>
          </div>
        </div>
      );
    }

    return (
      <>
        <OfflineBlockingScreen />
        <OnboardingForm
          email={firebaseUser.email || ''}
          defaultDisplayName={firebaseUser.displayName || ''}
          loading={authLoading}
          onSignOut={handleSignOut}
          onSubmit={async (data) => {
            setAuthLoading(true);
            try {
              await completeUserOnboarding({
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                ...data,
              });
            } finally {
              setAuthLoading(false);
            }
          }}
        />
      </>
    );
  }

  if (!currentUser) return null;

  // MANDATORY BAN CHECK
  if (currentUser.isBanned) {
    return (
      <>
        <OfflineBlockingScreen />
        <BannedScreen
          banReason={currentUser.banReason}
          onSignOut={handleSignOut}
        />
      </>
    );
  }

  const showAdminDashboard = isAdminActor && liveViewMode === 'admin';

  const navItems: { id: AppView; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'dashboard', label: 'Accueil', icon: <Home className="w-4 h-4" /> },
    { id: 'operations', label: 'Opérer', icon: <Wallet className="w-4 h-4" /> },
    { id: 'loans', label: 'Prêts', icon: <Landmark className="w-4 h-4" /> },
    { id: 'messages', label: 'Messages', icon: <MessageSquare className="w-4 h-4" /> },
    {
      id: 'notifications',
      label: 'Alertes',
      icon: <Bell className="w-4 h-4" />,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { id: 'reviews', label: 'Avis', icon: <Star className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#050B18] text-slate-100 flex flex-col">
      {/* Strict Online Requirement Blocking Overlay */}
      <OfflineBlockingScreen />

      {/* Unified Sticky Top Header + Horizontal Top Navigation Bar */}
      <header className="sticky top-0 z-50 bg-[#050B18]/95 backdrop-blur-md border-b border-[#1E3A63]/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          {/* Row 1: AFRICABANK Header */}
          <div className="h-14 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/logo-africabank.png"
                alt="Logo AFRICABANK"
                className="w-9 h-9 rounded-xl object-cover bg-[#050B18] border border-[#1E3A63] shrink-0"
              />
              <div className="min-w-0">
                <span className="font-display text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap">
                  AFRICA<span className="text-amber-400">BANK</span>
                </span>
                <p className="hidden sm:block text-[11px] text-slate-400 truncate">
                  {currentUser.fullName} · {formatCardNumber(currentUser.cardNumber, false)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isAdminActor && (
                <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0F1D36] border border-[#1E3A63]">
                  <button
                    type="button"
                    onClick={() => {
                      setLiveViewMode('user');
                      if (activeView === 'admin') setActiveView('dashboard');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                      liveViewMode === 'user'
                        ? 'bg-blue-500 text-white font-semibold'
                        : 'text-slate-300'
                    }`}
                  >
                    Client
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLiveViewMode('admin');
                      setActiveView('admin');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap cursor-pointer ${
                      liveViewMode === 'admin'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-amber-300'
                    }`}
                  >
                    Admin
                  </button>
                </div>
              )}

              <div className="hidden md:block">
                <PWAInstallButton compact />
              </div>

              <button
                type="button"
                onClick={handleSignOut}
                title="Déconnexion"
                aria-label="Déconnexion"
                className="min-h-[38px] min-w-[38px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#1E3A63] bg-[#0F1D36]/80 hover:border-red-400/50 hover:text-red-300 px-2.5 text-xs text-slate-300 transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span className="hidden lg:inline whitespace-nowrap">Déconnexion</span>
              </button>
            </div>
          </div>

          {/* Row 2: Top Horizontally Scrollable Navbar */}
          <nav
            aria-label="Navigation principale"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-2 border-t border-[#1E3A63]/45"
          >
            {navItems.map((item) => {
              const active = activeView === item.id && !showAdminDashboard;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setLiveViewMode('user');
                    setActiveView(item.id);
                  }}
                  className={`min-h-[38px] inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-blue-500 text-white font-semibold shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-[#0F1D36]'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={`font-mono-tabular text-[11px] font-bold ${
                        active ? 'text-amber-200' : 'text-amber-400'
                      }`}
                    >
                      ({item.badge})
                    </span>
                  )}
                </button>
              );
            })}

            {isAdminActor && (
              <button
                type="button"
                onClick={() => {
                  setLiveViewMode('admin');
                  setActiveView('admin');
                }}
                className={`min-h-[38px] inline-flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showAdminDashboard
                    ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
                    : 'text-amber-300 hover:text-amber-200 hover:bg-[#0F1D36] border border-amber-500/30'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>Admin</span>
              </button>
            )}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 flex-1">
        {showAdminDashboard ? (
          <AdminDashboard
            wallet={liveAdminWallet}
            users={liveAllUsers}
            transactions={liveAllTx}
            loans={liveAllLoans}
            loanConfig={liveLoanConfig}
            onStartAdminWithdrawal={async ({ operator, phone, amount }) => {
              const { txId } = await createPendingAdminWithdrawalTransaction({
                adminUid: currentUser.uid,
                adminName: currentUser.fullName,
                operator,
                phone,
                amount,
                currentBalance: liveAdminWallet.commissionBalance,
              });
              try {
                const idToken = await getValidIdToken();
                return await initiateMobileMoneyGateway({
                  idToken,
                  txId,
                  type: 'admin_withdrawal',
                  operator,
                  phone,
                  amount,
                });
              } catch (err) {
                await failAdminWithdrawalTransaction({
                  txId,
                  operator,
                  reason: err instanceof Error ? err.message : 'Erreur SingPay /transfert',
                }).catch(() => undefined);
                throw err;
              }
            }}
            onCheckAdminWithdrawalStatus={handleCheckMobileMoneyStatus}
            onCancelAdminWithdrawal={handleCancelMobileMoney}
            onConfirmAdminWithdrawal={async ({ txId, operator, phone, amount }) => {
              await finalizeConfirmedAdminWithdrawal({
                txId,
                operator,
                phone,
                amount,
                currentBalance: liveAdminWallet.commissionBalance,
              });
            }}
            onFailAdminWithdrawal={async ({ txId, operator, reason }) => {
              await failAdminWithdrawalTransaction({ txId, operator, reason });
            }}
            onSendAdminMessage={async ({ targetUser, text }) => {
              await sendPrivateMessage({
                senderId: 'ADMIN',
                senderName: 'Administration',
                recipientId: targetUser.uid,
                recipientName: targetUser.fullName,
                text,
                isAdminSupport: true,
              });
            }}
            onToggleBan={async ({ targetUser, isBanned, banReason }) => {
              await adminToggleUserBan({
                targetUserId: targetUser.uid,
                isBanned,
                banReason,
              });
            }}
            onProcessLoan={async ({ loan, decision, adminNote }) => {
              await adminProcessLoan({ loan, decision, adminNote });
            }}
            onUpdateLoanConfig={async (cfg) => {
              await adminUpdateLoanConfig(cfg);
            }}
            onSendBroadcast={async ({ title, message }) => {
              await adminSendBroadcast({
                title,
                message,
                userIds: liveAllUsers.map((u) => u.uid),
              });
            }}
          />
        ) : (
          <>
            {activeView === 'dashboard' && (
              <DashboardHome
                user={currentUser}
                transactions={userTransactions}
                loanConfig={liveLoanConfig}
                onOpenOperation={(op) => setOperationModal(op)}
                onNavigate={(v) => setActiveView(v)}
              />
            )}

            {activeView === 'operations' && (
              <div className="space-y-6">
                <div className="border-b border-[#1E3A63]/70 pb-4">
                  <h1 className="font-display text-2xl font-bold text-white">Centre d’opérations</h1>
                  <p className="text-sm text-slate-400 mt-1">
                    Toutes les opérations appliquent une commission transparente de 2% après confirmation réelle.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {[
                    {
                      op: 'deposit' as const,
                      title: 'Dépôt Mobile Money',
                      desc: 'Recharge sécurisée via Airtel Money ou Moov Money (confirmation sur votre téléphone).',
                      icon: <ArrowDownLeft className="w-6 h-6 text-emerald-400" />,
                    },
                    {
                      op: 'withdrawal' as const,
                      title: 'Retrait Mobile Money',
                      desc: 'Transférez le solde de votre carte vers votre numéro gabonais après validation.',
                      icon: <ArrowUpRight className="w-6 h-6 text-amber-400" />,
                    },
                    {
                      op: 'transfer_internal' as const,
                      title: 'Transfert Carte à Carte',
                      desc: 'Envoi instantané entre membres AFRICABANK (+2% frais).',
                      icon: <Send className="w-6 h-6 text-blue-400" />,
                    },
                    {
                      op: 'online_purchase' as const,
                      title: 'Paiement en ligne',
                      desc: 'Achat e-commerce sécurisé par le CVV de votre carte virtuelle.',
                      icon: <ShoppingBag className="w-6 h-6 text-amber-400" />,
                    },
                    {
                      op: 'transfer_international' as const,
                      title: 'Transfert International',
                      desc: 'Envoyez des fonds vers la France, le Cameroun, la Côte d’Ivoire, etc.',
                      icon: <Globe className="w-6 h-6 text-sky-400" />,
                    },
                  ].map((card) => (
                    <button
                      key={card.op}
                      type="button"
                      onClick={() => setOperationModal(card.op)}
                      className="rounded-2xl border border-[#1E3A63] bg-[#0F1D36]/75 hover:border-blue-400/60 p-6 text-left space-y-4 transition-colors cursor-pointer"
                    >
                      <div className="w-12 h-12 rounded-xl bg-[#050B18]/80 border border-[#1E3A63] flex items-center justify-center">
                        {card.icon}
                      </div>
                      <div className="space-y-1">
                        <h2 className="font-display text-base font-bold text-white">{card.title}</h2>
                        <p className="text-xs text-slate-300 leading-relaxed">{card.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeView === 'loans' && (
              <LoansView
                user={currentUser}
                loanConfig={liveLoanConfig}
                loans={liveLoans}
                onSubmitLoan={async ({ amount, durationMonths, reason }) => {
                  await submitLoanRequest({ user: currentUser, amount, durationMonths, reason });
                }}
              />
            )}

            {activeView === 'messages' && (
              <MessagingView
                currentUser={currentUser}
                contacts={liveContacts}
                conversations={liveConversations}
                selectedConvId={selectedConvId}
                messages={liveMessages}
                onSelectConversation={(id) => setSelectedConvId(id)}
                onStartConversation={handleStartConversation}
                onSendMessage={handleSendMessage}
              />
            )}

            {activeView === 'notifications' && (
              <NotificationsView
                notifications={liveNotifications}
                onMarkRead={async (notifId) => {
                  await markNotificationRead(notifId);
                }}
              />
            )}

            {activeView === 'reviews' && (
              <ReviewsView
                currentUser={currentUser}
                comments={liveComments}
                onPostComment={async ({ rating, content }) => {
                  await postPublicComment({
                    userId: currentUser.uid,
                    authorName: currentUser.fullName,
                    rating,
                    content,
                  });
                }}
                onDeleteComment={async (commentId) => {
                  await deletePublicComment(commentId);
                }}
              />
            )}
          </>
        )}
      </main>

      {/* Transaction Operations Modal */}
      <OperationsModal
        mode={operationModal}
        user={currentUser}
        onClose={() => setOperationModal(null)}
        onLookupCard={handleLookupCard}
        onStartMobileMoney={handleStartMobileMoney}
        onCheckMobileMoneyStatus={handleCheckMobileMoneyStatus}
        onCancelMobileMoney={handleCancelMobileMoney}
        onConfirmMobileMoney={handleConfirmMobileMoney}
        onFailMobileMoney={handleFailMobileMoney}
        onInternalTransfer={handleInternalTransfer}
        onOnlinePurchase={handleOnlinePurchase}
        onInternationalTransfer={handleInternationalTransfer}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
