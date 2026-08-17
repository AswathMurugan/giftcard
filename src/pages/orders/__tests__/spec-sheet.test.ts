import { describe, it, expect } from 'vitest';
import { buildSpecSheetHtml, escapeHtml, safeImageSrc } from '@/pages/orders/spec-sheet';
import type { SpecGroup } from '@/pages/orders/spec-helpers';

const GROUPS: SpecGroup[] = [
  {
    name: 'Card body',
    params: [
      {
        key: 'shape',
        label: 'Shape',
        value: 'CR80',
        raw: 'CR80',
        spec: { key: 'shape', label: 'Shape', saveAs: 'shape' },
      },
      {
        key: 'substrate',
        label: 'Substrate',
        value: null,
        raw: null,
        spec: { key: 'substrate', label: 'Substrate', saveAs: 'substrate' },
      },
    ],
  },
];

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('spec-sheet', { tags: ['card-spec', 'logic'] }, () => {
  describe('escapeHtml', { tags: ['important'] }, () => {
    it('escapes every character that could break out of markup', () => {
      expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
        '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
      );
    });

    it('renders null and undefined as empty, not as the word', { tags: ['edge-case'] }, () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('coerces non-strings the backend may hand back', { tags: ['edge-case'] }, () => {
      expect(escapeHtml(0)).toBe('0');
      expect(escapeHtml(false)).toBe('false');
    });
  });

  describe('safeImageSrc', { tags: ['important'] }, () => {
    it('accepts a base64 image data URI', () => {
      expect(safeImageSrc(PNG)).toBe(PNG);
    });

    it('rejects anything the renderer could not fetch or should not run', () => {
      expect(safeImageSrc('https://example.com/card.png')).toBeNull();
      expect(safeImageSrc('javascript:alert(1)')).toBeNull();
      expect(safeImageSrc('data:text/html;base64,PGI+')).toBeNull();
    });

    it('rejects non-string values', { tags: ['edge-case'] }, () => {
      expect(safeImageSrc(null)).toBeNull();
      expect(safeImageSrc(undefined)).toBeNull();
      expect(safeImageSrc({})).toBeNull();
    });
  });

  describe('buildSpecSheetHtml', { tags: ['smoke'] }, () => {
    const base = {
      appLabel: 'Forge',
      orderNo: 'GC-1048',
      cardName: 'Thank-You card',
      qty: 5000,
      shape: 'CR80',
      groups: GROUPS,
      generatedAt: '2026-08-13 10:00',
    };

    it('cites the order, quantity and resolved card format', () => {
      const html = buildSpecSheetHtml(base);
      expect(html).toContain('GC-1048');
      expect(html).toContain('5,000');
      expect(html).toContain('85.6 × 53.98 mm');
    });

    it('counts only the parameters that carry a value', { tags: ['important'] }, () => {
      expect(buildSpecSheetHtml(base)).toContain('1 of 2 parameters specified');
    });

    it('marks an unset parameter rather than omitting the row', () => {
      const html = buildSpecSheetHtml(base);
      expect(html).toContain('Substrate');
      expect(html).toContain('Not set');
    });

    it('embeds a data-URI face and labels a missing one', { tags: ['edge-case'] }, () => {
      const html = buildSpecSheetHtml({ ...base, previewFront: PNG });
      expect(html).toContain(`src="${PNG}"`);
      expect(html).toContain('Not designed');
    });

    it('does not embed a face the renderer could not fetch', { tags: ['important'] }, () => {
      const html = buildSpecSheetHtml({
        ...base,
        previewFront: 'https://example.com/front.png',
      });
      expect(html).not.toContain('example.com');
      expect(html).toContain('Not designed');
    });

    it('shows the carrier with its own trim when one is designed', () => {
      const html = buildSpecSheetHtml({ ...base, previewCarrier: PNG });
      expect(html).toContain('Carrier');
      // Its own format, not the card's — a supplier printing it needs the
      // carrier's dimensions, not CR80's.
      expect(html).toContain('140 × 90 mm');
    });

    it('omits the carrier block entirely on a card-only order', { tags: ['edge-case'] }, () => {
      // A "Carrier — Not designed" panel on every card-only sheet is noise,
      // and worse, reads as if a carrier were expected and missing.
      expect(buildSpecSheetHtml(base)).not.toContain('140 × 90 mm');
    });

    it('does not embed a carrier the renderer could not fetch', { tags: ['important'] }, () => {
      const html = buildSpecSheetHtml({
        ...base,
        previewCarrier: 'https://example.com/carrier.png',
      });
      expect(html).not.toContain('example.com');
    });

    it('escapes a card name carrying markup', { tags: ['edge-case'] }, () => {
      const html = buildSpecSheetHtml({ ...base, cardName: '<b>Gift</b>' });
      expect(html).not.toContain('<b>Gift</b>');
      expect(html).toContain('&lt;b&gt;Gift&lt;/b&gt;');
    });

    it('renders a dash for a missing quantity', { tags: ['edge-case'] }, () => {
      expect(buildSpecSheetHtml({ ...base, qty: null })).toContain('<strong>—</strong>');
    });

    it('falls back to CR80 for an unknown shape', { tags: ['edge-case'] }, () => {
      expect(buildSpecSheetHtml({ ...base, shape: null })).toContain('85.6 × 53.98 mm');
    });
  });
});
