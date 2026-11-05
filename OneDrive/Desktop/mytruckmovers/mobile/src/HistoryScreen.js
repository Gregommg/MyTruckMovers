import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { api } from './api';
import { Badge, Icon, money, s, C } from './ui';

const PAY_LABEL = { unpaid: 'Not paid', pending: 'Payment pending', paid: 'Paid', failed: 'Payment failed' };
const PAY_ICON = { unpaid: 'credit-card-outline', pending: 'progress-clock', paid: 'check-circle', failed: 'alert-circle-outline' };
const PAY_COLOR = { unpaid: C.muted, pending: '#92400e', paid: C.ok, failed: C.bad };

export default function HistoryScreen({ role, cfg, focus }) {
  const [list, setList] = useState([]);
  useEffect(() => { if (focus) api('/requests/history').then(setList).catch(() => {}); }, [focus]);
  const label = (id) => (cfg.truckTypes.find((t) => t.id === id) || {}).label || id;
  const when = (d) => new Date(String(d).replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <ScrollView style={{ backgroundColor: C.bg }} contentContainerStyle={{ padding: 18, paddingTop: 60 }}>
      <Text style={[s.h1, { marginBottom: 14 }]}>{role === 'driver' ? 'Job history' : 'Trips'}</Text>
      {list.length === 0 && <Text style={s.muted}>Nothing here yet.</Text>}
      {list.map((r) => {
        const other = role === 'driver' ? r.user : r.driver;
        const pay = r.payment_status;
        return (
          <View key={r.id} style={s.card}>
            <View style={s.row}><Text style={s.priceText}>{money(r.price)}</Text><Badge status={r.status} /></View>
            <Text style={s.line}>{label(r.truck_type)}{other ? ` · ${other.name}` : ''}</Text>
            <Text style={s.muted}>{r.pickup_addr || 'Pinned location'} to {r.dest_addr || 'Pinned location'}</Text>
            <View style={s.row}>
              <Text style={s.muted}>{when(r.created_at)}</Text>
              {cfg.mpesaEnabled && pay && (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon name={PAY_ICON[pay]} size={14} color={PAY_COLOR[pay]} />
                  <Text style={{ color: PAY_COLOR[pay], fontWeight: '700', fontSize: 12, marginLeft: 4 }}>{PAY_LABEL[pay]}</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
