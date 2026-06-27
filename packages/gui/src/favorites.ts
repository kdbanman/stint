/**
 * The GUI's favorites plumbing (PRD §05 R09, §12 R14) — Electron-free so it is unit-testable
 * without a main process, mirroring start.ts/reportview.ts. All favorite LOGIC lives in
 * @stint/core (store.pinFavorite/listFavorites/renameFavorite/unpinFavorite); these are the
 * two pure pieces the IPC handlers wrap: turn the renderer's payload into a core template
 * (resolving client/project names through core's single rule, exactly as the Start form does),
 * and project a core Favorite to the renderer-safe view shape (no core import in the page).
 */
import type { Store, Favorite, FavoriteTemplate } from '@stint/core';
import type { FavoriteView, FavoriteInputView } from './ipc.js';

/** Core Favorite → the renderer-safe projection the favorites rail paints. */
export function favoriteToView(fav: Favorite): FavoriteView {
  return {
    id: fav.id,
    name: fav.name,
    description: fav.description,
    clientId: fav.clientId,
    projectId: fav.projectId,
    billable: fav.billable,
    tags: fav.tags,
  };
}

/**
 * Pin a favorite from the renderer's payload (PRD §05 R09). A source entry (the running
 * entry or a closed entry's id) takes precedence — core captures its template; otherwise the
 * explicit attributes are used, with client/project names resolved through core's single rule
 * (one resolution per surface, exactly like the Start form), so neither surface drops an
 * attribute. Returns the renderer-safe view of the created favorite.
 */
export function pinFavorite(store: Store, p: FavoriteInputView): FavoriteView {
  const template: FavoriteTemplate = { name: p.name };
  if (p.fromEntryId !== undefined) {
    template.fromEntryId = p.fromEntryId;
  } else {
    const { clientId, projectId } = store.resolveClientProjectByName({
      client: p.client,
      project: p.project,
    });
    template.description = p.description ?? null;
    template.clientId = clientId;
    template.projectId = projectId;
    template.tags = p.tags ?? [];
    // Tri-state billable: only forward it when the form set it, so an omitted value falls
    // through to core's default (billable iff a client is present), like the Start form.
    if (p.billable !== undefined) template.billable = p.billable;
  }
  return favoriteToView(store.pinFavorite(template));
}

/** List favorites in the renderer-safe shape (PRD §05 R09). A read — no refresh. */
export function listFavorites(store: Store): FavoriteView[] {
  return store.listFavorites().map(favoriteToView);
}
