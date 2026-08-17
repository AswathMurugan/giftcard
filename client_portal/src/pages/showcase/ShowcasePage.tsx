import { useMemo, useState, useCallback, useEffect } from "react"
import type { ColDef, ValueFormatterParams, ICellRendererParams } from "ag-grid-community"
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  ChevronDownIcon,
  MailIcon,
  BellIcon,
  SettingsIcon,
  UserIcon,
  LogOutIcon,
  InfoIcon,
  AlertTriangleIcon,
  StarIcon,
  HeartIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Toggle } from "@/components/ui/toggle"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Kbd } from "@/components/ui/kbd"
import { DataTable, type ServerParams } from "@/components/ui/data-table"
import { Calendar } from "@/components/ui/calendar"
import { DatePicker } from "@/components/ui/date-picker"
import { TimePicker } from "@/components/ui/time-picker"
import type { DateRange } from "react-day-picker"

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  )
}

// ── DataTable demo data ─────────────────────────────────────────────────────

interface Employee {
  id: number
  name: string
  department: string
  title: string
  email: string
  salary: number
  startDate: string
  status: "Active" | "On Leave" | "Terminated"
  performance: number
}

const DEPARTMENTS = ["Engineering", "Design", "Marketing", "Sales", "HR", "Finance", "Legal", "Operations"]
const TITLES = ["Analyst", "Associate", "Senior", "Lead", "Manager", "Director", "VP"]
const STATUSES: Employee["status"][] = ["Active", "On Leave", "Terminated"]
const FIRST_NAMES = ["Alice", "Bob", "Carol", "David", "Eva", "Frank", "Grace", "Hank", "Iris", "Jack", "Kate", "Leo", "Mia", "Noah", "Olivia", "Paul", "Quinn", "Rita", "Sam", "Tina"]
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Chen", "Kim", "Patel", "Singh", "Lee"]

