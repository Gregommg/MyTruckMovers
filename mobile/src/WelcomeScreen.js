import React from 'react';
import { View, Text, Image, ScrollView, StyleSheet } from 'react-native';
import { Btn, Icon, C } from './ui';

const FEATURES = [
  ['map-marker', 'Pin your destination', 'See the price before you send the request.'],
  ['truck', 'Right truck for the job', 'From pickup to large lorry, with trucks shown around you.'],
  ['routes', 'Live route and ETA', 'Follow the truck and see the time remaining.'],
  ['shield-check', 'Verified drivers', 'Drivers register with ID, passport photo and truck details.'],
];

export default function WelcomeScreen({ onGo }) {
  return (
    <ScrollView style={{ backgroundColor: C.ink }} contentContainerStyle={w.wrap}>
      <View style={w.brand}><Image source={require('../assets/logo.png')} style={w.brandLogo} /><Text style={w.brandText}>MyTruckMovers</Text></View>
      <View style={w.art}><Image source={require('../assets/icon.png')} style={w.artLogo} /></View>
      <Text style={w.title}>Move anything.{'\n'}<Text style={{ color: C.brand }}>Track it live.</Text></Text>
      <Text style={w.lead}>Request a truck in seconds, see the price up front and follow your driver on the map to the destination.</Text>
      <Btn icon="package-variant-closed" title="Request a truck" onPress={() => onGo('register', 'user')} />
      <Btn icon="truck" kind="ghost" title="Drive with us" onPress={() => onGo('register', 'driver')} />
      <Btn kind="ghost" title="I already have an account" onPress={() => onGo('login', 'user')} />
      <View style={{ marginTop: 26 }}>
        {FEATURES.map(([icon, t, d]) => (
          <View key={t} style={w.feature}>
            <Icon name={icon} size={26} color={C.brand} />
            <View style={{ flex: 1, marginLeft: 14 }}><Text style={w.ft}>{t}</Text><Text style={w.fd}>{d}</Text></View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const w = StyleSheet.create({
  wrap: { padding: 22, paddingTop: 64, paddingBottom: 40 },
  brand: { flexDirection: 'row', alignItems: 'center' },
  brandLogo: { width: 30, height: 30, borderRadius: 6 },
  brandText: { color: '#fff', fontWeight: '900', fontSize: 20, marginLeft: 8 },
  art: { alignItems: 'center', marginVertical: 24 },
  artLogo: { width: 190, height: 190, borderRadius: 28 },
  title: { color: '#fff', fontSize: 36, fontWeight: '900', lineHeight: 40 },
  lead: { color: '#c7cfe0', fontSize: 16, lineHeight: 23, marginVertical: 14 },
  feature: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 14, marginBottom: 10 },
  ft: { color: '#fff', fontWeight: '800', fontSize: 15 },
  fd: { color: '#c7cfe0', fontSize: 13, marginTop: 2 },
});
