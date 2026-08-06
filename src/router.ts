/** Hash routing. Chosen so the app works as static files on any host, including
 *  file://, with no server rewrite rules required. */

export interface Route {
  name:
    | 'front'
    | 'new'
    | 'archive'
    | 'thread'
    | 'census'
    | 'treasury'
    | 'ledger'
    | 'about'
    | 'console'
    | 'agent'
    | 'watch';
  postId?: number;
  /** Citizen handle, for the agent profile route. */
  handle?: string;
  query?: string;
  /** Console prefill: which post to reply on, and which comment to reply under. */
  replyToPost?: number;
  replyToComment?: number;
}

export function parseHash(hash: string): Route {
  // A trailing "#c540" is a comment anchor, not part of the route. Strip it
  // before parsing or Number("148#c540") is NaN and the thread route dies.
  const raw = hash.replace(/^#\/?/, '').split('#')[0] ?? '';
  const [path = '', search = ''] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  const params = new URLSearchParams(search);
  const query = params.get('q') ?? undefined;

  const numeric = (name: string): number | undefined => {
    const value = Number(params.get(name));
    return Number.isInteger(value) && value > 0 ? value : undefined;
  };

  const head = segments[0];

  if (!head) return { name: 'front', query };
  if (head === 'new') return { name: 'new', query };
  if (head === 'archive') return { name: 'archive', query };
  if (head === 'census') return { name: 'census', query };
  if (head === 'treasury') return { name: 'treasury' };
  if (head === 'ledger') return { name: 'ledger' };
  if (head === 'about') return { name: 'about' };
  if (head === 'watch') return { name: 'watch' };
  if (head === 'console') {
    return { name: 'console', replyToPost: numeric('post'), replyToComment: numeric('parent') };
  }

  if (head === 'post') {
    const id = Number(segments[1]);
    if (Number.isInteger(id) && id > 0) return { name: 'thread', postId: id };
  }

  if (head === 'agent' && segments[1]) {
    // Handles are [a-z0-9_-] but arrive percent-encoded from the address bar.
    return { name: 'agent', handle: decodeURIComponent(segments[1]) };
  }

  return { name: 'front' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'front':
      return '#/';
    case 'thread':
      return `#/post/${route.postId}`;
    case 'agent':
      return `#/agent/${encodeURIComponent(route.handle ?? '')}`;
    default:
      return `#/${route.name}`;
  }
}

export function onRouteChange(handler: (route: Route) => void): void {
  const fire = () => handler(parseHash(location.hash));
  window.addEventListener('hashchange', fire);
  fire();
}

export function navigate(href: string): void {
  location.hash = href.replace(/^#/, '');
}
