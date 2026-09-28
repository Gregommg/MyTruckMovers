import React, { useCallback, useRef, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Marker } from 'react-native-maps';

export const C = { bg: '#f4f6fa', card: '#fff', ink: '#1c2333', muted: '#6b7386', brand: '#ff7a00', bad: '#dc2626', ok: '#16a34a', blue: '#2563eb', line: '#e3e7ef' };

export const Icon = ({ name, size = 20, color = C.ink, style }) => <MaterialCommunityIcons name={name} size={size} color={color} style={style} />;

export const Btn = ({ title, onPress, kind = 'primary', disabled, style, icon }) => {
  const fg = kind === 'danger' ? C.bad : kind === 'ghost' ? C.ink : '#fff';
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} activeOpacity={0.8}
      style={[s.btn, kind === 'danger' && s.danger, kind === 'ghost' && s.ghost, disabled && s.disabled, style]}>
      {icon ? <Icon name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
      <Text style={[s.btnText, { color: fg }]}>{title}</Text>
    </TouchableOpacity>
  );
};

export const Chip = ({ label, active, onPress, disabled, icon }) => (
  <TouchableOpacity onPress={onPress} disabled={disabled} style={[s.chip, active && s.chipOn, disabled && s.disabled]}>
    {icon ? <Icon name={icon} size={15} color={active ? '#fff' : C.ink} style={{ marginRight: 6 }} /> : null}
    <Text style={[s.chipText, active && { color: '#fff' }]}>{label}</Text>
  </TouchableOpacity>
);

export const Badge = ({ status }) => {
  const color = { pending: '#92400e', accepted: '#1e40af', picked_up: '#1e40af', completed: '#166534', cancelled: '#991b1b', expired: '#991b1b' }[status] || C.ink;
  return <Text style={[s.badge, { color }]}>{String(status).replace('_', ' ')}</Text>;
};

export const Banner = ({ msg }) => (msg ? <View style={[s.banner, msg.err && { backgroundColor: C.bad }]}><Text style={s.bannerText}>{msg.text}</Text></View> : null);

export function useBanner() {
  const [msg, setMsg] = useState(null);
  const t = useRef();
  const say = useCallback((text, err = false) => {
    setMsg({ text, err });
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 5000);
  }, []);
  return [msg, say];
}

// Round icon pin on the map. kind: truck | mine | pickup | dest | pkg
const PIN = { truck: [C.brand, 'truck', 34], mine: [C.brand, 'truck', 42], pickup: [C.ok, 'map-marker', 34], dest: [C.bad, 'flag-checkered', 34], pkg: [C.blue, 'package-variant-closed', 34] };
export const Pin = ({ kind, latitude, longitude, title, description }) => {
  const [bg, icon, size] = PIN[kind];
  return (
    <Marker coordinate={{ latitude, longitude }} title={title} description={description} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={[s.mk, { backgroundColor: bg, width: size, height: size, borderRadius: size / 2 }]}><Icon name={icon} size={size * 0.55} color="#fff" /></View>
    </Marker>
  );
};

export const money = (n) => 'KES ' + Number(n).toLocaleString();

export const s = StyleSheet.create({
  btn: { flexDirection: 'row', justifyContent: 'center', backgroundColor: C.brand, padding: 13, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  btnText: { fontWeight: '700', fontSize: 15 },
  danger: { backgroundColor: '#fee2e2' },
  ghost: { backgroundColor: C.bg },
  disabled: { opacity: 0.5 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.bg, marginRight: 8, marginBottom: 6 },
  chipOn: { backgroundColor: C.brand },
  chipText: { fontWeight: '600', color: C.ink, fontSize: 13 },
  badge: { fontWeight: '800', textTransform: 'uppercase', fontSize: 12, marginBottom: 4 },
  banner: { position: 'absolute', top: 120, left: 12, right: 12, zIndex: 10, backgroundColor: C.ink, padding: 12, borderRadius: 12 },
  bannerText: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 11, fontSize: 15, backgroundColor: '#fff', marginTop: 4, marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '700', color: C.ink, marginTop: 6 },
  panel: { backgroundColor: C.card, padding: 14, maxHeight: '48%', borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  h1: { fontSize: 26, fontWeight: '900', color: C.ink },
  h2: { fontSize: 18, fontWeight: '800', marginBottom: 6, color: C.ink },
  line: { fontSize: 14, color: C.ink, paddingVertical: 4 },
  muted: { fontSize: 12, color: C.muted },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12 },
  box: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  price: { backgroundColor: '#fff3e6', padding: 12, borderRadius: 12, marginTop: 8 },
  priceText: { fontSize: 18, fontWeight: '800', color: C.ink },
  mk: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
});
