import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, Sparkles, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { logger } from '@/utils/logger';

export interface FixItPayload {
  message: string;
  name: string;
  stack: string;
  componentStack: string;
  url: string;
  userAgent: string;
  timestamp: string;
}

/**
 * Build the payload sent to the logger when the user clicks
 * "Ask JIFFY to fix". Kept as a pure function so it's unit-testable
 * without rendering the component.
 */
export function buildFixItPayload(
  error: Error,
  info: ErrorInfo | null,
  ctx: { url?: string; userAgent?: string; now?: () => Date } = {},
): FixItPayload {
  const now = ctx.now ?? (() => new Date());
  return {
    message: error.message ?? String(error),
    name: error.name ?? 'Error',
    stack: error.stack ?? '',
    componentStack: info?.componentStack ?? '',
    url: ctx.url ?? '',
    userAgent: ctx.userAgent ?? '',
    timestamp: now().toISOString(),
  };
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label shown in the error UI (e.g. the route path). */
  context?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    logger.error('error:boundary-caught', {
      message: error.message,
      name: error.name,
      context: this.props.context,
    });
  }

  private handleReset = (): void => {
    this.setState({ error: null, info: null });
  };

  private handleFixIt = (): void => {
    const { error, info } = this.state;
    if (!error) return;
    const payload = buildFixItPayload(error, info, {
      url: typeof window !== 'undefined' ? window.location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
    logger.log('fix-it', { ...payload, context: this.props.context });
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const isDev = import.meta.env.DEV;

    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card className="p-6">
          <Badge variant="destructive" className="gap-1">
            <AlertCircle className="h-3.5 w-3.5" />
            Error
          </Badge>

          <h1 className="mt-3 text-xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isDev
              ? 'An unexpected error was thrown while rendering this page.'
              : 'Please refresh the page or try again later.'}
          </p>

          {isDev && (
            <pre className="mt-4 max-h-64 overflow-auto rounded-lg bg-foreground p-3 text-sm leading-relaxed text-background font-mono">
              {error.name}: {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
              {info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : ''}
            </pre>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={this.handleReset}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </Button>

            {isDev && (
              <Button
                size="sm"
                onClick={this.handleFixIt}
                aria-label="Ask JIFFY to fix"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Ask JIFFY to fix
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }
}
