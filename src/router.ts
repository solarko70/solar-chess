export type AppRoute = 'home' | 'game' | 'analysis' | 'settings' | 'history' | 'variants';

export function parseRouteHash(hash: string): AppRoute {
  const clean = hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (clean === 'game') return 'game';
  if (clean === 'analysis') return 'analysis';
  if (clean === 'settings') return 'settings';
  if (clean === 'history') return 'history';
  if (clean === 'variants') return 'variants';
  return 'home';
}

export class HashRouter {
  private onRouteChange: (route: AppRoute) => void;

  constructor(onRouteChange: (route: AppRoute) => void) {
    this.onRouteChange = onRouteChange;
    window.addEventListener('hashchange', this.handleHashChange);
  }

  public init(): void {
    this.handleHashChange();
  }

  public navigate(route: AppRoute): void {
    const targetHash = route === 'home' ? '#/' : `#/${route}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
    this.onRouteChange(route);
  }

  public getRoute(): AppRoute {
    return parseRouteHash(window.location.hash);
  }

  private handleHashChange = (): void => {
    const route = parseRouteHash(window.location.hash);
    this.onRouteChange(route);
  };

  public destroy(): void {
    window.removeEventListener('hashchange', this.handleHashChange);
  }
}
