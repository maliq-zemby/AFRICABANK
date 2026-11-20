import React, { useState } from 'react';
import { Check, Copy, Eye, EyeOff, Wifi } from 'lucide-react';
import { formatCardNumber, formatFCFA } from '../lib/formatters';
import type { UserProfile } from '../types';

interface VirtualCardProps {
  user: UserProfile;
}

export const VirtualCard: React.FC<VirtualCardProps> = ({ user }) => {
  const [revealSensitive, setRevealSensitive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(user.cardNumber);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silencieux si clipboard indisponible
    }
  };

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
            onClick={() => setRevealSensitive((prev) => !prev)}
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-[#1E3A63] bg-[#050B18]/80 hover:bg-[#050B18] px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {revealSensitive ? <EyeOff className="w-4 h-4 text-amber-400" /> : <Eye className="w-4 h-4 text-blue-400" />}
            <span>{revealSensitive ? 'Masquer' : 'Afficher'}</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-blue-400/40 bg-blue-500/15 hover:bg-blue-500/25 px-3.5 py-2 text-xs font-medium text-blue-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copié' : 'Copier le numéro'}</span>
          </button>
        </div>
      </div>

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
                  AFRICABANK — Carte Virtuelle XAF
                </p>
                <p className="text-[10px] text-amber-300/90 font-medium">Réseau Visa / XAF Gabon</p>
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
            <p className="text-[11px] text-slate-400 mb-1">Numéro de carte</p>
            <p className="font-mono-tabular text-lg sm:text-xl font-semibold tracking-wider text-white">
              {formatCardNumber(user.cardNumber, revealSensitive)}
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
                  {revealSensitive ? user.cardExpiry : '••/••'}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400">CVV</p>
                <p className="font-mono-tabular text-sm font-semibold text-amber-300">
                  {revealSensitive ? user.cardCvv : '•••'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
