import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  RefreshCw,
  Search,
  Check,
  X,
  Minus,
  ChevronDown,
  Sparkles,
  Clock,
  Tag,
  Calendar,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';

type Status = 'passed' | 'failed' | 'skipped';

type TestCase = {
  id: string;
  title: string;
  status: Status;
  durationMs: number;
  tags: string[];
  failureMessages: string[];
};

type TestGroup = {
  id: string;
  title: string;
  description: string;
  tests: TestCase[];
};

type AssertionResult = {
  ancestorTitles: string[];
  fullName: string;
  status: string;
  title: string;
  duration?: number;
  failureMessages: string[];
  tags?: string[];
};

type FileResult = {
  name: string;
  startTime: number;
  endTime: number;
  status: string;
  assertionResults: AssertionResult[];
};

type VitestResults = {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  startTime: number;
  success: boolean;
  testResults: FileResult[];
};

type Filter = 'all' | 'failed' | 'skipped' | 'passed';

const EMPTY_RESULTS: VitestResults = {
  numTotalTests: 0,
  numPassedTests: 0,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  startTime: Date.now(),
  success: true,
  testResults: [],
};

export function TestResultsPage() {
  const [data, setData] = useState<VitestResults>(EMPTY_RESULTS);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    // Each reload supersedes the previous one. A rapid test run can fire
    // `jiffy:tests-updated` while an earlier fetch is still open, so without the
    // sequence check a slow earlier response can overwrite the newer results.
    let generation = 0;

    const loadResults = () => {
      const request = ++generation;
      fetch(new URL('../../../test-results/results.json', import.meta.url).href, {
        cache: 'no-store',
      })
        .then((res) => {
          if (!res.ok) throw new Error(res.statusText);
          return res.json();
        })
        .then((json) => {
          if (cancelled || request !== generation) return;
          setData(json as VitestResults);
          setLoaded(true);
        })
        .catch(() => {
          if (cancelled || request !== generation) return;
          setLoaded(true);
        });
    };

    loadResults();

    // The dev server fires `jiffy:tests-updated` over Vite's HMR socket when the
    // background test run finishes (see vite.config.ts). Re-fetch in place so the
    // results refresh without a second full-page reload.
    if (import.meta.hot) {
      import.meta.hot.on('jiffy:tests-updated', loadResults);
      return () => {
        cancelled = true;
        import.meta.hot?.off('jiffy:tests-updated', loadResults);
      };
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => buildGroups(data), [data]);

  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups) {
      for (const t of g.tests) {
        for (const tag of t.tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => {
        if (a.tag === 'important') return -1;
        if (b.tag === 'important') return 1;
        return a.tag.localeCompare(b.tag);
      });
  }, [groups]);

  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => {
    const tagSet = new Set(availableTags.map((t) => t.tag));
    return tagSet.has('important') ? new Set(['important']) : new Set();
  });

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const counts = useMemo(() => {
    const passed = data.numPassedTests;
    const failed = data.numFailedTests;
    const skipped = data.numPendingTests + data.numTodoTests;
    return { total: passed + failed + skipped, passed, failed, skipped };
  }, [data]);

  const passRate = counts.total === 0 ? 0 : Math.round((counts.passed / counts.total) * 100);

  const failedTests = useMemo(
    () => groups.flatMap((g) => g.tests.filter((t) => t.status === 'failed')),
    [groups],
  );

  const runMeta = useMemo(() => deriveRunMeta(data), [data]);

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        tests: group.tests.filter((t) => {
          if (filter !== 'all' && t.status !== filter) return false;
          if (selectedTags.size > 0 && !t.tags.some((tag) => selectedTags.has(tag))) {
            return false;
          }
          if (q === '') return true;
          return (
            t.id.toLowerCase().includes(q) ||
            t.title.toLowerCase().includes(q) ||
            t.tags.some((tag) => tag.toLowerCase().includes(q))
          );
        }),
      }))
      .filter((g) => g.tests.length > 0);
  }, [filter, query, groups, selectedTags]);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center p-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
      </div>
    );
  }

  if (data.numTotalTests === 0) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <h1 className="text-2xl font-bold">Test Results</h1>
        <p className="mt-2 text-muted-foreground">
          No test results found. Run <code className="rounded bg-muted px-1 font-mono text-sm">npm test</code> to generate results.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-8 py-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">Functional Tests</h1>
              {counts.failed > 0 ? (
                <Badge variant="destructive">Failed</Badge>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-700">Passed</Badge>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {runMeta.timestamp}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {runMeta.duration}
              </span>
              <Badge variant="secondary" className="gap-1">
                <Tag className="h-3 w-3" />
                {runMeta.tag}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm">
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button size="sm">
              <RefreshCw className="h-4 w-4" />
              Re-run all
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="flex items-center gap-4 p-5">
            <div className="relative h-14 w-14 flex-shrink-0">
              <Progress value={passRate} className="h-14 w-14" />
              <div className="absolute inset-0 grid place-content-center text-center">
                <div className="text-sm font-bold">{passRate}%</div>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pass rate</div>
              <div className="mt-0.5 text-sm font-medium">{counts.passed} of {counts.total} passing</div>
            </div>
          </Card>
          <Card className="flex items-center gap-4 p-5">
            <div className="grid h-10 w-10 place-content-center rounded-full bg-emerald-100 text-emerald-700">
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Passed</div>
              <div className="mt-0.5 text-2xl font-bold leading-none">{counts.passed}</div>
            </div>
          </Card>
          <Card className={cn("flex items-center gap-4 p-5", counts.failed > 0 && "border-destructive/30")}>
            <div className="grid h-10 w-10 place-content-center rounded-full bg-red-100 text-red-700">
              <X className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Failed</div>
              <div className="mt-0.5 text-2xl font-bold leading-none">{counts.failed}</div>
            </div>
          </Card>
          <Card className="flex items-center gap-4 p-5">
            <div className="grid h-10 w-10 place-content-center rounded-full bg-muted text-muted-foreground">
              <Minus className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Skipped</div>
              <div className="mt-0.5 text-2xl font-bold leading-none">{counts.skipped}</div>
            </div>
          </Card>
        </div>

        {/* JIFFY callout */}
        {failedTests.length > 0 && (
          <Card className="mt-4 border-amber-200 bg-amber-50/70 p-4">
            <div className="flex flex-wrap items-start gap-4">
              <div className="grid h-9 w-9 flex-shrink-0 place-content-center rounded-full bg-foreground">
                <Sparkles className="h-4 w-4 text-amber-300" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  JIFFY can investigate {failedTests.length} failing test{failedTests.length === 1 ? '' : 's'}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  I'll read each failure, look at recent changes to the relevant files, and propose a fix you can review before merging.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {failedTests.map((t) => (
                    <Button key={t.id} variant="outline" size="sm" className="gap-1.5 rounded-full">
                      <span className="grid h-3.5 w-3.5 place-content-center rounded-full bg-red-600">
                        <X className="h-2.5 w-2.5 text-white" strokeWidth={3} />
                      </span>
                      {t.id}
                      <Sparkles className="h-3 w-3 text-amber-500" />
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              <TabsTrigger value="all">All ({counts.total})</TabsTrigger>
              <TabsTrigger value="failed">Failed ({counts.failed})</TabsTrigger>
              <TabsTrigger value="skipped">Skipped ({counts.skipped})</TabsTrigger>
              <TabsTrigger value="passed">Passed ({counts.passed})</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tests..."
              className="w-52 pl-9"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tag filter */}
        {availableTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Tag className="h-3 w-3" />
              Tags
            </span>
            {availableTags.map(({ tag, count }) => (
              <Toggle
                key={tag}
                size="sm"
                pressed={selectedTags.has(tag)}
                onPressedChange={() => toggleTag(tag)}
                className="gap-1 rounded-full text-xs"
              >
                {selectedTags.has(tag) && <Check className="h-3 w-3" strokeWidth={3} />}
                {tag}
                <Badge variant="secondary" className="h-4 px-1 text-[0.625rem]">{count}</Badge>
              </Toggle>
            ))}
            {selectedTags.size > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedTags(new Set())} className="gap-1 text-xs">
                <X className="h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
        )}

        {/* Groups */}
        <div className="mt-4 space-y-4">
          {visibleGroups.length === 0 ? (
            <Card className="p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Search className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-4 text-base font-semibold">No tests match this view</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try clearing the search, switching tabs, or removing tag filters.
              </p>
            </Card>
          ) : (
            visibleGroups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                collapsed={!!collapsed[group.id]}
                onToggle={() =>
                  setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))
                }
              />
            ))
          )}
        </div>
      </main>
    </div>
  );
}

