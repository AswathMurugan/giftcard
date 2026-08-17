/**
 * Getting Started — onboarding landing for a freshly cloned app.
 *
 * Shown as the `/` landing while no user pages exist (see `PrivateApp.tsx`)
 * and always reachable from the HelperMenu (see `scaffoldingRoutes()` in
 * `src/routes/index.tsx`). A hero introduces the builder, "How to prompt"
 * offers copy-on-click example prompts, a callout explains attaching a
 * screenshot / Figma, and a quick link opens the Component Showcase.
 *
 * Section headings are customizable `Label` slots (GettingStartedPage.schema.ts)
 * so the onboarding copy can be re-worded at runtime via preferences.
 *
 * The visual treatment (hero orbit, ambient glows, entrance motion) lives in a
 * page-scoped `<style>` block below. All colours resolve through the design
 * tokens in `src/index.css` (`--color-primary-*`, `--border`, `--foreground`,
 * …) so the page re-themes with the tenant palette.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Copy,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LayoutGrid,
  LayoutList,
  Lightbulb,
  LineChart,
  ScrollText,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { APPLICATION } from '@/types/app.generated';
import { GETTING_STARTED } from './GettingStartedPage.schema';

/** The app-builder brand shown in the onboarding hero copy. */
const BUILDER = 'JIFFYAI';

/** App display name, falling back to the starter default when metadata is absent. */
export function appName(): string {
  return APPLICATION?.label || APPLICATION?.name || 'Codegen Starter';
}

/**
 * App description for a "What is …?" blurb. Prefers the real
 * `APPLICATION.description` from app metadata (app.md / app.generated.ts);
 * falls back to a generic sentence (using the dynamic app name) when the
 * tenant hasn't set one. Never hardcode a specific app's copy here.
 */
export function appDescription(name: string): string {
  const fromMeta = APPLICATION?.description?.trim();
  if (fromMeta) return fromMeta;
  // Generic ~80-char fallback when the tenant hasn't set a description.
  return `${name} is your workspace for managing data and everyday tasks in one place.`;
}

/** Copy-able example prompts for generating pages. */
export const PROMPT_EXAMPLES: readonly string[] = [
  'Generate a list, detail, and form page for the client entity.',
  'Build an accounts dashboard with KPI tiles and a sortable accounts table.',
  'Create a service request page for an address change.',
  'Add an org-scoped advisor performance page with a chart and a data table.',
];

/** Icon per example prompt (parallel to PROMPT_EXAMPLES by index). */
const PROMPT_ICONS: readonly LucideIcon[] = [
  LayoutList,
  LayoutDashboard,
  FileText,
  LineChart,
];

/** Short do/don't best-practices for better generations. */
export const PROMPTING_TIPS: readonly { do: string; instead: string }[] = [
  {
    do: 'Name the exact entity and fields you want.',
    instead: 'Avoid vague asks like "make a nice page".',
  },
  {
    do: 'Describe the layout (table, KPI tiles, filters, form).',
    instead: "Don't leave the structure for the agent to guess.",
  },
  {
    do: 'Reference the design system for styling decisions.',
    instead: "Don't paste hard-coded colors or fonts.",
  },
  {
    do: 'Iterate in small steps and review each change.',
    instead: "Don't request a whole app in a single prompt.",
  },
];

/** Quick links to the always-on helper/scaffolding pages. */
export const QUICK_LINKS: readonly {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    path: '/showcase',
    label: 'Showcase',
    description: 'Browse every UI component in one place.',
    icon: Sparkles,
  },
  {
    path: '/test-results',
    label: 'Test Results',
    description: 'Inspect the latest automated test run.',
    icon: FlaskConical,
  },
  {
    path: '/logs',
    label: 'Logs',
    description: 'View, filter, and triage in-app log events.',
    icon: ScrollText,
  },
];

