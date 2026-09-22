/**
 * Saves a generated file to the user's machine.
 *
 * A plain `<a download>` covers normal hosting. Some embedded hosts (the
 * claude.ai artifact viewer, for one) sandbox downloads away, but offer a
 * `claude.use("downloads")` bridge instead; we use it when it's there so the
 * app still works when embedded, and fall back otherwise.
 */

interface DownloadsNamespace {
  save(request: { filename: string; data: Blob }): Promise<{ status: string }>;
}

interface ClaudeHost {
  use?(name: string): Promise<DownloadsNamespace | null>;
}

/** Host-side rejections that mean "no file was saved, and that's fine". */
const SILENT_CODES = new Set(['declined']);

export async function saveFile(blob: Blob, filename: string): Promise<void> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const downloads = await host.use('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code && SILENT_CODES.has(code)) return;
        const message = (err as { message?: string } | null)?.message;
        throw new Error(message || `Could not save ${filename}.`);
      }
      return;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
