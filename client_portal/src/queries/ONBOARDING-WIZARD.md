# Account Onboarding — Multi-Step SR Wizard Architecture

How to build account onboarding in this starter.

Onboarding is **not a one-off form** — it is the **large multi-step case of a
Service Request (SR)**. Everything in `SERVICE-REQUEST.md` applies; this doc adds
the architecture for the part that file calls "a wizard (2+ ordered steps)" but
at scale: **many registration types, a shared pool of steps, Classic/Modern
presentation, and a review/Generate-Forms submit.**

> **Read first, in order:** `src/queries/SERVICE-REQUEST.md` (the SR runtime
> contract — `useSrCreate` / `useSrSubmit` / draft patch / `service_request_model`),
> then `design-system/DESIGN.md`, then the per-step guides you'll need:
> `ADDRESS.md`, `FILE-UPLOAD.md`, `SIGNATURE.md`, `TABLE.md`. This doc does **not**
> restate the SR runtime — it builds on it.

---

## 1. Why this needs an architecture (not just a form)

Onboarding is heavily regulated and conditional — the same idea ("open an
account") changes shape by organisation, account type, channel, and the client's
own answers. Most steps exist to satisfy a specific obligation:

| Concern | Drives in the flow |
|---------|--------------------|
| Identity (CIP) | Legal name, DOB, address, tax/govt ID, screening |
| Know-your-customer | Employment, affiliations, source of funds |
| Due diligence | Beneficial owners (entities/trusts), risk profile |
| Suitability | Investment experience, objectives, risk tolerance |
| Disclosures / best-interest | Acknowledgements, generated forms |
| Trusted contact | Optional trusted contact person |
| Funding / transfer | Funding source, transfer-in, IRA contribution details |
| Documentation | Supporting docs, generated forms, e-sign |

Account-type families are the source of variation: **Individual/Joint, IRA
(Traditional/Roth/SEP/SIMPLE/Inherited), Trust, Entity, Managed (IMA)** — plus
options like *with/without beneficiary*, *with/without annuity*,
*managed vs. brokerage*, *custodian*. A "registration type" is a concrete
**(organisation × account-type × channel)** flow. There are far more
registration types than there are distinct steps, because most steps are shared.

---

## 2. The core problem & principle

If you generate a full page for every combination —

```
registration types × option combinations × {Classic, Modern} × {edit, review}
```

— you get thousands of artifacts that re-embed the same forms: huge bundles,
duplicated logic, and one field change rippling across hundreds of files.

> **Principle: compose from step components; assemble the flow from a manifest.
> Never generate a page per combination.**

Each step is built **once** (page-local). A registration type is a small
**manifest** (ordered step ids + visibility predicates). The heavy artifacts then
scale with the number of **distinct steps**, not with registration types — and a
type loads only its own steps.

---

## 3. Where everything lives (respect the read-only boundary)

All onboarding code is **page-local** under one feature folder (only
`src/pages/**` + `src/PrivateApp.tsx` are writable):

```
src/pages/account-onboarding/
├── AccountOnboardingPage.tsx        # entry: resolves manifest + presentation, mounts engine
├── AccountOnboardingPage.schema.ts  # buildSchema('account-onboarding', {...})
├── engine/                          # wizard orchestration (page-local; no new libs)
│   ├── useWizard.ts                 # useReducer + callbacks
│   └── wizard-context.tsx           # Context provider/selectors for rail + form + tabs
├── manifests.ts                     # registration-type manifests (ordered step ids + when)
├── steps/                           # the shared step universe (one component per step)
│   ├── PersonalInfoStep.tsx
│   ├── AddressStep.tsx              # composes useAddressAutofill (ADDRESS.md)
│   ├── BeneficiariesStep.tsx
│   ├── AnnuitiesStep.tsx
│   ├── DocumentsStep.tsx            # composes useDriveFiles (FILE-UPLOAD.md)
│   └── …
├── primitives/                      # field/collection primitives (Collection, OwnerGroup, …)
└── shells/                          # ClassicShell, ModernShell, StepRail (chrome composition)
```

`DefaultLayout` already owns the app chrome (left nav, top bar). The wizard rail
is **page content inside `<main>`** — do not rebuild chrome (see `LAYOUT.md` for
hiding the sidebar/header for a Modern/consumer flow).

---

## 4. Layers

```
┌─ Preferences (runtime) ── usePreferences + config props; field on/off/required
├─ Presentation shells ──── Classic (left nav + left rail) / Modern (header-only + top stepper, fit-to-screen)
├─ Wizard engine (1) ────── useReducer+Context; persists via the SR contract
├─ Registration manifests ─ ordered step ids + when() predicates
└─ Step components ──────── the only heavy artifacts; built once, reused
```

### 4.1 Step components (the shared universe)

Each step is an explicit component built from **shadcn primitives + the design
tokens** (never hand-rolled), validated with **zod + react-hook-form** (the
starter's stack — see `SERVICE-REQUEST.md` §8). Reuse the dedicated guides:

- Address fields → `useAddressAutofill` + country dropdown (`ADDRESS.md`) — never
  hand-roll line1/city/state/country.
- Document upload → `useDriveFiles` (`FILE-UPLOAD.md`).
- E-sign on the final/generate step → `useSignatures` (`SIGNATURE.md`).

All steps share one contract so a single engine can drive any of them:

```ts
interface StepProps {
  value: AccountSlice;                  // this step's slice of payload
  onChange: (patch: Partial<AccountSlice>) => void;
  mode: 'edit' | 'review';              // review = read-only render of the SAME component
  fieldConfig: FieldConfig;             // per-field hidden/required (from preferences)
  account: AccountContext;              // cross-step, read-only (for conditional fields)
}
export const schema: ZodType<AccountSlice>;   // per-step; reused for whole-account validate
```

Conditional fields (joint owner, IRA-only funding, affiliation detail) are plain
React conditionals reading `value` / `account` — not configuration.

### 4.2 Registration manifests

Tiny config, not a generated screen. **Option-based step trimming is a
predicate**, not a separate artifact:

```ts
export const ORG_IRA: RegistrationManifest = {
  org: 'ORG', accountType: 'IRA', channel: 'advisor',
  defaultPresentation: 'classic',
  steps: [
    { id: 'personal-info' },
    { id: 'address' },
    { id: 'employment' },
    { id: 'affiliations' },
    { id: 'financial' },
    { id: 'suitability' },
    { id: 'beneficiary', when: a => a.wantBeneficiaries },
    { id: 'annuity',     when: a => a.hasAnnuity },
    { id: 'funding' },
    { id: 'documents' },
  ],
};
```

Adding a registration type = one manifest entry. Trimming a step for an option =
one `when:`. Review is appended by the engine.

### 4.3 Wizard engine (page-local, no new libraries)

The engine is built on the **SR contract** — it does not invent persistence:

- The account being opened **is an `sr_instance`**. Create it with
  `useSrCreate('<onboarding_wf>')` → `srInstanceId`; all form data lives in
  `sr_instance.payload`.
- **Per-step save = draft patch.** On advance, write the accumulated form values
  to `payload` via `useSavedQueryMutation('<sr_instance_patch>')`
  (`{ id: srInstanceId, payload }`). Drafts are **unvalidated** (partial).
- **Resume** reads the platform `sr_instance` query by `id`; the persisted
  `payload` wins (no merge) — see `SERVICE-REQUEST.md` §4.
- **Validation**: per-step zod on advance; whole-account on the final step.
  Server errors come back from submit → `mapWorkflowErrors` (`SERVICE-REQUEST.md`
  §9), keyed to the step that owns the field path.
- **Submit = Generate Forms.** `useSrSubmit(srInstanceId)` fires the SR submit
  signal → document generation / e-sign.
- **Orchestration state** (current step, errored steps, instance index) is a
  page-local `useReducer` exposed through Context (built-in React — no external
  store; the agent cannot add packages).

`computeSteps(manifest, payload)` filters predicates + appends review; nothing
registration-specific lives in the engine.

### 4.4 Presentation shells — Classic vs Modern are genuinely different

Both presentations reuse the **same step field set + schema + validation + SR
persistence** — but their **shell, stepper position, and field layout differ on
purpose.** This is not "same page, different chrome"; the two must look and feel
distinct. Presentation is a prop (`'classic' | 'modern'`), selected per
registration type / per account, never duplicated step logic.

| Aspect | **Classic** (advisor / internal) | **Modern** (consumer / self-service) |
|--------|----------------------------------|--------------------------------------|
| App chrome | Full app — **left sidebar nav** stays (`DefaultLayout`) | **Header-only — sidebar hidden** (via `LAYOUT.md`) |
| Stepper | **Left vertical rail** (numbered; done/current/error/upcoming) + `Progress`. (A very short flow may use a top stepper.) | **Always a horizontal stepper across the top** + `Progress`, regardless of step count |
| Step layout | Denser, traditional — typically one field per line in `Card`s | **Fit-to-screen**: grouped rows, **multiple fields per row** (e.g. First / Middle / Last on one row, Email next row, Phone next row), sized to fill the viewport |
| Advance | `Back` / `Save & Next` footer | Prominent **Next** that moves to the next group; flows top-to-bottom; last step → review |
| Use | Internal operators | Public / branded onboarding |

```tsx
// Two shells, one prop. Step bodies are shared; the SHELL decides chrome + stepper.
function WizardShell({ presentation, steps, children }: WizardShellProps) {
  return presentation === 'modern'
    ? <ModernShell topStepper={<TopStepper steps={steps} />}>{children}</ModernShell>   // header-only, sidebar hidden
    : <ClassicShell leftRail={<LeftWizardRail steps={steps} />}>{children}</ClassicShell>; // full app, left nav
}
```

- **Modern** hides the app sidebar (`LAYOUT.md`) and renders a **top** stepper.
- **Classic** keeps the app sidebar and renders a **left** rail (top stepper only
  for a very short flow).
- The same step component renders in both — the **field grid is responsive**, so
  Modern's multi-field rows and Classic's denser stack come from layout/tokens
  (DESIGN.md), not from two copies of the form.

**Review — two variants, same data, label-over-value.** Review is a `mode='review'`
render of the **same** step components (no separate review files), and it follows
the active presentation:

- **Classic Review** — read-only summary in the classic (left-rail) layout.
- **Modern Review** — read-only summary in the modern (header-only, top) layout.
- Both render each field as **label on top, value below**, grouped per step, with
  an **edit** affordance that jumps back to that step. Use the design system's
  read-only field treatment; do not re-lay-out the review by hand per step.

### 4.5 Preferences (runtime)

Org settings (fields/sections/steps on or off, required, financial-summary
toggles) come from `usePreferences()` / the `config` prop pattern
(`PREFERENCE.md`, "Customizable components") and flow into each step as
`fieldConfig`. Never baked into code; two orgs share components but see different
fields. Permissions gate **submit**, not individual fields.

---

## 5. State management

The installed stack covers every layer:

| Concern | Use (all already installed) |
|---------|------------------------------|
| Per-step form (fields, dirty, validation) | **react-hook-form + zod + @hookform/resolvers** (starter standard — `SERVICE-REQUEST.md` §8); `useFieldArray` drives `Collection` |
| SR create / draft / submit | **`useSrCreate` / `useSavedQueryMutation` / `useSrSubmit`** (the SR contract) |
| Wizard orchestration (step, errors, instances) | **page-local `useReducer` + Context** (built-in React; shared by rail/form/tabs without prop-drilling) |

**On TanStack Query (`@tanstack/react-query`):** it's already mounted
(`main.tsx` has the single `QueryClient`) and is the engine behind every data
hook — `useSavedQuery*`, `useSrCreate`/`useSrSubmit`, `useSavedQueryMutation`,
`usePreferences`/`usePermissions`. You consume it **through those hooks**; never
write raw `useQuery` or create a second `QueryClient`.

**Draft = server state, not a client store.** It's persisted as
`sr_instance.payload` via `useSavedQueryMutation` (React Query under the hood).
The reducer holds only in-flight UI (current step, saving/generating flags,
errored steps) — there is no separate client store to add.

```ts
interface WizardState { currentStep: StepId; errors: FieldError[]; payload: AccountRecord; }
type WizardAction =
  | { type: 'merge'; saved: Partial<AccountRecord> }
  | { type: 'goTo'; step: StepId }
  | { type: 'setErrors'; errors: FieldError[] };

// handlers are useCallback-stable so the memoized rail / Collection rows don't re-render.
const saveAndNext = useCallback(async (stepId, slice) => {
  if (!stepSchema(stepId).safeParse(slice).success) return;       // RHF shows field errors
  await patchDraft.mutateAsync({ id: srInstanceId, payload: nextPayload });  // unvalidated draft
  dispatch({ type: 'merge', saved: slice });
  dispatch({ type: 'goTo', step: nextStepId(steps, stepId) });
}, [patchDraft, srInstanceId, steps]);
```

### 5.1 Supporting hooks — yes, but page-local & composition-only

You may add custom hooks, with two rules:

1. **Page-local only.** They live under `src/pages/account-onboarding/engine/`
   (or a `hooks/` subfolder there) — **never** in `src/hooks/`, which is
   starter-owned and read-only (writes outside `src/pages/**` are blocked).
2. **Compose, don't re-implement.** They wrap the starter hooks
   (`useSrCreate`, `useSavedQueryMutation`, `useSrSubmit`, RHF, `usePreferences`),
   never re-create data plumbing or add a library.

The set this architecture implies (add only these — don't over-build):

| Hook | Wraps / does |
|------|--------------|
| `useWizard(manifest, srInstanceId)` | the `useReducer` engine + `useCallback`-stable actions |
| `useWizardContext()` | Context selector so rail / form / tabs read state without prop-drilling |
| `useOnboardingDraft(srInstanceId)` | `useSrCreate` + `useSavedQueryMutation` (patch `payload`) + `useSrSubmit` — one SR-lifecycle surface |
| `useVisibleSteps(manifest, payload)` | memoized `computeSteps` (predicate filter + append review) |
| `useStepForm(stepId, value)` | RHF `useForm` + `zodResolver(stepSchema)` — uniform per-step wiring |
| `useMultiAccountInstances()` | per-account engine states + active index (only if multi-account is in scope) |

Extract pure logic (`computeSteps`, `nextStepId`, `firstErroredStep`,
merge-by-id) as plain functions so they're unit-tested without React (node env).

---

## 6. Repeating & nested collections (the `annuities[]` case)

Onboarding has genuine **array-inside-array** shapes inside `payload`:
`owners[].affiliations[]`, `beneficiaries[]`, `annuities[].allocations[]`,
`funding.sources[]`. They need **no new mechanism** — three rules:

1. **Stable item ids; merge by id, never by index.** Each array item carries a
   generated id (`uuid` is installed). Patches to `payload` merge by id, so
   add/remove/reorder never corrupts saved items.
2. **Path-based field keys for validation & error-nav.** Server errors arrive as
   paths like `annuities[2].allocations[0].percent`; map the **root segment**
   (`annuities`) to its owning step.
3. **One `Collection` primitive, pluggable presentation.** Add/remove/reorder
   lives once (backed by RHF `useFieldArray`); how it's *shown* is the part that
   varies by requirement — **suggest a fit, let the author pick/override:**

| Presentation | Best when | Built from |
|--------------|-----------|-----------|
| **Inline** | few items, few fields (beneficiaries, funding sources) | stacked cards |
| **Table + popup** | many fields/items, needs overview (annuities, affiliations) | `data-table`/`Table` + `Dialog`/`Drawer` |
| **Tabs** | small fixed named set (primary vs joint owner) | `Tabs` |
| **Accordion** | medium count, one-at-a-time editing | `Accordion` |

Defaults: short lists → inline; rich/long nested (e.g. `annuities[]`) →
table + popup. Reversible per collection — no engine/schema/persistence change.

```tsx
// annuities[] → each has allocations[] (array inside array; same primitive)
<Collection control={form.control} name="annuities" layout="table-popup"
  columns={ANNUITY_COLUMNS}
  row={({ control, index }) => (
    <>
      <MoneyField control={control} name={`annuities.${index}.premium`} label="Premium" />
      <Collection control={control} name={`annuities.${index}.allocations`}
        layout="inline" row={AllocationRow} />
    </>
  )} />
```

`control` + dotted `name` paths mean RHF tracks item ids, the engine merges by id,
and validation paths line up with the server's nested error keys.

---

## 7. Multi-account (open several accounts at once)

**One `sr_instance` per account** — each with its own `payload` and possibly its
own registration type/presentation. The engine remounts per instance (state never
bleeds), instance tabs switch between them, and the **last** account's submit
completes the batch. This is the SR `payload` round-trip (`SERVICE-REQUEST.md`
§4.B) applied N times, not a new mechanism.

---

## 8. Data & flow

```
payload (per sr_instance)
 └─ account
     ├─ owners[]            └─ affiliations[]     ← nested
     ├─ address  ├─ employment[]  ├─ financial  ├─ suitability  ├─ features
     ├─ beneficiaries[]
     ├─ annuities[]         ├─ allocations[]  └─ riders[]        ← nested
     ├─ funding             └─ sources[]
     ├─ trustedContacts[]   └─ documents[]
```

```
Open page  →  resolve registration type + presentation (from URL / manifest)
           →  useSrCreate (new) or read sr_instance by id (resume; payload wins)
           →  engine computes visible steps from manifest + payload answers
           →  Step 1 … N  (advance: zod step-validate → draft-patch payload → merge)
           →  Final step: whole-account validate
                 ├─ errors → mapWorkflowErrors → highlight + jump to first errored step
                 └─ clean  → Review (read-only, edit links) → "Generate Forms"
                                → useSrSubmit → docs / e-sign
           →  (multi-account) next sr_instance, or batch-complete on the last
```

---

## 9. Build / generation workflow

1. **Resolve the onboarding SR workflow** (`SERVICE-REQUEST.md` §2) and its
   `sr_<wf>` master-entity read query; sync `service_request_model` via
   `update_workflow_model`.
2. **Generate / reuse step components** under `src/pages/account-onboarding/steps/`
   — emit only steps that don't exist; reuse the rest. Compose address / file /
   signature via their guides.
3. **Emit one manifest** per registration type in `manifests.ts`.
4. **Register the route** in `PrivateApp.tsx` (`hideFromNav: true` — it's reached
   with URL params), and `register_screen` with `root_component` = the SR workflow
   name.
5. **Ship colocated tests** for pure logic (predicate filtering, path→step mapping,
   merge-by-id, zod schemas, `mapWorkflowErrors`) — node env, no DOM.

Net: a new registration type is mostly a manifest plus any genuinely new steps;
presentation, review, validation, persistence and submit come from shared code +
the SR contract.

---

## 10. Non-goals (avoid over-engineering)

- Use only installed packages — the agent cannot add dependencies or edit
  `package.json`. Build with RHF + zod + React Query (via starter hooks) +
  page-local `useReducer`.
- No generic schema-driven form interpreter — steps are explicit code.
- No per-org / per-option / per-presentation generated files — runtime
  data / predicates / props.
- No rebuilt app chrome — `DefaultLayout` owns it; configure via `LAYOUT.md`.
- No reinvented SR plumbing — `useSrCreate` / draft patch / `useSrSubmit`.
- No premature primitives — extract a primitive on its second repeat.

---

## 11. What each change costs

| Change | Work |
|--------|------|
| New registration type | one manifest (+ any genuinely new steps) |
| Trim a step for an option | one `when:` predicate |
| Classic vs Modern (incl. their reviews) | shell prop: Classic = left nav + left rail; Modern = header-only + top stepper, fit-to-screen. Review is `mode='review'` of the same steps in the active shell |
| New field on a step | edit one step component |
| Org turns a field off / required | preferences data — no code change |
| Open multiple accounts at once | one `sr_instance` per account (engine handles it) |
