import { randomInt } from 'crypto';
import QRCode from 'qrcode';
// The pixel renderer qrcode's browser canvas output uses (LocalQrImage → toDataURL), without PNG encoding.
const renderer = require('qrcode/lib/renderer/utils') as { getOptions(o: object): object; getImageWidth(size: number, o: object): number; qrToImageData(data: Uint8ClampedArray, qr: unknown, o: object): void };
import { createQrDecoder, type RgbaFrame } from './qrDecoder';

// UX A13. The previous decoder (@zxing/library 0.21.3) failed on 5–12% of valid codes for this payload.
// Done = every generated identity's code, rendered exactly as the app renders it, decodes.
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const fingerprint = (): string => 'K3 ' + Array.from({ length: 11 }, (_, group) =>
  Array.from({ length: group === 10 ? 3 : 4 }, () => alphabet[randomInt(alphabet.length)]).join('')).join(' ');
const render = async (text: string): Promise<RgbaFrame> => {
  // Same options as LocalQrImage: error correction M, 280 px, margin 2.
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' }); const options = renderer.getOptions({ width: 280, margin: 2 });
  const size = renderer.getImageWidth(qr.modules.size, options); const data = new Uint8ClampedArray(size * size * 4);
  renderer.qrToImageData(data, qr, options);
  return { data, width: size, height: size };
};

it('decodes 1,000 generated verification codes without a miss', async () => {
  const decoder = await createQrDecoder({});
  let misses = 0;
  for (let i = 0; i < 1000; i++) {
    const text = JSON.stringify({ version: 1, algorithm: 'vodozemac', fingerprint: fingerprint() });
    if (await decoder.decode(await render(text)) !== text) misses++;
  }
  expect(misses).toBe(0);
}, 180_000);

it('prefers the built-in BarcodeDetector and falls back to zbar when it reads nothing', async () => {
  const frame = await render('{"version":1,"algorithm":"vodozemac","fingerprint":"K3 HQIO A1J9 DNVI TEHH JHLB EA8F S3_9 HP6_ GVJM OUBY NLG"}');
  const native = { detect: jest.fn(async () => [{ rawValue: 'from-native' }]) };
  const Detector = Object.assign(jest.fn(() => native), { getSupportedFormats: async () => ['qr_code'] });
  expect(await (await createQrDecoder({ BarcodeDetector: Detector })).decode(frame)).toBe('from-native');
  native.detect.mockResolvedValueOnce([]);
  expect(await (await createQrDecoder({ BarcodeDetector: Detector })).decode(frame)).toContain('"algorithm":"vodozemac"');
});

it('skips a BarcodeDetector that cannot read QR codes', async () => {
  const Detector = Object.assign(jest.fn(), { getSupportedFormats: async () => ['ean_13'] });
  const decoder = await createQrDecoder({ BarcodeDetector: Detector });
  expect(Detector).not.toHaveBeenCalled();
  expect(decoder.kind).toBe('zbar');
});
