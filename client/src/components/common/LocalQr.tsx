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

export const LocalQrScanner: React.FC<{ onScanned: (text: string) => void }> = ({ onScanned }) => {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onScanned); callback.current = onScanned;
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    const hidden = () => { if (document.visibilityState !== 'visible') setScanning(false); };
    document.addEventListener('visibilitychange', hidden);
    void import('@zxing/browser').then(async ({ BrowserQRCodeReader }) => {
      if (cancelled || !video.current) return;
      const controls = await new BrowserQRCodeReader().decodeFromVideoDevice(undefined, video.current, (result) => {
        if (!result || cancelled) return;
        callback.current(result.getText()); setScanning(false);
      });
      if (cancelled) controls.stop(); else stop = () => controls.stop();
    }).catch(() => { if (!cancelled) { setError('Camera unavailable. Choose Compare security code, or use the fallback in Advanced security details.'); setScanning(false); } });
    return () => { cancelled = true; stop?.(); document.removeEventListener('visibilitychange', hidden); };
  }, [scanning]);
  return <div>{scanning ? <><video ref={video} autoPlay muted playsInline aria-label="Verification QR camera preview" /><button type="button" className="btn btn--secondary" onClick={() => setScanning(false)}>Stop camera</button></> : <button className="btn btn--primary" type="button" onClick={() => { setError(''); setScanning(true); }}>Scan their QR</button>}{error && <p role="alert">{error}</p>}</div>;
};