function GroupCard({
  group,
  collapsed,
  onToggle,
}: {
  group: TestGroup;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const passed = group.tests.filter((t) => t.status === 'passed').length;
  const failed = group.tests.filter((t) => t.status === 'failed').length;
  const skipped = group.tests.filter((t) => t.status === 'skipped').length;
  const counted = passed + failed;
  const passWidth = counted === 0 ? 0 : (passed / counted) * 100;

  return (
    <Card className="overflow-hidden">
      <header
        onClick={onToggle}
        className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/50"
      >
        <div className="flex min-w-0 items-center gap-2">
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform',
              collapsed && '-rotate-90',
            )}
          />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h3 className="truncate text-base font-bold">{group.title}</h3>
              <span className="text-xs font-medium text-muted-foreground">
                {group.tests.length} test{group.tests.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{group.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative h-1.5 w-40 overflow-hidden rounded-full bg-red-200">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${passWidth}%` }}
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            {failed > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                <X className="h-3 w-3" strokeWidth={3} /> {failed}
              </span>
            )}
            {passed > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                <Check className="h-3 w-3" strokeWidth={3} /> {passed}
              </span>
            )}
            {skipped > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground">
                <Minus className="h-3 w-3" strokeWidth={3} /> {skipped}
              </span>
            )}
          </div>
        </div>
      </header>

      {!collapsed && (
        <ul className="divide-y border-t">
          {group.tests.map((t) => (
            <TestRow key={t.id} test={t} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function TestRow({ test }: { test: TestCase }) {
  const isFailed = test.status === 'failed';
  const [expanded, setExpanded] = useState(false);
  const hasFailure = test.failureMessages.length > 0;

  return (
    <li className={cn('transition-colors list-none', isFailed ? 'bg-red-50/30 hover:bg-red-50/60' : 'hover:bg-muted/30')}>
      <div className="group flex items-center gap-4 px-5 py-3">
        <StatusBubble status={test.status} />
        <code className="font-mono text-xs text-muted-foreground">{test.id}</code>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            isFailed ? 'font-semibold' : '',
          )}
          title={test.title}
        >
          {test.title}
        </span>

        {test.tags.length > 0 && (
          <div className="hidden gap-1 lg:flex">
            {test.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[0.6875rem]">{tag}</Badge>
            ))}
          </div>
        )}

        {isFailed && (
          <Button size="default" className="opacity-0 transition-opacity group-hover:opacity-100">
            <Sparkles className="h-3 w-3 text-amber-300" />
            Ask JIFFY to fix
          </Button>
        )}

        <span className="w-16 flex-shrink-0 text-right text-xs text-muted-foreground">
          {formatDuration(test.durationMs, test.status)}
        </span>
        {isFailed && hasFailure && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setExpanded((v) => !v)}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
          </Button>
        )}
      </div>

      {isFailed && hasFailure && expanded && (
        <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-background p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-destructive">
            {test.failureMessages.join('\n\n')}
          </pre>
        </div>
      )}
    </li>
  );
}

