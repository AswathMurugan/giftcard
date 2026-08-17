/**
 * Schema builder.
 *
 * The agent generates one `<Page>.schema.ts` per page DECLARING each
 * customizable component name + type, e.g.:
 *
 *   // First arg is the page's URL slug (route path w/o '/'), e.g. 'clients'
 *   // for route '/clients' — same name used for register_screen + preferences.
 *   export const CLIENT_LIST = buildSchema('clients', {
 *     newClientBtn: 'button',
 *     searchInput:  'input',
 *     adminOnlyBtn: { type: 'button', permission: true },  // access-controlled
 *   });
 *
 * `buildSchema` stamps each entry with its full address id (`<Page>.<name>`)
 * so the call site references a typed node on the primitive's `config` prop:
 *
 *   <Button config={CLIENT_LIST.newClientBtn}>New</Button>
 *
 * Because the id is COMPUTED (never hand-typed), a component can't drift out
 * of sync with its address — and a wrong reference is a compile error.
 *
 * A slot value may be either:
 *   - a bare `ComponentType` (e.g. `'button'`) — not permission-gated, or
 *   - `{ type, permission?: boolean }` — `permission: true` makes the
 *     component access-controlled (hidden unless the current user has a
 *     `screen_component` permission for it). See `useComponentPermissions`.
 */
import type { ComponentType, Slot, SlotDecl, SlotDeclType } from './types';

/**
 * The resolved schema type: each key keeps its declared literal type, so
 * `usePageText` can statically restrict to the `'text'` keys and `config`
 * call sites stay precise.
 */
export type BuiltSchema<S extends Record<string, SlotDecl>> = {
  [K in keyof S]: Slot<SlotDeclType<S[K]> & ComponentType>;
};

/**
 * Build a per-page schema from a `{ name: SlotDecl }` declaration.
 *
 * Each slot PRESERVES its declared literal type (e.g. `'text'`, `'card'`) in
 * the return type — that's what makes `usePageText(schema)` type-check text
 * keys and `config={SCHEMA.x}` precise.
 *
 * @param page  The page name — becomes the first address segment and must
 *              match the screen the preferences/permissions APIs key on.
 * @param slots Map of component name → ComponentType | { type, permission? }.
 */
export function buildSchema<S extends Record<string, SlotDecl>>(
  page: string,
  slots: S,
): BuiltSchema<S> {
  const out = {} as Record<string, Slot>;
  for (const name of Object.keys(slots) as (keyof S & string)[]) {
    const decl = slots[name];
    out[name] =
      typeof decl === 'string'
        ? { id: `${page}.${name}`, type: decl }
        : { id: `${page}.${name}`, type: decl.type, permission: decl.permission };
  }
  return out as BuiltSchema<S>;
}
