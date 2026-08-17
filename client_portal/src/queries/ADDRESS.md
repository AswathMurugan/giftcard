# Address capture (read FIRST for any address)

**Never hand-roll an address as loose text inputs** (`line1`, `line2`, `city`,
`state`, `province`, `country`, …). That is the wrong pattern. Every address is
captured through **Mapbox autocomplete** (`useAddressAutofill` from `@/hooks`)
writing into the Phoenix **`address`** entity, with **country and state as
dropdowns backed by the `wealthdomain` entities** — not free text.

There is **no Address UI component** in this starter (by design). You compose
the field yourself from existing primitives (`Input` + `Select`) and drive it
with the hook. The hook does Mapbox only; country/state option data comes from a
saved query (below).

### Field label & UX conventions (apply these when you compose the field)

- **Title-Case every label:** `Address Line 1`, `Address Line 2`, `City`,
  `State / Province`, `Postal Code`, `Country` — never `Address line 1`.
- **No `(Optional)` suffix on optional fields.** The required marker (the gold
  left-bar the field primitives draw for `required`) already distinguishes
  required from optional — an optional field is simply *unmarked*. Do NOT write
  `Address Line 2 (Optional)` or an "(optional)" placeholder.
- **Don't override the input font weight.** The field primitives already use the
  design-system value weight; a `font-normal` (or similar) override makes the
  address inputs read differently from the rest of the form. Leave it.
- **State field:** the `<Select>` **options list full names** (scannable), but
  the **collapsed/selected value and any review string show the 2-letter code**
  (`usStateAbbrev`, see §1) for US addresses.
- **Country comes before State** — selecting Country drives US-detection, which
  switches the State field between the US dropdown and a free-text province and
  sets the postal format, so it's chosen first.

---

## 1. The `address` entity (what you persist)

Source: `src/types/entities/address.ts` (app `wealthdomain_69c65d7d64bd0f04506bab2b`).
Fields are **snake_case**; `country` and `state` are **entity links**.

