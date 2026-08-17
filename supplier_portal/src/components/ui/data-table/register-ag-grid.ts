/**
 * AG Grid Enterprise — license registration & module setup.
 *
 * Imported for side effects in main.tsx so that every <AgGridReact> instance
 * automatically picks up the license and the registered modules.
 */
import {
  ModuleRegistry,
  CellStyleModule,
  RowStyleModule,
  ClientSideRowModelModule,
  InfiniteRowModelModule,
  PaginationModule,
  RowSelectionModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  ValidationModule,
} from 'ag-grid-community';
import {
  LicenseManager,
  MenuModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
  SetFilterModule,
  MultiFilterModule,
  SideBarModule,
  MasterDetailModule,
  AllEnterpriseModule
} from 'ag-grid-enterprise';

// ── License key ─────────────────────────────────────────────────────────────
//
// AG Grid Enterprise key (AG-085370). The starter uses enterprise modules
// (SetFilter, SideBar, MasterDetail, Menu, ColumnsToolPanel, …) registered
// below; without this key the grid renders an evaluation watermark.
//
// The AG Charts Enterprise key (AG-116179) is NOT wired here because the
// starter has no AG Charts code (no `ag-charts-*` dependency, no `<AgCharts>`
// usage, no `IntegratedChartsModule.with(...)`). If chart UI is added later,
// install `ag-charts-enterprise` and follow the pattern from the renderer at
// `/Users/.../ui/libs/core/licenses/src/lib/licenses.ts` — the Charts key
// must go through `ag-charts-enterprise`'s own LicenseManager, NOT the Grid
// one. Routing both keys through Grid's LicenseManager triggers AG Grid
// warning #291 (the second call overwrites the first).

const AG_GRID_LICENSE_KEY =
  'Using_this_{AG_Grid}_Enterprise_key_{AG-085370}_in_excess_of_the_licence_granted_is_not_permitted___Please_report_misuse_to_legal@ag-grid.com___For_help_with_changing_this_key_please_contact_info@ag-grid.com___{Jiffy.ai}_is_granted_a_{Single_Application}_Developer_License_for_the_application_{JIFFY.ai}_only_for_{2}_Front-End_JavaScript_developers___All_Front-End_JavaScript_developers_working_on_{JIFFY.ai}_need_to_be_licensed___{JIFFY.ai}_has_been_granted_a_Deployment_License_Add-on_for_{1}_Production_Environment___This_key_works_with_{AG_Grid}_Enterprise_versions_released_before_{6_December_2026}____[v3]_[01]_MTc5NjUxNTIwMDAwMA==fede4a38cbe23ed9e38798190bf28c06';

LicenseManager.setLicenseKey(AG_GRID_LICENSE_KEY);

// ── Module registration ─────────────────────────────────────────────────────

ModuleRegistry.registerModules([
  ValidationModule,
  CellStyleModule,
  RowStyleModule,
  ClientSideRowModelModule,
  InfiniteRowModelModule,
  PaginationModule,
  RowSelectionModule,
  TextFilterModule,
  NumberFilterModule,
  DateFilterModule,
  SetFilterModule,
  MultiFilterModule,
  MenuModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
  SideBarModule,
  MasterDetailModule,
  AllEnterpriseModule
]);
