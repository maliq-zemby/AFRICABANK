import React, { useState } from 'react';
import { ArrowRight, CheckSquare, CreditCard, Lock, ShieldCheck, Smartphone, Square } from 'lucide-react';
import { PWAInstallButton, PWAInstallReminder } from './PWAComponents';

interface AuthScreenProps {
  onGoogleLogin: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  onGoogleLogin,
  loading,
  error,
}) => {
  return (
    <div className="min-h-screen bg-[#050B18] text-slate-100 flex flex-col justify-between p-6 lg:p-12">
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img
            src="/logo-africabank.png"
            alt="Logo AFRICABANK"
            className="w-10 h-10 rounded-xl object-cover bg-[#050B18] border border-[#1E3A63] shrink-0"
          />
          <span className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0">
            AFRICA<span className="text-amber-400">BANK</span>
          </span>
        </div>
        <PWAInstallButton compact />
      </header>

      <main className="max-w-6xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center my-auto py-8">
        <div className="lg:col-span-7 space-y-6">
          <p className="text-sm font-medium text-blue-300">
            Néobanque Mobile-First · Libreville &amp; Port-Gentil · Devise FCFA (XAF)
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-bold text-white tracking-tight leading-[1.12] text-balance">
            Votre carte bancaire virtuelle instantanée connectée à Airtel &amp; Moov Money.
          </h1>
          <p className="text-base text-slate-300 max-w-xl leading-relaxed">
            Rechargez en quelques secondes, réglez vos achats internationaux en ligne, transférez vers vos proches et débloquez des micro-prêts grâce à votre fidélité sur AFRICABANK.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[#1E3A63]/60">
            <div className="space-y-1 pt-3">
              <CreditCard className="w-5 h-5 text-blue-400" />
              <p className="text-sm font-semibold text-white">Carte VISA XAF</p>
              <p className="text-xs text-slate-400">Activée via émetteur partenaire sécurisé</p>
            </div>
            <div className="space-y-1 pt-3">
              <Smartphone className="w-5 h-5 text-amber-400" />
              <p className="text-sm font-semibold text-white">Mobile Money 07/06</p>
              <p className="text-xs text-slate-400">Dépôts et retraits Airtel &amp; Moov</p>
            </div>
            <div className="space-y-1 pt-3">
              <ShieldCheck className="w-5 h-5 text-slate-200" />
              <p className="text-sm font-semibold text-white">Tarification claire</p>
              <p className="text-xs text-slate-400">Commission transparente de 2%</p>
            </div>
          </div>

          <PWAInstallReminder />
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-3xl border border-[#1E3A63] bg-[#0F1D36]/90 backdrop-blur-xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex flex-col items-center text-center space-y-3">
              <img
                src="/logo-africabank.png"
                alt="Logo AFRICABANK"
                className="w-24 h-24 rounded-2xl object-cover bg-[#050B18] border border-[#1E3A63]"
              />
              <div className="space-y-1">
                <h2 className="font-display text-xl font-bold text-white">Accéder à AFRICABANK</h2>
                <p className="text-sm text-slate-300">
                  Connexion sécurisée obligatoire via votre compte Google.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-200">
                {error}
              </div>
            )}

            <button
              type="button"
              disabled={loading}
              onClick={onGoogleLogin}
              className="w-full min-h-[48px] flex items-center justify-center gap-3 rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-60 text-white font-semibold text-sm transition-colors px-4 py-3 cursor-pointer"
            >
              <Lock className="w-4 h-4" />
              <span>{loading ? 'Connexion en cours...' : 'Continuer avec Google'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <p className="text-xs text-slate-400 text-center">
              Réservé aux personnes majeures (18 ans et plus) · Connexion Internet active requise.
            </p>
          </div>
        </div>
      </main>

      <footer className="max-w-6xl w-full mx-auto text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2 pt-4 border-t border-[#1E3A63]/50">
        <span>AFRICABANK Gabon · FCFA (XAF)</span>
        <span>Chiffrement Firebase &amp; Contrôle d’accès strict</span>
      </footer>
    </div>
  );
};

interface OnboardingFormProps {
  email: string;
  defaultDisplayName: string;
  onSubmit: (data: { firstName: string; lastName: string; age: number; acceptedTerms: boolean }) => Promise<void>;
  onSignOut: () => void;
  loading: boolean;
}

export const OnboardingForm: React.FC<OnboardingFormProps> = ({
  email,
  defaultDisplayName,
  onSubmit,
  onSignOut,
  loading,
}) => {
  const parts = defaultDisplayName.trim().split(' ');
  const [firstName, setFirstName] = useState(parts[0] || '');
  const [lastName, setLastName] = useState(parts.slice(1).join(' ') || '');
  const [age, setAge] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsedAge = Number(age);
    if (!firstName.trim() || !lastName.trim()) {
      setError('Veuillez renseigner votre nom et votre prénom.');
      return;
    }
    if (!Number.isInteger(parsedAge) || parsedAge < 18) {
      setError('Vous devez avoir au moins 18 ans pour ouvrir un compte AFRICABANK.');
      return;
    }
    if (!acceptedTerms) {
      setError('Vous devez accepter les conditions générales d’utilisation.');
      return;
    }
    try {
      await onSubmit({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        age: parsedAge,
        acceptedTerms,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création du profil.');
    }
  };

  return (
    <div className="min-h-screen bg-[#050B18] text-slate-100 flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-md w-full rounded-3xl border border-[#1E3A63] bg-[#0F1D36]/95 p-6 sm:p-8 space-y-6 shadow-2xl">
        <div className="flex flex-col items-center text-center space-y-3">
          <img
            src="/logo-africabank.png"
            alt="Logo AFRICABANK"
            className="w-20 h-20 rounded-2xl object-cover bg-[#050B18] border border-[#1E3A63]"
          />
          <div className="space-y-1">
            <p className="text-xs font-medium text-blue-300">Inscription AFRICABANK</p>
            <h1 className="font-display text-2xl font-bold text-white">Créer votre carte virtuelle</h1>
            <p className="text-xs text-slate-400">Compte Google connecté : {email}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Prénom</label>
              <input
                type="text"
                required
                maxLength={60}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ex: Marc"
                className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white focus:border-blue-400 focus:outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Nom</label>
              <input
                type="text"
                required
                maxLength={60}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Ex: Ndong"
                className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white focus:border-blue-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-300">Âge (minimum 18 ans)</label>
            <input
              type="number"
              required
              min={18}
              max={120}
              placeholder="Ex: 24"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-[#1E3A63] bg-[#050B18]/80 px-3.5 py-2.5 text-sm text-white font-mono-tabular focus:border-blue-400 focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => setAcceptedTerms((v) => !v)}
            className="w-full flex items-start gap-3 text-left rounded-xl border border-[#1E3A63] bg-[#050B18]/60 p-3.5 hover:border-blue-400/50 transition-colors"
          >
            {acceptedTerms ? (
              <CheckSquare className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            ) : (
              <Square className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
            )}
            <span className="text-xs text-slate-300 leading-relaxed">
              J’accepte les conditions générales d’utilisation et la politique de commission de 2% sur les opérations AFRICABANK.
            </span>
          </button>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full min-h-[48px] rounded-xl bg-blue-500 hover:bg-blue-400 disabled:opacity-60 text-white font-semibold text-sm transition-colors px-4 py-3 cursor-pointer"
          >
            {loading ? 'Création du compte...' : 'Activer mon compte AFRICABANK'}
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="w-full min-h-[40px] text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Changer de compte Google
          </button>
        </form>
      </div>
    </div>
  );
};
