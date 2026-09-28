// Prices in KES. Edit to suit your market.
const TRUCK_TYPES = [
  { id: 'pickup', label: 'Pickup (up to 1 ton)', base: 500, perKm: 60 },
  { id: 'small', label: 'Small truck (3 ton)', base: 1200, perKm: 90 },
  { id: 'medium', label: 'Medium truck (7 ton)', base: 2500, perKm: 130 },
  { id: 'large', label: 'Large lorry (10+ ton)', base: 4500, perKm: 180 },
];

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Straight-line distance x 1.3 approximates road distance
function quote(typeId, pLat, pLng, dLat, dLng) {
  const t = TRUCK_TYPES.find((x) => x.id === typeId);
  const km = Math.round(haversine(pLat, pLng, dLat, dLng) * 1.3 * 10) / 10;
  const price = Math.round((t.base + t.perKm * km) / 10) * 10;
  return { distanceKm: km, price, currency: 'KES' };
}

module.exports = { TRUCK_TYPES, haversine, quote };