/** Page-scoped styling. Colours resolve through the design tokens in index.css. */
const STYLES = `
.gs-stage{position:relative;overflow:hidden;min-height:100%;background:var(--background);color:var(--foreground);padding:56px 24px 72px;box-sizing:border-box}
.gs-page{position:relative;z-index:1;max-width:920px;margin:0 auto}

.gs-topwash{position:absolute;top:0;left:0;right:0;height:460px;pointer-events:none;z-index:0;background:linear-gradient(180deg,var(--color-primary-50) 0%,rgba(249,244,225,.35) 42%,rgba(249,244,225,0) 100%)}
.gs-tealglow{position:absolute;top:-70px;left:-190px;width:572px;height:572px;border-radius:50%;pointer-events:none;z-index:0;opacity:.8;background:radial-gradient(circle,rgba(44,143,134,.18) 0%,rgba(44,143,134,0) 65%);animation:gs-glowpulse 8s ease-in-out infinite}
.gs-topgrid{position:absolute;top:-91px;left:-61px;right:0;height:460px;pointer-events:none;z-index:0;background-image:radial-gradient(rgba(158,123,25,.14) 1px,transparent 1px);background-size:24px 24px;-webkit-mask-image:linear-gradient(180deg,#000 0%,transparent 80%);mask-image:linear-gradient(180deg,#000 0%,transparent 80%)}
.gs-glow{position:absolute;top:-140px;right:-90px;width:540px;height:540px;border-radius:50%;background:radial-gradient(circle,rgba(158,123,25,.18),rgba(158,123,25,0) 70%);pointer-events:none;animation:gs-glowpulse 7s ease-in-out infinite;z-index:0}
.gs-glow2{position:absolute;bottom:-180px;left:-120px;width:460px;height:460px;border-radius:50%;background:radial-gradient(circle,rgba(158,123,25,.1),rgba(158,123,25,0) 70%);pointer-events:none;animation:gs-glowpulse 9s ease-in-out infinite;z-index:0}

.gs-hero{display:flex;align-items:center;justify-content:space-between;gap:36px;flex-wrap:wrap}
.gs-hero-txt{flex:1;min-width:300px}
.gs-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:14px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--color-grayscale-500)}
.gs-title{font-size:24px;font-weight:700;line-height:1.15;letter-spacing:-.02em;margin:14px 0 0;color:var(--foreground)}
.gs-lead{font-size:17px;font-weight:400;color:var(--color-grayscale-600);line-height:1.5;margin:12px 0 0;max-width:620px}

.gs-orbit{position:relative;width:154px;height:154px;flex:none;animation:gs-floaty 6s ease-in-out infinite,gs-rvUp .7s cubic-bezier(.22,.61,.36,1) both}
.gs-orbit-ring{position:absolute;inset:0;border:1.5px dashed var(--color-primary-200);border-radius:50%;animation:gs-spin 24s linear infinite}
.gs-orbit-ring.r2{inset:28px;border-color:var(--color-primary-100);animation:gs-spin 17s linear infinite reverse}
.gs-orbit-core{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:72px;height:72px;display:grid;place-content:center;border-radius:18px;background:var(--color-primary-500);color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.08);animation:gs-pulse 3.4s ease-in-out infinite}
.gs-orbit-dot{position:absolute;border-radius:50%;background:var(--color-primary-500)}
.gs-orbit-dot.d1{width:12px;height:12px;top:-6px;left:50%;margin-left:-6px}
.gs-orbit-dot.d2{width:9px;height:9px;bottom:8px;right:0;background:var(--color-primary-300)}
.gs-orbit-dot.d3{width:8px;height:8px;bottom:14px;left:4px;background:var(--color-primary-400)}

.gs-rule{height:1px;background:linear-gradient(90deg,#0F0C0800,#F1E2A9EB,#F1E2A9EB,#0F0C0800);margin:36px 0}

.gs-sec{margin-top:44px}
.gs-shead{display:flex;align-items:baseline;gap:12px}
.gs-sname{font-size:20px;font-weight:600;letter-spacing:-.01em;margin:0;color:var(--foreground)}
.gs-sintro{font-size:16px;color:var(--color-grayscale-600);line-height:1.5;margin:8px 0 0}
.gs-body{margin:20px 0 0}

.gs-pgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.gs-pcard{position:relative;display:flex;align-items:center;gap:16px;padding:16px;background:var(--card);border:1px solid var(--border);border-radius:10px;cursor:pointer;overflow:hidden;transition:box-shadow .15s,border-color .15s,transform .15s;text-align:left;font:inherit;color:inherit}
.gs-pcard:hover{box-shadow:0 4px 12px rgba(0,0,0,.08);border-color:var(--color-primary-200);transform:translateY(-2px)}
.gs-pcard-ico{flex:none;width:52px;height:52px;border-radius:12px;background:var(--color-primary-50);color:var(--color-primary-500);display:grid;place-content:center;transition:background .15s,color .15s}
.gs-pcard:hover .gs-pcard-ico{background:var(--color-primary-500);color:#fff}
.gs-pcard-body{flex:1;font-size:16px;line-height:1.5;color:var(--foreground)}
.gs-pcard-copy{margin-left:auto;display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--color-grayscale-400);opacity:0;transition:opacity .15s,color .15s}
.gs-pcard:hover .gs-pcard-copy{opacity:1}
.gs-pcard-copy.on{opacity:1;color:var(--color-success-600)}

.gs-tips{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.gs-tip{display:flex;gap:14px;padding:20px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.gs-tip-ico{flex:none;width:52px;height:52px;border-radius:12px;background:var(--color-primary-50);color:var(--color-primary-500);display:grid;place-content:center}
.gs-tip-title{font-size:16px;font-weight:600;line-height:1.3;margin:0;color:var(--foreground)}
.gs-tip-dont{font-size:16px;color:var(--color-grayscale-500);line-height:1.45;margin:6px 0 0}

.gs-callout{display:flex;align-items:center;gap:24px;padding:24px;background:var(--color-primary-50);border:1px solid var(--color-primary-200);border-radius:12px}
.gs-fig{flex:none;width:150px;height:110px;border-radius:10px;background:var(--card);border:1px solid var(--color-primary-200);box-shadow:0 1px 2px rgba(0,0,0,.04);overflow:hidden;display:flex;flex-direction:column}
.gs-fig-bar{height:18px;display:flex;align-items:center;gap:5px;padding:0 9px;border-bottom:1px solid var(--border);background:var(--color-grayscale-50)}
.gs-fig-dot{width:6px;height:6px;border-radius:50%;background:var(--color-primary-300)}
.gs-fig-body{flex:1;display:flex;gap:8px;padding:9px}
.gs-fig-side{width:30px;display:flex;flex-direction:column;gap:5px}
.gs-fig-nav{height:7px;border-radius:2px;background:var(--color-primary-100)}
.gs-fig-nav.on{background:var(--color-primary-400)}
.gs-fig-main{flex:1;display:flex;flex-direction:column;gap:6px}
.gs-fig-row{display:flex;gap:6px}
.gs-fig-tile{flex:1;height:24px;border-radius:3px;background:var(--color-primary-100)}
.gs-fig-line{height:7px;border-radius:2px;background:var(--border)}
.gs-fig-line.s{width:65%}
.gs-callout-title{font-size:20px;font-weight:600;margin:0;color:var(--foreground)}
.gs-callout-txt{font-size:16px;color:var(--color-grayscale-600);line-height:1.55;margin:6px 0 0}

.gs-qlink{display:flex;align-items:center;gap:18px;padding:22px 24px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.04);cursor:pointer;transition:box-shadow .12s,border-color .12s;text-decoration:none}
.gs-qlink:hover{box-shadow:0 1px 3px rgba(0,0,0,.08);border-color:var(--color-grayscale-300)}
.gs-qlink-ico{flex:none;width:52px;height:52px;border-radius:12px;background:var(--color-primary-50);color:var(--color-primary-500);display:grid;place-content:center;transition:transform .2s}
.gs-qlink:hover .gs-qlink-ico{transform:scale(1.07)}
.gs-qlink-title{font-size:20px;font-weight:600;margin:0;color:var(--foreground)}
.gs-qlink-desc{font-size:16px;color:var(--color-grayscale-600);margin:4px 0 0;line-height:1.45}
.gs-qlink-arrow{margin-left:auto;color:var(--color-grayscale-400);transition:transform .2s,color .12s;display:grid;place-content:center}
.gs-qlink:hover .gs-qlink-arrow{transform:translateX(6px);color:var(--color-primary-500)}

.gs-eyebrow,.gs-title,.gs-lead,.gs-rule,.gs-sec{animation:gs-rvUp .6s cubic-bezier(.22,.61,.36,1) both}
.gs-title{animation-delay:.06s}
.gs-lead{animation-delay:.12s}
.gs-rule{animation-delay:.18s}

@keyframes gs-rvUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes gs-spin{to{transform:rotate(360deg)}}
@keyframes gs-pulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.07)}}
@keyframes gs-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes gs-glowpulse{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.9;transform:scale(1.1)}}
@media(prefers-reduced-motion:reduce){.gs-stage *{animation:none!important;transition:none!important}}
`;