function StatusBubble({ status }: { status: Status }) {
  if (status === 'passed') {
    return (
      <span className="grid h-5 w-5 flex-shrink-0 place-content-center rounded-full bg-emerald-100 text-emerald-700">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="grid h-5 w-5 flex-shrink-0 place-content-center rounded-full bg-red-600 text-white">
        <X className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="grid h-5 w-5 flex-shrink-0 place-content-center rounded-full bg-muted text-muted-foreground">
      <Minus className="h-3 w-3" strokeWidth={3} />
    </span>
  );
}

function formatDuration(ms: number, status: Status): string {
  if (status === 'skipped') return '\u2014';
  if (ms < 1) return '< 1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function buildGroups(d: VitestResults): TestGroup[] {
  const groups = new Map<string, TestGroup>();

  for (const file of d.testResults) {
    const fileBase = (file.name.split('/').pop() ?? file.name).replace(
      /\.(test|spec)\.[tj]sx?$/,
      '',
    );
    for (const a of file.assertionResults) {
      const top = a.ancestorTitles[0] ?? humanize(fileBase);
      if (!groups.has(top)) {
        groups.set(top, {
          id: slugify(top),
          title: humanize(top),
          description: file.name.split('/').slice(-2).join('/'),
          tests: [],
        });
      }
      const grp = groups.get(top)!;
      const subPath = [...a.ancestorTitles.slice(1), a.title].join(' > ');
      const id = `${initials(top)}-${String(grp.tests.length + 1).padStart(3, '0')}`;
      const status: Status = normaliseStatus(a.status);
      grp.tests.push({
        id,
        title: subPath || a.title,
        status,
        durationMs: a.duration ?? 0,
        tags: a.tags ?? [],
        failureMessages: a.failureMessages ?? [],
      });
    }
  }

  return Array.from(groups.values());
}

function normaliseStatus(s: string): Status {
  if (s === 'passed') return 'passed';
  if (s === 'failed') return 'failed';
  return 'skipped';
}

function humanize(s: string): string {
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function initials(s: string): string {
  const words = s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return words
      .map((w) => w[0])
      .slice(0, 3)
      .join('')
      .toUpperCase();
  }
  return s.slice(0, 2).toUpperCase();
}

function deriveRunMeta(d: VitestResults): {
  timestamp: string;
  duration: string;
  tag: string;
} {
  const ts = new Date(d.startTime);
  const timestamp = ts.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  let durationMs = 0;
  if (d.testResults.length > 0) {
    const minStart = Math.min(...d.testResults.map((r) => r.startTime));
    const maxEnd = Math.max(...d.testResults.map((r) => r.endTime));
    durationMs = Math.max(0, maxEnd - minStart);
  }
  if (durationMs < 1000) {
    durationMs = d.testResults.reduce(
      (acc, r) =>
        acc +
        r.assertionResults.reduce((s, a) => s + (a.duration ?? 0), 0),
      0,
    );
  }

  const duration = formatRunDuration(durationMs);
  const fileCount = d.testResults.length;
  const tag = `Vitest \u00b7 ${fileCount} file${fileCount === 1 ? '' : 's'}`;

  return { timestamp, duration, tag };
}

function formatRunDuration(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 1) return `${Math.max(1, Math.round(ms))} ms`;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 2 : 1)} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  return `${minutes}m ${seconds}s`;
}
