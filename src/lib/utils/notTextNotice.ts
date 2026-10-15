/**
 * The notice that a file is not opened because it is not text. The
 * backend says why in the file's tree entry (`not_text_reason`, in the
 * words every command refuses it with); a backend of contract 2.0 says
 * nothing, and the file is then called binary.
 */
export function notTextNotice(name: string, reason: string | null | undefined): string {
  return reason ? `Cannot open ${name}: ${reason}` : `Cannot open binary file: ${name}`;
}
