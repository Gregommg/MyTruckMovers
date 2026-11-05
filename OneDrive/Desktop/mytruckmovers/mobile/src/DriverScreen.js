import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert, Linking } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from './api';
import { connect } from './socket';
import { useRouteNav, NavBanner, fitTo, fmtDist } from './nav';
import { Btn, Chip, Badge, Banner, Pin, useBanner, money, s, C } from './ui';

const NAIROBI = { latitude: -1.2864, longitude: 36.8172, latitudeDelta: 0.08, longitudeDelta: 0.08 };

export default function DriverScreen({ session, cfg, visible, avail, onAvail, onSummary }) {
  const map = useRef(null);
  const sock = useRef(null);
  const watch = useRef(null);
  const lastSent = useRef(0);
  const manual = useRef(false);
  const fitted = useRef(null);
  const [banner, say] = useBanner();
  const [loc, setLoc] = useState(null);
  const [list, setList] = useState([]);
  const [job, setJob] = useState(null);
  const label = (id) => (cfg.truckTypes.find((t) => t.id === id) || {}).label || id;

  // navigate to the pickup first, then to the destination once the item is on board
  const target = job ? (job.status === 'accepted' ? { lat: job.pickup_lat, lng: job.pickup_lng } : { lat: job.dest_lat, lng: job.dest_lng }) : null;
  const navKey = job ? (job.status === 'accepted' ? 'pickup' : 'dest') : '';
  const nav = useRouteNav(job ? loc : null, target, navKey);

  useEffect(() => {
    if (visible && nav.route && fitted.current !== nav.targetKey) { fitted.current = nav.targetKey; fitTo(map, nav); }
  }, [nav.targetKey, visible]);

  useEffect(() => {
    onSummary({ item: job, nav: nav.route ? { duration: nav.route.duration, fetchedAt: nav.route.fetchedAt } : null, open: list.length });
  }, [job, nav.route, list.length]);

  const loadOpen = async () => { try { setList(await api('/driver/requests')); } catch {} };

  const updateLoc = (lat, lng) => {
    setLoc((prev) => { if (!prev) { map.current && map.current.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.06, longitudeDelta: 0.06 }); setTimeout(loadOpen, 800); } return { lat, lng }; });
    if (Date.now() - lastSent.current > 2000) { lastSent.current = Date.now(); sock.current && sock.current.emit('driver:location', { lat, lng }); }
  };

  const startTracking = async () => {
    if (watch.current) return;
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return say('Location permission is needed so customers can see your truck.', true);
    watch.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 3000, distanceInterval: 10 },
      (p) => updateLoc(p.coords.latitude, p.coords.longitude));
  };
  const stopTracking = () => { watch.current && watch.current.remove(); watch.current = null; };
  useEffect(() => { avail !== 'offline' ? startTracking() : stopTracking(); }, [avail]);

  useEffect(() => {
    const so = connect(session.token);
    sock.current = so;
    so.on('request:new', ({ request, notify }) => {
      setList((p) => [request, ...p.filter((x) => x.id !== request.id)]);
      if (notify) say(`New request near you: ${money(request.price)}`);
    });
    so.on('request:removed', ({ id }) => setList((p) => p.filter((x) => x.id !== id)));
    so.on('request:updated', ({ request }) => {
      if (['accepted', 'picked_up'].includes(request.status)) setJob(request);
      else {
        setJob((cur) => {
          if (cur && cur.id === request.id) {
            say(request.status === 'cancelled' ? 'The customer cancelled this job.' : 'Job complete. Well done!', request.status === 'cancelled');
            onAvail('empty', true);
          }
          return null;
        });
        loadOpen();
      }
    });
    (async () => {
      const cur = await api('/requests/active').catch(() => ({}));
      setJob(cur.request || null);
      await loadOpen();
    })();
    const t = setInterval(loadOpen, 20000);
    return () => { clearInterval(t); so.disconnect(); stopTracking(); };
  }, []);

  const accept = async (r) => {
    try {
      const res = await api(`/requests/${r.id}/accept`, { method: 'POST' });
      if (res.mode === 'accepted') {
        say('Job accepted. Customer details are now visible.');
        const cur = await api('/requests/active');
        setJob(cur.request);
      } else { say('Application sent. The customer must approve it.'); loadOpen(); }
    } catch (e) { Alert.alert('Cannot accept', e.message); loadOpen(); }
  };
  const step = (name) => api(`/requests/${job.id}/${name}`, { method: 'POST' }).catch((e) => Alert.alert('Error', e.message));
  const openMaps = () => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`);

  const describe = (rt) => {
    const st = rt.steps[1] || rt.steps[0];
    return { icon: st.icon, title: st.text, sub: `${st.inMeters ? 'In ' + fmtDist(st.inMeters) + ' · ' : ''}${navKey === 'pickup' ? 'To pickup' : 'To destination'}` };
  };
  const sorted = [...list].sort((a, b) => (a.away_km ?? 1e9) - (b.away_km ?? 1e9));

  return (
    <View style={{ flex: 1 }}>
      <Banner msg={banner} />
      <NavBanner nav={nav} describe={describe} />
      <MapView ref={map} style={{ flex: 1 }} initialRegion={NAIROBI} showsUserLocation={false}
        onPress={(e) => { if (manual.current) { manual.current = false; const c = e.nativeEvent.coordinate; updateLoc(c.latitude, c.longitude); say('Location set'); } }}>
        {nav.coords.length > 1 && <Polyline coordinates={nav.coords} strokeColor={C.brand} strokeWidth={6} />}
        {loc && <Pin kind="mine" latitude={loc.lat} longitude={loc.lng} title="You" />}
        {!job && sorted.map((r) => <Pin key={'r' + r.id} kind="pkg" latitude={r.pickup_lat} longitude={r.pickup_lng} title={money(r.price)} description={r.item || ''} />)}
        {job && <Pin kind="pickup" latitude={job.pickup_lat} longitude={job.pickup_lng} title="Pickup" />}
        {job && <Pin kind="dest" latitude={job.dest_lat} longitude={job.dest_lng} title="Destination" />}
      </MapView>

      <View style={s.panel}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={s.muted}>{session.user.name} · {session.driver.truck_reg} · {label(session.driver.truck_type)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
            <Chip icon="power" label="Offline" active={avail === 'offline'} disabled={!!job} onPress={() => onAvail('offline')} />
            <Chip icon="truck" label="Empty" active={avail === 'empty'} disabled={!!job} onPress={() => onAvail('empty')} />
            <Chip icon="flag-checkered" label="Dropping off" active={avail === 'dropping_off'} disabled={!!job} onPress={() => onAvail('dropping_off')} />
          </View>
          <Btn kind="ghost" icon="crosshairs-gps" title="Set my location on the map" onPress={() => { manual.current = true; say('Tap the map to set where your truck is'); }} style={{ marginTop: 0 }} />

          {job ? (
            <View style={s.box}>
              <Text style={s.h2}>Current job</Text>
              <Badge status={job.status} />
              <Text style={s.line}><Text style={{ fontWeight: '800' }}>{money(job.price)}</Text> · {job.distance_km} km</Text>
              <Text style={s.line}>{job.item || 'No description'}</Text>
              <Text style={s.line}>Pickup: {job.pickup_addr || 'Pinned location'}</Text>
              <Text style={s.line}>Destination: {job.dest_addr || 'Pinned location'}</Text>
              <Text style={s.line}>Customer: <Text style={{ fontWeight: '800' }}>{job.user.name}</Text></Text>
              <Btn kind="ghost" icon="phone" title={job.user.phone} onPress={() => Linking.openURL(`tel:${job.user.phone}`)} style={{ marginTop: 2 }} />
              <Btn kind="ghost" icon="navigation-variant" title="Open in Google Maps" onPress={openMaps} />
              {job.status === 'accepted' && <Btn icon="package-variant-closed" title="Item picked up" onPress={() => step('pickup')} />}
              {job.status === 'picked_up' && <Btn icon="check" title="Delivered" onPress={() => step('complete')} />}
              <Text style={s.muted}>Once accepted, only the customer can cancel this job.</Text>
            </View>
          ) : (
            <View>
              <Text style={[s.h2, { marginTop: 10 }]}>Open requests</Text>
              <Text style={s.muted}>Far-away requests can still be applied for; the customer must approve.</Text>
              {sorted.length === 0 && <Text style={s.line}>No open requests for your truck type right now.</Text>}
              {sorted.map((r) => (
                <View key={r.id} style={s.box}>
                  <View style={s.row}><Text style={s.priceText}>{money(r.price)}</Text><Text style={s.muted}>{r.away_km ?? '?'} km away</Text></View>
                  <Text style={s.line}>{r.item || 'No description'}</Text>
                  <Text style={s.muted}>From: {r.pickup_addr || 'Pinned location'}{'\n'}To: {r.dest_addr || 'Pinned location'}{'\n'}Trip: {r.distance_km} km</Text>
                  <Btn title={r.applied ? 'Applied, waiting for customer' : r.nearby ? 'Accept job' : 'Apply for job (far away)'} disabled={r.applied || avail === 'offline'} onPress={() => accept(r)} />
                </View>
              ))}
              {avail === 'offline' && <Text style={s.muted}>Go online (Empty / Dropping off) to accept jobs.</Text>}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
