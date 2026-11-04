import type { SafeHtml } from '../html.js';

export type NavKey = 'overview' | 'booking' | 'ask' | null;

export interface View {
  title: string;
  nav: NavKey;
  body: SafeHtml;
  /** Attach event listeners after the body is in the DOM. `rerender` redraws the current route. */
  mount?(root: HTMLElement, rerender: () => void): void;
}
