type LogFields = Record<string, string | number | boolean | undefined>;

const redact = (fields: LogFields): LogFields => Object.fromEntries(
  Object.entries(fields).filter(([key, value]) => value !== undefined && !/(message|cipher|key|secret|token|capability|proof|authorization|identity)/i.test(key)),
);

/** Structured operational log boundary. Never pass request bodies, envelopes, credentials, or key material here. */
export const operationalLog = (level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}): void => {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...redact(fields) });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
};
