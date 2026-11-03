/**
 * UX A13: QR decoding for the check and invitation scanners. The browser's built-in BarcodeDetector is used
 * when it supports QR codes; zbar (WebAssembly, loaded as a separate same-origin file) reads anything the
 * built-in detector does not, and is the only decoder where BarcodeDetector is missing. No CDN is used.
 */
export interface RgbaFrame { data: Uint8ClampedArray; width: number; height: number; }
export interface QrDecoder { kind: 'native' | 'zbar'; decode(frame: RgbaFrame): Promise<string | undefined>; }

interface NativeDetector { detect(source: unknown): Promise<{ rawValue: string }[]>; }
interface NativeDetectorClass { new (options: { formats: string[] }): NativeDetector; getSupportedFormats?(): Promise<string[]>; }
export interface QrDecoderEnvironment { BarcodeDetector?: unknown; ImageData?: unknown; zbarWasmUrl?: string; }

type ZbarModule = typeof import('@undecaf/zbar-wasm');
let zbarModule: Promise<ZbarModule> | undefined;
const loadZbar = (wasmUrl?: string): Promise<ZbarModule> => zbarModule ??= import('@undecaf/zbar-wasm').then((zbar) => {
  if (wasmUrl) zbar.setModuleArgs({ locateFile: (file: string) => (file.endsWith('.wasm') ? wasmUrl : file) });
  return zbar;
});

const zbarDecode = async (zbar: ZbarModule, frame: RgbaFrame): Promise<string | undefined> => {
  const symbols = await zbar.scanRGBABuffer(frame.data.buffer as ArrayBuffer, frame.width, frame.height);
  return symbols.find((symbol) => symbol.typeName === 'ZBAR_QRCODE')?.decode();
};

const nativeDetector = async (environment: QrDecoderEnvironment): Promise<NativeDetector | undefined> => {
  const Detector = environment.BarcodeDetector as NativeDetectorClass | undefined;
  if (typeof Detector !== 'function') return undefined;
  try {
    const formats = await Detector.getSupportedFormats?.();
    return formats?.includes('qr_code') ? new Detector({ formats: ['qr_code'] }) : undefined;
  } catch { return undefined; }
};

export const createQrDecoder = async (environment: QrDecoderEnvironment = globalThis as QrDecoderEnvironment): Promise<QrDecoder> => {
  const native = await nativeDetector(environment);
  const zbar = await loadZbar(environment.zbarWasmUrl);
  return {
    kind: native ? 'native' : 'zbar',
    decode: async (frame) => {
      if (native) {
        const ImageDataClass = environment.ImageData as (new (data: Uint8ClampedArray, width: number, height: number) => unknown) | undefined;
        const source = ImageDataClass ? new ImageDataClass(frame.data, frame.width, frame.height) : frame;
        const found = await native.detect(source).catch(() => []);
        if (found[0]?.rawValue) return found[0].rawValue;
      }
      return zbarDecode(zbar, frame);
    },
  };
};
