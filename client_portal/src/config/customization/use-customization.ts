/**
 * useCustomization — the hook shadcn primitives call to self-customize.
 *
 * Customization is OPTIONAL and attaches per-instance: a primitive becomes
 * customizable only when a `config` slot is passed. With no slot the hook is
 * a transparent no-op (the component renders exactly as a stock shadcn
 * primitive), so there is no separate "Cfg" component set — the primitive
 * itself is the single component.
 *
 * Returns the resolved overrides + a `hidden` flag (permission denied OR
 * `visible:false`) + pre-merged className/style, so each primitive applies
 * customization in ~3 lines regardless of its shape.
 */
import { useMemo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { useComponentConfig } from './ConfigProvider';
import type { ComponentConfig, Slot } from './types';

export interface CustomizationResult {
  /** Resolved config (defaults + server override), or null when no slot. */
  config: ComponentConfig | null;
  /** True when the component must render nothing (no permission or hidden). */
  hidden: boolean;
  /** className merged: caller classes first, then preference override. */
  className: string | undefined;
  /** style merged: caller style first, then preference override wins. */
  style: CSSProperties | undefined;
}

/**
 * @param slot            Optional schema node. When omitted, no customization
 *                        is applied and the component renders normally. The
 *                        page name (for the permission check) is derived from
 *                        the slot id — there is no separate `page` argument.
 * @param callerClassName The component's own className.
 * @param callerStyle     The component's own style.
 */
export function useCustomization(
  slot: Slot | undefined,
  callerClassName?: string,
  callerStyle?: CSSProperties,
): CustomizationResult {
  // Hooks must run unconditionally. When no slot is provided we still call
  // useComponentConfig with a stable inert slot and ignore its result.
  const result = useComponentConfig(slot ?? INERT_SLOT);

  return useMemo(() => {
    if (!slot) {
      return {
        config: null,
        hidden: false,
        className: callerClassName,
        style: callerStyle,
      };
    }
    const { config, permissionHidden } = result;
    // Hide when EITHER an explicit admin `visible:false` preference applies,
    // OR the component is permission-gated and the user lacks access
    // (permissionHidden is only ever true for slots flagged permission:true).
    const hidden = config.visible === false || permissionHidden;
    const className = cn(callerClassName, config.className);
    const style =
      config.style || callerStyle
        ? { ...callerStyle, ...config.style }
        : undefined;
    return { config, hidden, className: className || undefined, style };
  }, [slot, result, callerClassName, callerStyle]);
}

/** Stable placeholder so the underlying hook can run unconditionally. */
const INERT_SLOT: Slot = { id: '\u0000inert', type: 'button' };
