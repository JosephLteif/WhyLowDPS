const isDesktopBuild =
  process.env.DESKTOP_BUILD === 'true' ||
  process.env.DESKTOP_BUILD === '1' ||
  process.env.NEXT_PUBLIC_DESKTOP_BUILD === 'true' ||
  process.env.NEXT_PUBLIC_DESKTOP_BUILD === '1';

export function simResultHref(id: string): string {
  const encodedId = encodeURIComponent(id);
  return isDesktopBuild ? `/sim/_/?id=${encodedId}` : `/sim/${encodedId}`;
}

export function characterHref(region: string, realm: string, name: string): string {
  const normalizedRegion = (region || 'us').toLowerCase();
  const normalizedRealm = realm.toLowerCase().replace(/'/g, '').replace(/\s+/g, '-');
  const normalizedName = name.toLowerCase();

  if (isDesktopBuild) {
    const query = new URLSearchParams({
      region: normalizedRegion,
      realm: normalizedRealm,
      name: normalizedName,
    });
    return `/character/us/realm/name/?${query.toString()}`;
  }

  return `/character/${encodeURIComponent(normalizedRegion)}/${encodeURIComponent(normalizedRealm)}/${encodeURIComponent(normalizedName)}`;
}
