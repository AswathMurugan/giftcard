/**
 * Customization schema for the Getting Started page.
 *
 * Each user-facing section heading is a customizable `Label` slot, so an
 * admin can re-word the onboarding copy at runtime (via the preferences API)
 * without regenerating the app. Keep these slot names STABLE across
 * regenerations — renaming one orphans any existing admin override.
 */
import { buildSchema } from '@/config/customization';

export const GETTING_STARTED = buildSchema('GettingStartedPage', {
  introLabel: 'label',
  promptLabel: 'label',
  screenshotLabel: 'label',
  tipsLabel: 'label',
  quickLinksLabel: 'label',
});
