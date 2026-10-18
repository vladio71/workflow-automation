'use client';

import { useState, useTransition } from 'react';
import { checkGeminiNow } from '@/app/actions';
import type { ModelCheck } from '@/lib/gemini';
import { modelLabel } from '@/lib/ai-labels';

/** "Check Gemini" button: one tiny request per model in the list, with status and time next to each. */
export function GeminiCheck() {
  const [results, setResults] = useState<ModelCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();

  function check() {
    setError(null);
    startChecking(async () => {
      const response = await checkGeminiNow();
      if (response.ok) setResults(response.results);
      else setError(response.error);
    });
  }

  return (
    <div>
      <button type="button" className="btn sm" onClick={check} disabled={checking}>
        {checking ? 'Перевіряю…' : '🔌 Перевірити Gemini'}
      </button>
      {error && <p className="ai-failure">⚠️ {error}</p>}
      {results && (
        <table className="db" style={{ marginTop: 8 }} data-testid="gemini-check">
          <tbody>
            {results.map((result) => (
              <tr key={result.model}>
                <td style={{ width: 160 }}>{modelLabel(result.model)}</td>
                <td style={{ width: 110 }}><span className={`tag ${result.outcome === 'ok' ? 'green' : 'red'}`}>{result.outcome === 'ok' ? 'працює' : 'не працює'}</span></td>
                <td className="muted">{result.outcome === 'ok' ? '' : result.detail}</td>
                <td className="faint mono" style={{ width: 70, textAlign: 'right' }}>{(result.ms / 1000).toFixed(1)} с</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
