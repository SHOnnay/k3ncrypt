import React from 'react';
import type { SafeDiagnosticCode } from '../../product/safeDiagnostics';

export const SafeDiagnosticDetails: React.FC<{ code?: SafeDiagnosticCode }> = ({ code }) => code ? (
  <details className="safe-diagnostic-details">
    <summary>Technical details</summary>
    <code>Diagnostic code: {code}</code>
  </details>
) : null;
