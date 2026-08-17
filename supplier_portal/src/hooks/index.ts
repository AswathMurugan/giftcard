// Barrel of all hooks. Read this to see what hooks are available
// without listing the directory.

// Reads go through saved queries only (useSavedQueryTable / -List / -Single).
// The dynamic read hooks (useEntityList / useEntityDetail / useEntityAggregate)
// were removed — the data plane is not queried directly via POST /query/{entity}.
// Writes still go through useEntityMutation (entity CRUD).
export { useEntityMutation } from './useEntityMutation';
export type { EntityMutationOptions } from './useEntityMutation';

export { useIsMobile } from './useMobile';

// Jiffy Drive file upload / view / download (see src/queries/FILE-UPLOAD.md).
// No UI component — compose a shadcn dropzone and drive the I/O with this hook.
export {
  useDriveFiles,
  buildDriveFormData,
  fileExtension,
  formatBytes,
  isPreviewableMime,
  uploadProgressPercent,
} from './useDriveFiles';
export type {
  UseDriveFilesResult,
  DriveUploadOptions,
  DriveUploadResult,
  DriveFileMetadata,
  DriveScope,
  DriveRetentionPolicy,
  DriveClassification,
} from './useDriveFiles';

// Address capture — Mapbox autocomplete (see src/queries/ADDRESS.md). No UI
// component; compose Input + Select and drive them from this hook.
export {
  useAddressAutofill,
  MAPBOX_DEBOUNCE_MS,
  US_COUNTRY_CODE,
  DEFAULT_MAPBOX_TOKEN,
  isUsCountryCode,
  findCountryByCode2,
  findCountryByName,
  resolveStateOption,
  sortCountriesUsFirst,
  validatePostalCode,
  usStateAbbrev,
  mapSuggestion,
  mapRetrievalToAddress,
  formatSuggestionLabel,
} from './useAddressAutofill';
export type {
  UseAddressAutofillOptions,
  UseAddressAutofillResult,
  AddressValue,
  AddressSuggestion,
  CountryOption,
  StateOption,
} from './useAddressAutofill';

// Document signing — e-sign / wet-sign envelopes (see src/queries/SIGNATURE.md).
// No UI component; compose the screen from shadcn primitives and drive it with
// this hook. The PDF viewer hook is NOT exported here — import it directly from
// '@/hooks/usePdfViewer' so react-pdf / pdfjs-dist only load on viewer routes.
export {
  useSignatures,
  bundleDisplayName,
  providerToMethod,
  roleVariantForRole,
  stripSignedPrefix,
  resolveDriveFileId,
  envelopeOwnDocuments,
  mapSignatories,
  rowStatusForApiStatus,
  envelopeStatusMap,
  mapDocumentGroups,
  mapAccounts,
  isBundleSigned,
  statusChipSpec,
  formatSignedOn,
  applySignedOverrides,
} from './useSignatures';
export type {
  UseSignaturesResult,
  SignMethod,
  DocBundleType,
  SignStatus,
  DocumentRowAction,
  AccountStatusKind,
  RoleVariant,
  SignAccount,
  SignDocumentRow,
  SignDocumentGroup,
  Signatory,
  StatusChipSpec,
  EnvelopeRecipient,
  EnvelopeDocument,
  SigningEnvelope,
} from './useSignatures';

export { useSavedQueryList } from './useSavedQueryList';
export type {
  SavedQueryListOptions,
  SavedQueryListResult,
} from './useSavedQueryList';

export { useSavedQuerySingle } from './useSavedQuerySingle';
export type {
  SavedQuerySingleOptions,
  SavedQuerySingleResult,
} from './useSavedQuerySingle';

export { useSavedQueryMutation } from './useSavedQueryMutation';
export type { SavedQueryMutationOptions } from './useSavedQueryMutation';

export {
  useSavedQueryTable,
  DEFAULT_FETCH_ALL_PAGE_SIZE,
  DEFAULT_INITIAL_PAGE_SIZE,
} from './useSavedQueryTable';
export type {
  UseSavedQueryTableOptions,
  UseSavedQueryTableResult,
  UseSavedQueryTableServerOptions,
  UseSavedQueryTableFetchAllOptions,
} from './useSavedQueryTable';

export { useWorkflow } from './useWorkflow';
export type {
  UseWorkflowOptions,
  UseWorkflowResult,
} from './useWorkflow';

// Service Request (SR) runtime calls (see src/queries/SERVICE-REQUEST.md).
// useSrCreate → POST /v1/sr/execute/{name} (returns srInstanceId);
// useSrSubmit → POST /v1/signals/{srInstanceId}/trigger (replaces sr_submit).
export { useSrCreate } from './useSrCreate';
export type {
  UseSrCreateOptions,
  UseSrCreateResult,
  SrCreateResult,
} from './useSrCreate';

export { useSrSubmit, normaliseSrSubmitInput } from './useSrSubmit';
export type {
  UseSrSubmitOptions,
  UseSrSubmitResult,
  SrSubmitInput,
} from './useSrSubmit';

export {
  usePartnerModule,
  usePartnerCategoryMethod,
} from './usePartnerModule';
export type {
  UsePartnerModuleOptions,
  UsePartnerModuleResult,
  UsePartnerCategoryMethodOptions,
  UsePartnerCategoryMethodResult,
} from './usePartnerModule';

export { useDebouncedValue } from './useDebouncedValue';
