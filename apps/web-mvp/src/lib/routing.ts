import type { View } from '../store';

/**
 * Tiny URL <-> view router. Only the canonical view list — anything else
 * (404, /wizard/step-2, etc.) falls through to home so users never land on
 * a blank screen from a typo'd URL.
 *
 * Why URLs instead of pure-state routing: gives the user deep-linkable
 * URLs (brtlb.io/wizard sends a peer straight to onboarding) and
 * gives Vercel Analytics distinct page-view events per screen so we can
 * see funnel shape (Home → Wizard → completion) instead of one undifferentiated
 * "/" page view.
 */

const VIEW_PATHS: ReadonlyArray<readonly [View, string]> = [
  ['home', '/'],
  ['settings', '/settings'],
  ['record', '/record'],
  ['review', '/review'],
  ['wizard', '/wizard'],
];

const PATH_TO_VIEW = new Map<string, View>(VIEW_PATHS.map(([v, p]) => [p, v]));
const VIEW_TO_PATH = new Map<View, string>(VIEW_PATHS);

export function viewFromPath(path: string): View {
  // Strip trailing slashes (except root) so /wizard/ matches /wizard.
  const normalized = path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path;
  return PATH_TO_VIEW.get(normalized) ?? 'home';
}

export function pathForView(view: View): string {
  return VIEW_TO_PATH.get(view) ?? '/';
}