| Field | Type | Notes |
|---|---|---|
| `line_1` | string | Street line. (`line_2`..`line_4` also exist; usually only 1–2 used.) |
| `line_2` | string | Apt / suite. |
| `city` | string | |
| `postal_code` | string | ZIP (US) / postal code (non-US). |
| `country` | link `{ id }` | → `country` entity. **Dropdown, required.** |
| `state` | link `{ id }` | → `state_or_province` entity. **Dropdown, US only.** |
| `state_or_province` | string | Free-text state/province for **non-US** (where the link can't be used). |
| `is_us_address` | boolean | Drives US vs non-US behaviour. |

**US vs non-US (key rule):**
- **US** (`isUsCountry(country)` — see below): show a **State dropdown** (`state`
  link from `state_or_province` entity) + a 5-digit **ZIP**. Set
  `is_us_address: true`, leave `state_or_province` empty.
- **Non-US**: show a **free-text State/Province `Input`** (`state_or_province`)
  + alphanumeric **postal code**. Set `is_us_address: false`, leave `state`
  null.

> 🇺🇸 **Displaying a US address → show the 2-letter state CODE** ("San Antonio,
> TX 78213"), the standard for US addresses. The state `<Select>` **input** still
> shows full names for selection, but any DISPLAY/review string should abbreviate.
> Use `usStateAbbrev(name)` from `useAddressAutofill` (exported via `@/hooks`) —
> it maps a US state's full name to its code and is a no-op for a code already, a
> non-US province, or empty. Apply it to the region in your address formatter,
> gated on `is_us_address` (non-US regions stay as-is):
> ```ts
> const region = isUs ? usStateAbbrev(stateName) : state_or_province;
> ```

> ⚠️ **Detect US with `isUsCountry`, not a single code field.** Do NOT key off
> `country.code_2_letters === 'US'` — a tenant's US row may not store
> `code_2_letters` as `"US"` (or at all), so that check returns false for a real
> US address and the State field wrongly renders as a free-text input showing
> the state's link UUID. Use the exported `isUsCountry(country, fallbackName?)`
> helper from `useAddressAutofill` — it checks `code_2_letters` **OR**
> `code_3_letters` **OR** the country name containing "united states" (the name
> is the reliable signal here). (The Mapbox autofill path is different: there
> the source is a reliable ISO-2 `country_code`, so `isUsCountryCode(code)` is
> fine — `mapRetrievalToAddress` already handles it.)

---

## 2. Country & state options — find-or-create a saved query

The country/state dropdowns load their options from the `wealthdomain`
entities via a **saved query** (the starter's read path):

1. **Find:** grep `src/types/catalogs/saved-queries.catalog.md` for a country list query
   (keywords: "country", "state", "province"). If a suitable one exists, use its
   `Hook:` line.
2. **Create (if none):** call `create_saved_query` against **`wealthdomain`**
   (`appKey` = `wealthdomain_69c65d7d64bd0f04506bab2b`, `entityAppKey` = same):
   - `country_list` — select `id, full_name, short_name, code_2_letters,
     code_3_letters, sort_order`; no filter; `isSingle: false`. Description:
     "All countries for the address country dropdown: id, names, ISO codes,
     sort order. Use to populate the country Select in any address field."
   - `state_or_province_list` — select `id, name, code, country`; `isSingle:
     false`. Description: "All states/provinces for the US state dropdown in
     address fields: id, name, code, country link."
3. Consume with `useSavedQueryList` and map rows to the hook's option shape
   (`CountryOption` / `StateOption`).

> Reads go through saved queries. Do **not** call `executeCountryDynamicQuery`
> directly for the dropdown.

---

## 3. `useAddressAutofill` — the hook

```ts
import { useAddressAutofill } from '@/hooks';
import type { AddressValue, CountryOption, StateOption } from '@/hooks';
```

Options: `{ token?, countryList, stateList, countryPreference?, onAddressSelected }`.
Returns: `{ suggestions, isAvailable, isLoading, suggest, selectSuggestion, clearSuggestions }`.

- **Mechanism:** native `fetch` to the Mapbox Search Box API v2
  (`/suggest` + `/retrieve`), 400ms debounced, one session token per instance.
  No SDK, no `npm install`.
- **Token:** `VITE_MAPBOX_TOKEN` env override → built-in default
  (`DEFAULT_MAPBOX_TOKEN`). A public `pk.` token is safe client-side.
- **Graceful degradation:** if the token is missing or a request fails,
  `isAvailable` becomes `false` and `suggestions` stays empty. **Always keep the
  manual fields usable** so the form still works without autocomplete.
- **Link resolution:** pass `countryList` / `stateList` so the hook can turn
  Mapbox names/codes into `country: { id }` / `state: { id }`. `onAddressSelected`
  receives an `AddressValue` already shaped to the `address` entity (snake_case
  + links + `is_us_address`).
- `validatePostalCode(input, isUs)` is exported for the ZIP/postal input.

---

## 4. Render pattern (compose Input + Select)

```tsx
import { useState } from 'react';
import { useAddressAutofill, sortCountriesUsFirst, validatePostalCode, usStateAbbrev } from '@/hooks';
// `isUsCountry` is NOT re-exported from the @/hooks barrel — import from the module.
import { isUsCountry } from '@/hooks/useAddressAutofill';
import type { AddressValue, CountryOption, StateOption } from '@/hooks';
import { useSavedQueryList } from '@/hooks';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

function AddressField({ value, onChange }: {
  value: AddressValue; onChange: (v: AddressValue) => void;
}) {
  // 1. Option data from saved queries (find-or-create — see §2).
  const { data: countries = [] } = useSavedQueryList('country_list');
  const { data: states = [] } = useSavedQueryList('state_or_province_list');
  const countryList = sortCountriesUsFirst(countries as CountryOption[]);
  const stateList = states as StateOption[];

  // 2. Mapbox autocomplete → fills the whole address on select.
  const { suggestions, isAvailable, suggest, selectSuggestion } = useAddressAutofill({
    countryList, stateList, countryPreference: 'US',
    onAddressSelected: (addr) => onChange({ ...value, ...addr }),
  });

  const isUs = value.is_us_address ?? true;

  return (
    <div className="flex flex-col gap-4">
      {/* Autocomplete line — degrades to a plain line_1 input when unavailable */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="addr-line1">Address Line 1</Label>
        <Input
          id="addr-line1"
          value={value.line_1 ?? ''}
          placeholder={isAvailable ? 'Start typing your address…' : 'Street address'}
          onChange={(e) => { onChange({ ...value, line_1: e.target.value }); suggest(e.target.value); }}
        />
        {suggestions.length > 0 && (
          <ul className="rounded-md border border-border">
            {suggestions.map((s) => (
              <li key={s.mapbox_id}>
                <button type="button" className="w-full px-3 py-2 text-left hover:bg-accent"
                  onClick={() => selectSuggestion(s)}>{s.label}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Optional field — no "(Optional)" label/placeholder; it's simply unmarked. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="addr-line2">Address Line 2</Label>
        <Input id="addr-line2" placeholder="Apartment, suite, unit, etc." value={value.line_2 ?? ''}
          onChange={(e) => onChange({ ...value, line_2: e.target.value })} />
      </div>
      <Input placeholder="City" value={value.city ?? ''}
        onChange={(e) => onChange({ ...value, city: e.target.value })} />

      {/* Country — dropdown, required, stored as a link id */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="addr-country">Country</Label>
        <Select value={value.country?.id ?? undefined}
          onValueChange={(id) => {
            const c = countryList.find((x) => x.id === id);
            // Multi-signal US detection — code_2_letters alone is unreliable.
            onChange({ ...value, country: { id }, is_us_address: isUsCountry(c) });
          }}>
          {/* lookupValue: country_list loads async, so pass the known label
              so a prefilled value shows immediately (before options mount). */}
          <SelectTrigger id="addr-country">
            <SelectValue placeholder="Select a country"
              lookupValue={value.country_name ?? countryList.find((c) => c.id === value.country?.id)?.name} />
          </SelectTrigger>
          <SelectContent>
            {countryList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* State: dropdown (US) vs free text (non-US) */}
      {isUs ? (
        <Select value={value.state?.id ?? undefined}
          onValueChange={(id) => onChange({ ...value, state: { id }, state_or_province: '' })}>
          <SelectTrigger>
            {/* Selected value shows the 2-letter code; the options below list full names. */}
            <SelectValue placeholder="State"
              lookupValue={usStateAbbrev(stateList.find((s) => s.id === value.state?.id)?.name)} />
          </SelectTrigger>
          <SelectContent>
            {stateList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input placeholder="State / Province" value={value.state_or_province ?? ''}
          onChange={(e) => onChange({ ...value, state: null, state_or_province: e.target.value })} />
      )}

      <Input placeholder={isUs ? 'ZIP code' : 'Postal code'} value={value.postal_code ?? ''}
        onChange={(e) => onChange({ ...value, postal_code: validatePostalCode(e.target.value, isUs) })} />
    </div>
  );
}
```

---

## 5. Persisting

The `AddressValue` is already snake_case with link wrappers, so it maps directly
onto an `address` insert/update (via the page's saved-query mutation or
`useEntityMutation`). Send `country`/`state` as `{ id }`; for non-US send
`state_or_province` (string) and `state: null`. Always include `is_us_address`.

## 6. Guardrails

- Never hand-roll address text inputs — use `useAddressAutofill` + the dropdowns.
- Country is ALWAYS a dropdown from the `wealthdomain` `country` entity, stored
  as a link `{ id }`. Never a free-text country.
- US → `state` link dropdown + ZIP; non-US → `state_or_province` free text +
  postal. Keyed off `is_us_address`, which you derive with **`isUsCountry`**
  (multi-signal: code_2_letters OR code_3_letters OR name) — **never**
  `code_2_letters === 'US'` alone; tenant data may not populate it.
- **Don't filter the US state dropdown by the selected country link.** Map
  `state_or_province_list` rows straight to options (as in §4). In this tenant
  the `state_or_province` entity carries NO `country` link (`country` is null on
  every row), so filtering `states` by `country.id === selectedCountry` drops
  **every** state and the dropdown goes empty. If you ever do scope states by
  country, guard it: only apply the filter when some row actually has a
  `country?.id`.
- **Prefilled state may arrive as a link id in `state_or_province`.** A saved
  address can store the state's UUID in the free-text `state_or_province` slot
  (not a name/code). Resolve it with `resolveStateOption` (it matches by id
  first, then name/code) and set `state: { id }` so the dropdown reflects the
  current value. Gate that resolution on the state options being loaded.
- Keep manual entry working when Mapbox is unavailable (`isAvailable === false`).
- **Prefilled country/state on async-loaded options just works** — the shared
  `Select` swallows Radix's spurious `onValueChange("")` (fired while options
  are still loading and the value matches no mounted item), so a prefilled
  `country`/`state` link is never wiped. Optionally pass `lookupValue` to
  `<SelectValue>` (the known label, e.g. `value.country_name`) to show the label
  during the brief load gap before the real option mounts.
- Don't persist lat/lng (not on the entity); don't edit the generated entity files.
- Ship a test for any pure mapping/validation helper you add on top.
