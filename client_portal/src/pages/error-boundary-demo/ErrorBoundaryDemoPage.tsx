import { useEffect, useState } from 'react';
import { AlertTriangle, Bomb, Zap } from 'lucide-react';
import { logger } from '@/utils/logger';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Throwing inside render is what a React ErrorBoundary actually catches.
 * Handler-only / async throws don't bubble through render and would crash
 * silently — so this page re-throws them from render via state.
 * Exported so a unit test can assert the thrown error's shape without rendering.
 */
export function explode(label: string): never {
  const err = new Error(`Demo error from ${label}`);
  err.name = 'DemoError';
  throw err;
}

interface BoomState {
  source: 'render' | 'handler' | 'async';
  label: string;
}

export function ErrorBoundaryDemoPage() {
  const [boom, setBoom] = useState<BoomState | null>(null);

  useEffect(() => {
    logger.log('error-boundary-demo:viewed');
  }, []);

  if (boom) {
    explode(boom.label);
  }

  const onRenderThrow = () => {
    logger.log('error-boundary-demo:trigger', { source: 'render' });
    setBoom({ source: 'render', label: 'render-throw button' });
  };

  const onHandlerThrow = () => {
    logger.log('error-boundary-demo:trigger', { source: 'handler' });
    setBoom({ source: 'handler', label: 'handler-throw button' });
  };

  const onAsyncThrow = () => {
    logger.log('error-boundary-demo:trigger', { source: 'async' });
    setTimeout(() => {
      setBoom({ source: 'async', label: 'async-throw button (setTimeout)' });
    }, 50);
  };

  return (
    <div className="mx-auto max-w-3xl p-8">
      <header className="flex items-start gap-3">
        <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Error boundary demo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the buttons below to trigger an error and see the page-level
            ErrorBoundary kick in. In DEV mode the boundary surfaces a
            "Ask JIFFY to fix" button that ships the stack trace via the
            EventLogger.
          </p>
        </div>
      </header>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Triggers</CardTitle>
          <CardDescription>
            Each button throws a <code className="rounded bg-muted px-1 font-mono text-sm">DemoError</code> with a unique message and stack.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={onRenderThrow}
            >
              <Bomb className="h-3.5 w-3.5" />
              Throw on next render
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onHandlerThrow}
            >
              <Zap className="h-3.5 w-3.5" />
              Throw from handler
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onAsyncThrow}
            >
              <Zap className="h-3.5 w-3.5" />
              Throw async (setTimeout 50ms)
            </Button>
          </div>
        </CardContent>
      </Card>

      <Alert className="mt-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <h3 className="font-semibold">How it works</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              React error boundaries only catch errors thrown during render, lifecycle, or constructors —
              not async or event-handler errors directly. This page funnels all three through render state so
              the boundary catches them uniformly.
            </li>
            <li>
              On catch, the boundary logs <code className="rounded bg-muted px-1 font-mono text-xs">error:boundary-caught</code>{' '}
              automatically. Clicking <strong>Ask JIFFY to fix</strong> logs <code className="rounded bg-muted px-1 font-mono text-xs">fix-it</code>{' '}
              with the full stack trace, component stack, URL, and user agent.
            </li>
            <li>Navigating to another page resets the boundary.</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
