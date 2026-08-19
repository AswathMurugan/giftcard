/**
 * Proofs — the artwork rounds on the client orders this supplier is building.
 *
 * Master-detail on purpose. A proof hangs off the CLIENT's order, so the only
 * safe way to show one to a supplier is to establish first, server-side, which
 * demand orders they hold a PO against — then read that one order's rounds.
 * A single unfiltered read of `review_request` would be simpler and would put
 * every client's artwork on the wire.
 */
import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useSavedQueryList, useDriveFiles } from '@/hooks';
import { Button } from '@/components/ui/button';
import { saveProofDocument } from '@/pages/orders/order-api';
import { PAGE_CONTAINER } from '@/pages/page-shell';
import { useSupplierSession } from '@/pages/_shared/supplier-session';
import { SupplierSwitcher } from '@/pages/_shared/SupplierSwitcher';
import type { SupplierPoParentsRow } from '@/types/saved-queries.generated';
import {
  decorateSupplierProofs,
  type SupplierProofRow,
  parentOptions,
  type RawReview,
} from './supplier-proof-helpers';

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function SupplierProofsPage() {
  const { supplierId, supplierName, isLoading: sessionLoading } = useSupplierSession();
  const [orderId, setOrderId] = useState('');

  const parents = useSavedQueryList('supplier_po_parents', {
    input: { supplierId },
    enabled: Boolean(supplierId),
  });

  const options = useMemo(
    () => parentOptions((parents.data ?? []) as SupplierPoParentsRow[]),
    [parents.data],
  );

  // Land on the newest order rather than an empty pane, and re-seat the
  // selection when the supplier is switched — the previous order belongs to
  // someone else now.
  useEffect(() => {
    if (options.length === 0) {
      setOrderId('');
      return;
    }
    if (!options.some((o) => o.orderId === orderId)) setOrderId(options[0].orderId);
  }, [options, orderId]);

  const reviews = useSavedQueryList('order_reviews', {
    input: { orderId },
    enabled: Boolean(orderId),
  });

  const rows = useMemo(
    () => decorateSupplierProofs((reviews.data ?? []) as RawReview[]),
    [reviews.data],
  );
  const selected = options.find((o) => o.orderId === orderId) ?? null;
  const owed = rows.filter((r) => r.awaitingUpload).length;

  /**
   * Supplier-side proof upload (US-601).
   *
   * The same Drive scope and the same write Forge uses, so a proof attached
   * here and one CS attaches on the supplier's behalf are one artefact — the
   * client's approval must not point at a different file depending on who
   * happened to upload it.
   */
  const drive = useDriveFiles();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleProofFile(row: SupplierProofRow, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared straight away so re-picking the SAME file still fires `change`.
    e.target.value = '';
    if (!file) return;

    setUploadingId(row.id);
    setUploadError(null);
    try {
      const result = await drive.upload(file, {
        scope: 'APPS',
        retentionPolicy: 'BUSINESS_3_YEAR',
        classification: 'CONFIDENTIAL',
        preserveFilename: true,
        folderPath: `proofs/${row.proofType.replace(/\s+/g, '-').toLowerCase()}`,
      });
      await saveProofDocument({
        reviewId: row.id,
        fileId: result.file_id,
        fileName: file.name,
      });
      await reviews.refetch();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploadingId(null);
    }
  }

  if (sessionLoading || parents.isLoading) {
    return (
      <div className={PAGE_CONTAINER}>
        <Skeleton className="mb-4 h-10 w-64" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER} data-testid="supplier-proofs-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-foreground">Proofs</h1>
        <SupplierSwitcher />
      </div>

      {options.length === 0 ? (
        <>
          <p className="mt-1 text-[15px] text-muted-foreground">
            No orders awarded to {supplierName} yet.
          </p>
          <div
            className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
            data-testid="supplier-proofs-empty"
          >
            <p className="text-[14px] font-semibold text-foreground">Nothing to proof</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Proof rounds appear once you hold a purchase order on a client&rsquo;s job.
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Artwork rounds on the orders you are building. Pick an order to see its rounds.
          </p>

          <div className="mt-5 max-w-md">
            <SearchableSelect
              value={orderId}
              onValueChange={setOrderId}
              options={options.map((o) => ({
                label: `${o.orderCode} · ${o.clientName} (${o.poCode})`,
                value: o.orderId,
              }))}
              placeholder="Select an order"
              searchPlaceholder="Search orders"
              aria-label="Order"
            />
          </div>

          {selected ? (
            <p className="mt-2 text-[12.5px] text-muted-foreground" data-testid="proofs-order-brief">
              {selected.brief}
            </p>
          ) : null}

          {reviews.isLoading ? (
            <Skeleton className="mt-6 h-32 rounded-xl" />
          ) : rows.length === 0 ? (
            <div
              className="mt-6 rounded-xl border border-border bg-card px-4 py-10 text-center"
              data-testid="supplier-proofs-none"
            >
              <p className="text-[14px] font-semibold text-foreground">No rounds opened</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {selected?.orderCode} has not reached proofing yet.
              </p>
            </div>
          ) : (
            <>
              <p className="mt-4 text-[13px] text-muted-foreground">
                {owed === 0
                  ? 'Nothing waiting on your artwork.'
                  : `${owed} round${owed === 1 ? '' : 's'} waiting on your artwork.`}
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    data-testid={`supplier-proof-${row.proofType}-r${row.round}`}
                    data-row-key={`${row.proofType}-${row.round}`}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-bold text-foreground">
                          {row.proofType}
                        </span>
                        <span className="text-[12.5px] text-muted-foreground">
                          round {row.round}
                        </span>
                        <Badge variant={row.awaitingUpload ? 'outline' : 'secondary'}>
                          {row.label}
                        </Badge>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground/80">
                        {row.fileName
                          ? `${row.fileName} · uploaded ${shortDate(row.uploadedAt)}`
                          : `requested ${shortDate(row.requestedAt)}`}
                      </p>
                    </div>
                    {row.awaitingUpload ? (
                      <Button
                        asChild
                        size="sm"
                        aria-busy={uploadingId === row.id}
                        className="shrink-0"
                        data-testid={`upload-proof-${row.proofType}-r${row.round}`}
                      >
                        <label>
                          {uploadingId === row.id ? 'Uploading…' : 'Upload artwork'}
                          <input
                            type="file"
                            className="sr-only"
                            aria-label={`Upload ${row.proofType} artwork, round ${row.round}`}
                            disabled={uploadingId !== null}
                            onChange={(e) => handleProofFile(row, e)}
                          />
                        </label>
                      </Button>
                    ) : (
                      <span className="shrink-0 text-[12.5px] font-semibold text-muted-foreground">
                        {row.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {uploadError ? (
                <p
                  className="mt-3 text-[12px] text-destructive"
                  role="alert"
                  data-testid="proof-upload-error"
                >
                  That upload did not go through ({uploadError}). The round is unchanged — try
                  again.
                </p>
              ) : (
                <p className="mt-3 text-[11.5px] text-muted-foreground">
                  Uploading a file puts that round straight into review with your buyer.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default SupplierProofsPage;
