import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let readable = error.message || 'Une erreur inattendue est survenue.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && parsed.error) {
        readable = `Erreur Firestore (${parsed.operationType} sur ${parsed.path || 'collection'}) : ${parsed.error}`;
      }
    } catch {
      // Message texte standard
    }
    return { hasError: true, message: readable };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#050B18] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-[#0F1D36] p-8 text-center space-y-5 shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-white">Interruption de sécurité</h2>
              <p className="text-sm text-slate-300 leading-relaxed">{this.state.message}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-sm transition-colors px-4 py-2.5 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              Recharger l’application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
