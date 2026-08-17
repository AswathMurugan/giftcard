# File upload & view (read FIRST for any file upload / attachment / document)

**There is NO file-upload UI component in this starter — and you don't need
one.** Compose the dropzone yourself from shadcn primitives and drive the I/O
with the **`useDriveFiles`** hook from `@/hooks`. This mirrors the address
pattern (`ADDRESS.md`): the hook does the network + state; you render the field.

The platform's own atomic (`@ui-atomic/file-dropzone`) is the same shape — a
dashed drop area + filename chip + validation, **no built-in viewer** — and it
isn't importable here anyway (different primitive stack). So: shadcn dropzone +
this hook.

Transport is already wired: the `drive` service is configured in
`src/config/api-config.ts` (`origin/drive`, tenant/env headers, auth provider,
403-refresh). `apiManager` already supports multipart (`FormData` body) and
binary (`responseType: 'blob'`) — **do not** edit `api-manager.ts`.

---

## ⚠️ Ask the user the `scope` — never assume it

`scope` is a **required** upload field with **no default**. The Drive API
accepts exactly three values — anything else 400s with `invalid scope`:

- **`PLATFORM`** · **`APPS`** · **`PUBLIC_ASSETS`**

**STOP and ask the user which scope to use** before uploading. Then:

- `scope: 'APPS'` → also pass `appName` (defaults to the current app's name).
- `scope: 'PLATFORM'` → tenant/platform-wide storage.
- `scope: 'PUBLIC_ASSETS'` → publicly accessible assets.

`serviceName` (sent as `service_name`) is optional — only pass it if the
deployment's scope requires a service identifier (e.g. `'UI'`).

Other enums (safe to default, override on request):

| Field | Values | Hook default |
|---|---|---|
| `classification` | `PUBLIC` · `INTERNAL` · `CONFIDENTIAL` · `RESTRICTED` | `INTERNAL` |
| `retentionPolicy` | `TEMP_7_DAYS` · `TEMP_30_DAYS` · `TEMP_90_DAYS` · `STANDARD_1_YEAR` · `BUSINESS_3_YEAR` · `COMPLIANCE_7_YEAR` | `TEMP_7_DAYS` |

---

## The hook — `useDriveFiles()` (`@/hooks`)

```ts
const {
  upload,            // (file, { scope, ... }) => Promise<{ file_id, storage_key, ... }>
  getPresignedUrl,   // (fileId, expiresIn?) => Promise<string>  ← <img> / link ONLY (NOT react-pdf — CORS)
  download,          // (fileId) => Promise<Blob>                ← PDF view (blob → object URL) + save-to-disk
  getMetadata,       // (fileId) => Promise<DriveFileMetadata>
  remove,            // (fileId) => Promise<void>  (soft delete)
  isUploading, progress, error,
} = useDriveFiles();
```

Endpoints it shapes (all under the `drive` service):
`POST /api/v1/files` · `GET /api/v1/files/{id}/presigned-url` ·
`GET /api/v1/files/{id}/download` · `GET /api/v1/files/{id}` ·
`DELETE /api/v1/files/{id}`.

---

## 1. Render the dropzone (compose shadcn — don't fork a component)

Compose a dashed dropzone from primitives: a hidden `<input type="file">` + a
dashed bordered area (`border border-dashed`) with a cloud-upload icon, drop
copy, and a `ghost` Browse button that triggers the hidden input. Validate
extension/size in the page (the hook doesn't validate). Keep a `Label` sibling
for a11y.

```tsx
const { upload, isUploading, progress } = useDriveFiles();
const [ref, setRef] = useState<DriveUploadResult | null>(null);

async function onPick(file: File) {
  // scope MUST come from the user — see above.
  const result = await upload(file, { scope: 'APPS', folderPath: 'service-requests' });
  setRef(result);   // persist result.file_id wherever the page needs it
}
```

## 2. View a stored file — blob for PDFs, presigned URL for images

**PDFs (the react-pdf viewer — `DOCUMENT-VIEWER.md`): use `download()` → blob →
object URL.** A presigned URL does NOT work there: react-pdf loads the bytes
with `fetch()`, which is CORS-gated, and the Drive S3 bucket has no CORS policy
for app origins — the viewer hangs at "Loading PDF…" with a console CORS error.

```tsx
const blob = await download(ref.file_id);
const url = URL.createObjectURL(blob);   // pass to <Document file={url}>
// URL.revokeObjectURL(url) when the viewer closes
```

**Images** can use the **presigned URL** (the browser fetches S3 directly, no
API proxying — `<img>` loads aren't CORS-gated):

```tsx
const url = await getPresignedUrl(ref.file_id);
<img src={url} alt={name} />
```

Use `isPreviewableMime(mime)` (exported helper) to decide inline-view vs
download. For non-previewable types, offer **download** (same blob pattern:
trigger an `<a download>` click, then `URL.revokeObjectURL(href)`).

## 3. Permission — gate the trigger, no wrapper needed

Permission gating is independent of any component. To restrict who can upload:

- Put `config={SCHEMA.uploadBtn}` with `permission: true` on the Browse
  **Button** (or the file **Input**) — `ConfigProvider` hides/disables it when
  the user lacks the component permission. (See "Customizable components" in
  `CLAUDE.md`.)
- Or wrap the whole upload block in `<PermissionGuard>`
  (`src/components/PermissionGuard.tsx`).

Either works with a plain composed dropzone — going hook-only costs nothing
here.

---

## Guardrails

- **No FileUpload component.** Compose shadcn + this hook. Don't add a library
  (`react-dropzone`, `uppy`, …) — native `File`/`FormData`/`Blob` only.
- **Ask the user the `scope`.** Don't hardcode one; the enum differs per Drive
  build.
- **Persist the returned `file_id` / `storage_key`**, not the `File`. The page
  owns where it goes (an entity field, a form payload, etc.) — decide that with
  the user; nothing is auto-wired.
- **Validate in the page** (extension + size); show `error` from the hook for
  network failures.
- **Ship a colocated test** for any new pure helper you add around it (the
  hook's own helpers are already tested in `useDriveFiles.test.ts`).
