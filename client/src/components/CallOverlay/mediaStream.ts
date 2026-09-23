/** Attach a browser-owned WebRTC stream without copying or retaining its tracks. */
export const attachMediaStream = (element: HTMLMediaElement | null, stream?: MediaStream): void => {
  if (element) element.srcObject = stream ?? null;
};
