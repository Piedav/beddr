import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { arrayUnion, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
const darkStrongColor = 'rgb(109, 16, 126)';
const labelColor = 'rgb(180, 180, 188)';
const placeholderColor = 'rgb(166, 166, 178)';
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

function formatMinutes(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

type LockedEvent = {
  timestamp: number;
  lockedIn: boolean;
};

type LockedSession = {
  start: number;
  end: number;
};

function normalizeLockedEvents(events?: LockedEvent[]): LockedEvent[] {
  if (!Array.isArray(events)) return [];
  return [...events]
    .filter(
      (e) =>
        e &&
        typeof e.timestamp === 'number' &&
        typeof e.lockedIn === 'boolean'
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function buildLockedSessions(
  events?: LockedEvent[],
  nowMs: number = Date.now()
): LockedSession[] {
  const sorted = normalizeLockedEvents(events);
  const sessions: LockedSession[] = [];

  let currentStart: number | null = null;

  for (const event of sorted) {
    if (event.lockedIn) {
      if (currentStart === null) {
        currentStart = event.timestamp;
      }
    } else {
      if (currentStart !== null && event.timestamp > currentStart) {
        sessions.push({
          start: currentStart,
          end: event.timestamp,
        });
        currentStart = null;
      }
    }
  }

  // still locked in right now
  if (currentStart !== null && nowMs > currentStart) {
    sessions.push({
      start: currentStart,
      end: nowMs,
    });
  }

  return sessions;
}

function getOverlapMs(
  sessionStart: number,
  sessionEnd: number,
  rangeStart: number,
  rangeEnd: number
): number {
  const start = Math.max(sessionStart, rangeStart);
  const end = Math.min(sessionEnd, rangeEnd);
  return Math.max(0, end - start);
}

function getLockedMinutesInRange(
  events: LockedEvent[] | undefined,
  rangeStart: number,
  rangeEnd: number,
  nowMs: number = Date.now()
): number {
  if (rangeEnd <= rangeStart) return 0;

  const sessions = buildLockedSessions(events, nowMs);
  let totalMs = 0;

  for (const session of sessions) {
    totalMs += getOverlapMs(session.start, session.end, rangeStart, rangeEnd);
  }

  return Math.floor(totalMs / 60000);
}

function getAllTimeLockedMinutes(
  events?: LockedEvent[],
  nowMs: number = Date.now()
): number {
  const sessions = buildLockedSessions(events, nowMs);
  const totalMs = sessions.reduce((sum, s) => sum + (s.end - s.start), 0);
  return Math.floor(totalMs / 60000);
}

function getStartOfWeekMs(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function getThisWeekLockedMinutes(
  events?: LockedEvent[],
  nowMs: number = Date.now()
): number {
  const startOfWeek = getStartOfWeekMs(new Date(nowMs));
  return getLockedMinutesInRange(events, startOfWeek, nowMs, nowMs);
}

export default function CompetitionCodesScreen() {
  const { userData } = useUser();

  const [joinCode, setJoinCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  type WinType = 'number' | 'percentage' | 'team';
  const [competitionName, setCompetitionName] = useState('');
  const [reward, setReward] = useState('');
  const [winType, setWinType] = useState<WinType>('number');
  const [winValInput, setWinValInput] = useState('');

  const [scrollY, setScrollY] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const showBottomFade = contentHeight > layoutHeight && scrollY + layoutHeight < contentHeight - 8;

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
      async function recalculateCompetitionPointsForUser(
        competitionId: string,
        uid: string,
      ) {
        const compRef = doc(firestore, 'competitiondb', competitionId);
        const compSnap = await getDoc(compRef);
        if (!compSnap.exists()) return;

        const comp = compSnap.data() as any;
        const start = typeof comp?.start === 'number' ? comp.start : null;
        const end = typeof comp?.end === 'number' ? comp.end : null;

        if (start == null || end == null) return;

        

        const profileRef = doc(firestore, 'profiledb', uid);
        const profileSnap = await getDoc(profileRef);
        const lockedEvents = ((profileSnap.data() as any)?.LockedEvents ?? []) as LockedEvent[];
        const points = getLockedMinutesInRange(lockedEvents, start, end);
        await updateDoc(compRef, {
          [`players.${uid}.points`]: getLockedMinutesInRange(lockedEvents, data.start, data.end),
        });
      }
      await setDoc(
        compRef,
        {
          players: {
            [userData.uid]: {
              points: 0,
              joinedAt: Date.now(),
              name: userData.name,
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

      const finalName = competitionName.trim() || userData.name + "'s Sleep Competition";
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

      
      const parsedWinVal = parseInt(winValInput, 10);
      const winVal = isNaN(parsedWinVal) ? 0 : parsedWinVal;

      if(winType === 'number') {
        if(winVal <= 0) {
          Alert.alert('Invalid number of winners', 'Please enter a positive number of winners.');
          return;
        }
      }
      else if(winType === 'percentage') {
        if(winVal <= 0 || winVal > 100) {
          Alert.alert('Invalid percentage of winners', 'Please enter a positive number 1-100 for the percentage of winners.');
          
          return;
        }
      }
      else if(winType === 'team') {
        if(winVal <= 0) {
          Alert.alert('Invalid team point goal', 'Please enter a positive number for the total team point goal.');
          return;
        }
      }
      
      
      const code = await ensureUniqueCode();
      const ref = doc(firestore, 'competitiondb', code);

      const payload = {
        name: finalName,
        start: startMs,
        end: endMs,
        reward: finalReward,
        players: {},
        winType: winType,
        winVal: winVal,
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
  }, [competitionName, reward, endDate, ensureUniqueCode, joinCompetitionByCode, startDate, userData?.uid, winType, winValInput, userData?.name]);

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
    <SafeAreaView style={{ flex: 1, backgroundColor: bgColor }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.container, { flexGrow: 1 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => setLayoutHeight(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentHeight(h)}
        onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        <Animated.View style={getAnimatedStyle(joinAnimation)}>
          <View style={styles.card}>
            <Text style={styles.title}>Join a Competition</Text>
            <View style={styles.row}>
              <TextInput
                value={joinCode}
                onChangeText={setJoinCode}
                placeholder="Enter code (e.g. ABC123)"
                placeholderTextColor={placeholderColor}
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
            {generatedCode ? (
              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Your code</Text>
                <Text style={styles.codeValue}>{generatedCode}</Text>
                <Text style={styles.hint}>Share this with friends so they can join.</Text>
              </View>
            ) : null}
            <Text style={styles.title}>Create a New Competition</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Competition Name</Text>
              <TextInput
                value={competitionName}
                onChangeText={setCompetitionName}
                placeholder="ex. Ice Cream Competition"
                placeholderTextColor={placeholderColor}
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
              Competition runs from the start of {formatShortDate(startDate)} {"\n"} to the end of {formatShortDate(endDate)}.
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Winning Reward  (Provided by Non-Winning Competitors)</Text>
              <TextInput
                value={reward}
                onChangeText={setReward}
                placeholder="e.g. $20 Gift Card, Bragging Rights, Free Coffee"
                placeholderTextColor={placeholderColor}
                style={styles.input}
                autoCapitalize="none"
              />
              <View style = {styles.row}>
                <TouchableOpacity activeOpacity={0.7} style={[styles.multiButton, winType === 'number' && { backgroundColor: strongColor }]} onPress={() => setWinType('number')} >
                  <Text style={styles.multiButtonText}>Top # Win</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7}style={[styles.multiButton, winType === 'percentage' && { backgroundColor: strongColor }]} onPress={() => setWinType('percentage')} >
                  
                  <Text style={styles.multiButtonText}>Top % Win</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7}style={[styles.multiButton, winType === 'team' && { backgroundColor: strongColor }]} onPress={() => setWinType('team')} >
                  
                  <Text style={styles.multiButtonText}>Co-op Goal</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                value={winValInput}
                onChangeText={(text) => {
                  const cleaned = text.replace(/[^0-9]/g, '');
                  setWinValInput(cleaned);
                }}
                placeholder={
                  winType === 'team'
                    ? 'e.g. 1000 total team points needed to win'
                    : winType === 'percentage'
                    ? 'e.g. 25 for top 25% winning'
                    : 'e.g. 3, for top 3 players winning'
                }
                placeholderTextColor={placeholderColor}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardAppearance="dark"
                textContentType="none"
              />
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={createCompetition} disabled={creating}>
              <Ionicons name="sparkles-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>{creating ? 'Creating…' : 'Generate Code'}</Text>
            </TouchableOpacity>
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
      </ScrollView>

      {showBottomFade && (
        <LinearGradient
          colors={[
            'transparent',
            'rgba(17,17,36,0.6)',
            'rgba(17,17,36,0.9)',
            '#111124'
          ]}
          pointerEvents="none"
          style={styles.bottomFade}
        />
      )}
    </SafeAreaView>
    
  );
}

const styles = StyleSheet.create({
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
  },
  container: {
    backgroundColor: bgColor,
    padding: 16,
    gap: 16,
    paddingBottom: 0,
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
    color: labelColor,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
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
    color: labelColor,
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
  multiButton: {
    minHeight: 28,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: darkStrongColor,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  multiButtonText: {
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
    minHeight: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
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
    color: labelColor,
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
    color: labelColor,
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