import { count } from './format.js';
import { html, type SafeHtml } from './html.js';
import type { Severity } from './model.js';

export function severityPill(severity: Severity, label: string | number = severity): SafeHtml {
  return html`<span class="pill pill-${severity}">${label}</span>`;
}

export function issueBadges(counts: Record<Severity, number>): SafeHtml {
  return html`<span class="badges">
    ${counts.high > 0 ? html`<span class="pill pill-high" title="High severity">${counts.high} high</span>` : ''}
    ${counts.medium > 0 ? html`<span class="pill pill-medium" title="Medium severity">${counts.medium} medium</span>` : ''}
    ${counts.low > 0 ? html`<span class="pill pill-low" title="Low severity">${counts.low} low</span>` : ''}
  </span>`;
}

export function stat(label: string, value: string | number, note?: string | SafeHtml): SafeHtml {
  return html`<div class="stat">
    <div class="stat-label">${label}</div>
    <div class="stat-value">${value}</div>
    ${note ? html`<div class="stat-note">${note}</div>` : ''}
  </div>`;
}

/** Horizontal meter; `value` may exceed `max`, which renders the excess in red. */
export function meter(value: number, max: number, label: string): SafeHtml {
  const scale = Math.max(value, max, 1);
  const okWidth = (Math.min(value, max) / scale) * 100;
  const overWidth = (Math.max(0, value - max) / scale) * 100;
  const capacityAt = (max / scale) * 100;
  return html`<div class="meter" role="meter" aria-label="${label}" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="${max}">
    <span class="meter-fill" style="width:${okWidth.toFixed(2)}%"></span>
    ${overWidth > 0 ? html`<span class="meter-over" style="left:${okWidth.toFixed(2)}%;width:${overWidth.toFixed(2)}%"></span>` : ''}
    ${overWidth > 0 ? html`<span class="meter-cap" style="left:${capacityAt.toFixed(2)}%"></span>` : ''}
  </div>`;
}

export function emptyState(title: string, body: string | SafeHtml): SafeHtml {
  return html`<div class="empty"><h2>${title}</h2><p>${body}</p></div>`;
}

export function guestsLabel(n: number): string {
  return count(n, 'guest');
}
