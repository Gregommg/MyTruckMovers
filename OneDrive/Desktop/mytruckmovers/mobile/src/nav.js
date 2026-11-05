import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { api } from './api';
import { Icon, C } from './ui';

export const fmtDist = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
export const fmtMin = (sec) => {
  const m = Math.max(1, Math.ceil(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function distM(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Keeps a driving route from `from` to `to` up to date (refetched when the origin moves 75 m or every 30 s).
 * `key` names the leg ('pickup' | 'dest' | 'preview') so a new leg always fetches a fresh route.
 * Returns { route, coords, remaining (seconds, counts down live), targetKey }.
 */
export function useRouteNav(from, to, key) {
  const [route, setRoute] = useState(null);
  const [now, setNow] = useState(Date.now());
  const st = useRef({ origin: null, target: null, key: null, at: 0, pending: false, seq: 0 });

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const s = st.current;
    if (!from || !to) {
      s.seq++; s.origin = s.target = s.key = null; s.pending = false;
      if (route) setRoute(null);
      return;
    }
    const same = s.key === key && s.target && s.target.lat === to.lat && s.target.lng === to.lng;
    const moved = !s.origin || distM(s.origin, from) > 75;
    if (same && !moved && Date.now() - s.at < 30000) return;
    if (s.pending) return;
    s.pending = true;
    const seq = s.seq;
    api(`/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`).then((rt) => {
      if (seq !== st.current.seq) return;
      Object.assign(s, { origin: { lat: from.lat, lng: from.lng }, target: { lat: to.lat, lng: to.lng }, key, at: Date.now() });
      setRoute({ ...rt, fetchedAt: Date.now(), targetKey: `${key}:${to.lat.toFixed(5)},${to.lng.toFixed(5)}` });
    }).catch(() => {}).finally(() => { s.pending = false; });
  }, [from && from.lat, from && from.lng, to && to.lat, to && to.lng, key, Math.floor(now / 5000)]);

  const coords = useMemo(() => (route ? route.coords.map(([latitude, longitude]) => ({ latitude, longitude })) : []), [route]);
  const remaining = route ? Math.max(0, route.duration - (now - route.fetchedAt) / 1000) : 0;
  return { route, coords, remaining, targetKey: route && route.targetKey };
}

const TURN_ICON = { straight: 'arrow-up-bold', left: 'arrow-left-bold', right: 'arrow-right-bold', uturn: 'undo-variant', roundabout: 'rotate-right', arrive: 'flag-checkered', truck: 'truck', route: 'routes' };

// Banner over the map: instruction (or status) on the left, time remaining on the right
export function NavBanner({ nav, describe }) {
  if (!nav.route) return null;
  const d = describe(nav.route);
  return (
    <View style={n.bar}>
      <View style={n.turn}><Icon name={TURN_ICON[d.icon] || 'arrow-up-bold'} size={28} color="#fff" /></View>
      <View style={{ flex: 1 }}>
        <Text style={n.title} numberOfLines={2}>{d.title}</Text>
        <Text style={n.sub} numberOfLines={1}>{d.sub}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={n.time}>{fmtMin(nav.remaining)}</Text>
        <Text style={n.sub}>{fmtDist(nav.route.distance)} · {clock(Date.now() + nav.remaining * 1000)}{nav.route.source === 'estimate' ? ' (est.)' : ''}</Text>
      </View>
    </View>
  );
}

export const fitTo = (mapRef, nav) =>
  mapRef.current && nav.coords.length > 1 &&
  mapRef.current.fitToCoordinates(nav.coords, { edgePadding: { top: 170, right: 50, bottom: 340, left: 50 }, animated: true });

const n = StyleSheet.create({
  bar: { position: 'absolute', top: 48, left: 12, right: 12, zIndex: 9, flexDirection: 'row', alignItems: 'center', backgroundColor: C.ink, borderRadius: 16, padding: 12 },
  turn: { width: 46, height: 46, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  title: { color: '#fff', fontWeight: '800', fontSize: 15 },
  sub: { color: '#c7cfe0', fontSize: 12, marginTop: 2 },
  time: { color: '#fff', fontWeight: '900', fontSize: 20 },
});
