import React from 'react';
import { Bell, Check, Landmark, Megaphone, ShieldAlert, ArrowLeftRight } from 'lucide-react';
import { formatDateFr } from '../lib/formatters';
import type { NotificationItem } from '../types';

interface NotificationsViewProps {
  notifications: NotificationItem[];
  onMarkRead: (notifId: string) => Promise<void>;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  notifications,
  onMarkRead,
}) => {
  const getIcon = (cat: NotificationItem['category']) => {
    switch (cat) {
      case 'loan':
        return <Landmark className="w-5 h-5 text-amber-400" />;
      case 'broadcast':
        return <Megaphone className="w-5 h-5 text-sky-400" />;
      case 'security':
      case 'admin':
        return <ShieldAlert className="w-5 h-5 text-amber-400" />;
      default:
        return <ArrowLeftRight className="w-5 h-5 text-emerald-400" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">Notifications privées</h1>
          <p className="text-sm text-slate-400 mt-1">
            Alertes strictement personnelles : transactions, prêts et messages administratifs.
          </p>
        </div>
        <span className="text-xs text-slate-400 font-mono-tabular">
          {notifications.filter((n) => !n.read).length} non lue(s)
        </span>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-10 text-center space-y-2">
          <Bell className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-400">Aucune notification pour le moment.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/80 rounded-2xl border border-slate-800 bg-slate-900/70 overflow-hidden">
          {notifications.map((notif) => (
            <div
              key={notif.id}
              className={`p-5 flex items-start justify-between gap-4 transition-colors ${
                notif.read ? 'opacity-75' : 'bg-emerald-500/[0.04]'
              }`}
            >
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-center shrink-0">
                  {getIcon(notif.category)}
                </div>
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{notif.title}</h3>
                    {!notif.read && (
                      <span className="text-[11px] font-semibold text-emerald-400">· Nouveau</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{notif.message}</p>
                  <p className="text-xs text-slate-500">{formatDateFr(notif.createdAt)}</p>
                </div>
              </div>

              {!notif.read && (
                <button
                  type="button"
                  onClick={() => onMarkRead(notif.id)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-700 hover:border-emerald-500/40 px-3 py-1.5 text-xs text-slate-300 hover:text-emerald-300 transition-colors whitespace-nowrap shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Lu</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
