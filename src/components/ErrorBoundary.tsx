import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected interface error occurred.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8 space-y-4">
            <h1 className="text-xl font-bold text-slate-900">Something interrupted the session</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Your active queue token remains safely stored on the server. Reload the page to reconnect cleanly.
            </p>
            <div className="p-3 bg-slate-100 rounded-lg text-xs font-mono-tabular text-slate-700 break-words">
              {this.state.message}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors"
            >
              Reload Queueless
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
