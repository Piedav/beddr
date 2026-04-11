import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import {
  arrayUnion,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { firestore } from '../firebase';
import { useUser } from './_layout';

const bgColor = '#111124ff';
const lbgColor = '#322f4e81';
const strongColor = '#cc7bdbff';
const defFontType = 'OpenSansSemiBold';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

function startOfDayMs(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDayMs(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type PickerTarget = 'start' | 'end' | null;

export default function CompetitionCodesScreen() {
  const { userData } = useUser();

  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  const [competitionName, setCompetitionName] = useState('');
  const [reward, setReward] = useState('');

  const thisWeek = useMemo(() => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    const day = start.getDay();
    const daysToSunday = (7 - day) % 7;
    end.setDate(start.getDate() + daysToSunday);
    return { start, end };
  }, []);

  const [startDate, setStartDate] = useState<Date>(thisWeek.start);
  const [endDate, setEndDate] = useState<Date>(thisWeek.end);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
  const [tempPickerDate, setTempPickerDate] = useState<Date>(thisWeek.start);

  const ensureUniqueCode = useCallback(async () => {
    for (let i = 0; i < 5; i++) {
      const code = randomCode(6);
      const ref = doc(firestore, 'competitiondb', code);
      const snap = await getDoc(ref);
      if (!snap.exists()) return code;
    }
    throw new Error('Could not generate a unique code. Try again.');
  }, []);

  const joinCompetitionByCode = useCallback(
    async (codeRaw: string) => {
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

      const end = typeof data?.end === 'number' ? data.end : null;
      if (end == null) {
        Alert.alert('Invalid competition', 'This competition is missing its end date.');
        return;
      }

      if (Date.now() > end) {
        Alert.alert('Competition Ended', 'This competition has already finished.');
        return;
      }

      const existing = data?.players?.[userData.uid];
      if (existing) {
        Alert.alert('Already Joined', 'You are already in this competition!');
        return;
      }

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

      const profileRef = doc(firestore, 'profiledb', userData.uid);
      try {
        await updateDoc(profileRef, { competitions: arrayUnion(code) });
      } catch {
        await setDoc(profileRef, { competitions: [code] }, { merge: true });
      }

      Alert.alert('Joined!', 'You have joined the competition.');
    },
    [userData?.uid]
  );

  const createCompetition = useCallback(async () => {
    try {
      setCreating(true);

      if (!userData?.uid) {
        Alert.alert('Not signed in', 'Please sign in to create competitions.');
        return;
      }

      const finalName = competitionName.trim() || 'Weekly Sleep Competition';
      const finalReward = reward.trim();

      if (!finalReward) {
        Alert.alert('Missing reward', 'Please enter a custom reward description.');
        return;
      }

      const startMs = startOfDayMs(startDate);
      const endMs = endOfDayMs(endDate);

      if (startMs > endMs) {
        Alert.alert('Invalid range', 'Start date must be on or before end date.');
        return;
      }

      const code = await ensureUniqueCode();
      const ref = doc(firestore, 'competitiondb', code);

      const payload = {
        name: finalName,
        start: startMs,
        end: endMs,
        reward: finalReward,
        players: {},
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
  }, [competitionName, reward, endDate, ensureUniqueCode, joinCompetitionByCode, startDate, userData?.uid]);

  const joinCompetition = useCallback(async () => {
    try {
      await joinCompetitionByCode(joinCode);
      setJoinCode('');
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message ?? 'Failed to join competition.');
    }
  }, [joinCode, joinCompetitionByCode]);

  const openPicker = (target: PickerTarget) => {
    if (!target) return;
    setPickerTarget(target);
    setTempPickerDate(target === 'start' ? startDate : endDate);
    setPickerVisible(true);
  };

  const closePicker = () => {
    setPickerVisible(false);
    setPickerTarget(null);
  };

  const confirmPicker = () => {
    if (pickerTarget === 'start') {
      setStartDate(tempPickerDate);
      if (tempPickerDate.getTime() > endDate.getTime()) {
        setEndDate(tempPickerDate);
      }
    } else if (pickerTarget === 'end') {
      setEndDate(tempPickerDate);
    }
    closePicker();
  };

  const joinAnimation = useRef(new Animated.Value(0)).current;
  const createAnimation = useRef(new Animated.Value(0)).current;
  const [hasInitialized, setHasInitialized] = useState(false);

  const startAnimations = () => {
    joinAnimation.setValue(0);
    createAnimation.setValue(0);
    setHasInitialized(true);

    Animated.timing(joinAnimation, {
      toValue: 1,
      duration: 0,
      useNativeDriver: true,
    }).start();

    setTimeout(() => {
      Animated.timing(createAnimation, {
        toValue: 1,
        duration: 0,
        useNativeDriver: true,
      }).start();
    }, 0);
  };

  useEffect(() => {
    const timer = setTimeout(startAnimations, 100);
    return () => clearTimeout(timer);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      setHasInitialized(false);
      const timer = setTimeout(startAnimations, 50);
      return () => clearTimeout(timer);
    }, [])
  );

  const getAnimatedStyle = (animationValue: Animated.Value) => ({
    opacity: animationValue,
    transform: [
      {
        translateY: animationValue.interpolate({
          inputRange: [0, 1],
          outputRange: [30, 0],
        }),
      },
    ],
  });

  if (!hasInitialized) {
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
              placeholderTextColor="#8E8E93"
              autoCapitalize="characters"
              style={[styles.input, styles.rowInput]}
              textContentType="none"
              keyboardAppearance="dark"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={joinCompetition}>
              <Ionicons name="log-in-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Join</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Ask a friend for their code, paste it here, and tap Join.</Text>
        </View>
      </Animated.View>

      <Animated.View style={getAnimatedStyle(createAnimation)}>
        <View style={styles.card}>
          <Text style={styles.title}>Create a New Competition</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Competition Name</Text>
            <TextInput
              value={competitionName}
              onChangeText={setCompetitionName}
              placeholder="ex. Ice Cream Competition"
              placeholderTextColor="#8E8E93"
              style={styles.input}
              textContentType="none"
              keyboardAppearance="dark"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.iosGroup}>
            <TouchableOpacity style={styles.iosRow} onPress={() => openPicker('start')} activeOpacity={0.7}>
              <Text style={styles.iosRowLabel}>Start Date</Text>
              <View style={styles.iosRowRight}>
                <Text style={styles.iosRowValue}>{formatShortDate(startDate)}</Text>
                <Ionicons name="chevron-forward" size={16} color="#8E8E93" />
              </View>
            </TouchableOpacity>

            <View style={styles.separator} />

            <TouchableOpacity style={styles.iosRow} onPress={() => openPicker('end')} activeOpacity={0.7}>
              <Text style={styles.iosRowLabel}>End Date</Text>
              <View style={styles.iosRowRight}>
                <Text style={styles.iosRowValue}>{formatShortDate(endDate)}</Text>
                <Ionicons name="chevron-forward" size={16} color="#8E8E93" />
              </View>
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Competition runs from the start of {formatShortDate(startDate)} to the end of {formatShortDate(endDate)}.
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Reward</Text>
            <TextInput
              value={reward}
              onChangeText={setReward}
              placeholder="e.g. $20 Gift Card, Bragging Rights, Free Coffee"
              placeholderTextColor="#8E8E93"
              style={styles.input}
              autoCapitalize="none"
            />
            <Text style={styles.hint}>This text will be shown as the prize.</Text>
          </View>

          <TouchableOpacity style={styles.primaryButton} onPress={createCompetition} disabled={creating}>
            <Ionicons name="sparkles-outline" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>{creating ? 'Creating…' : 'Generate Code'}</Text>
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

      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={closePicker}
      >
        <Pressable style={styles.modalBackdrop} onPress={closePicker} />
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetGrabber} />

            <View style={styles.sheetHeader}>
              <TouchableOpacity onPress={closePicker}>
                <Text style={styles.sheetCancel}>Cancel</Text>
              </TouchableOpacity>

              <Text style={styles.sheetTitle}>
                {pickerTarget === 'start' ? 'Start Date' : 'End Date'}
              </Text>

              <TouchableOpacity onPress={confirmPicker}>
                <Text style={styles.sheetDone}>Done</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sheetPickerWrap}>
              <DateTimePicker
                value={tempPickerDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                minimumDate={pickerTarget === 'end' ? startDate : new Date()}
                onChange={(_, selectedDate) => {
                  if (selectedDate) setTempPickerDate(selectedDate);
                }}
                textColor="white"
                themeVariant="dark"
                style={styles.sheetPicker}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: bgColor,
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: lbgColor,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  title: {
    fontFamily: defFontType,
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  hint: {
    fontFamily: defFontType,
    color: '#8E8E93',
    fontSize: 12,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  input: {
    backgroundColor: '#1C1C1E',
    color: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: defFontType,
  },
  rowInput: {
    flex: 1,
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontFamily: defFontType,
    color: '#8E8E93',
    fontSize: 12,
    marginBottom: 4,
  },
  primaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: strongColor,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButtonText: {
    fontFamily: defFontType,
    color: '#fff',
    fontWeight: '700',
  },

  iosGroup: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    overflow: 'hidden',
  },
  iosRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iosRowLabel: {
    color: '#fff',
    fontSize: 16,
    fontFamily: defFontType,
  },
  iosRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iosRowValue: {
    color: '#8E8E93',
    fontSize: 16,
    fontFamily: defFontType,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#2C2C2E',
    marginLeft: 14,
  },

  codeBox: {
    marginTop: 8,
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  codeLabel: {
    fontFamily: defFontType,
    color: '#8E8E93',
    fontSize: 12,
  },
  codeValue: {
    fontFamily: defFontType,
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  sheetGrabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#5A5A5F',
    marginTop: 10,
    marginBottom: 8,
  },
  sheetHeader: {
    minHeight: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetCancel: {
    color: '#0A84FF',
    fontSize: 17,
    fontFamily: defFontType,
  },
  sheetDone: {
    color: '#0A84FF',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: defFontType,
  },
  sheetTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    fontFamily: defFontType,
  },
  sheetPickerWrap: {
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  sheetPicker: {
    alignSelf: 'stretch',
  },
});