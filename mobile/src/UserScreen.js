import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Alert, Linking } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from './api';
import { connect } from './socket';
import { useRouteNav, NavBanner, fitTo, fmtMin } from './nav';
import { Btn, Chip, Badge, Banner, Icon, Pin, useBanner, money, s, C } from './ui';

const NAIROBI = { latitude: -1.2864, longitude: 36.8172, latitudeDelta: 0.08, longitudeDelta: 0.08 };
const isOpen = (r) => r && ['pending', 'accepted', 'picked_up'].includes(r.status);
const STATUS_TEXT = {
  accepted: 'A driver accepted and is on the way to your pickup point.',
  picked_up: 'Your items are on the truck and heading to the destination.',
  completed: 'Delivered. Thank you for using MyTruckMovers!',
  cancelled: 'This request was cancelled.',
  expired: 'No driver accepted your request. You can try again.',
};

export default function UserScreen({ session, cfg, visible, onSummary }) {
  const map = useRef(null);
  const reqRef = useRef(null);
  const fitted = useRef(null);
  const [banner, say] = useBanner();
  const [pickup, setPickup] = useState(null);
  const [dest, setDest] = useState(null);
  const [mode, setMode] = useState('dest');
  const [typeId, setTypeId] = useState(cfg.truckTypes[0].id);
  const [item, setItem] = useState('');
  const [quote, setQuote] = useState(null);
  const [trucks, setTrucks] = useState([]);
  const [req, setReq] = useState(null);
  const [offers, setOffers] = useState([]);
  const [assigned, setAssigned] = useState(null);
  const [offerLocs, setOfferLocs] = useState({});
  const [now, setNow] = useState(Date.now());
  const label = (id) => (cfg.truckTypes.find((t) => t.id === id) || {}).label || id;

  const applyReq = (r, o) => {
    reqRef.current = r; setReq(r); setOffers(o || []);
    if (r && r.driver && r.driver.lat != null) setAssigned((p) => p || { lat: r.driver.lat, lng: r.driver.lng });
  };

  // which route to show: trip preview before requesting, the truck's route once a driver is assigned
  let navFrom = null, navTo = null, navKey = '';
  if (req && req.status === 'accepted' && assigned) { navFrom = assigned; navTo = { lat: req.pickup_lat, lng: req.pickup_lng }; navKey = 'pickup'; }
  else if (req && req.status === 'picked_up' && assigned) { navFrom = assigned; navTo = { lat: req.dest_lat, lng: req.dest_lng }; navKey = 'dest'; }
  else if (!req && pickup && dest) { navFrom = pickup; navTo = dest; navKey = 'preview'; }
  const nav = useRouteNav(navFrom, navTo, navKey);

  useEffect(() => {
    if (visible && nav.route && fitted.current !== nav.targetKey) { fitted.current = nav.targetKey; fitTo(map, nav); }
  }, [nav.targetKey, visible]);

  // tell the Home tab what is going on
  useEffect(() => {
    onSummary({ item: req, nav: nav.route && navKey !== 'preview' ? { duration: nav.route.duration, fetchedAt: nav.route.fetchedAt } : null, trucks: trucks.length });
  }, [req, nav.route, trucks.length]);

  // realtime
  useEffect(() => {
    const sock = connect(session.token);
    sock.on('request:updated', ({ request, offers: o }) => {
      const prev = reqRef.current;
      if (prev && prev.status !== request.status) {
        if (request.status === 'accepted') say(`${request.driver ? request.driver.name : 'A driver'} accepted your request`);
        if (request.status === 'picked_up') say('Your items have been picked up');
        if (request.status === 'completed') say('Delivered!');
        if (request.status === 'expired') say('No driver accepted your request', true);
      }
      applyReq(request, o);
    });
    sock.on('offer:new', () => say('A driver from farther away applied. Review it in your request.'));
    sock.on('offer:location', (d) => setOfferLocs((p) => ({ ...p, [d.driverId]: d })));
    sock.on('driver:location', (d) => { if (reqRef.current && reqRef.current.id === d.requestId) setAssigned({ lat: d.lat, lng: d.lng }); });
    sock.on('payment:updated', (d) => {
      if (reqRef.current && reqRef.current.id === d.requestId) {
        setReq((r) => (r ? { ...r, payment_status: d.status, mpesa_receipt: d.receipt || r.mpesa_receipt } : r));
        if (d.status === 'paid') say('Payment received. Thank you!');
      }
    });
    return () => sock.disconnect();
  }, []);

  // initial state + my location
  useEffect(() => {
    (async () => {
      const cur = await api('/requests/active').catch(() => ({}));
      applyReq(cur.request || null, cur.offers);
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const p = await Location.getCurrentPositionAsync({});
        const c = { lat: p.coords.latitude, lng: p.coords.longitude };
        map.current && map.current.animateToRegion({ latitude: c.lat, longitude: c.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 });
        if (!isOpen(cur.request)) setPoint('pickup', c.lat, c.lng);
      } else say('Location is off. Tap the map to set your pickup point.', true);
    })();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const setPoint = async (kind, lat, lng) => {
    const p = { lat, lng, addr: '' };
    kind === 'pickup' ? setPickup(p) : setDest(p);
    try {
      const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (a) {
        p.addr = [a.name, a.street, a.city].filter(Boolean).join(', ');
        kind === 'pickup' ? setPickup({ ...p }) : setDest({ ...p });
      }
    } catch {}
  };

  // price shown before sending
  useEffect(() => {
    if (!pickup || !dest) return setQuote(null);
    api('/quote', { method: 'POST', body: { truckType: typeId, pickup, dest } }).then(setQuote).catch(() => setQuote(null));
  }, [pickup && pickup.lat, pickup && pickup.lng, dest && dest.lat, dest && dest.lng, typeId]);

  // trucks around
  const loadTrucks = useCallback(async () => {
    if (!pickup) return;
    try { setTrucks(await api(`/trucks/nearby?lat=${pickup.lat}&lng=${pickup.lng}`)); } catch {}
  }, [pickup && pickup.lat, pickup && pickup.lng]);
  useEffect(() => { loadTrucks(); const t = setInterval(loadTrucks, 10000); return () => clearInterval(t); }, [loadTrucks]);

  const send = async () => {
    try {
      const r = await api('/requests', { method: 'POST', body: { truckType: typeId, item, pickup, dest } });
      applyReq(r.request, []);
      say('Request sent. Nearby drivers have been notified.');
    } catch (e) { Alert.alert('Cannot send request', e.message); }
  };
  const cancel = () => Alert.alert('Cancel request?', '', [
    { text: 'No' },
    { text: 'Yes, cancel', style: 'destructive', onPress: () => api(`/requests/${req.id}/cancel`, { method: 'POST' }).catch((e) => Alert.alert('Error', e.message)) },
  ]);
  const acceptOffer = (o) => api(`/requests/${req.id}/offers/${o.offer_id}/accept`, { method: 'POST' }).catch((e) => Alert.alert('Error', e.message));
  const reset = () => { applyReq(null, []); setDest(null); setAssigned(null); setOfferLocs({}); fitted.current = null; };

  const left = req && req.status === 'pending' ? Math.max(0, Math.round((req.expires_at - now) / 1000)) : 0;
  const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  const showTrucks = !req || req.status === 'pending';
  const pu = req ? { lat: req.pickup_lat, lng: req.pickup_lng } : pickup;
  const de = req ? { lat: req.dest_lat, lng: req.dest_lng } : dest;

  const describe = (rt) => ({
    icon: navKey === 'preview' ? 'route' : 'truck',
    title: navKey === 'pickup' ? 'Your truck is heading to the pickup point' : navKey === 'dest' ? 'Your items are heading to the destination' : 'Estimated trip time',
    sub: navKey === 'preview' ? 'Driving time from pickup to destination' : 'Live from the truck location',
  });

  return (
    <View style={{ flex: 1 }}>
      <Banner msg={banner} />
      <NavBanner nav={nav} describe={describe} />
      <MapView ref={map} style={{ flex: 1 }} initialRegion={NAIROBI} showsUserLocation
        onPress={(e) => { if (!isOpen(req)) { const c = e.nativeEvent.coordinate; setPoint(mode, c.latitude, c.longitude); } }}>
        {nav.coords.length > 1 && <Polyline coordinates={nav.coords} strokeColor={C.brand} strokeWidth={5} />}
        {showTrucks && trucks.map((t) => (
          <Pin key={'t' + t.id} kind="truck" latitude={t.lat} longitude={t.lng} title={label(t.truck_type)} description={t.availability === 'empty' ? 'Empty' : 'Dropping off nearby'} />
        ))}
        {pu && <Pin kind="pickup" latitude={pu.lat} longitude={pu.lng} title="Pickup" />}
        {de && <Pin kind="dest" latitude={de.lat} longitude={de.lng} title="Destination" />}
        {req && req.status === 'pending' && offers.map((o) => {
          const l = offerLocs[o.driver_id] || (o.lat != null && { lat: o.lat, lng: o.lng });
          return l ? <Pin key={'o' + o.driver_id} kind="truck" latitude={l.lat} longitude={l.lng} title="Applicant truck" /> : null;
        })}
        {assigned && req && ['accepted', 'picked_up'].includes(req.status) && <Pin kind="mine" latitude={assigned.lat} longitude={assigned.lng} title="Your truck" />}
      </MapView>

      <View style={s.panel}>
        <ScrollView keyboardShouldPersistTaps="handled">
          {!req ? (
            <View>
              <Text style={s.h2}>Request a truck</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {cfg.truckTypes.map((t) => <Chip key={t.id} label={t.label} active={typeId === t.id} onPress={() => setTypeId(t.id)} />)}
              </View>
              <TextInput style={s.input} placeholder="What are you moving?" value={item} onChangeText={setItem} />
              <View style={{ flexDirection: 'row' }}>
                <Chip icon="map-marker" label="Set pickup" active={mode === 'pickup'} onPress={() => setMode('pickup')} />
                <Chip icon="flag-checkered" label="Set destination" active={mode === 'dest'} onPress={() => setMode('dest')} />
              </View>
              <Text style={s.muted}>Tap the map to drop the selected pin.</Text>
              <Text style={s.line}>Pickup: {pickup ? pickup.addr || `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}` : 'not set'}</Text>
              <Text style={s.line}>Destination: {dest ? dest.addr || `${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)}` : 'not set'}</Text>
              {quote && (
                <View style={s.price}>
                  <Text style={s.priceText}>{money(quote.price)}</Text>
                  <Text style={s.muted}>{quote.distanceKm} km trip{nav.route && navKey === 'preview' ? ` · about ${fmtMin(nav.route.duration)} drive` : ''} · {label(typeId)}</Text>
                </View>
              )}
              <Btn icon="send" title="Send request" onPress={send} disabled={!pickup || !dest} />
            </View>
          ) : (
            <View>
              <Text style={s.h2}>Your request</Text>
              <Badge status={req.status} />
              <Text style={s.line}>
                {req.status === 'pending' ? `Looking for a driver. ${req.retries ? `(retry ${req.retries}) ` : ''}Notifying more drivers in ${mmss}.` : STATUS_TEXT[req.status]}
              </Text>
              <Text style={s.muted}>{label(req.truck_type)} · {money(req.price)}{'\n'}{req.item || 'No description'}{'\n'}From: {req.pickup_addr || 'Pinned location'}{'\n'}To: {req.dest_addr || 'Pinned location'}</Text>

              {req.status === 'pending' && offers.map((o) => (
                <View key={o.offer_id} style={s.box}>
                  <View style={s.row}>
                    <View><Text style={s.line}>{label(o.truck_type)}</Text><Text style={s.muted}>{o.truck_reg} · {o.distance_km ?? '?'} km from pickup</Text></View>
                    <Btn title="Accept" onPress={() => acceptOffer(o)} style={{ marginTop: 0 }} />
                  </View>
                </View>
              ))}

              {req.driver && (
                <View style={s.box}>
                  <Text style={[s.line, { fontWeight: '800' }]}>{req.driver.name}</Text>
                  <Btn kind="ghost" icon="phone" title={req.driver.phone} onPress={() => Linking.openURL(`tel:${req.driver.phone}`)} style={{ marginTop: 4 }} />
                  <Text style={s.muted}>{label(req.driver.truck_type)} · {req.driver.truck_reg}</Text>
                </View>
              )}

              {cfg.mpesaEnabled && <PayBox req={req} phone={session.user.phone} onUpdate={(patch) => setReq((r) => (r ? { ...r, ...patch } : r))} />}

              {isOpen(req) ? <Btn kind="danger" icon="close" title="Cancel request" onPress={cancel} /> : <Btn icon="plus" title="Make a new request" onPress={reset} />}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const PAY_LABEL = { unpaid: 'Not paid', pending: 'Payment pending', paid: 'Paid', failed: 'Payment failed' };
const PAY_ICON = { unpaid: 'credit-card-outline', pending: 'progress-clock', paid: 'check-circle', failed: 'alert-circle-outline' };
const PAY_COLOR = { unpaid: C.muted, pending: '#92400e', paid: C.ok, failed: C.bad };

function PayBox({ req, phone: defaultPhone, onUpdate }) {
  const [phone, setPhone] = useState(defaultPhone || '');
  const [busy, setBusy] = useState(false);
  const pollRef = useRef(null);
  const status = req.payment_status || 'unpaid';

  const check = async (silent) => {
    try {
      const r = await api(`/requests/${req.id}/pay/check`, { method: 'POST' });
      if (r.status !== 'pending') {
        clearInterval(pollRef.current); pollRef.current = null;
        onUpdate({ payment_status: r.status });
        if (r.status === 'failed' && !silent) Alert.alert('Payment did not go through', 'You can try again.');
      }
    } catch (e) { if (!silent) Alert.alert('Oops', e.message); }
  };

  useEffect(() => {
    if (status === 'pending' && !pollRef.current) pollRef.current = setInterval(() => check(true), 5000);
    if (status !== 'pending' && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [status]);

  const pay = async () => {
    setBusy(true);
    try {
      const r = await api(`/requests/${req.id}/pay`, { method: 'POST', body: { phone } });
      Alert.alert('Check your phone', r.message || 'Enter your M-Pesa PIN to complete payment.');
      onUpdate({ payment_status: 'pending' });
    } catch (e) { Alert.alert('Oops', e.message); }
    setBusy(false);
  };

  return (
    <View style={s.box}>
      <View style={s.row}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name={PAY_ICON[status]} size={16} color={PAY_COLOR[status]} />
          <Text style={{ color: PAY_COLOR[status], fontWeight: '800', marginLeft: 6 }}>{PAY_LABEL[status]}</Text>
        </View>
        <Text style={s.muted}>{money(req.price)}</Text>
      </View>
      {status === 'paid' && req.mpesa_receipt && <Text style={s.muted}>Receipt: {req.mpesa_receipt}</Text>}
      {status === 'pending' && (
        <View>
          <Text style={[s.muted, { marginTop: 6 }]}>Enter your M-Pesa PIN on your phone to finish paying.</Text>
          <Btn kind="ghost" icon="refresh" title="I've paid, check now" onPress={() => check(false)} />
        </View>
      )}
      {(status === 'unpaid' || status === 'failed') && (
        <View>
          <Text style={s.label}>M-Pesa phone number</Text>
          <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="07XXXXXXXX" />
          <Btn icon="cellphone" title={busy ? 'Sending…' : 'Pay with M-Pesa'} onPress={pay} disabled={busy} />
        </View>
      )}
    </View>
  );
}
