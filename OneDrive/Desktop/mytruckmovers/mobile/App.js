import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setToken } from './src/api';
import { Icon, C } from './src/ui';
import WelcomeScreen from './src/WelcomeScreen';
import AuthScreen from './src/AuthScreen';
import HomeScreen from './src/HomeScreen';
import UserScreen from './src/UserScreen';
import DriverScreen from './src/DriverScreen';
import HistoryScreen from './src/HistoryScreen';

export default function App() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null); // { token, user, driver }
  const [cfg, setCfg] = useState(null);
  const [screen, setScreen] = useState({ name: 'welcome' }); // welcome | auth
  const [tab, setTab] = useState('home');                     // home | map | history
  const [summary, setSummary] = useState({});                 // current request/job + route ETA, from the map screens
  const [avail, setAvail] = useState('offline');

  const start = async (token) => {
    setToken(token);
    const me = await api('/me');
    await AsyncStorage.setItem('tm_token', token);
    if (me.driver) setAvail(me.driver.availability === 'busy' ? 'empty' : me.driver.availability);
    setTab('home');
    setSession({ token, user: me.user, driver: me.driver });
  };

  useEffect(() => {
    (async () => {
      try {
        setCfg(await api('/config'));
        const t = await AsyncStorage.getItem('tm_token');
        if (t) await start(t);
      } catch { await AsyncStorage.removeItem('tm_token'); }
      setReady(true);
    })();
  }, []);

  const logout = async () => {
    await AsyncStorage.removeItem('tm_token');
    setToken(null); setSession(null); setSummary({}); setScreen({ name: 'welcome' });
  };

  const changeAvail = async (v, local) => {
    if (local) return setAvail(v); // server already updated it (job finished / cancelled)
    try { await api('/driver/availability', { method: 'POST', body: { availability: v } }); setAvail(v); }
    catch (e) { Alert.alert('Cannot change status', e.message); }
  };

  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color={C.brand} /></View>;

  if (!session) {
    return (
      <View style={{ flex: 1 }}>
        <StatusBar style={screen.name === 'welcome' ? 'light' : 'dark'} />
        {screen.name === 'welcome'
          ? <WelcomeScreen onGo={(mode, role) => setScreen({ name: 'auth', mode, role })} />
          : <AuthScreen onAuth={start} cfg={cfg} retryCfg={async () => setCfg(await api('/config'))}
              initialMode={screen.mode} initialRole={screen.role} onBack={() => setScreen({ name: 'welcome' })} />}
      </View>
    );
  }

  const isDriver = session.user.role === 'driver';
  // screens stay mounted (so live tracking and sockets keep running) and are just hidden
  const pane = (name) => [{ flex: 1 }, tab !== name && { display: 'none' }];
  const tabs = [['home', 'home', 'Home'], ['map', isDriver ? 'navigation-variant' : 'map-marker-path', isDriver ? 'Jobs' : 'Request'], ['history', 'history', isDriver ? 'History' : 'Trips']];

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <View style={pane('home')}>
        <HomeScreen session={session} focus={tab === 'home'} summary={summary} avail={avail} onAvail={changeAvail} goTab={setTab} onLogout={logout} />
      </View>
      <View style={pane('map')}>
        {isDriver
          ? <DriverScreen session={session} cfg={cfg} visible={tab === 'map'} avail={avail} onAvail={changeAvail} onSummary={setSummary} />
          : <UserScreen session={session} cfg={cfg} visible={tab === 'map'} onSummary={setSummary} />}
      </View>
      <View style={pane('history')}>
        <HistoryScreen role={session.user.role} cfg={cfg} focus={tab === 'history'} />
      </View>

      <View style={t.bar}>
        {tabs.map(([key, icon, label]) => (
          <TouchableOpacity key={key} style={t.item} onPress={() => setTab(key)}>
            <Icon name={icon} size={24} color={tab === key ? C.brand : C.muted} />
            <Text style={[t.label, tab === key && { color: C.brand }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const t = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.line, paddingBottom: 18, paddingTop: 8 },
  item: { flex: 1, alignItems: 'center' },
  label: { fontSize: 11, fontWeight: '700', color: C.muted, marginTop: 2 },
});
