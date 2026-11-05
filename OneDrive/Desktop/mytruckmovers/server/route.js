// Turn-by-turn routing via OSRM (free, no API key). Set ROUTING_URL to self-host or use another OSRM-compatible service.
const { haversine } = require('./pricing');

const ROUTING_URL = process.env.ROUTING_URL || 'https://router.project-osrm.org';
const cache = new Map();

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function iconFor(step) {
  const { type, modifier = '' } = step.maneuver;
  if (type === 'arrive') return 'arrive';
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') return 'roundabout';
  if (modifier === 'uturn') return 'uturn';
  if (modifier.includes('left')) return 'left';
  if (modifier.includes('right')) return 'right';
  return 'straight';
}

function phrase(step) {
  const { type, modifier = '', exit } = step.maneuver;
  const on = step.name ? ` onto ${step.name}` : '';
  switch (type) {
    case 'depart': return step.name ? `Head out on ${step.name}` : 'Start driving';
    case 'arrive': return 'Arrive at your destination';
    case 'turn': return `Turn ${modifier}${on}`;
    case 'roundabout': case 'rotary': return exit ? `At the roundabout take exit ${exit}${on}` : `Enter the roundabout${on}`;
    case 'merge': return `Merge${on}`;
    case 'fork': return `Keep ${modifier.includes('left') ? 'left' : 'right'} at the fork`;
    case 'end of road': return `At the end of the road turn ${modifier}${on}`;
    case 'on ramp': case 'off ramp': return `Take the ramp${on}`;
    default: return step.name ? `Continue on ${step.name}` : cap(`${type} ${modifier}`.trim());
  }
}

function fallback(a, b) {
  const km = haversine(a.lat, a.lng, b.lat, b.lng) * 1.3;
  return {
    source: 'estimate',
    duration: Math.round((km / 30) * 3600), // assume 30 km/h city driving
    distance: Math.round(km * 1000),
    coords: [[a.lat, a.lng], [b.lat, b.lng]],
    steps: [
      { text: 'Head towards your destination', icon: 'straight', inMeters: 0 },
      { text: 'Arrive at your destination', icon: 'arrive', inMeters: Math.round(km * 1000) },
    ],
  };
}

async function getRoute(a, b) {
  const key = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(4)).join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10000) return hit.data;

  let data;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const url = `${ROUTING_URL}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=true`;
    const j = await (await fetch(url, { signal: ctl.signal })).json();
    clearTimeout(timer);
    if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error('no route');
    const rt = j.routes[0];
    const raw = rt.legs[0].steps;
    data = {
      source: 'osrm',
      duration: Math.round(rt.duration),
      distance: Math.round(rt.distance),
      coords: rt.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      steps: raw.map((s, i) => ({
        text: phrase(s), icon: iconFor(s),
        inMeters: i === 0 ? 0 : Math.round(raw[i - 1].distance), // distance from the start of the route to this maneuver
        lat: s.maneuver.location[1], lng: s.maneuver.location[0],
      })),
    };
  } catch {
    data = fallback(a, b);
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { getRoute };
