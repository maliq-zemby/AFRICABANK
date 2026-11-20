export type UserRole = 'user' | 'admin';

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer_internal'
  | 'transfer_international'
  | 'online_purchase'
  | 'loan_disbursement'
  | 'admin_withdrawal';

export type TransactionStatus = 'completed' | 'pending' | 'failed';

export type MobileOperator = 'Airtel Money' | 'Moov Money';

export interface UserProfile {
  uid: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  age: number;
  acceptedTerms: boolean;
  role: UserRole;
  isBanned: boolean;
  banReason: string;
  cardNumber: string;
  cardExpiry: string;
  cardCvv: string;
  balance: number;
  totalDepositsCount: number;
  totalDepositsVolume: number;
  totalWithdrawalsVolume: number;
  totalTransactionsCount: number;
  totalVolume: number;
  loanEligible: boolean;
  createdAt: Date | unknown;
  updatedAt: Date | unknown;
}

export interface CardDirectoryEntry {
  uid: string;
  cardNumber: string;
  holderName: string;
  active: boolean;
}

export interface MessagingDirectoryEntry {
  uid: string;
  displayName: string;
  cardLast4: string;
  role: UserRole;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  userName: string;
  recipientId: string;
  recipientName: string;
  type: TransactionType;
  operator: string;
  phoneOrAccount: string;
  country: string;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  status: TransactionStatus;
  description: string;
  createdAt: Date | unknown;
}

export interface LoanRequest {
  id: string;
  userId: string;
  userName: string;
  amount: number;
  durationMonths: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote: string;
  createdAt: Date | unknown;
  updatedAt: Date | unknown;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  category: 'transaction' | 'loan' | 'admin' | 'broadcast' | 'security';
  read: boolean;
  createdAt: Date | unknown;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  participantLabels: string[];
  isAdminSupport: boolean;
  lastMessage: string;
  lastSenderId: string;
  createdAt: Date | unknown;
  updatedAt: Date | unknown;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: Date | unknown;
}

export interface CommentReview {
  id: string;
  userId: string;
  authorName: string;
  rating: number;
  content: string;
  createdAt: Date | unknown;
}

export interface AdminWallet {
  commissionBalance: number;
  totalCommissionsEarned: number;
  totalWithdrawnByAdmin: number;
  updatedAt: Date | unknown;
}

export interface LoanConfig {
  minTransactionsCount: number;
  minCumulativeVolume: number;
  maxLoanAmount: number;
  updatedAt: Date | unknown;
}

export type AppView =
  | 'dashboard'
  | 'operations'
  | 'loans'
  | 'messages'
  | 'reviews'
  | 'notifications'
  | 'admin';

export type OperationModalType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer_internal'
  | 'transfer_international'
  | 'online_purchase'
  | null;
