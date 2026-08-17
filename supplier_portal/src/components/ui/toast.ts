// Imperative half of the toast system. The render half — the styled
// `<Toaster />` container (theme, tokens, status icons) — lives in `./sonner`
// and is mounted once, app-wide, in `src/App.tsx`.
//
// App code fires toasts through THIS path, never from the `sonner` package
// directly, so the whole codebase shares one import:
//
//   import { toast } from '@/components/ui/toast'
//   toast.success('Saved', { testId: 'toast-save' })
//
// (Separate file rather than an export from `sonner.tsx` because a component
// file may only export components — react-refresh/only-export-components.)
export { toast } from "sonner"
