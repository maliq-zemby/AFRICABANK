import React from 'react';
import { Ban, LogOut, ShieldAlert } from 'lucide-react';

interface BannedScreenProps {
  banReason: string;
  onSignOut: () => void;
}

export const BannedScreen: React.FC<BannedScreenProps> = ({
  banReason,
  onSignOut,
}) => {
  return (
    <div className="min-h-screen bg-[#1A0509] text-red-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full rounded-3xl border border-red-500/40 bg-red-950/60 backdrop-blur-xl p-8 space-y-6 shadow-2xl text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/40 text-red-400 flex items-center justify-center mx-auto">
          <Ban className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Vous avez été banni
          </h1>
          <p className="text-sm text-red-200/80">
            L’accès à votre compte AFRICABANK et à votre carte virtuelle a été suspendu par l’administration.
          </p>
        </div>

        <div className="rounded-2xl border border-red-500/30 bg-black/35 p-4 text-left space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-red-300">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Motif enregistré par l’administrateur</span>
          </div>
          <p className="text-sm text-white leading-relaxed">
            {banReason || 'Non-respect des conditions générales d’utilisation.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={onSignOut}
            className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/40 bg-red-900/40 hover:bg-red-900/70 text-white font-medium text-sm transition-colors px-4 py-2.5 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Se déconnecter</span>
          </button>
        </div>
      </div>
    </div>
  );
};
