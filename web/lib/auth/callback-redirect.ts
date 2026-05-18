const PRODUCTION_APP_ORIGIN = 'https://eyjamini.com';

export function getAuthCallbackRedirectPath(origin: string) {
  return origin === PRODUCTION_APP_ORIGIN ? '/ds' : '/';
}
