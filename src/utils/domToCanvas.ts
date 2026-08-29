/**
 * Rasterises an on-screen element for the PDF exports.
 *
 * Shared by the service certificate and the monthly report because they want
 * exactly the same thing, and the same capture written twice is how two
 * documents end up looking different for reasons nobody can find.
 *
 * Two things here are not defaults, and both were paid for:
 *
 * html2canvas-pro rather than html2canvas. The original was last released in
 * 2022 and throws on the oklab() colours Tailwind v4 emits, which meant both
 * exports failed for everyone with "unsupported color function".
 *
 * The onclone hook. html2canvas renders a *copy* of the page inside a detached
 * iframe, and that copy carries a <link> to the stylesheet rather than the
 * stylesheet itself -- so it re-fetches it. When that fetch has not finished by
 * the time the render runs, every element falls back to browser defaults and
 * the certificate comes out as plain unstyled text on an empty page: no border,
 * no layout, no seal. Copying the rules in as an inline <style> removes the
 * fetch, and with it the race. The original <link> elements stay, so the
 * cross-origin webfonts (whose rules cannot be read out of another origin's
 * stylesheet) still load the way they always did.
 */
export async function captureElement(element: HTMLElement): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import('html2canvas-pro');

  return html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#FAF6EE',
    logging: false,
    onclone: (clonedDocument: Document) => {
      const rules: string[] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) rules.push(rule.cssText);
        } catch {
          // A cross-origin sheet (the webfonts) refuses to be read. Its <link>
          // came across with the clone, so leaving it alone is the right answer.
        }
      }
      if (rules.length === 0) return;
      const style = clonedDocument.createElement('style');
      style.textContent = rules.join('\n');
      clonedDocument.head.appendChild(style);
    }
  });
}
