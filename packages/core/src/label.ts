/**
 * The one way to render an entry's client/project as a label (PRD §03, §12). Shared
 * so every surface agrees: "Client / Project" when both are set, otherwise whichever
 * one exists, or null when neither does. Each surface decides its own placeholder for
 * the null case (the CLI shows "—"; the GUI shows nothing).
 */
export function joinClientProject(
  clientName: string | null,
  projectName: string | null,
): string | null {
  if (clientName && projectName) return `${clientName} / ${projectName}`;
  return clientName ?? projectName ?? null;
}
