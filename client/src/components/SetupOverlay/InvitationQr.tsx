import React, { useEffect, useRef, useState } from 'react';
import { parseInviteInput, parseModernInviteInput } from '../../utils/urlHash';

/** QR is only a visual carrier for the existing invitation; joining still uses the normal parser. */
export const InvitationQr: React.FC<{ invitation: string }> = ({ invitation }) => {
  const [image, setImage] = useState('');
  useEffect(() => {
    let active = true;
    setImage('');
    if (invitation) void import('qrcode').then(({ default: qr }) => qr.toDataURL(invitation, {
      errorCorrectionLevel: 'M', margin: 2, width: 320,
    })).then((url) => { if (active) setImage(url); }).catch(() => setImage(''));
    return () => { active = false; };
  }, [invitation]);
  return image ? <div className="invitation-qr"><img src={image} alt="Private invitation QR code" /><p>Show this only to the person you want to invite. Compare identities separately before trusting the contact.</p></div> : null;
};

export const InvitationQrScanner: React.FC<{ onScanned: (invitation: string) => void }> = ({ onScanned }) => {
  const video = useRef<HTMLVideoElement>(null);
  const onScannedRef = useRef(onScanned);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { onScannedRef.current = onScanned; }, [onScanned]);
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    void import('@zxing/browser').then(async ({ BrowserQRCodeReader }) => {
      if (!video.current || cancelled) return;
      const controls = await new BrowserQRCodeReader().decodeFromVideoDevice(undefined, video.current, (result) => {
        if (!result || cancelled) return;
        const value = result.getText();
        if (!parseModernInviteInput(value) && !parseInviteInput(value)) {
          setError('This QR code is not a valid K3NCRYPT invitation.');
          return;
        }
        stop?.();
        setScanning(false);
        onScannedRef.current(value);
      });
      if (cancelled) controls.stop(); else stop = () => controls.stop();
    }).catch(() => { if (!cancelled) { setError('Camera unavailable. Paste the invitation instead.'); setScanning(false); } });
    return () => { cancelled = true; stop?.(); };
  }, [scanning]);
  return <div className="invitation-scanner">
    {!scanning ? <button type="button" className="btn btn--secondary" onClick={() => { setError(''); setScanning(true); }}>Scan invitation QR</button> : <>
      <video ref={video} muted playsInline autoPlay aria-label="Invitation QR camera preview" />
      <button type="button" className="btn btn--secondary" onClick={() => setScanning(false)}>Stop camera</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
};
