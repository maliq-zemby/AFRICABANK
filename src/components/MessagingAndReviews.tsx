import React, { useMemo, useState } from 'react';
import { MessageSquare, Search, Send, Shield, Star, Trash2, User } from 'lucide-react';
import { formatDateFr } from '../lib/formatters';
import type {
  ChatMessage,
  CommentReview,
  Conversation,
  MessagingDirectoryEntry,
  UserProfile,
} from '../types';

interface MessagingViewProps {
  currentUser: UserProfile;
  contacts: MessagingDirectoryEntry[];
  conversations: Conversation[];
  selectedConvId: string | null;
  messages: ChatMessage[];
  onSelectConversation: (convId: string) => void;
  onStartConversation: (contact: MessagingDirectoryEntry) => void;
  onSendMessage: (params: {
    recipientId: string;
    recipientName: string;
    text: string;
    isAdminSupport?: boolean;
  }) => Promise<void>;
}

export const MessagingView: React.FC<MessagingViewProps> = ({
  currentUser,
  contacts,
  conversations,
  selectedConvId,
  messages,
  onSelectConversation,
  onStartConversation,
  onSendMessage,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [draftText, setDraftText] = useState('');
  const [sending, setSending] = useState(false);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return contacts.filter(
      (c) =>
        c.uid !== currentUser.uid &&
        (!q ||
          (c.displayName || '').toLowerCase().includes(q) ||
          (c.cardLast4 || '').includes(q))
    );
  }, [contacts, currentUser.uid, searchQuery]);

  const activeConv = conversations.find((c) => c.id === selectedConvId) || null;

  const getConvTitle = (conv: Conversation) => {
    if (conv.isAdminSupport) return 'Administration AFRICABANK';
    const idx = conv.participantIds.indexOf(currentUser.uid);
    if (idx === 0) return conv.participantLabels[1] || 'Utilisateur';
    return conv.participantLabels[0] || 'Utilisateur';
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConv || !draftText.trim()) return;
    setSending(true);
    try {
      const otherId =
        activeConv.participantIds.find((id) => id !== currentUser.uid) || 'ADMIN';
      await onSendMessage({
        recipientId: otherId,
        recipientName: getConvTitle(activeConv),
        text: draftText.trim(),
        isAdminSupport: activeConv.isAdminSupport,
      });
      setDraftText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="font-display text-2xl font-bold text-white">Messagerie Privée</h1>
        <p className="text-sm text-slate-400 mt-1">
          Échanges chiffrés et cloisonnés 1-à-1 avec les autres membres ou l’Administration.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[520px]">
        {/* Contacts & Conversations List */}
        <div className="lg:col-span-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 flex flex-col gap-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher par nom ou 4 chiffres..."
              className="w-full min-h-[42px] rounded-xl border border-slate-700 bg-slate-950/70 pl-10 pr-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1 overflow-y-auto max-h-[220px]">
            <p className="text-xs font-medium text-slate-400 px-1 pb-1">Conversations actives</p>
            {conversations.length === 0 ? (
              <p className="text-xs text-slate-500 px-1 py-2">Aucune discussion démarrée.</p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => onSelectConversation(conv.id)}
                  className={`w-full text-left rounded-xl p-3 transition-colors flex items-start gap-3 ${
                    selectedConvId === conv.id
                      ? 'bg-emerald-500/15 border border-emerald-500/30'
                      : 'hover:bg-slate-800/70 border border-transparent'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                    {conv.isAdminSupport ? (
                      <Shield className="w-4 h-4 text-amber-400" />
                    ) : (
                      <User className="w-4 h-4 text-emerald-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">{getConvTitle(conv)}</p>
                    <p className="text-xs text-slate-400 truncate">{conv.lastMessage || 'Nouvelle discussion'}</p>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-slate-800 pt-3 space-y-1 overflow-y-auto max-h-[200px]">
            <p className="text-xs font-medium text-slate-400 px-1 pb-1">Démarrer avec un membre</p>
            {filteredContacts.length === 0 ? (
              <p className="text-xs text-slate-500 px-1">Aucun autre membre trouvé.</p>
            ) : (
              filteredContacts.map((contact) => (
                <button
                  key={contact.uid}
                  type="button"
                  onClick={() => onStartConversation(contact)}
                  className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-slate-800/60 transition-colors flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">{contact.displayName}</p>
                    <p className="text-[11px] text-slate-500 font-mono-tabular">Carte •••• {contact.cardLast4}</p>
                  </div>
                  <MessageSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Active Chat Thread */}
        <div className="lg:col-span-8 rounded-2xl border border-slate-800 bg-slate-900/70 flex flex-col overflow-hidden">
          {!activeConv ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-600" />
              <p className="text-sm font-medium text-slate-300">Sélectionnez ou démarrez une conversation</p>
              <p className="text-xs text-slate-500">Seuls vous et votre interlocuteur pouvez lire ces messages.</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-4 border-b border-slate-800 flex items-center gap-3 bg-slate-950/40">
                {activeConv.isAdminSupport ? (
                  <Shield className="w-5 h-5 text-amber-400" />
                ) : (
                  <User className="w-5 h-5 text-emerald-400" />
                )}
                <div>
                  <p className="text-sm font-semibold text-white">{getConvTitle(activeConv)}</p>
                  <p className="text-xs text-slate-400">
                    {activeConv.isAdminSupport ? 'Canal officiel Administration' : 'Discussion privée 1-à-1'}
                  </p>
                </div>
              </div>

              <div className="flex-1 p-5 space-y-3 overflow-y-auto max-h-[380px]">
                {messages.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">Aucun message pour l’instant.</p>
                ) : (
                  messages.map((msg) => {
                    const isMine = msg.senderId === currentUser.uid;
                    const isFromAdmin = msg.senderId === 'ADMIN';
                    return (
                      <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                        <div
                          className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm space-y-1 ${
                            isMine
                              ? 'bg-emerald-500 text-slate-950 font-medium'
                              : isFromAdmin
                                ? 'bg-amber-500/15 border border-amber-500/30 text-amber-100'
                                : 'bg-slate-800 text-slate-100'
                          }`}
                        >
                          {!isMine && (
                            <p className="text-[11px] font-semibold opacity-80">{msg.senderName}</p>
                          )}
                          <p className="leading-relaxed">{msg.text}</p>
                        </div>
                        <span className="text-[11px] text-slate-500 mt-1 px-1">
                          {formatDateFr(msg.createdAt)}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              <form onSubmit={handleSend} className="p-4 border-t border-slate-800 flex items-center gap-3 bg-slate-950/30">
                <input
                  type="text"
                  maxLength={1000}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Écrivez votre message privé..."
                  className="flex-1 min-h-[44px] rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sending || !draftText.trim()}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-semibold text-sm px-4 transition-colors cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Envoyer</span>
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface ReviewsViewProps {
  currentUser: UserProfile;
  comments: CommentReview[];
  onPostComment: (params: { rating: number; content: string }) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
}

export const ReviewsView: React.FC<ReviewsViewProps> = ({
  currentUser,
  comments,
  onPostComment,
  onDeleteComment,
}) => {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const avgRating = useMemo(() => {
    if (comments.length === 0) return '5.0';
    const sum = comments.reduce((acc, c) => acc + c.rating, 0);
    return (sum / comments.length).toFixed(1);
  }, [comments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim().length < 3) return;
    setSubmitting(true);
    try {
      await onPostComment({ rating, content: content.trim() });
      setContent('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Avis &amp; Commentaires</h1>
          <p className="text-sm text-slate-400 mt-1">
            Partagez votre expérience avec la communauté AFRICABANK Gabon.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
          <span className="font-mono-tabular font-bold text-white text-lg">{avgRating}</span>
          <span className="text-slate-400">/ 5 · {comments.length} avis</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-6 space-y-4 h-fit"
        >
          <h2 className="font-display text-lg font-semibold text-white">Laisser un avis</h2>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Note</label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950/60 hover:border-amber-500/50 transition-colors"
                >
                  <Star
                    className={`w-5 h-5 ${
                      star <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-600'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Votre commentaire</label>
            <textarea
              required
              rows={4}
              maxLength={500}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Rapidité des dépôts Airtel Money, carte virtuelle, support..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
          >
            {submitting ? 'Publication...' : 'Publier mon avis'}
          </button>
        </form>

        <div className="lg:col-span-7 space-y-4">
          {comments.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-8 text-center text-sm text-slate-400">
              Soyez le premier à publier un avis sur AFRICABANK.
            </div>
          ) : (
            comments.map((cmt) => {
              const canDelete = currentUser.role === 'admin' || cmt.userId === currentUser.uid;
              return (
                <div
                  key={cmt.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-white">{cmt.authorName}</span>
                      <span className="text-xs text-slate-500">{formatDateFr(cmt.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`w-3.5 h-3.5 ${
                              i < cmt.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-700'
                            }`}
                          />
                        ))}
                      </div>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => onDeleteComment(cmt.id)}
                          aria-label="Supprimer cet avis"
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{cmt.content}</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
