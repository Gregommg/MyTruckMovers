import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, Alert, ActivityIndicator, TouchableOpacity, Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { api } from './api';
import { Btn, Chip, Icon, C, s } from './ui';

export default function AuthScreen({ onAuth, cfg, retryCfg, initialMode = 'login', initialRole = 'user', onBack }) {
  const [mode, setMode] = useState(initialMode);
  const [role, setRole] = useState(initialRole);
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '', truckReg: '', truckType: 'pickup' });
  const [files, setFiles] = useState({}); // idPdf, passportPdf, truckPhoto -> {uri,name,type}
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState({ email: '', code: '', newPassword: '' });
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const setForgotField = (k) => (v) => setForgot((p) => ({ ...p, [k]: v }));

  useEffect(() => { if (!cfg) retryCfg().catch(() => {}); }, []);

  const pickPdf = async (key) => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (!r.canceled) { const a = r.assets[0]; setFiles((p) => ({ ...p, [key]: { uri: a.uri, name: a.name || key + '.pdf', type: 'application/pdf' } })); }
  };
  const pickPhoto = async (camera) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Permission needed', 'Allow access to add the truck photo.');
    const opts = { mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (!r.canceled) setFiles((p) => ({ ...p, truckPhoto: { uri: r.assets[0].uri, name: 'truck.jpg', type: 'image/jpeg' } }));
  };

  const submit = async () => {
    setBusy(true);
    try {
      let data;
      if (mode === 'login') {
        data = await api('/login', { method: 'POST', body: { email: f.email.trim(), password: f.password } });
      } else {
        const form = new FormData();
        form.append('role', role);
        ['name', 'phone', 'email', 'password'].forEach((k) => form.append(k, f[k].trim ? f[k].trim() : f[k]));
        if (role === 'driver') {
          form.append('truckReg', f.truckReg);
          form.append('truckType', f.truckType);
          ['idPdf', 'passportPdf', 'truckPhoto'].forEach((k) => files[k] && form.append(k, files[k]));
        }
        data = await api('/register', { method: 'POST', form });
      }
      await onAuth(data.token);
    } catch (e) { Alert.alert('Oops', e.message); }
    setBusy(false);
  };

  const sendResetCode = async () => {
    if (!/^\S+@\S+\.\S+$/.test(forgot.email.trim())) return Alert.alert('Enter a valid email');
    setBusy(true);
    try {
      const r = await api('/auth/forgot-password', { method: 'POST', body: { email: forgot.email.trim() } });
      Alert.alert('Check your email', r.message || "If that email is registered, we've sent a reset code.");
      setMode('forgot-verify');
    } catch (e) { Alert.alert('Oops', e.message); }
    setBusy(false);
  };

  const submitReset = async () => {
    if (!/^\d{6}$/.test(forgot.code.trim())) return Alert.alert('Enter the 6-digit code from your email');
    if (forgot.newPassword.length < 6) return Alert.alert('Password must be at least 6 characters');
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { email: forgot.email.trim(), code: forgot.code.trim(), newPassword: forgot.newPassword } });
      Alert.alert('Password reset', 'You can log in with your new password now.');
      setF((p) => ({ ...p, email: forgot.email.trim(), password: '' }));
      setForgot({ email: '', code: '', newPassword: '' });
      setMode('login');
    } catch (e) { Alert.alert('Oops', e.message); }
    setBusy(false);
  };

  // plain render helpers (not components) so TextInputs keep focus while typing
  const field = (label, k, p = {}) => (
    <View key={k}><Text style={s.label}>{label}</Text><TextInput style={s.input} value={f[k]} onChangeText={set(k)} autoCapitalize="none" {...p} /></View>
  );
  const fileRow = (label, k, onPress, extra) => (
    <View style={s.box} key={k}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.muted}>{files[k] ? 'Added: ' + files[k].name : 'Not added yet'}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}><Btn kind="ghost" title="Choose file" onPress={onPress} style={{ flex: 1 }} />{extra}</View>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 70 }} keyboardShouldPersistTaps="handled" style={{ backgroundColor: C.bg }}>
      <TouchableOpacity onPress={onBack} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
        <Icon name="arrow-left" size={20} color={C.muted} /><Text style={{ color: C.muted, fontWeight: '600', marginLeft: 6 }}>Home</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Image source={require('../assets/logo.png')} style={{ width: 34, height: 34, borderRadius: 6 }} /><Text style={{ fontSize: 28, fontWeight: '900', color: C.ink, marginLeft: 8 }}>MyTruckMovers</Text>
      </View>
      <Text style={s.muted}>Request a truck. Drive a truck. Track it live.</Text>

      {(mode === 'forgot-request' || mode === 'forgot-verify') ? (
        <View style={{ marginTop: 16 }}>
          <Text style={s.h2}>Reset your password</Text>
          {mode === 'forgot-request' ? (
            <View>
              <Text style={s.muted}>Enter the email on your account and we'll send a 6-digit reset code.</Text>
              <View>
                <Text style={s.label}>Email</Text>
                <TextInput style={s.input} value={forgot.email} onChangeText={setForgotField('email')} autoCapitalize="none" keyboardType="email-address" />
              </View>
              <Btn title={busy ? 'Sending…' : 'Send reset code'} icon="email-outline" onPress={sendResetCode} disabled={busy} />
            </View>
          ) : (
            <View>
              <Text style={s.muted}>Enter the code we emailed you and choose a new password.</Text>
              <View>
                <Text style={s.label}>6-digit code</Text>
                <TextInput style={s.input} value={forgot.code} onChangeText={setForgotField('code')} keyboardType="number-pad" maxLength={6} placeholder="123456" />
              </View>
              <View>
                <Text style={s.label}>New password</Text>
                <TextInput style={s.input} value={forgot.newPassword} onChangeText={setForgotField('newPassword')} secureTextEntry />
              </View>
              <Btn title={busy ? 'Please wait…' : 'Reset password'} icon="lock-reset" onPress={submitReset} disabled={busy} />
            </View>
          )}
          <Btn kind="ghost" title="Back to log in" icon="arrow-left" onPress={() => setMode('login')} />
        </View>
      ) : (
      <View>
      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        <Chip label="Log in" active={mode === 'login'} onPress={() => setMode('login')} />
        <Chip label="Register" active={mode === 'register'} onPress={() => setMode('register')} />
      </View>

      {mode === 'register' && (
        <View>
          <Text style={s.label}>I am a…</Text>
          <View style={{ flexDirection: 'row' }}>
            <Chip label="Customer (need a truck)" active={role === 'user'} onPress={() => setRole('user')} />
            <Chip label="Driver (own a truck)" active={role === 'driver'} onPress={() => setRole('driver')} />
          </View>
          {field("Full name", "name", { autoCapitalize: "words" })}
          {field("Phone number", "phone", { keyboardType: "phone-pad", placeholder: "+2547XXXXXXXX" })}
        </View>
      )}
      {field("Email", "email", { keyboardType: "email-address" })}
      {field("Password", "password", { secureTextEntry: true })}
      {mode === 'login' && (
        <TouchableOpacity onPress={() => { setForgotField('email')(f.email); setMode('forgot-request'); }} style={{ marginBottom: 4 }}>
          <Text style={{ color: C.muted, fontWeight: '600', fontSize: 13 }}>Forgot password?</Text>
        </TouchableOpacity>
      )}

      {mode === 'register' && role === 'driver' && (
        <View>
          <Text style={[s.h2, { marginTop: 10 }]}>Driver documents</Text>
          <Text style={s.label}>Truck size</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {(cfg ? cfg.truckTypes : []).map((t) => <Chip key={t.id} label={t.label} active={f.truckType === t.id} onPress={() => set('truckType')(t.id)} />)}
          </View>
          {field("Truck registration number", "truckReg", { autoCapitalize: "characters", placeholder: "KCA 123A" })}
          {fileRow("ID (PDF)", "idPdf", () => pickPdf("idPdf"))}
          {fileRow("Passport photo (PDF)", "passportPdf", () => pickPdf("passportPdf"))}
          {fileRow("Clear front photo of the truck showing the plate number", "truckPhoto", () => pickPhoto(false),
            <Btn kind="ghost" title="Camera" onPress={() => pickPhoto(true)} style={{ flex: 1 }} />)}
        </View>
      )}

      <Btn title={busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'} onPress={submit} disabled={busy} style={{ marginTop: 18 }} />
      {busy && <ActivityIndicator style={{ marginTop: 10 }} color={C.brand} />}
      </View>
      )}
    </ScrollView>
  );
}
