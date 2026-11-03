import { useQrCameraScan } from '../../media/useQrCameraScan';
import React, { useEffect, useRef, useState } from 'react';

export const LocalQrImage: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [image, setImage] = useState('');
  useEffect(() => {
    let active = true;
    void import('qrcode').then(({ default: qr }) => qr.toDataURL(value, { errorCorrectionLevel: 'M', width: 280, margin: 2 }))
      .then((url) => { if (active) setImage(url); }).catch(() => setImage(''));
    return () => { active = false; };
  }, [value]);
  return image ? <img src={image} alt={label} width={280} height={280} /> : null;
};

/** UX A13: camera scanner for check codes. After 15 s without a read it suggests the number comparison instead. */
export const LocalQrScanner: React.FC<{ onScanned: (text: string) => void; startLabel?: string; onFallback?: () => void; fallbackLabel?: string }> = ({ onScanned, startLabel = 'Scan their QR', onFallback, fallbackLabel = 'Show numbers instead' }) => {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const { timedOut } = useQrCameraScan({ active: scanning, video,
    onText: (text) => { setScanning(false); onScanned(text); },
    onError: () => { setError('Camera unavailable. Choose “Show numbers instead”.'); setScanning(false); } });
  useEffect(() => {
    if (!scanning) return undefined;
    const hidden = () => { if (document.visibilityState !== 'visible') setScanning(false); };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [scanning]);
  return <div>{scanning ? <><video ref={video} autoPlay muted playsInline aria-label="Camera preview for scanning their code" /><button type="button" className="btn btn--secondary" onClick={() => setScanning(false)}>Stop camera</button>
    {timedOut && <p className="scan-fallback" role="status">Can’t read the code? {onFallback ? <button type="button" className="btn btn--link" onClick={() => { setScanning(false); onFallback(); }}>{fallbackLabel}</button> : 'Hold it steady, closer and in good light.'}</p>}</>
    : <button className="btn btn--primary" type="button" onClick={() => { setError(''); setScanning(true); }}>{startLabel}</button>}{error && <p role="alert">{error}</p>}</div>;
};
