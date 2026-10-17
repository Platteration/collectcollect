/** Every icon file, by its path under an app's `public/`, as the bytes to write there. */
export function renderIconFiles(svg: Uint8Array, ground: string): Promise<Record<string, Buffer>>;
export function writeIcons(options: { svgPath: string; ground: string; publicDir: string }): Promise<void>;
