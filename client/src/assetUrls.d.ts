/** Vite `?url` imports resolve to a same-origin asset URL string (UX A13: the zbar WebAssembly file). */
declare module '*?url' {
  const url: string;
  export default url;
}