export function GettingStartedPage() {
  const [copied, setCopied] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function copy(text: string, i: number) {
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* clipboard unavailable — ignore */
    }
    setCopied(i);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(-1), 1500);
  }

  return (
    <div className="gs-stage">
      <style>{STYLES}</style>
      <div className="gs-topwash" />
      <div className="gs-tealglow" />
      <div className="gs-topgrid" />
      <div className="gs-glow" />
      <div className="gs-glow2" />

      <div className="gs-page">
        {/* Hero */}
        <div className="gs-hero">
          <div className="gs-hero-txt">
            <Label config={GETTING_STARTED.introLabel} className="gs-eyebrow">
              Getting started
            </Label>
            <h1 className="gs-title">Prompt {BUILDER} like a pro</h1>
            <p className="gs-lead">
              Describe the app you want in plain language and {BUILDER} assembles
              working screens with your design system. The clearer your prompt,
              the closer the result.
            </p>
          </div>
          <div className="gs-orbit">
            <div className="gs-orbit-ring">
              <span className="gs-orbit-dot d1" />
              <span className="gs-orbit-dot d2" />
              <span className="gs-orbit-dot d3" />
            </div>
            <div className="gs-orbit-ring r2" />
            <div className="gs-orbit-core">
              <Sparkles size={30} aria-hidden="true" />
            </div>
          </div>
        </div>

        <div className="gs-rule" />

        {/* How to prompt */}
        <div className="gs-sec">
          <div className="gs-shead">
            <Label config={GETTING_STARTED.promptLabel} className="gs-sname">
              How to prompt
            </Label>
          </div>
          <p className="gs-sintro">
            Ask for a page in plain language. Be specific about the entity, the
            layout, and the fields. Click any example to copy it.
          </p>
          <div className="gs-body">
            <div className="gs-pgrid">
              {PROMPT_EXAMPLES.map((text, i) => {
                const Icon = PROMPT_ICONS[i] ?? Sparkles;
                const on = copied === i;
                return (
                  <button
                    key={text}
                    type="button"
                    className="gs-pcard"
                    onClick={() => copy(text, i)}
                  >
                    <span className="gs-pcard-ico">
                      <Icon size={26} aria-hidden="true" />
                    </span>
                    <span className="gs-pcard-body">{text}</span>
                    <span className={`gs-pcard-copy${on ? ' on' : ''}`}>
                      {on ? <Check size={15} /> : <Copy size={15} />}
                      {on ? 'Copied' : 'Copy'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Prompting tips — retained but hidden, matching the mockup. */}
        <div className="gs-sec" style={{ display: 'none' }}>
          <div className="gs-shead">
            <Label config={GETTING_STARTED.tipsLabel} className="gs-sname">
              Prompting tips
            </Label>
          </div>
          <p className="gs-sintro">
            Four habits that consistently produce better output.
          </p>
          <div className="gs-body">
            <div className="gs-tips">
              {PROMPTING_TIPS.map((tip) => (
                <div key={tip.do} className="gs-tip">
                  <span className="gs-tip-ico">
                    <Lightbulb size={26} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="gs-tip-title">{tip.do}</p>
                    <p className="gs-tip-dont">{tip.instead}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Attach a Screenshot or Figma */}
        <div className="gs-sec" style={{ marginTop: 8 }}>
          <div className="gs-body">
            <div className="gs-callout">
              <div className="gs-fig" aria-hidden="true">
                <div className="gs-fig-bar">
                  <span className="gs-fig-dot" />
                  <span className="gs-fig-dot" />
                  <span className="gs-fig-dot" />
                </div>
                <div className="gs-fig-body">
                  <div className="gs-fig-side">
                    <span className="gs-fig-nav on" />
                    <span className="gs-fig-nav" />
                    <span className="gs-fig-nav" />
                  </div>
                  <div className="gs-fig-main">
                    <span className="gs-fig-line" />
                    <div className="gs-fig-row">
                      <span className="gs-fig-tile" />
                      <span className="gs-fig-tile" />
                    </div>
                    <span className="gs-fig-line" />
                    <span className="gs-fig-line s" />
                  </div>
                </div>
              </div>
              <div>
                <Label
                  config={GETTING_STARTED.screenshotLabel}
                  className="gs-callout-title"
                >
                  Attach a Screenshot or Figma
                </Label>
                <p className="gs-callout-txt">
                  Attach a screenshot or paste a Figma link with your prompt. The
                  agent reads the visual reference and matches the layout,
                  spacing, and components far more closely than from text alone —
                  ideal for recreating an existing design.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Component Showcase */}
        <div className="gs-sec" style={{ marginTop: 8 }}>
          <div className="gs-body">
            <Link to="/showcase" className="gs-qlink">
              <span className="gs-qlink-ico">
                <LayoutGrid size={26} aria-hidden="true" />
              </span>
              <div>
                <Label
                  config={GETTING_STARTED.quickLinksLabel}
                  className="gs-qlink-title"
                >
                  Component Showcase
                </Label>
                <p className="gs-qlink-desc">
                  Browse every UI component in one place.
                </p>
              </div>
              <span className="gs-qlink-arrow">
                <ArrowRight size={22} aria-hidden="true" />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GettingStartedPage;
