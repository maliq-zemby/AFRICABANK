import React, { useState } from 'react';
import { Download, RefreshCw, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 text-blue-200 font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer ${
          compact ? 'px-3 py-1.5 text-xs' : 'w-full px-4 py-2.5 text-sm'
        }`}
      >
        <Download className="w-4 h-4 shrink-0 text-amber-400" />
        <span>Installer AFRICABANK</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-[#1E3A63] bg-[#0F1D36]/80 hover:border-blue-400/50 text-slate-200 font-medium transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer ${
          compact ? 'px-3 py-1.5 text-xs' : 'w-full px-4 py-2.5 text-sm'
        }`}
      >
        {isIOS ? (
          <Share className="w-4 h-4 shrink-0 text-amber-400" />
        ) : (
          <Smartphone className="w-4 h-4 shrink-0 text-blue-400" />
        )}
        <span>Installer l’app</span>
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#1E3A63] bg-[#0F1D36] p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img
                  src="/logo-africabank.png"
                  alt="Logo AFRICABANK"
                  className="w-8 h-8 rounded-lg object-cover bg-[#050B18]"
                />
                <h3 className="text-base font-semibold text-white">Installer AFRICABANK</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Fermer"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-[#050B18]/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="rounded-xl border border-[#1E3A63] bg-[#050B18]/70 p-3.5 space-y-1">
                <p className="font-semibold text-blue-300">Sur Android (Chrome / Edge)</p>
                <p>Ouvrez le menu du navigateur (⋮) puis sélectionnez <strong>Installer l’application</strong>.</p>
              </div>
              <div className="rounded-xl border border-[#1E3A63] bg-[#050B18]/70 p-3.5 space-y-1">
                <p className="font-semibold text-amber-300">Sur iPhone / iPad (iOS Safari)</p>
                <p>Appuyez sur <strong>Partager</strong> dans la barre Safari puis sur <strong>Sur l’écran d’accueil</strong>.</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-sm transition-colors"
            >
              Compris
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const PWAInstallReminder: React.FC = () => {
  const { isInstalled, isInstallable, install } = usePWAInstall();
  if (isInstalled) return null;

  return (
    <div className="rounded-2xl border border-[#1E3A63] bg-[#0F1D36]/75 p-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <img
          src="/logo-africabank.png"
          alt="Logo AFRICABANK"
          className="w-10 h-10 rounded-xl object-cover bg-[#050B18] shrink-0"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">Installer AFRICABANK sur votre téléphone</p>
          <p className="text-[11px] text-slate-300 leading-snug mt-0.5">
            Android : bouton <strong>Installer l’application</strong> (menu ⋮) · iOS Safari :{' '}
            <strong>Partager → Sur l’écran d’accueil</strong>.
          </p>
        </div>
      </div>
      {isInstallable && (
        <button
          type="button"
          onClick={install}
          className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold px-3.5 py-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Installer</span>
        </button>
      )}
    </div>
  );
};

export const OfflineBlockingScreen: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-[#050B18] text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-3xl border border-[#1E3A63] bg-[#0F1D36]/90 p-8 text-center space-y-6 shadow-2xl">
        <div className="flex justify-center">
          <img
            src="/logo-africabank.png"
            alt="Logo AFRICABANK"
            className="w-24 h-24 rounded-2xl object-cover bg-[#050B18] border border-[#1E3A63]"
          />
        </div>

        <div className="w-14 h-14 rounded-2xl bg-blue-500/15 border border-blue-400/30 text-blue-300 flex items-center justify-center mx-auto">
          <WifiOff className="w-7 h-7" />
        </div>

        <div className="space-y-2">
          <h2 className="font-display text-2xl font-bold text-white">Connexion Internet requise</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            <strong>AFRICABANK</strong> exige une connexion Internet active pour sécuriser vos opérations financières et synchroniser votre carte virtuelle en temps réel.
          </p>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-sm transition-colors px-4 py-3 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Vérifier la connexion</span>
        </button>
      </div>
    </div>
  );
};
