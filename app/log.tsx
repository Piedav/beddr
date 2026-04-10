import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { firestore } from '../firebase';
import { useUser } from './_layout';

import { SafeAreaView } from 'react-native-safe-area-context';

const dbgColor = "#0a0513ff"; //dark background
const bgColor = "#111124ff"; //background
const lbgColor = "#322f4e81"; //light background
const l2bgColor = "#322f4eff"; //2nd light background
const l3bgColor = "#323150";
const strongColor = "#cc7bdbff"; //strong color

const warmFontType = "Molengo";
const defFontType = "OpenSansSemiBold";


function isYYYYMMDD(s: string) {
  // very light check: YYYY-MM-DD and forms a valid date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function isValidMilitaryTimeHHMM(time: string) {
  // Must be exactly "HH:MM"
  if (!/^\d{2}:\d{2}$/.test(time)) return false;

  const [hhStr, mmStr] = time.split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr);

  // Reject NaN (extra safety)
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return false;

  // 24-hour range checks
  if (hh < 0 || hh > 23) return false;
  if (mm < 0 || mm > 59) return false;

  return true;
}
function formatDate(time: string) {
  const [hhStr, mmStr] = time.split(":");
  const hh = Number(hhStr) + (Number(hhStr) <= 12 ? 24 : 0);
  const mm = Number(mmStr);
  return 60*hh+mm;
}
function toYYYYMMDD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function* eachDateInclusive(startStr: string, endStr: string) {
  const start = parseLocalYYYYMMDD(startStr);
  const end = parseLocalYYYYMMDD(endStr);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    yield toYYYYMMDD(d);
  }
}
function parseLocalYYYYMMDD(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function daysBetween(a: Date, b: Date) {
  const ms = 24 * 60 * 60 * 1000;
  // Normalize to midnight local
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((B - A) / ms);
}
// same rule you use on HomeScreen
function calculatePointsFromWeektime(weekTimeValue: number) {
  if (weekTimeValue < 0) return 0;

  const fivePM = 17 * 60;
  const ninePM = 21 * 60;
  const totalDuration = 6 * 60; // 9pm -> 3am

  let timeFromNinePM: number;

  if (weekTimeValue >= ninePM) {
    timeFromNinePM = weekTimeValue - ninePM;
  } else if (weekTimeValue >= fivePM) {
    return 30;
  } else {
    timeFromNinePM = (24 * 60 - ninePM) + weekTimeValue;
  }

  if (timeFromNinePM <= totalDuration) {
    return Math.max(0, Math.round(30 * (1 - timeFromNinePM / totalDuration) * 1000) / 1000);
  }
  return 0;
}
function sumPointsForRange(
  sleepTimes: Record<string, number> | undefined,
  startStr: string,
  endStr: string
) {
  let total = 0;
  for (const dayStr of eachDateInclusive(startStr, endStr)) {
    const v = sleepTimes?.[dayStr];
    if (typeof v === "number") total += calculatePointsFromWeektime(v);
  }
  return total;
}

export async function updateAllCompetitions(uid: string, date: string) {

  // read profile once (to recompute totals)
  const profileRef = doc(firestore, "profiledb", uid);
  const profileSnap = await getDoc(profileRef);
  const sleepTimes: Record<string, number> | undefined = profileSnap.data()?.sleepTimes;

  // scan competitions (ok if your competitiondb is small)
  const compsSnap = await getDocs(collection(firestore, "competitiondb"));

  const updates: Promise<void>[] = [];

  compsSnap.forEach((compDoc) => {
    const comp = compDoc.data() || {};
    const startStr = comp?.dates?.start;
    const endStr = comp?.dates?.end;
    const players = comp?.players;

    if (!startStr || !endStr) return;
    if (!players || typeof players !== "object") return;
    if (!players[uid]) return; // user not in this competition

    // only update competitions that include the logged date
    if (date < startStr || date > endStr) return;

    const newTotalPoints = sumPointsForRange(sleepTimes, startStr, endStr);

    const compRef = doc(firestore, "competitiondb", compDoc.id);
    updates.push(
      updateDoc(compRef, {
        [`players.${uid}.points`]: newTotalPoints,
      })
    );
  });

  await Promise.all(updates);
}

export default function logScreen() {
  const { userData } = useUser();

  const [updating, setUpdating] = useState(false);
  
  //competition params
  const [inputDate, setInputDate] = useState('');
  const [inputTime, setInputTime] = useState('');

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
  

  const updateHours = useCallback(async () => {
    try {
      setUpdating(true);

      // Fallbacks: if user leaves fields empty, use defaults
      const finalDate = inputDate.trim();
      const finalTime = inputTime.trim();
      if (!finalDate || !finalTime) {
          Alert.alert('Missing Field', 'Please enter all fields.');
          return;
      }
      

      // Basic validation
      if (!isYYYYMMDD(finalDate)) {
        Alert.alert('Invalid Date', 'Use YYYY-MM-DD.');
        return;
      }
      if (!isValidMilitaryTimeHHMM(finalTime)) {
        Alert.alert('Invalid Time', 'Use HH:MM.');
        return;
      }

      if(!userData?.uid) {
        Alert.alert('User ID Error', 'Please Log Out and Retry.');
        return;
      }

      const ref = doc(firestore, 'profiledb', userData.uid);

      try {
        // await ref.update({
        //   [`sleepTimes.${finalDate}`]: formatDate(finalTime),
        // });
        await updateDoc(ref, {[`sleepTimes.${finalDate}`]: formatDate(finalTime),});
      } catch (e: any) {
        // If doc doesn't exist, create it (merge) with a real nested object
        // await ref.set(
        //   { sleepTimes: { [finalDate]: formatDate(finalTime) } },
        //   { merge: true }
        // );
        await setDoc(ref, {sleepTimes: {[finalDate]: formatDate(finalTime)}}, {merge: true});
      }
      
      //update all your past competitions
      await updateAllCompetitions(userData.uid, finalDate);

      Alert.alert('Sleep Time Updated');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message ?? 'Failed to update sleep time.');
    } finally {
      setUpdating(false);
    }
  }, [userData, formatDate, inputDate, inputTime, firestore]);

  
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
      
      <Animated.View style={getAnimatedStyle(createAnimation)}> 
          <View style={styles.card}>
          <Text style={styles.title}>Log Sleep Times</Text>

          {/* Dates */}
          <View style={styles.fieldGroup}>
            
              <Text style={styles.label}>Date (ex. if you slept 1 am Tuesday, put Monday's date)</Text>
              <Text style={styles.label}>(YYYY-MM-DD) </Text>
              <TextInput
                value={inputDate}
                onChangeText={setInputDate}
                placeholder={thisWeek.start}
                placeholderTextColor="#9aa0a6"
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                style={[styles.input, { flex: 0 }]}
              />
            
            <View style={{ width: 8 }} />
            
          </View>

          {/* Sleep timing */}
          <View style={styles.fieldGroup}>

          <View style={{ marginTop: 8 }}>
            <Text style={styles.label}>Last Time Phone Was Used (HH:MM, Military Time)</Text>
            <TextInput
              value={inputTime}
              onChangeText={setInputTime}
              placeholder="24:00"
              placeholderTextColor="#9aa0a6"
              style={[styles.input, { flex: 0 }]}
            />
          </View>
          
        </View>

          <TouchableOpacity style={styles.button} onPress={updateHours} disabled={updating}>
            <Ionicons name="checkmark-outline" size={18} color="#fff" />
            <Text style={styles.buttonText}>{updating ? 'Updating...' : 'Update Hours'}</Text>
          </TouchableOpacity>

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