function generateEmployees(count: number): Employee[] {
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST_NAMES[i % FIRST_NAMES.length]
    const last = LAST_NAMES[i % LAST_NAMES.length]
    return {
      id: i + 1,
      name: `${first} ${last}`,
      department: DEPARTMENTS[i % DEPARTMENTS.length],
      title: TITLES[i % TITLES.length],
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      salary: 50000 + Math.floor(Math.random() * 150000),
      startDate: `20${15 + (i % 10)}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      status: STATUSES[i % 3],
      performance: Math.round((3 + Math.random() * 2) * 10) / 10,
    }
  })
}

const DEMO_EMPLOYEES = generateEmployees(85)

// ── Demo: Client-side DataTable ─────────────────────────────────────────────

function DataTableClientDemo() {
  const columnDefs = useMemo<ColDef<Employee>[]>(() => [
    { field: "id", headerName: "ID", width: 80, flex: 0, filter: "agNumberColumnFilter" },
    { field: "name", headerName: "Name", minWidth: 160, filter: "agTextColumnFilter" },
    { field: "department", headerName: "Department", filter: "agSetColumnFilter" },
    { field: "title", headerName: "Title", filter: "agSetColumnFilter" },
    { field: "email", headerName: "Email", minWidth: 220, filter: "agTextColumnFilter" },
    {
      field: "salary",
      headerName: "Salary",
      filter: "agNumberColumnFilter",
      valueFormatter: (params: ValueFormatterParams<Employee>) =>
        params.value != null
          ? `$${(params.value as number).toLocaleString()}`
          : "",
    },
    { field: "startDate", headerName: "Start Date", width: 130, flex: 0, filter: "agDateColumnFilter" },
    { field: "status", headerName: "Status", width: 120, flex: 0, filter: "agSetColumnFilter" },
  ], [])

  return (
    <DataTable<Employee>
      rowData={DEMO_EMPLOYEES}
      columnDefs={columnDefs}
      className="h-[28.75rem]"
    />
  )
}

// ── Demo: Initial-load skeleton ─────────────────────────────────────────────

function DataTableSkeletonDemo() {
  const columnDefs = useMemo<ColDef<Employee>[]>(() => [
    { field: "id", headerName: "ID", width: 80, flex: 0 },
    { field: "name", headerName: "Name", minWidth: 160 },
    { field: "department", headerName: "Department" },
    { field: "title", headerName: "Title" },
    { field: "email", headerName: "Email", minWidth: 220 },
    { field: "status", headerName: "Status", width: 120, flex: 0 },
  ], [])

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Employee[]>([])

  const load = useCallback(() => {
    setLoading(true)
    setRows([])
    const timer = setTimeout(() => {
      setRows(DEMO_EMPLOYEES.slice(0, 8))
      setLoading(false)
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => load(), [load])

  return (
    <div className="space-y-3">
      <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
        {loading ? "Loading…" : "Reload (show skeleton)"}
      </Button>
      <DataTable<Employee>
        rowData={rows}
        isLoading={loading}
        columnDefs={columnDefs}
        className="h-[26.25rem]"
      />
    </div>
  )
}

// ── Demo: Infinite row model (simulated server) ─────────────────────────────

const ALL_INFINITE_ROWS = generateEmployees(500)

function DataTableInfiniteDemo() {
  const columnDefs = useMemo<ColDef<Employee>[]>(() => [
    { field: "id", headerName: "ID", width: 80, flex: 0, filter: "agNumberColumnFilter" },
    { field: "name", headerName: "Name", minWidth: 160, filter: "agTextColumnFilter" },
    { field: "department", headerName: "Department", filter: "agSetColumnFilter", filterParams: { values: DEPARTMENTS } },
    { field: "title", headerName: "Title", filter: "agSetColumnFilter", filterParams: { values: TITLES } },
    {
      field: "salary",
      headerName: "Salary",
      filter: "agNumberColumnFilter",
      valueFormatter: (params: ValueFormatterParams<Employee>) =>
        params.value != null
          ? `$${(params.value as number).toLocaleString()}`
          : "",
    },
    { field: "status", headerName: "Status", width: 120, flex: 0, filter: "agSetColumnFilter", filterParams: { values: STATUSES } },
  ], [])

  const [pageRows, setPageRows] = useState<Employee[] | null>(null)
  const [totalRows, setTotalRows] = useState<number | undefined>(undefined)

  const handleParamsChange = useCallback(({ page, pageSize, sortModel, filterModel }: ServerParams) => {
    // Simulate server: apply filter → sort → paginate, then push the
    // page slice back via state. DataTable resolves AG Grid for us.
    const timer = setTimeout(() => {
      let result = [...ALL_INFINITE_ROWS]

      // ── Filter ────────────────────────────────────────
      if (filterModel) {
        for (const [field, model] of Object.entries(filterModel) as [string, any][]) {
          result = result.filter((row) => {
            const value = (row as any)[field]
            if (model.filterType === "set") {
              return model.values?.includes(value) ?? true
            }
            if (model.filterType === "text") {
              const v = String(value ?? "").toLowerCase()
              const f = String(model.filter ?? "").toLowerCase()
              switch (model.type) {
                case "contains": return v.includes(f)
                case "notContains": return !v.includes(f)
                case "equals": return v === f
                case "notEqual": return v !== f
                case "startsWith": return v.startsWith(f)
                case "endsWith": return v.endsWith(f)
                default: return true
              }
            }
            if (model.filterType === "number") {
              const v = Number(value)
              const f = Number(model.filter)
              switch (model.type) {
                case "equals": return v === f
                case "notEqual": return v !== f
                case "greaterThan": return v > f
                case "greaterThanOrEqual": return v >= f
                case "lessThan": return v < f
                case "lessThanOrEqual": return v <= f
                case "inRange": return v >= f && v <= Number(model.filterTo)
                default: return true
              }
            }
            return true
          })
        }
      }

      // ── Sort ──────────────────────────────────────────
      if (sortModel.length) {
        const { colId, sort } = sortModel[0]
        result.sort((a, b) => {
          const va = (a as any)[colId]
          const vb = (b as any)[colId]
          if (va === vb) return 0
          const cmp = va > vb ? 1 : -1
          return sort === "asc" ? cmp : -cmp
        })
      }

      const start = page * pageSize
      setPageRows(result.slice(start, start + pageSize))
      setTotalRows(result.length)
    }, 300)
    return () => clearTimeout(timer)
  }, [])

  return (
    <DataTable<Employee>
      rowData={pageRows}
      count={totalRows}
      onParamsChange={handleParamsChange}
      columnDefs={columnDefs}
      className="h-[28.75rem]"
    />
  )
}

// ── Demo: Custom renderers, pinning, selection ──────────────────────────────

function StatusCellRenderer(params: ICellRendererParams<Employee>) {
  const status = params.value as Employee["status"] | undefined
  if (!status) return null
  const color =
    status === "Active"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300"
      : status === "On Leave"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300"
        : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {status}
    </span>
  )
}

function PerformanceCellRenderer(params: ICellRendererParams<Employee>) {
  const value = params.value as number | undefined
  if (value == null) return null
  const pct = ((value - 3) / 2) * 100
  const barColor = value >= 4.5 ? "bg-emerald-500" : value >= 3.5 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="flex items-center gap-2 h-full">
      <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <span className="text-xs tabular-nums">{value.toFixed(1)}</span>
    </div>
  )
}

function DataTableCustomDemo() {
  const columnDefs = useMemo<ColDef<Employee>[]>(() => [
    {
      field: "name",
      headerName: "Name",
      pinned: "left",
      minWidth: 160,
      filter: "agTextColumnFilter",
      checkboxSelection: true,
      headerCheckboxSelection: true,
    },
    { field: "department", headerName: "Department", filter: "agSetColumnFilter" },
    { field: "title", headerName: "Title", filter: "agSetColumnFilter" },
    {
      field: "salary",
      headerName: "Salary",
      filter: "agNumberColumnFilter",
      valueFormatter: (params: ValueFormatterParams<Employee>) =>
        params.value != null
          ? `$${(params.value as number).toLocaleString()}`
          : "",
    },
    {
      field: "status",
      headerName: "Status",
      width: 130,
      flex: 0,
      filter: "agSetColumnFilter",
      cellRenderer: StatusCellRenderer,
    },
    {
      field: "performance",
      headerName: "Performance",
      width: 170,
      flex: 0,
      filter: "agNumberColumnFilter",
      cellRenderer: PerformanceCellRenderer,
    },
    { field: "startDate", headerName: "Start Date", width: 130, flex: 0, filter: "agDateColumnFilter" },
  ], [])

  const [selectedCount, setSelectedCount] = useState(0)

  const onSelectionChanged = useCallback((event: any) => {
    setSelectedCount(event.api.getSelectedRows().length)
  }, [])

  return (
    <div>
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 border-b px-4 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{selectedCount}</span> row{selectedCount !== 1 ? "s" : ""} selected
        </div>
      )}
      <DataTable<Employee>
        rowData={DEMO_EMPLOYEES}
        columnDefs={columnDefs}
        className="h-[28.75rem]"
        rowSelection="multiple"
        onSelectionChanged={onSelectionChanged}
      />
    </div>
  )
}

/**
 * Select whose options load asynchronously while a value is already set —
 * the common prefill case (e.g. an address form's country dropdown backed by
 * a saved query). `lookupValue` keeps the known label visible during the gap
 * before the matching `<SelectItem>` mounts; once options arrive, the real
 * option's text takes over. Without it the trigger would show the placeholder
 * even though a value is selected.
 */
function AsyncSelectDemo() {
  // Pretend these arrive from an async query a moment after mount.
  const [options, setOptions] = useState<{ id: string; name: string }[]>([])
  // A value that's already known up-front (as if prefilled from a record).
  const [value] = useState("us")
  const knownLabel = "United States of America"

  useEffect(() => {
    const t = setTimeout(
      () =>
        setOptions([
          { id: "us", name: "United States of America" },
          { id: "ca", name: "Canada" },
          { id: "gb", name: "United Kingdom" },
        ]),
      1500,
    )
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="space-y-2">
      <Label>Country (async options, prefilled)</Label>
      <Select value={value}>
        <SelectTrigger className="w-full">
          {/* lookupValue bridges the async gap so the label shows immediately */}
          <SelectValue placeholder="Select a country" lookupValue={knownLabel} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Options load after ~1.5s; the trigger shows the label the whole time
        via <code>lookupValue</code>.
      </p>
    </div>
  )
}

export function ShowcasePage() {
  const [progress, setProgress] = useState(60)
  const [sliderValue, setSliderValue] = useState([40])
  const [calendarDate, setCalendarDate] = useState<Date | undefined>(new Date())
  const [pickerDate, setPickerDate] = useState<Date | undefined>(undefined)
  const [pickerRange, setPickerRange] = useState<DateRange | undefined>(undefined)
  const [time24, setTime24] = useState("09:30")
  const [time12, setTime12] = useState("14:15")

  return (
    <TooltipProvider>
      {/* Renders inside DefaultLayout's scrollable <main>; no min-h-svh /
          sticky header / nested scroll container — that page owns the scroll. */}
      <div className="text-foreground">
        {/* Header */}
        <header className="mb-10 border-b pb-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold">
                Component Showcase
              </h1>
              <Badge variant="secondary">shadcn/ui</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Press <Kbd>d</Kbd> to toggle dark mode
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="mx-auto max-w-5xl space-y-12">
          {/* Buttons */}
          <Section title="Button">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="tertiary">Tertiary</Button>
              <Button variant="ghost">Ghost</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="default">Default</Button>
              <Button size="icon">
                <HeartIcon />
              </Button>
              <Button disabled>Disabled</Button>
            </div>
          </Section>

          <Separator />

          {/* Badges */}
          <Section title="Badge">
            <div className="flex flex-wrap items-center gap-3">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="success">Live</Badge>
              <Badge variant="info">Info</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="destructive">Danger</Badge>
            </div>
          </Section>

          <Separator />

          {/* Cards */}
          <Section title="Card">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>Notifications</CardTitle>
                  <CardDescription>
                    You have 3 unread messages.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <BellIcon className="size-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Push Notifications</p>
                      <p className="text-xs text-muted-foreground">
                        Send notifications to device.
                      </p>
                    </div>
                    <Switch className="ml-auto" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Team Members</CardTitle>
                  <CardDescription>
                    Invite your team members to collaborate.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AvatarGroup>
                    <Avatar>
                      <AvatarFallback>JD</AvatarFallback>
                    </Avatar>
                    <Avatar>
                      <AvatarFallback>AS</AvatarFallback>
                    </Avatar>
                    <Avatar>
                      <AvatarFallback>MK</AvatarFallback>
                    </Avatar>
                    <AvatarGroupCount>+5</AvatarGroupCount>
                  </AvatarGroup>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" size="sm" className="w-full">
                    <UserIcon /> Invite
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Storage</CardTitle>
                  <CardDescription>
                    You&apos;ve used 60% of your storage.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Progress value={progress} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>6.0 GB used</span>
                    <span>10.0 GB total</span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button size="sm" className="w-full">Upgrade Plan</Button>
                </CardFooter>
              </Card>
            </div>
          </Section>

          <Separator />

          {/* Form Inputs */}
          <Section title="Form Inputs">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    placeholder="Type your message here..."
                  />
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <Label>Framework</Label>
                  <Select>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a framework" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="react">React</SelectItem>
                      <SelectItem value="vue">Vue</SelectItem>
                      <SelectItem value="svelte">Svelte</SelectItem>
                      <SelectItem value="angular">Angular</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <AsyncSelectDemo />

                <div className="space-y-3">
                  <Label>Preferences</Label>
                  <div className="flex items-center gap-2">
                    <Checkbox id="terms" />
                    <Label htmlFor="terms" className="font-normal">
                      Accept terms and conditions
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="newsletter" defaultChecked />
                    <Label htmlFor="newsletter" className="font-normal">
                      Subscribe to newsletter
                    </Label>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label>Plan</Label>
                  <RadioGroup defaultValue="pro">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="free" id="free" />
                      <Label htmlFor="free" className="font-normal">
                        Free
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="pro" id="pro" />
                      <Label htmlFor="pro" className="font-normal">
                        Pro
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="enterprise" id="enterprise" />
                      <Label htmlFor="enterprise" className="font-normal">
                        Enterprise
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>
            </div>
          </Section>

          <Separator />

          {/* Switch & Slider */}
          <Section title="Switch & Slider">
            <div className="grid gap-6 sm:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Airplane Mode</Label>
                    <Switch />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <Label>Wi-Fi</Label>
                    <Switch defaultChecked />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <Label>Bluetooth</Label>
                    <Switch defaultChecked />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Volume: {sliderValue[0]}%</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <Slider
                    value={sliderValue}
                    onValueChange={setSliderValue}
                    max={100}
                    step={1}
                  />
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Upload progress</span>
                      <span>{progress}%</span>
                    </div>
                    <Progress value={progress} />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setProgress((p) => Math.max(0, p - 10))
                        }
                      >
                        -10
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setProgress((p) => Math.min(100, p + 10))
                        }
                      >
                        +10
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Separator />

          {/* Tabs */}
          <Section title="Tabs">
            <Tabs defaultValue="account">
              <TabsList>
                <TabsTrigger value="account">Account</TabsTrigger>
                <TabsTrigger value="password">Password</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
              </TabsList>
              <TabsContent value="account">
                <Card>
                  <CardHeader>
                    <CardTitle>Account</CardTitle>
                    <CardDescription>
                      Make changes to your account here. Click save when
                      you&apos;re done.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" defaultValue="John Doe" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="username">Username</Label>
                      <Input id="username" defaultValue="@johndoe" />
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button>Save changes</Button>
                  </CardFooter>
                </Card>
              </TabsContent>
              <TabsContent value="password">
                <Card>
                  <CardHeader>
                    <CardTitle>Password</CardTitle>
                    <CardDescription>
                      Change your password here. After saving, you&apos;ll be
                      logged out.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="current">Current password</Label>
                      <Input id="current" type="password" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new">New password</Label>
                      <Input id="new" type="password" />
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button>Save password</Button>
                  </CardFooter>
                </Card>
              </TabsContent>
              <TabsContent value="notifications">
                <Card>
                  <CardHeader>
                    <CardTitle>Notifications</CardTitle>
                    <CardDescription>
                      Choose what you want to be notified about.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Email notifications</p>
                        <p className="text-xs text-muted-foreground">
                          Receive emails about your account activity.
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Push notifications</p>
                        <p className="text-xs text-muted-foreground">
                          Receive push notifications on your device.
                        </p>
                      </div>
                      <Switch />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </Section>

          <Separator />

          {/* Date & Time */}
          <Section title="Date & Time">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Calendar</CardTitle>
                </CardHeader>
                <CardContent className="flex justify-center">
                  <Calendar
                    mode="single"
                    selected={calendarDate}
                    onSelect={setCalendarDate}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Date Picker</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="demo-date-single">Single date</Label>
                    <DatePicker
                      id="demo-date-single"
                      value={pickerDate}
                      onChange={setPickerDate}
                      placeholder="Pick a date"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="demo-date-range">Date range</Label>
                    <DatePicker
                      id="demo-date-range"
                      mode="range"
                      value={pickerRange}
                      onChange={setPickerRange}
                      placeholder="Pick a range"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Time Picker (24h)</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-3">
                  <TimePicker value={time24} onChange={setTime24} />
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {time24}
                  </span>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Time Picker (12h)</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-3">
                  <TimePicker value={time12} onChange={setTime12} hour12 minuteStep={5} />
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {time12}
                  </span>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Separator />

          {/* Alerts */}
          <Section title="Alert">
            <div className="space-y-3">
              <Alert>
                <InfoIcon />
                <AlertTitle>Heads up!</AlertTitle>
                <AlertDescription>
                  You can add components to your app using the CLI.
                </AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  Your session has expired. Please log in again.
                </AlertDescription>
              </Alert>
            </div>
          </Section>

          <Separator />

          {/* Accordion */}
          <Section title="Accordion">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>Is it accessible?</AccordionTrigger>
                <AccordionContent>
                  Yes. It adheres to the WAI-ARIA design pattern.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>Is it styled?</AccordionTrigger>
                <AccordionContent>
                  Yes. It comes with default styles that matches the other
                  components&apos; aesthetic.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>Is it animated?</AccordionTrigger>
                <AccordionContent>
                  Yes. It&apos;s animated by default, but you can disable it if
                  you prefer.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Section>

          <Separator />

          {/* Dialog & Dropdown */}
          <Section title="Dialog & Dropdown">
            <div className="flex flex-wrap items-center gap-3">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <MailIcon /> Open Dialog
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Edit profile</DialogTitle>
                    <DialogDescription>
                      Make changes to your profile here. Click save when
                      you&apos;re done.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="dialog-name">Name</Label>
                      <Input id="dialog-name" defaultValue="John Doe" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dialog-email">Email</Label>
                      <Input
                        id="dialog-email"
                        defaultValue="john@example.com"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button>Save changes</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <SettingsIcon /> Options <ChevronDownIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>My Account</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <UserIcon /> Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <SettingsIcon /> Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <BellIcon /> Notifications
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <LogOutIcon /> Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon">
                    <InfoIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>This is a tooltip</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </Section>

          {/* DataTable — Client-Side */}
          <Section title="DataTable (Client-Side)">
            <p className="text-sm text-muted-foreground">
              AG Grid Enterprise with project theme. Sorting, filtering,
              resizable columns, and pagination are enabled by default.
            </p>
            <Card className="overflow-hidden">
              <DataTableClientDemo />
            </Card>
          </Section>

          <Separator />

          {/* DataTable — Loading skeleton */}
          <Section title="DataTable (Loading Skeleton)">
            <p className="text-sm text-muted-foreground">
              On the first load (while <code>isLoading</code> is true and no
              rows have arrived) the table shows a shimmer skeleton. Once the
              grid mounts, later fetches use AG Grid&rsquo;s own overlay.
            </p>
            <Card className="overflow-hidden">
              <DataTableSkeletonDemo />
            </Card>
          </Section>

          <Separator />

          {/* DataTable — Infinite Row Model */}
          <Section title="DataTable (Server-Side / Infinite)">
            <p className="text-sm text-muted-foreground">
              Infinite row model with simulated server-side pagination.
              Scroll down to lazy-load more rows. Sorting and filtering
              requests are sent to the datasource.
            </p>
            <Card className="overflow-hidden">
              <DataTableInfiniteDemo />
            </Card>
          </Section>

          <Separator />

          {/* DataTable — Custom Cell Renderers */}
          <Section title="DataTable (Custom Renderers & Features)">
            <p className="text-sm text-muted-foreground">
              Demonstrates custom cell renderers, value formatters,
              pinned columns, and row selection.
            </p>
            <Card className="overflow-hidden">
              <DataTableCustomDemo />
            </Card>
          </Section>

          <Separator />

          {/* Toggle */}
          <Section title="Toggle">
            <div className="flex flex-wrap items-center gap-2">
              <Toggle aria-label="Toggle bold">
                <BoldIcon />
              </Toggle>
              <Toggle aria-label="Toggle italic">
                <ItalicIcon />
              </Toggle>
              <Toggle aria-label="Toggle underline">
                <UnderlineIcon />
              </Toggle>
              <Separator orientation="vertical" className="h-8" />
              <Toggle variant="outline" aria-label="Toggle star">
                <StarIcon />
              </Toggle>
              <Toggle variant="outline" aria-label="Toggle heart">
                <HeartIcon />
              </Toggle>
            </div>
          </Section>

          <Separator />

          {/* Avatars */}
          <Section title="Avatar">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar size="sm">
                <AvatarFallback>SM</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>DF</AvatarFallback>
              </Avatar>
              <Avatar size="lg">
                <AvatarFallback>LG</AvatarFallback>
              </Avatar>
              <Separator orientation="vertical" className="h-10" />
              <AvatarGroup>
                <Avatar>
                  <AvatarFallback>AB</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>CD</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>EF</AvatarFallback>
                </Avatar>
                <Avatar>
                  <AvatarFallback>GH</AvatarFallback>
                </Avatar>
                <AvatarGroupCount>+3</AvatarGroupCount>
              </AvatarGroup>
            </div>
          </Section>

          <Separator />

          {/* Skeleton */}
          <Section title="Skeleton">
            <div className="flex items-center gap-4">
              <Skeleton className="size-12 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-[15.625rem]" />
                <Skeleton className="h-4 w-[12.5rem]" />
              </div>
            </div>
          </Section>

          <Separator />

          {/* Keyboard Shortcuts */}
          <Section title="Keyboard Shortcuts">
            <div className="flex flex-wrap items-center gap-3">
              <Kbd>Ctrl</Kbd>
              <span className="text-muted-foreground">+</span>
              <Kbd>C</Kbd>
              <span className="text-sm text-muted-foreground ml-2">Copy</span>
              <Separator orientation="vertical" className="h-6 mx-2" />
              <Kbd>Ctrl</Kbd>
              <span className="text-muted-foreground">+</span>
              <Kbd>V</Kbd>
              <span className="text-sm text-muted-foreground ml-2">Paste</span>
              <Separator orientation="vertical" className="h-6 mx-2" />
              <Kbd>Ctrl</Kbd>
              <span className="text-muted-foreground">+</span>
              <Kbd>Z</Kbd>
              <span className="text-sm text-muted-foreground ml-2">Undo</span>
            </div>
          </Section>

          {/* Footer */}
          <Separator />
          <footer className="text-center text-sm text-muted-foreground">
            Built with shadcn/ui, Radix UI, and Tailwind CSS.
          </footer>
        </div>
      </div>
    </TooltipProvider>
  )
}
