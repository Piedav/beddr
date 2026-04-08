import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { arrayUnion, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { db } from '../firebase'; // adjust path if needed
import { useUser } from './_layout';

const dbgColor = "#0a0513ff"; //dark background
const bgColor = "#111124ff"; //background
const lbgColor = "#322f4e81"; //light background
const l2bgColor = "#322f4eff"; //2nd light background
const l3bgColor = "#323150";
const strongColor = "#cc7bdbff"; //strong color

const warmFontType = "Molengo";
const defFontType = "OpenSansSemiBold";

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // skip confusing chars

function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function isYYYYMMDD(s: string) {
  // very light check: YYYY-MM-DD and forms a valid date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}


export default function CompetitionCodesScreen() {
  const firestore = db;
  const { userData } = useUser();

  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  
  //competition params
  const [competitionName, setCompetitionName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reward, setReward] = useState('');
  // Reward selection
  const [rewardType, setRewardType] = useState<'money' | 'custom'>('money');
  const [customReward, setCustomReward] = useState('');

  const thisWeek = useMemo(() => {
    // defaults: start today, end Sunday
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    const day = start.getDay(); // 0 Sun..6 Sat
    const daysToSunday = (7 - day) % 7; // if today is Sun -> 0
    end.setDate(start.getDate() + daysToSunday);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: fmt(start), end: fmt(end) };
  }, []);

  const ensureUniqueCode = useCallback(async () => {
    // tries a few times to avoid collision
    for (let i = 0; i < 5; i++) {
      const code = randomCode(6);
      const ref = doc(firestore, 'competitiondb', code);
      const snap = await getDoc(ref);
      if (!snap.exists()) return code;
    }
    throw new Error('Could not generate a unique code. Try again.');
  }, [firestore]);

  const joinCompetitionByCode = useCallback(async (codeRaw: string) => {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return;

    if (!userData?.uid) {
      Alert.alert('Not signed in', 'Please sign in to join competitions.');
      return;
    }

    const compRef = doc(firestore, 'competitiondb', code);
    const snap = await getDoc(compRef);

    if (!snap.exists()) {
      Alert.alert('Invalid Code', 'No competition was found with that code.');
      return;
    }

    const data = snap.data() as any;

    // finished check (end date inclusive)
    const parseLocalDate = (dateStr: string) => {
      const [y, m, d] = (dateStr || '').split('-').map(Number);
      return new Date(y, (m || 1) - 1, d || 1);
    };

    const endStr = data?.metadata?.dates?.end ?? data?.dates?.end; // support both shapes
    const end = parseLocalDate(endStr);
    end.setHours(23, 59, 59, 999);

    if (new Date() > end) {
      Alert.alert('Competition Ended', 'This competition has already finished.');
      return;
    }

    // already joined check (NEW: players map)
    const existing = data?.players?.[userData.uid];
    if (existing) {
      Alert.alert('Already Joined', 'You are already in this competition!');
      return;
    }

    // create player entry inside competition doc
    // players.<uid> = { points: 0, joinedAt: serverTimestamp() }
    await setDoc(
      compRef,
      {
        players: {
          [userData.uid]: {
            points: 0,
            joinedAt: serverTimestamp(),
          },
        },
      },
      { merge: true }
    );

    // add competition code to user's profile list
    const profileRef = doc(db, 'profiledb', userData.uid);
    try {
      await updateDoc(profileRef, { competitions: arrayUnion(code) });
    } catch {
      await setDoc(profileRef, { competitions: [code] }, { merge: true });
    }

    Alert.alert('Joined!', 'You have joined the competition.');
  }, [firestore, userData?.uid]);
  
  const createCompetition = useCallback(async () => {
    try {
      setCreating(true);

      // Fallbacks: if user leaves fields empty, use defaults
      const finalName = competitionName.trim() || 'Weekly Sleep Competition';
      const finalStart = startDate.trim() || thisWeek.start;
      const finalEnd = endDate.trim() || thisWeek.end;

      let finalReward: string;
      if (rewardType === 'money') {
        finalReward = 'money';
        console.log("TESTS");
      } else {
        finalReward = customReward.trim();
        if (!finalReward) {
          Alert.alert('Missing reward', 'Please enter a custom reward description.');
          return;
        }
      }

      // Basic validation
      if (!isYYYYMMDD(finalStart) || !isYYYYMMDD(finalEnd)) {
        Alert.alert('Invalid dates', 'Use YYYY-MM-DD for both start and end.');
        return;
      }
      if (new Date(finalStart) > new Date(finalEnd)) {
        Alert.alert('Invalid range', 'Start date must be on or before end date.');
        return;
      }

      const code = await ensureUniqueCode();
      const ref = doc(firestore, 'competitiondb', code);

      const payload = {
        name: finalName,
        dates: { start: finalStart, end: finalEnd },
        reward: finalReward,          // 'money' or your custom text
        players: {}, // optional: initializes map
      };

      await setDoc(ref, payload, { merge: true });
      await joinCompetitionByCode(code);
      setGeneratedCode(code);
      Alert.alert('Competition Created', `${finalName}\nCode: ${code}`);
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message ?? 'Failed to create competition.');
    } finally {
      setCreating(false);
    }
  }, [
    competitionName,
    startDate,
    endDate,
    rewardType,
    customReward,
    ensureUniqueCode,
    firestore,
    thisWeek.start,
    thisWeek.end,
    joinCompetitionByCode,
  ]);
  

  const joinCompetition = useCallback(async () => {
    try {
      await joinCompetitionByCode(joinCode);
      setJoinCode('');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message ?? 'Failed to join competition.');
    }
  }, [joinCode, joinCompetitionByCode]);
  
  // Animation references - start at 0 to prevent flash
  const joinAnimation = useRef(new Animated.Value(0)).current;
  const createAnimation = useRef(new Animated.Value(0)).current;
  
  // Track if this is the initial render to prevent flash
  const [hasInitialized, setHasInitialized] = useState(false);
  

  // Animation trigger function
  const startAnimations = () => {
    // Reset all animations to 0 first to prevent any flash
    joinAnimation.setValue(0);
    createAnimation.setValue(0);

    // Mark as initialized to show content
    setHasInitialized(true);

    // Staggered animation sequence
    //const animationDuration = 400;
    //const staggerDelay = 150;
    const animationDuration = 0;
    const staggerDelay = 0;

    // Welcome text (first)
    Animated.timing(joinAnimation, {
      toValue: 1,
      duration: animationDuration,
      useNativeDriver: true,
    }).start();

    // Status banner (second)
    setTimeout(() => {
      Animated.timing(createAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay);
    
  };
  useEffect(() => {
    // Small delay to ensure everything is rendered
    setTimeout(() => {
      startAnimations();
    }, 100);
    }
  , []);

  useFocusEffect(
    React.useCallback(() => {
      
      // Reset hasInitialized to ensure proper animation flow
      setHasInitialized(false);
      // Small delay to ensure everything is rendered
      setTimeout(() => {
        startAnimations();
      }, 50); // Reduced delay to minimize flash
      
    }, [])
  );

  const getAnimatedStyle = (animationValue: Animated.Value) => ({
    opacity: animationValue,
    transform: [
      {
        translateY: animationValue.interpolate({
          inputRange: [0, 1],
          outputRange: [30, 0], // Start 30 pixels down, move to original position
        }),
      },
    ],
  });
  if (!hasInitialized) {
    // (optional) keep background to avoid white flash
    return <SafeAreaView style={styles.container} />;
  }
  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={getAnimatedStyle(joinAnimation)}>
        <View style={styles.card}>
          <Text style={styles.title}>Join a Competition</Text>
          <View style={styles.row}>
            <TextInput
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="Enter code (e.g. ABC123)"
              placeholderTextColor="#9aa0a6"
              autoCapitalize="characters"
              style={styles.input}
            />
            <TouchableOpacity style={styles.button} onPress={joinCompetition}>
              <Ionicons name="log-in-outline" size={18} color="#fff" />
              <Text style={styles.buttonText}>Join</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Ask a friend for their code, paste it here, and tap Join.</Text>
        </View>
      </Animated.View>
      
      <Animated.View style={getAnimatedStyle(createAnimation)}> 
          <View style={styles.card}>
          <Text style={styles.title}>Create a New Competition</Text>

          {/* Name */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Competition Name</Text>
            <TextInput
              value={competitionName}
              onChangeText={setCompetitionName}
              placeholder="ex. Ice Cream Competition"
              placeholderTextColor="#9aa0a6"
              style={[styles.input, { flex: 0 }]}
            />
          </View>

          {/* Dates */}
          <View style={styles.fieldRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Start (YYYY-MM-DD)</Text>
              <TextInput
                value={startDate}
                onChangeText={setStartDate}
                placeholder={thisWeek.start}
                placeholderTextColor="#9aa0a6"
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                style={[styles.input, { flex: 0 }]}
              />
            </View>
            <View style={{ width: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>End (YYYY-MM-DD)</Text>
              <TextInput
                value={endDate}
                onChangeText={setEndDate}
                placeholder={thisWeek.end}
                placeholderTextColor="#9aa0a6"
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                style={[styles.input, { flex: 0 }]}
              />
            </View>
          </View>

          {/* Reward selector (simple segmented buttons) */}
          <View style={styles.fieldGroup}>
          <Text style={styles.label}>Reward</Text>

          <View style={styles.segmentRow}>
            <TouchableOpacity
              onPress={() => setRewardType('money')}
              style={[styles.segmentBtn, rewardType === 'money' && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, rewardType === 'money' && styles.segmentTextActive]}>
                Money
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setRewardType('custom')}
              style={[styles.segmentBtn, rewardType === 'custom' && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, rewardType === 'custom' && styles.segmentTextActive]}>
                Custom
              </Text>
            </TouchableOpacity>
          </View>

          {rewardType === 'custom' && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.label}>Custom reward description</Text>
              <TextInput
                value={customReward}
                onChangeText={setCustomReward}
                placeholder="e.g. $20 Gift Card, Bragging Rights, Free Coffee, etc."
                placeholderTextColor="#9aa0a6"
                style={[styles.input, { flex: 0 }]}
              />
              <Text style={styles.hint}>This text will be shown as the prize.</Text>
            </View>
          )}
        </View>

          <TouchableOpacity style={styles.button} onPress={createCompetition} disabled={creating}>
            <Ionicons name="sparkles-outline" size={18} color="#fff" />
            <Text style={styles.buttonText}>{creating ? 'Creating…' : 'Generate Code'}</Text>
          </TouchableOpacity>

          {generatedCode ? (
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Your code</Text>
              <Text style={styles.codeValue}>{generatedCode}</Text>
              <Text style={styles.hint}>Share this with friends so they can join.</Text>
            </View>
          ) : null}
        </View>
      </Animated.View>
      
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: bgColor, padding: 16, gap: 16 },
  card: { backgroundColor: lbgColor, borderRadius: 16, padding: 16, gap: 12 },
  title: { fontFamily: defFontType, color: '#fff', fontSize: 18, fontWeight: '700' },
  hint: { fontFamily: defFontType, color: '#b0b0b0', fontSize: 12 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: '#1a1a2a',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: defFontType,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: strongColor,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonText: { fontFamily: defFontType, color: '#fff', fontWeight: '700' },
  inlineInfo: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  inlineText: { fontFamily: defFontType, color: '#fff' },
  codeBox: {
    marginTop: 8,
    backgroundColor: '#1a1a2a',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  codeLabel: { fontFamily: defFontType, color: '#b0b0b0', fontSize: 12 },
  codeValue: { fontFamily: defFontType, color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: 2 },
  fieldGroup: { gap: 6 },
  fieldRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  label: { fontFamily: defFontType, color: '#b0b0b0', fontSize: 12, marginBottom: 4 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1a1a2a',
    borderWidth: 1,
    borderColor: '#2a2a3a',
  },
  segmentBtnActive: {
    backgroundColor: strongColor,
    borderColor: strongColor,
  },
  segmentText: { fontFamily: defFontType, color: '#b0b0b0', fontWeight: '600' },
  segmentTextActive: { fontFamily: defFontType, color: '#fff' },
});
