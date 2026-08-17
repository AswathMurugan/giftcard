# Document signing (read FIRST for any e-sign / wet-sign / signature flow)

**There is NO signatures UI component in this starter — and you don't need
one.** Compose the screen yourself from shadcn primitives and drive the data +
actions with the **`useSignatures`** hook from `@/hooks`. This mirrors the
address (`ADDRESS.md`) and file-upload (`FILE-UPLOAD.md`) patterns: the hook
does the network + state mapping; you render the layout.

Transport is already wired: the `docproc` service (signing API) and the `drive`
service (document bytes) are configured in `src/config/api-config.ts`. **Do not**
edit `api-manager.ts` or re-fetch an auth token — the auth provider injects the
bearer + tenant headers automatically.

---

## 1. Where the `envelopeId` comes from

An envelope is created upstream (a bundle/workflow) and its id is stored on your
record — typically the entity field **`e_signature_envelope_id`**. Read it
through a saved query, then pass it to the hook:

```tsx
const { data } = useSavedQuerySingle('account_signing', { input: { id } });
const sign = useSignatures(data?.e_signature_envelope_id);
```

If you don't have an id yet, pass `undefined` — the hook stays idle
(`loading: false`, `envelope: null`).

---

## 2. The hook — `useSignatures(envelopeId)` (`@/hooks`)

```ts
const {
  envelope, loading, error, refresh,        // raw envelope + status
  method, availableMethods,                 // 'e-sign' | 'wet-sign' (from provider)
  accounts, signatories, documentGroups,    // ready-to-render, already mapped
  bundleSigned,
  uploadSigned,      // (documentId, file)  → Drive upload + link signed copy
  revoke,            // (documentId, reason?)
  getDocumentUrl,    // (documentId) → object URL for inline view (you revoke it)
  downloadDocument,  // (documentId, filename?) → save one file
  downloadBundle,    // () → save every doc (sequential; no zip)
  markSigned,        // (recipientId) → CLIENT-ONLY (no backend; see guardrails)
  busy,              // true while a bundle download runs
} = useSignatures(envelopeId);
```

Endpoints it shapes (all auto-authenticated):
`GET docproc /api/v1/signing/envelopes/{id}` ·
`POST …/{id}/documents/{docId}/upload-signed` ·
`POST …/{id}/documents/{docId}/revoke` · plus Drive
`GET /api/v1/files/{fileId}/download` for bytes.

After `uploadSigned` / `revoke` the hook re-reads the envelope from the API
response, so `accounts` / `documentGroups` / `bundleSigned` update on their own.

---

## 3. Render pattern (compose — don't fork a component)

`method` follows the envelope's `provider` (only that tab is real):

- **E-Sign:** read-only — show `signatories` with their `esignStatusLabel` /
  `esignSigned`. No bundle download.
- **Wet-Sign:** show the **document bundle** (download + per-row `view` / `upload`
  / `revoke` from `row.actions`) and **Confirm Signatories** with a *Mark as
  Signed* action gated on `canMarkSigned`.

```tsx
function SigningPanel({ envelopeId }: { envelopeId: string }) {
  const s = useSignatures(envelopeId);
  if (s.loading) return <Spinner />;
  if (s.error) return <p className="text-destructive">Couldn't load signing details.</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* accounts sidebar */}
      {s.accounts.map((a) => (
        <Card key={a.id}>{a.name} — <Badge>{a.statusLabel}</Badge></Card>
      ))}

      {s.method === 'wet-sign' && s.documentGroups.map((g) => (
        <Card key={g.id}>
          <div className="flex items-center justify-between">
            <span>{g.title} · {g.count} documents</span>
            <Button variant="outline" onClick={s.downloadBundle} disabled={s.busy}>
              <i className="icon icon_-Tb_download text-[1.25rem] mr-2" aria-hidden /> Download
            </Button>
          </div>
          {g.documents.map((d) => (
            <div key={d.id} className="flex items-center justify-between">
              <span>{d.name}</span>
              <div className="flex gap-1">
                {d.actions?.includes('view') && (
                  <Button variant="ghost" onClick={() => openViewer(d.id)}>View</Button>
                )}
                {d.actions?.includes('revoke') && (
                  <Button variant="ghost" onClick={() => s.revoke(d.id)}>Revoke</Button>
                )}
                {d.actions?.includes('upload') && (
                  <UploadSignedCopy onPick={(file) => s.uploadSigned(d.id, file)} />
                )}
              </div>
            </div>
          ))}
        </Card>
      ))}

      {/* signatories (both methods) */}
      {s.signatories.map((p) => (
        <Card key={p.id}>
          {p.name} <Badge>{p.role}</Badge>
          {p.esignSigned
            ? <Badge variant="default">{p.esignStatusLabel}</Badge>
            : p.canMarkSigned && s.method === 'wet-sign'
              ? <Button variant="outline" onClick={() => s.markSigned(p.id)}>Mark as Signed</Button>
              : <span>{p.esignStatusLabel}</span>}
        </Card>
      ))}
    </div>
  );
}
```

`UploadSignedCopy` is a hidden `<input type="file">` + a Button (same as
`FILE-UPLOAD.md`). The hook handles the Drive upload internally.

---

## 4. Viewing a document

To show a document, resolve it to a URL with **`getDocumentUrl(documentId)`**
(a blob object URL — revoke it when done), then render it with the shared
viewer. **Read `DOCUMENT-VIEWER.md`** for the full composition (`usePdfViewer`
+ `react-pdf`, zoom/page nav, multi-doc tabs, images):

```tsx
const s = useSignatures(envelopeId);
const [view, setView] = useState<{ url: string; name: string } | null>(null);

async function openViewer(documentId: string) {
  const url = await s.getDocumentUrl(documentId); // blob object URL
  setView({ url, name: 'Document' });
}
function closeViewer() {
  if (view) URL.revokeObjectURL(view.url); // revoke on close
  setView(null);
}
// Render <PdfView url={view.url} .../> inside a shadcn <Dialog> — see DOCUMENT-VIEWER.md.
```

---

## 5. Guardrails

- **No signatures component.** Compose from shadcn + `useSignatures`. Don't fork
  the platform composite. (Document viewing → `DOCUMENT-VIEWER.md`.)
- **`markSigned` is CLIENT-ONLY.** The source flow has no "mark as signed"
  backend endpoint — it only stamps a local "Signed On (…)" label this session.
  It does NOT persist. If real persistence is needed, a backend endpoint must be
  added first; flag it, don't fake it.
- **Viewing documents → `DOCUMENT-VIEWER.md`** (`usePdfViewer` + `react-pdf`).
  Don't add a zip/PDF library — `downloadBundle` saves files sequentially via Drive.
- **Revoke object URLs** from `getDocumentUrl` when you're done (on dialog close)
  to avoid leaks.
- **Persist nothing the API owns.** The envelope/document status is the server's;
  re-read via `refresh()` instead of caching it locally.
- Ship a colocated test for any pure helper you add on top (the hook's own
  mappers are already covered in `useSignatures.test.ts`).
