/** Vite serves files outside its root at /@fs/<absolute path>. On Windows the path starts with a drive letter and uses backslashes. */
export const fsUrl = (absolutePath: string): string => {
  const forward = absolutePath.replace(/\\/g, '/');
  return `/@fs${forward.startsWith('/') ? '' : '/'}${forward}`;
};
