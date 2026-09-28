import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { api } from './api';
import { Btn, Chip, Badge, Icon, money, s, C } from './ui';
import { fmtMin } from './nav';

const USER_TEXT = {
  pending: 'Looking for a driver.',
  accepted: 'A driver accepted and is on the way to your pickup point.',
  picked_up: 'Your items are on the truck and heading to the destination.',
};

export default function HomeScreen({ session, focus, summary, avail, onAvail, goTab, onLogout }) {
  const isDriver = session.user.role === 'driver';
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!focus) return;
    api('/requests/history').then((h) => {
      const c = h.filter((x) => x.status === 'completed');
      setDone(c.length); setTotal(c.reduce((t, x) => t + x.price, 0));
    }).catch(() => {});
  }, [focus]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const item = summary.item; // current request (customer) or job (driver)
  const nav = summary.nav;
  const eta = nav ? Math.max(0, nav.duration - (now - nav.fetchedAt) / 1000) : null;
  const first = session.user.name.split(' ')[0];

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, paddingTop: 60 }}>
      <View style={s.row}>
        <View><Text style={s.muted}>{isDriver ? 'Driver' : 'Customer'}</Text><Text style={s.h1}>Hello, {first}</Text></View>
        <TouchableOpacity onPress={onLogout} style={h.logout}><Icon name="logout" size={20} color={C.muted} /></TouchableOpacity>
      </View>

      {isDriver && (
        <View style={[s.card, { marginTop: 16 }]}>
          <Text style={s.h2}>My status</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip icon="power" label="Offline" active={avail === 'offline'} disabled={!!item} onPress={() => onAvail('offline')} />
            <Chip icon="truck" label="Empty" active={avail === 'empty'} disabled={!!item} onPress={() => onAvail('empty')} />
            <Chip icon="flag-checkered" label="Dropping off soon" active={avail === 'dropping_off'} disabled={!!item} onPress={() => onAvail('dropping_off')} />
          </View>
          <Text style={s.muted}>Go online so customers can see your truck and you can receive job alerts.</Text>
        </View>
      )}

      <View style={[s.card, !isDriver && { marginTop: 16 }]}>
        {item && ['pending', 'accepted', 'picked_up'].includes(item.status) ? (
          <View>
            <View style={s.row}><Text style={s.h2}>{isDriver ? 'Current job' : 'Current request'}</Text><Badge status={item.status} /></View>
            <Text style={s.line}>
              {isDriver ? (item.status === 'accepted' ? 'Head to the pickup point.' : 'Items on board. Head to the destination.') : USER_TEXT[item.status]}
            </Text>
            {eta != null && ['accepted', 'picked_up'].includes(item.status) && (
              <Text style={h.eta}>{fmtMin(eta)} <Text style={s.muted}>
                {isDriver ? (item.status === 'accepted' ? 'to pickup' : 'to destination') : (item.status === 'accepted' ? 'until the truck reaches you' : 'to the destination')}
              </Text></Text>
            )}
            <Btn icon={isDriver ? 'navigation-variant' : 'map'} title={isDriver ? 'Continue navigation' : 'Track on map'} onPress={() => goTab('map')} />
          </View>
        ) : (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name={isDriver ? 'navigation-variant' : 'package-variant-closed'} size={32} color={C.brand} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.h2}>{isDriver ? 'No active job' : 'Where are we moving today?'}</Text>
                <Text style={s.muted}>{isDriver ? 'Go online and accept a request to start navigating.' : 'Pick a truck size, pin the destination and see the price up front.'}</Text>
              </View>
            </View>
            <Btn icon={isDriver ? 'map' : 'plus'} title={isDriver ? 'See open requests' : 'Request a truck'} onPress={() => goTab('map')} />
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row' }}>
        <Stat icon="check" value={done} label={isDriver ? 'Jobs completed' : 'Trips completed'} />
        <Stat icon="wallet" value={money(total)} label={isDriver ? 'Total earned' : 'Total spent'} />
        <Stat icon={isDriver ? 'package-variant-closed' : 'truck'} value={isDriver ? summary.open : summary.trucks} label={isDriver ? 'Open requests' : 'Trucks near you'} />
      </View>

      <Tile icon="history" title={isDriver ? 'Job history' : 'Trip history'} sub={isDriver ? 'Your completed jobs' : 'Your past and current requests'} onPress={() => goTab('history')} />

      <ChangePasswordCard />
    </ScrollView>
  );
}

function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next.length < 6) return Alert.alert('New password must be at least 6 characters');
    setBusy(true);
    try {
      await api('/account/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: next } });
      Alert.alert('Password updated');
      setCur(''); setNext(''); setOpen(false);
    } catch (e) { Alert.alert('Oops', e.message); }
    setBusy(false);
  };

  return (
    <View style={[s.card, { marginTop: 4 }]}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Icon name="lock-outline" size={22} color={C.brand} />
        <Text style={[s.h2, { flex: 1, marginLeft: 12, marginBottom: 0 }]}>Change password</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={22} color={C.muted} />
      </TouchableOpacity>
      {open && (
        <View style={{ marginTop: 10 }}>
          <Text style={s.label}>Current password</Text>
          <TextInput style={s.input} value={cur} onChangeText={setCur} secureTextEntry />
          <Text style={s.label}>New password</Text>
          <TextInput style={s.input} value={next} onChangeText={setNext} secureTextEntry />
          <Btn title={busy ? 'Updating…' : 'Update password'} onPress={submit} disabled={busy} />
        </View>
      )}
    </View>
  );
}

const Stat = ({ icon, value, label }) => (
  <View style={h.stat}><Icon name={icon} size={20} color={C.brand} /><Text style={h.statV} numberOfLines={1} adjustsFontSizeToFit>{value ?? 0}</Text><Text style={s.muted}>{label}</Text></View>
);
const Tile = ({ icon, title, sub, onPress }) => (
  <TouchableOpacity onPress={onPress} style={[s.card, { marginTop: 4 }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Icon name={icon} size={26} color={C.brand} />
      <View style={{ flex: 1, marginLeft: 12 }}><Text style={s.h2}>{title}</Text><Text style={s.muted}>{sub}</Text></View>
      <Icon name="chevron-right" size={22} color={C.muted} />
    </View>
  </TouchableOpacity>
);

const h = StyleSheet.create({
  stat: { flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 12, marginRight: 8, marginBottom: 12 },
  statV: { fontSize: 18, fontWeight: '900', color: C.ink, marginVertical: 2 },
  eta: { fontSize: 28, fontWeight: '900', color: '#d96500', marginTop: 4 },
  logout: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
