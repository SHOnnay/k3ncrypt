import { useQrCameraScan } from '../../media/useQrCameraScan';
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
  return image ? <div className="invitation-qr"><img src={image} alt="Private invitation QR code" /><p>Show this only to the person you want to invite. After they join, check it’s really them before sharing files.</p></div> : null;
};

export const InvitationQrScanner: React.FC<{ onScanned: (invitation: string) => void }> = ({ onScanned }) => {
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  // UX A13: same decoder as the check scanner (built-in detector, then zbar); keeps scanning past codes that aren't invitations.
  const { timedOut } = useQrCameraScan({ active: scanning, video,
    onText: (value) => {
      if (!parseModernInviteInput(value) && !parseInviteInput(value)) { setError('This QR code is not a valid K3NCRYPT invitation.'); return 'continue'; }
      setError(''); setScanning(false); onScanned(value); return undefined;
    },
    onError: () => { setError('Camera unavailable. Paste the invitation instead.'); setScanning(false); } });
  return <div className="invitation-scanner">
    {!scanning ? <button type="button" className="btn btn--secondary" onClick={() => { setError(''); setScanning(true); }}>Scan invitation QR</button> : <>
      <video ref={video} muted playsInline autoPlay aria-label="Invitation QR camera preview" />
      <button type="button" className="btn btn--secondary" onClick={() => setScanning(false)}>Stop camera</button>
      {timedOut && <p className="scan-fallback" role="status">Can’t read the code? Paste the invitation instead.</p>}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
};
