import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeDiagnosticDetails } from './SafeDiagnosticDetails';

describe('safe diagnostic disclosure', () => {
  it('renders only the bounded code in an optional collapsed disclosure', () => {
    const markup = renderToStaticMarkup(React.createElement(SafeDiagnosticDetails, { code: 'PINNED_IDENTITY_CHANGED' }));
    expect(markup).toContain('<details');
    expect(markup).toContain('<summary>Technical details</summary>');
    expect(markup).toContain('Diagnostic code: PINNED_IDENTITY_CHANGED');
    expect(markup).not.toContain('fingerprint');
  });

  it('renders no disclosure in the ordinary-success or unclassified state', () => {
    expect(renderToStaticMarkup(React.createElement(SafeDiagnosticDetails, {}))).toBe('');
  });
});
