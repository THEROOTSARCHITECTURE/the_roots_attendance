// Resolves to { lat, lng, accuracy } or { locationError } — never rejects, so a punch is never blocked.
export function getLocation(timeout = 10000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ locationError: 'not supported' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => resolve({
        locationError: { 1: 'permission denied', 2: 'unavailable', 3: 'timed out' }[err.code] || 'error',
      }),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    );
  });
}
