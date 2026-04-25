import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import * as LiveActivity from 'expo-live-activity';
import * as Notifications from 'expo-notifications';
import { Tabs } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, firestore } from '../firebase';
import { useUser } from './_layout';

const dbgColor = '#0a0513ff';
const bgColor = '#111124ff';
const lbgColor = '#322f4e81';
const l2bgColor = '#322f4eff';
const l3bgColor = '#323150';
const strongColor = '#cc7bdbff';
const buttonPressedColor = 'rgb(100, 65, 106)';

const warmFontType = 'Molengo';
const defFontType = 'OpenSansSemiBold';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
interface UserProfile {
  name: string;
  lockedEvents: [];
  pastcomps: Array<{
    date: string;
    money: number;
    points: number;
    rank: number;
    won: boolean;
  }>;
  competitions: {};
}

interface Player {
  id: number;
  name: string;
  points: number;
}

interface Competition {
  id: string;
  name: string;
  start: number;
  end: number;
  status: 'ongoing' | 'upcoming' | 'finished';
  players: Record<string, { points?: number; joinedAt?: any }>;
  reward: string;
  userJoined: boolean;
}

type DayProgress = {
  day: string;
  points: number;
  lastPutDown: string;
};
function formatMinutes(totalMinutes: number) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if(h === 0) return `${m}m`;
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
function formatDurationWithSeconds(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const hh = h > 0 ? `${h}:` : '';
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');

  return `${hh}${mm}:${ss}`;
}
function formatClockTime(date: Date) {
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function syncAllJoinedCompetitionPoints(
  uid: string,
  lockedEvents: LockedEvent[],
  competitions: Competition[]
) {
  const joined = competitions.filter((c) => c.userJoined);

  await Promise.all(
    joined.map(async (comp) => {
      const points = getLockedMinutesInRange(lockedEvents, comp.start, comp.end);
      const currentPoints = (comp.players as any)?.[uid]?.points ?? 0;

      if (currentPoints === points) return;

      await updateDoc(doc(firestore, 'competitiondb', comp.id), {
        [`players.${uid}.points`]: points,
      });
    })
  );
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

export default function HomeScreen() {
  const { userData } = useUser();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [isJoining, setIsJoining] = useState<string | null>(null);
  const [weeklyProgress, setWeeklyProgress] = useState<DayProgress[]>([]);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  const showBottomFade =
    contentHeight > layoutHeight &&
    scrollY + layoutHeight < contentHeight - 8;
  const [allTimeLockedMinutes, setAllTimeLockedMinutes] = useState(0);
  const [thisWeekLockedMinutes, setThisWeekLockedMinutes] = useState(0);
  const [lockedEvents, setLockedEvents] = useState<LockedEvent[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const homeLockoutNotificationIdRef = useRef<string | null>(null);
  const lastLockoutNotificationAtRef = useRef<number>(0);
  const liveActivityIdRef = useRef<string | null>(null);
  const liveActivityStartMsRef = useRef<number | null>(null);
  const defaultTabBarStyle = {
    backgroundColor: dbgColor,
    borderTopWidth: 2,
    borderTopColor: l3bgColor,
    height: 80,
    paddingBottom: 20,
    paddingTop: 8,
  };
  
  

  type NativeLiveActivityState = {
    title: string;
    subtitle?: string;
    progressBar?: {
      date?: number;
      progress?: number;
      elapsedTimer?: {
        startDate: number;
      };
    };
    imageName?: string;
    dynamicIslandImageName?: string;
  };
  const isLiveActivitySupported =
    Platform.OS === 'ios';

  const startLockInLiveActivity = async (startMs: number) => {
    
    if (Platform.OS !== 'ios') return;

    try {
      if (liveActivityIdRef.current) {
        await LiveActivity.stopActivity(liveActivityIdRef.current, {
          title: 'Locked out',
          subtitle: 'Session ended',
        } as any);
        liveActivityIdRef.current = null;
      }

      const liveState: NativeLiveActivityState = {
        title: 'Locked In',
        subtitle: 'Tap to Open Beddr. Failure to tap this banner while re-opening the device may result in errors in tracking.',
        progressBar: {
          elapsedTimer: {
            startDate: startMs,
          },
        },
      };
      console.log('Starting stopwatch live activity', liveState);
      const id = LiveActivity.startActivity(liveState as any, {
        timerType: 'digital',
      } as any);

      if (id) {
        liveActivityIdRef.current = id;
        liveActivityStartMsRef.current = startMs;
      }
    } catch (e) {
      console.error('Failed to start Live Activity', e);
    }
    
  };


  const stopLockInLiveActivity = async () => {
    if (Platform.OS !== 'ios') return;
    if (!liveActivityIdRef.current) return;

    try {
      await LiveActivity.stopActivity(liveActivityIdRef.current, {
        title: 'Locked out',
        subtitle: 'Session ended',
      } as any);
    } catch (e) {
      console.error('Failed to stop Live Activity', e);
    } finally {
      liveActivityIdRef.current = null;
      liveActivityStartMsRef.current = null;
    }
  };

  useEffect(() => {
    requestNotificationPermission().catch(console.error);
  }, []);
  const requestNotificationPermission = async () => {
    const settings = await Notifications.getPermissionsAsync();

    if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return true;
    }

    const req = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: false,
      },
    });

    return !!(req.granted || req.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL);
  };

  const scheduleHomeLockoutNotification = async () => {
    const now = Date.now();

    // debounce so repeated app-state churn doesn't spam notifications
    if (now - lastLockoutNotificationAtRef.current < 8000) return;

    lastLockoutNotificationAtRef.current = now;

    const hasPermission = await requestNotificationPermission();
    if (!hasPermission) return;

    // cancel previous pending one if any
    if (homeLockoutNotificationIdRef.current) {
      try {
        await Notifications.cancelScheduledNotificationAsync(
          homeLockoutNotificationIdRef.current
        );
      } catch {}
      homeLockoutNotificationIdRef.current = null;
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Locked out',
        body: 'You left Beddr, so your lock-in session ended.',
        sound: false,
      },
      trigger: null, // immediate local notification
    });

    homeLockoutNotificationIdRef.current = id;
  };

  const cancelHomeLockoutNotification = async () => {
    if (!homeLockoutNotificationIdRef.current) return;

    try {
      await Notifications.cancelScheduledNotificationAsync(
        homeLockoutNotificationIdRef.current
      );
    } catch {}

    homeLockoutNotificationIdRef.current = null;
  };


  
  useEffect(() => {
    const total = getAllTimeLockedMinutes(lockedEvents, nowMs);
    const week = getThisWeekLockedMinutes(lockedEvents, nowMs);

    setAllTimeLockedMinutes(total);
    setThisWeekLockedMinutes(week);
  }, [lockedEvents, nowMs]);

  
  const [stats, setStats] = useState<{
    totalWins: number;
    averageBedtime: string;
    weeksPlayed: number;
    bestRank: string | number;
  }>({
    totalWins: 0,
    averageBedtime: 'N/A',
    weeksPlayed: 0,
    bestRank: 'N/A',
  });

  const [collapseFinished, setCollapseFinished] = useState(true);
  const [theButtonPressed, setTheButtonPressed] = useState(false);
  
  const KeepAwakeOn = () => {
    useKeepAwake();
    return null;
  }
  useEffect(() => {
    if (!theButtonPressed) return;

    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [theButtonPressed]);

  const [statsHeight, setStatsHeight] = useState(0);

  const navigation = useNavigation<any>();

  const [profileLoading, setProfileLoading] = useState(true);
  const [competitionsLoading, setCompetitionsLoading] = useState(true);
  const [hasInitialized, setHasInitialized] = useState(false);

  const [uid, setUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!uid) return;
    if (profileLoading) return;

    const userDocRef = doc(firestore, 'profiledb', uid);

    updateDoc(userDocRef, {
      totalLockedMinutes: allTimeLockedMinutes,
      thisWeekLockedMinutes: thisWeekLockedMinutes,
    }).catch((err) => {
      console.error('Failed to update minute totals:', err);
    });
  }, [uid, profileLoading, allTimeLockedMinutes, thisWeekLockedMinutes]);

  const canScrollLeft = scrollPosition > 5;
  const canScrollRight =
    scrollViewWidth > 0 &&
    contentWidth > 0 &&
    scrollPosition < contentWidth - scrollViewWidth - 5;

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    setScrollPosition(contentOffset.x);
    setScrollViewWidth(layoutMeasurement.width);
    setContentWidth(contentSize.width);
  };

  const handleContentSizeChange = (width: number, _height: number) => {
    setContentWidth(width);
  };

  const handleLayout = (event: any) => {
    setScrollViewWidth(event.nativeEvent.layout.width);
  };

  const scrollLeft = () => {
    const newPosition = Math.max(0, scrollPosition - 200);
    scrollViewRef.current?.scrollTo({ x: newPosition, animated: true });
  };

  const scrollRight = () => {
    const maxScroll = contentWidth - scrollViewWidth;
    const newPosition = Math.min(maxScroll, scrollPosition + 200);
    scrollViewRef.current?.scrollTo({ x: newPosition, animated: true });
  };

  const goToCompetition = (competitionId: string) => {
    navigation.navigate('competition', { competitionId });
  };

  const getTodayIndex = () => new Date().getDay();
  const recordEvent = async (lockedIn: boolean, timestamp?: number): Promise<boolean> => {
    if (!uid) {
      console.log('recordEvent skipped: no uid');
      return false;
    }

    const newEvent: LockedEvent = {
      timestamp: timestamp ?? Date.now(),
      lockedIn,
    };

    const profileRef = doc(firestore, 'profiledb', uid);

    try {
      await updateDoc(profileRef, {
        lockedEvents: arrayUnion(newEvent),
      });
      console.log('recordEvent success:', newEvent);
      return true;
    } catch (err) {
      console.log('updateDoc failed, falling back to setDoc:', err);
      await setDoc(
        profileRef,
        { lockedEvents: [newEvent] },
        { merge: true }
      );
      console.log('recordEvent fallback success:', newEvent);
      return true;
    }
  };
  

  

  const convertWeektimesToProgressData = (weektimes: number[]) => {
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return weekDays.map((day, index) => {
      const weekTimeValue = weektimes?.[index] ?? -1;
      return {
        day,
        points : 0, //: calculatePointsFromWeektime(weekTimeValue),
        lastPutDown : 0, //: formatTimeFromMinutes(weekTimeValue),
      };
    });
  };

  const welcomeAnimation = useRef(new Animated.Value(0)).current;
  const statusBannerAnimation = useRef(new Animated.Value(0)).current;
  const progressAnimation = useRef(new Animated.Value(0)).current;
  const competitionsAnimation = useRef(new Animated.Value(0)).current;
  const statsAnimation = useRef(new Animated.Value(0)).current;
  const resetButtonAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      setAuthReady(true);
      console.log('Auth state:', user ? user.uid : 'SIGNED OUT');
    });
    return unsub;
  }, []);
  useEffect(() => {
    if (!uid) return;
    if (!competitions.length) return;

    syncAllJoinedCompetitionPoints(uid, lockedEvents, competitions).catch(console.error);
  }, [uid, lockedEvents, competitions.length]);

  const startAnimations = () => {
    welcomeAnimation.setValue(0);
    statusBannerAnimation.setValue(0);
    competitionsAnimation.setValue(0);
    progressAnimation.setValue(0);
    statsAnimation.setValue(0);
    resetButtonAnimation.setValue(0);

    setHasInitialized(true);

    const animationDuration = 400;
    const staggerDelay = 100;

    Animated.timing(welcomeAnimation, {
      toValue: 1,
      duration: animationDuration,
      useNativeDriver: true,
    }).start();

    setTimeout(() => {
      Animated.timing(statusBannerAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay);

    setTimeout(() => {
      Animated.timing(progressAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay * 2);

    setTimeout(() => {
      Animated.timing(competitionsAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay * 3);

    setTimeout(() => {
      Animated.timing(statsAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay * 4);

    setTimeout(() => {
      Animated.timing(resetButtonAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay * 5);
  };

  

  const calculateStats = (profileData: UserProfile) => {
    if (!profileData?.pastcomps) {
      return {
        totalWins: 0,
        averageBedtime: 'N/A',
        weeksPlayed: 0,
        bestRank: 'N/A',
      };
    }


    const pastComps = profileData.pastcomps;
    const totalWins = pastComps.filter((comp) => comp.won).length;
    const weeksPlayed = pastComps.length;
    const bestRank =
      pastComps.length > 0 ? Math.min(...pastComps.map((comp) => comp.rank)) : 'N/A';
    

    return {
      totalWins,
      averageBedtime: 'N/A', // Placeholder, as calculating average bedtime requires more complex logic
      weeksPlayed,
      bestRank: bestRank === 'N/A' ? 'N/A' : `#${bestRank}`,
    };
  };
  const theButtonPressedRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!uid) return;
    if (!pendingFalseEventRef.current) return;

    flushPendingFalseEvent().catch(console.error);
  }, [uid]);

  

  const lastInactiveAtRef = useRef<number | null>(null);
  const pendingFalseEventRef = useRef(false);
  const isWritingFalseEventRef = useRef(false);
  const pendingFalseTimestampRef = useRef<number | null>(null);
  const markPendingLockOut = async (timestamp?: number) => {
    if (!uid) return;

    const profileRef = doc(firestore, 'profiledb', uid);

    try {
      await setDoc(
        profileRef,
        {
          pendingLockOut: true,
          pendingLockOutTimestamp: timestamp ?? Date.now(),
        },
        { merge: true }
      );
      console.log('Marked pending lock-out');
    } catch (e) {
      console.error('Failed to mark pending lock-out', e);
    }
  };
  const flushPendingLockOutFromProfile = async (profileData?: any) => {
    if (!uid) return false;
    if (!profileData?.pendingLockOut) return false;
    if (isWritingFalseEventRef.current) return false;

    isWritingFalseEventRef.current = true;
    const profileRef = doc(firestore, 'profiledb', uid);

    try {
      const ts =
        typeof profileData?.pendingLockOutTimestamp === 'number'
          ? profileData.pendingLockOutTimestamp
          : Date.now();

      await updateDoc(profileRef, {
        lockedEvents: arrayUnion({
          timestamp: ts,
          lockedIn: false,
        }),
        pendingLockOut: false,
        pendingLockOutTimestamp: null,
      });

      console.log('Flushed pending lock-out from profile');
      return true;
    } catch (e) {
      console.error('Failed to flush pending lock-out from profile', e);
      return false;
    } finally {
      isWritingFalseEventRef.current = false;
    }
  };
  const flushPendingFalseEvent = async () => {
    if (!pendingFalseEventRef.current) return;
    if (isWritingFalseEventRef.current) return;
    if (!uid) {
      console.log('flushPendingFalseEvent: waiting for uid');
      return;
    }

    isWritingFalseEventRef.current = true;

    try {
      const wrote = await recordEvent(
        false,
        pendingFalseTimestampRef.current ?? undefined
      );

      if (wrote) {
        console.log('Flushed pending lockedIn:false event');
        pendingFalseEventRef.current = false;
        pendingFalseTimestampRef.current = null;
      } else {
        console.log('Pending false event not flushed yet; keeping pending flag');
      }
    } catch (e) {
      console.error('Failed to flush pending lockedIn:false event', e);
    } finally {
      isWritingFalseEventRef.current = false;
    }
  };
  useEffect(() => {
    console.log('AppState effect registered');

    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      const prevState = appStateRef.current;
      console.log('AppState:', prevState, '->', nextAppState);

      // mark when app first becomes inactive
      // if (nextAppState === 'inactive') {
      //   lastInactiveAtRef.current = Date.now();
      // }

      // decide whether this was likely app switch / home gesture
      // if (prevState === 'inactive' && nextAppState === 'background') {
      //   const inactiveAt = lastInactiveAtRef.current;
      //   const elapsed = inactiveAt ? Date.now() - inactiveAt : null;

      //   if (elapsed !== null) {
      //     if (elapsed < 200) {
      //       console.log('Probably lock screen');
      //       console.log(elapsed);
      //     } else {
      //       console.log('Probably home screen / app switch');
      //       console.log(elapsed);
      //     }
      //   }
      // }

      if (
        prevState === 'active' &&
        (nextAppState === 'inactive' || nextAppState === 'background')
      ) {
        const wasLockedIn = theButtonPressedRef.current;

        if (!wasLockedIn) {
          console.log('app left while already locked out; no notification');
          appStateRef.current = nextAppState;
          return;
        }

        console.log('app left while locked in');

        theButtonPressedRef.current = false;
        setTheButtonPressed(false);

        const leaveTs = Date.now();
        pendingFalseEventRef.current = true;
        pendingFalseTimestampRef.current = leaveTs;

        await markPendingLockOut(leaveTs);
        await scheduleHomeLockoutNotification();
      }

      // once app becomes active again, flush the pending false event
      if (
        (prevState === 'background' || prevState === 'inactive') &&
        nextAppState === 'active'
      ) {
        await cancelHomeLockoutNotification();
        await flushPendingFalseEvent();
      }

      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [uid]);

  // useEffect(() => {
  //   const unsub = onAuthStateChanged(auth, (user) => {
  //     setUid(user?.uid ?? null);
  //     setAuthReady(true);
      
  //     // Lock out on every app open (auth resolves on launch)
  //     if (user?.uid) {
  //       const lockOutEvent: SleepEvent = {
  //         timestamp: Date.now(),
  //         lockedIn: false,
  //       };
  //       const profileRef = doc(firestore, 'profiledb', user.uid);
  //       updateDoc(profileRef, { SleepEvents: arrayUnion(lockOutEvent) });
  //     }
  //   });
  //   return unsub;
  // }, []);

  const getCompetitionStatus = (start : number, end : number)
  : 'ongoing' | 'upcoming' | 'finished' => {
    const now = Date.now();
    
    if (now < start) return 'upcoming';
    if (now > end) return 'finished';
    return 'ongoing';
  };

  const processCompetitionsData = (snapshot: any) => {
    const competitionsData: Competition[] = [];

    snapshot.forEach((docSnap: any) => {
      const cur = docSnap.data();

      if (!cur?.start || !cur?.end) return;
      if (!cur?.players || typeof cur.players !== 'object') return;

      const playerUids = Object.keys(cur.players);
      const playerCount = playerUids.length;

      const myUid = uid;
      const myPlayerEntry = myUid ? cur.players?.[myUid] : null;

      const userJoined = !!myPlayerEntry;

      const competition: Competition = {
        id: docSnap.id,
        start: cur.start,
        end: cur.end,
        
        status: getCompetitionStatus(cur.start, cur.end),
        players: cur.players,
        name: cur.name ?? "Untitled Game",
        reward: cur.reward,
        userJoined,
      };

      competitionsData.push(competition);
    });

    competitionsData.sort((a, b) => {
      const statusOrder: Record<string, number> = {
        ongoing: 0,
        upcoming: 1,
        finished: 2,
      };
      if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status];
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

    return competitionsData;
  };

  const toYYYYMMDD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const getThisWeeksDates = () => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    start.setDate(today.getDate() - today.getDay());

    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(toYYYYMMDD(d));
    }
    return dates;
  };

  // const buildWeektimesFromSleepTimes = (sleepTimes?: Record<string, number>) => {
  //   const dates = getThisWeeksDates();
  //   return dates.map((dateStr) => {
  //     const v = sleepTimes?.[dateStr];
  //     return typeof v === 'number' ? v : -1;
  //   });
  // };
  
  useEffect(() => {
    if (!uid) return;

    setProfileLoading(true);
    const userDocRef = doc(firestore, 'profiledb', uid);

    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const profileData = docSnapshot.data() as any;
          setUserProfile(profileData);
          if (profileData?.pendingLockOut) {
            flushPendingLockOutFromProfile(profileData).catch(console.error);
          }
          const events = (profileData?.lockedEvents ?? []) as LockedEvent[];
          setLockedEvents(events);

          // const total = getAllTimeLockedMinutes(events);
          // const week = getThisWeekLockedMinutes(events);

          // setAllTimeLockedMinutes(total);
          // setThisWeekLockedMinutes(week);

          // if (
          //   profileData.totalLockedMinutes !== total ||
          //   profileData.thisWeekLockedMinutes !== week
          // ) {
          //   updateDoc(userDocRef, {
          //     totalLockedMinutes: total,
          //     thisWeekLockedMinutes: week,
          //   }).catch(() => {});
          // }

          setStats(calculateStats(profileData));
        } else {
          console.log('User profile not found for uid:', uid);
          setUserProfile(null);
          setLockedEvents([]);
          setAllTimeLockedMinutes(0);
          setThisWeekLockedMinutes(0);
        }

        setProfileLoading(false);
      },
      (error) => {
        console.error('Error fetching user profile:', error);
        setProfileLoading(false);
        Alert.alert(
          'Profile access error',
          'Permission denied reading your profile. Check Firestore Rules.'
        );
      }
    );

    return unsubscribe;
  }, [uid]);

  useEffect(() => {
    if (!uid) return;

    setCompetitionsLoading(true);
    const competitionsCollection = collection(firestore, 'competitiondb');

    const unsubscribe = onSnapshot(
      competitionsCollection,
      (snapshot) => {
        const competitionsData = processCompetitionsData(snapshot);
        setCompetitions(competitionsData);
        setCompetitionsLoading(false);
      },
      (error) => {
        console.error('Error fetching competitions:', error);
        setCompetitionsLoading(false);
        Alert.alert(
          'Competitions access error',
          'Permission denied reading competitions. Check Firestore Rules.'
        );
      }
    );

    return unsubscribe;
  }, [uid]);

  useEffect(() => {
    if (!profileLoading && !competitionsLoading && uid) {
      setTimeout(() => startAnimations(), 100);
    }
  }, [profileLoading, competitionsLoading, uid]);

  useFocusEffect(
    React.useCallback(() => {
      if (!profileLoading && !competitionsLoading && uid) {
        setHasInitialized(false);
        setTimeout(() => startAnimations(), 50);
      }
    }, [profileLoading, competitionsLoading, uid])
  );

  const handleJoinCompetition = async (competitionId: string) => {
    if (!userData?.uid || !userProfile) {
      Alert.alert('Error', 'Unable to join competition. Please try again.');
      return;
    }

    const competition = competitions.find((comp) => comp.id === competitionId);
    if (!competition) {
      Alert.alert('Error', 'Competition not found.');
      return;
    }
    

    if (competition.userJoined) {
      Alert.alert('Already Joined', 'You are already in this competition!');
      return;
    }

    if (competition.status === 'finished') {
      Alert.alert('Competition Ended', 'This competition has already finished.');
      return;
    }

    setIsJoining(competitionId);

    try {
      const competitionDocRef = doc(firestore, 'competitiondb', competitionId);
      const snap = await getDoc(competitionDocRef);

      if (!snap.exists()) {
        Alert.alert('Error', 'Competition doc not found.');
        return;
      }

      const compData = snap.data() as any;
      const currentUid = userData.uid;

      const initialPoints = getLockedMinutesInRange(
        lockedEvents,
        compData.start,
        compData.end
      );

      await setDoc(
        competitionDocRef,
        {
          players: {
            [currentUid]: {
              joinedAt: serverTimestamp(),
              points: initialPoints,
            },
          },
        },
        { merge: true }
      );

      const profileRef = doc(firestore, 'profiledb', currentUid);
      try {
        await updateDoc(profileRef, {
          competitions: arrayUnion(competitionId),
        });
      } catch {
        await setDoc(
          profileRef,
          { competitions: [competitionId] },
          { merge: true }
        );
      }

      Alert.alert('Competition Joined!', "You've successfully joined this competition.", [
        { text: 'OK' },
      ]);
    } catch (error) {
      console.error('Error joining competition:', error);
      Alert.alert('Error', 'Failed to join competition. Please try again.');
    } finally {
      setIsJoining(null);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatDateRange = (startDate: number, endDate: number) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    const startFormatted = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const endFormatted = end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    return `${startFormatted} - ${endFormatted}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ongoing':
        return '#10B981';
      case 'upcoming':
        return '#F59E0B';
      case 'finished':
        return '#6B7280';
      default:
        return '#6B7280';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ongoing':
        return 'play-circle';
      case 'upcoming':
        return 'time';
      case 'finished':
        return 'checkmark-circle';
      default:
        return 'time';
    }
  };

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

  if (!authReady) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="moon" size={48} color={strongColor} />
          <Text style={styles.loadingText}>Checking login...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!uid) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="log-in-outline" size={48} color={strongColor} />
          <Text style={styles.loadingText}>You’re signed out. Please sign in again.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (profileLoading || competitionsLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="wifi" size={48} color={strongColor} />
          <Text style={styles.loadingText}>
            {profileLoading ? 'Loading your profile...' : 'Loading competitions...'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const userStats = [
    {
      id: 1,
      title: 'Total Wins',
      value: stats.totalWins.toString(),
      icon: 'trophy',
      color: strongColor,
      backgroundColor: 'rgba(157, 78, 221, 0.15)',
    },
    {
      id: 2,
      title: 'Average Bedtime',
      value: stats.averageBedtime,
      icon: 'moon',
      color: strongColor,
      backgroundColor: 'rgba(157, 78, 221, 0.15)',
    },
    {
      id: 3,
      title: 'Weeks Played',
      value: stats.weeksPlayed.toString(),
      icon: 'calendar',
      color: strongColor,
      backgroundColor: 'rgba(157, 78, 221, 0.15)',
    },
    {
      id: 4,
      title: 'Best Rank',
      value: stats.bestRank,
      icon: 'medal-outline',
      color: strongColor,
      backgroundColor: 'rgba(157, 78, 221, 0.15)',
    },
  ];

  const finishedCompetitions = competitions.filter(
    (c) => c.status === 'finished' && c.userJoined === true
  );
  const activeCompetitions = competitions.filter(
    (c) => c.status !== 'finished' && c.userJoined === true
  );

  const currentLockStartMs =
    theButtonPressed && lockedEvents.length > 0
      ? [...lockedEvents]
          .reverse()
          .find((e) => e.lockedIn)?.timestamp ?? null
      : null;

  const lockedInSeconds = currentLockStartMs
    ? Math.max(0, Math.floor((nowMs - currentLockStartMs) / 1000))
    : 0;
  

  return (
    <SafeAreaView style={{ ...styles.container, backgroundColor: bgColor,}}>
      {theButtonPressed && <KeepAwakeOn />}
      <Tabs.Screen
        options={{
          tabBarStyle: theButtonPressed
            ? {
                ...defaultTabBarStyle,
                position: 'absolute',
                transform: [{ translateY: 120 }],
                opacity: 0,
              }
            : {
                ...defaultTabBarStyle,
                position: 'absolute',
                transform: [{ translateY: 0 }],
                opacity: 1,
              },
        }}
      />
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={true}
        onLayout={(e) => setLayoutHeight(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentHeight(h)}
        onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        <View style={styles.content}>
          {hasInitialized && (
            <>
              <View style={styles.competitionsContainer}>


                <View
                  onLayout={(e) => {
                  const { height } = e.nativeEvent.layout;
                  if(!theButtonPressed) setStatsHeight(height);
                }}>
                  {!theButtonPressed ? (
                  <>
                    <Animated.View style={getAnimatedStyle(welcomeAnimation)}>
                      <Text style={[styles.warmFont, styles.welcomeText]}>
                        Welcome, <Text style={styles.username}>{userProfile?.name ?? userData?.name ?? 'User'}</Text>
                      </Text>
                    </Animated.View>
                  
                  
                    
                    {competitions.some((comp) => comp.userJoined && comp.status === 'ongoing') && (
                      <Animated.View
                        style={[getAnimatedStyle(statusBannerAnimation), styles.statusBanner]}
                      >
                        <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                        <Text style={styles.statusText}>You're currently in a competition!</Text>
                      </Animated.View>
                    )}

                    <Animated.View style={getAnimatedStyle(progressAnimation)}>
                      
                      <View style = {[styles.row, styles.competitionContainer]}>
                        {/* <Text style={styles.minutesText}>Lifetime locked in minutes: {formatMinutes(allTimeLockedMinutes)}</Text>
                        <Text style={styles.minutesText}>This week locked in minutes: {formatMinutes(thisWeekLockedMinutes)}</Text>  */}
                        <View style={styles.competitionStatBox}>
                          
                          <Text style={styles.dataNumber}>
                            {formatMinutes(allTimeLockedMinutes)}
                          </Text>
                          <Text style={styles.competitionStatLabel}>life time locked in</Text>
                        </View>     
                        <View style={styles.competitionStatBox}>
                          
                          <Text style={styles.dataNumber}>
                            {formatMinutes(thisWeekLockedMinutes)}
                          </Text>
                          <Text style={styles.competitionStatLabel}>weekly time locked in</Text>
                        </View>   
                      </View>
                    </Animated.View>
                    </>
                  ) : (
                    <View style={{height: statsHeight, ...styles.lockedInContainer}}>
                      <View style={styles.lockedInInner}>
                        <Text style={styles.lockClockText}>
                          {formatClockTime(new Date(nowMs))}
                        </Text>

                        <Text style={styles.lockedInLabel}>
                          Locked in for
                        </Text>

                        <Text style={styles.lockedInTimerText}>
                          {formatDurationWithSeconds(lockedInSeconds)}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

        {/* This is the button that toggles giving points and whanot*/}
                <Animated.View style={getAnimatedStyle(progressAnimation)}>
                  <TouchableOpacity
                    style={[styles.theButton, theButtonPressed&&{backgroundColor: buttonPressedColor}]}
                    onPress={async () => {
                      const next = !theButtonPressedRef.current;
                      const now = Date.now();

                      theButtonPressedRef.current = next;
                      setTheButtonPressed(next);
                      await recordEvent(next, now);

                      // if (next) {
                      //   await startLockInLiveActivity(now);
                      // } else {
                      //   await stopLockInLiveActivity();
                      // }
                    }}
                  >
                    <Ionicons
                      name={theButtonPressed ? 'lock-closed' : 'lock-open-outline'}
                      size={40}
                      color="#FFFFFF"
                      style={styles.buttonIcon}
                    />
                    <Text style={styles.theButtonText}>
                      {theButtonPressed
                        ? 'Lock Out'
                        : 'Lock In'}
                    </Text>
                  </TouchableOpacity>
                  
                </Animated.View>

                {!theButtonPressed && (
                <>
                  <Animated.View style={getAnimatedStyle(competitionsAnimation)}>
                    {competitions.length === 0 ? (
                      <View style={styles.noCompetitionsContainer}>
                        <Ionicons name="trophy-outline" size={48} color="#666" />
                        <Text style={styles.noCompetitionsText}>No competitions available</Text>
                        <Text style={styles.noCompetitionsSubtext}>
                          Check back soon for new competitions!
                        </Text>
                      </View>
                    ) : (
                      <View>
                        {activeCompetitions.map((competition) => (
                          <View key={competition.id} style={styles.competitionContainer}>
                            <View style={styles.competitionHeader}>
                              <Text style={styles.competitionTitle}>
                                {competition.name}{' '}
                                <Text style={styles.compId}>({competition.id})</Text>
                              </Text>

                              <View
                                style={[
                                  styles.statusTag,
                                  {
                                    backgroundColor: `${getStatusColor(competition.status)}20`,
                                  },
                                ]}
                              >
                                <Ionicons
                                  name={getStatusIcon(competition.status) as any}
                                  size={20}
                                  color={getStatusColor(competition.status)}
                                />
                                <Text
                                  style={[
                                    styles.statusTagText,
                                    { color: getStatusColor(competition.status) },
                                  ]}
                                >
                                  {competition.status.toUpperCase()}
                                </Text>
                              </View>
                            </View>

                            <Text style={styles.dateRange}>
                              {formatDateRange(competition.start, competition.end)}
                            </Text>

                            <View style={styles.competitionStatsContainer}>
                              <View style={styles.competitionStatBox}>
                                <View style={styles.competitionIconContainer}>
                                  <Ionicons name="people" size={24} color={strongColor} />
                                </View>
                                <Text style={styles.competitionStatNumber}>
                                  {Object.keys(competition.players || {}).length}
                                </Text>
                                <Text style={styles.competitionStatLabel}>Users</Text>
                              </View>

                              <View style={styles.competitionStatBox}>
                                <View style={styles.competitionIconContainer}>
                                  <Ionicons name="cash" size={24} color={strongColor} />
                                </View>

                                
                                <Text style={styles.competitionStatNumber}>
                                  {competition.reward}
                                </Text>
                                

                                <Text style={styles.competitionStatLabel}>Prize Pool</Text>
                              </View>
                            </View>

                            <TouchableOpacity
                              style={[
                                styles.joinButton,
                                competition.status === 'finished' && styles.joinButtonDisabled,
                                isJoining === competition.id && styles.joinButtonDisabled,
                              ]}
                              onPress={() =>
                                competition.userJoined
                                  ? goToCompetition(competition.id)
                                  : handleJoinCompetition(competition.id)
                              }
                              disabled={isJoining === competition.id}
                            >
                              {isJoining === competition.id ? (
                                <>
                                  <Ionicons
                                    name="hourglass"
                                    size={20}
                                    color="#FFFFFF"
                                    style={styles.buttonIcon}
                                  />
                                  <Text style={styles.joinButtonText}>Joining...</Text>
                                </>
                              ) : competition.userJoined && competition.status !== 'finished' ? (
                                <>
                                  <Ionicons
                                    name="arrow-forward"
                                    size={20}
                                    color="#FFFFFF"
                                    style={styles.buttonIcon}
                                  />
                                  <Text style={styles.joinButtonText}>
                                    Joined - View Competition
                                  </Text>
                                </>
                              ) : competition.userJoined ? (
                                <>
                                  <Ionicons
                                    name="information-circle-outline"
                                    size={20}
                                    color="#FFFFFF"
                                    style={styles.buttonIcon}
                                  />
                                  <Text style={styles.joinButtonText}>Ended - View Competition</Text>
                                </>
                              ) : competition.status === 'finished' ? (
                                <>
                                  <Ionicons
                                    name="close-circle"
                                    size={20}
                                    color="#FFFFFF"
                                    style={styles.buttonIcon}
                                  />
                                  <Text style={styles.joinButtonText}>Competition Ended</Text>
                                </>
                              ) : (
                                <>
                                  <Ionicons
                                    name="add-circle"
                                    size={20}
                                    color="#FFFFFF"
                                    style={styles.buttonIcon}
                                  />
                                  <Text style={styles.joinButtonText}>Join Competition</Text>
                                </>
                              )}
                            </TouchableOpacity>
                          </View>
                        ))}

                        <TouchableOpacity
                          style={styles.collapseButton}
                          onPress={() => setCollapseFinished((prev) => !prev)}
                        >
                          <Ionicons
                            name={collapseFinished ? 'chevron-down' : 'chevron-up'}
                            size={20}
                            color="#FFFFFF"
                            style={styles.buttonIcon}
                          />
                          <Text style={styles.collapseButtonText}>
                            {collapseFinished
                              ? 'Show Finished Competitions'
                              : 'Hide Finished Competitions'}
                          </Text>
                        </TouchableOpacity>
                        
                        {!collapseFinished &&
                          finishedCompetitions.map((competition) => (
                            <View key={competition.id} style={styles.competitionContainer}>
                              <View style={styles.competitionHeader}>
                                <Text style={styles.competitionTitle}>{competition.name}</Text>
                                <View
                                  style={[
                                    styles.statusTag,
                                    {
                                      backgroundColor: `${getStatusColor(competition.status)}20`,
                                    },
                                  ]}
                                >
                                  <Ionicons
                                    name={getStatusIcon(competition.status) as any}
                                    size={20}
                                    color={getStatusColor(competition.status)}
                                  />
                                  <Text
                                    style={[
                                      styles.statusTagText,
                                      { color: getStatusColor(competition.status) },
                                    ]}
                                  >
                                    {competition.status.toUpperCase()}
                                  </Text>
                                </View>
                              </View>

                              <Text style={styles.dateRange}>
                                {formatDateRange(competition.start, competition.end)}
                              </Text>

                              <View style={styles.competitionStatsContainer}>
                                <View style={styles.competitionStatBox}>
                                  <View style={styles.competitionIconContainer}>
                                    <Ionicons name="people" size={24} color={strongColor} />
                                  </View>
                                  <Text style={styles.competitionStatNumber}>
                                    {Object.keys(competition.players || {}).length}
                                  </Text>
                                  <Text style={styles.competitionStatLabel}>Users</Text>
                                </View>

                                <View style={styles.competitionStatBox}>
                                  <View style={styles.competitionIconContainer}>
                                    <Ionicons name="cash" size={24} color={strongColor} />
                                  </View>

                                  
                                  
                                  <Text style={styles.competitionStatNumber}>
                                    {competition.reward}
                                  </Text>
                                  

                                  <Text style={styles.competitionStatLabel}>Prize Pool</Text>
                                </View>
                              </View>

                              <TouchableOpacity
                                style={[
                                  styles.joinButton,
                                  competition.status === 'finished' && styles.joinButtonDisabled,
                                  isJoining === competition.id && styles.joinButtonDisabled,
                                ]}
                                onPress={() =>
                                  competition.userJoined
                                    ? goToCompetition(competition.id)
                                    : handleJoinCompetition(competition.id)
                                }
                                disabled={isJoining === competition.id}
                              >
                                {isJoining === competition.id ? (
                                  <>
                                    <Ionicons
                                      name="hourglass"
                                      size={20}
                                      color="#FFFFFF"
                                      style={styles.buttonIcon}
                                    />
                                    <Text style={styles.joinButtonText}>Joining...</Text>
                                  </>
                                ) : competition.userJoined &&
                                  competition.status !== 'finished' ? (
                                  <>
                                    <Ionicons
                                      name="arrow-forward"
                                      size={20}
                                      color="#FFFFFF"
                                      style={styles.buttonIcon}
                                    />
                                    <Text style={styles.joinButtonText}>
                                      Joined - View Competition
                                    </Text>
                                  </>
                                ) : competition.userJoined ? (
                                  <>
                                    <Ionicons
                                      name="information-circle-outline"
                                      size={20}
                                      color="#FFFFFF"
                                      style={styles.buttonIcon}
                                    />
                                    <Text style={styles.joinButtonText}>
                                      Ended - View Competition
                                    </Text>
                                  </>
                                ) : competition.status === 'finished' ? (
                                  <>
                                    <Ionicons
                                      name="close-circle"
                                      size={20}
                                      color="#FFFFFF"
                                      style={styles.buttonIcon}
                                    />
                                    <Text style={styles.joinButtonText}>Competition Ended</Text>
                                  </>
                                ) : (
                                  <>
                                    <Ionicons
                                      name="add-circle"
                                      size={20}
                                      color="#FFFFFF"
                                      style={styles.buttonIcon}
                                    />
                                    <Text style={styles.joinButtonText}>Join Competition</Text>
                                  </>
                                )}
                              </TouchableOpacity>
                            </View>
                          ))}
                      </View>
                    )}
                  </Animated.View>
                </>
                )}
              </View>

              {/*<Animated.View style={[getAnimatedStyle(statsAnimation), styles.userStatsContainer]}>
                <Text style={styles.userStatsTitle}>Your Stats</Text>

                <View style={styles.statsGrid}>
                  {userStats.map((stat) => (
                    <View key={stat.id} style={styles.statCard}>
                      <View style={styles.statIconContainer}>
                        <Ionicons name={stat.icon as any} size={24} color={stat.color} />
                      </View>
                      <Text style={styles.statValue}>{stat.value}</Text>
                      <Text style={styles.statTitle}>{stat.title}</Text>
                    </View>
                  ))}
                </View>
              </Animated.View>*/}
            </>
          )}
        </View>
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
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 190,
          }}
        />
      )}
    </SafeAreaView>
  );
}

const resetStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 10,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF4444',
    gap: 8,
  },
  resetText: {
    fontFamily: defFontType,
    color: '#FF4444',
    fontSize: 16,
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  weeklyScrollView: {
    marginHorizontal: -4,
  },
  weeklyProgressRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  minutesText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  dayCard: {
    backgroundColor: lbgColor,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    minWidth: 80,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  todayCard: {
    borderColor: strongColor,
    backgroundColor: l2bgColor,
  },
  incompleteTodayCard: {
    borderColor: strongColor,
    backgroundColor: l2bgColor,
  },
  dayLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: strongColor,
    marginBottom: 8,
    fontFamily: defFontType,
  },
  incompleteDayLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B0B0B0',
    marginBottom: 8,
    fontFamily: defFontType,
  },
  todayText: {
    color: strongColor,
    fontFamily: defFontType,
  },
  pointsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  dayPoints: {
    fontSize: 18,
    fontWeight: '700',
    color: strongColor,
    marginLeft: 4,
    fontFamily: defFontType,
  },
  incompleteDayPoints: {
    color: '#666',
    fontFamily: defFontType,
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lastPutDownTime: {
    fontSize: 12,
    color: strongColor,
    marginLeft: 4,
    fontWeight: '500',
    fontFamily: defFontType,
  },
  incompleteTime: {
    color: '#666',
    fontFamily: defFontType,
  },
  scrollArrowButton: {
    position: 'absolute',
    top: '50%',
    backgroundColor: dbgColor,
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    marginTop: -5,
  },
  leftArrow: {
    left: 16,
  },
  rightArrow: {
    right: 16,
  },
  weeklyProgressWrapper: {
    backgroundColor: dbgColor,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    position: 'relative',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 16,
    fontFamily: defFontType,
  },
  weeklyProgressContainer: {
    marginBottom: 30,
  },
  warmFont: {
    fontFamily: warmFontType,
  },
  container: {
    flex: 1,
    backgroundColor: bgColor,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 16,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 100,
  },
  welcomeText: {
    fontSize: 42,
    fontWeight: '300',
    color: '#FFFFFF',
    marginBottom: 40,
    textAlign: 'center',
  },
  username: {
    fontWeight: '600',
    color: strongColor,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    fontFamily: defFontType,
  },
  statusText: {
    fontFamily: defFontType,
    color: '#10B981',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  competitionsContainer: {
    marginBottom: 30,
  },
  lockedInContainer: {
    
    marginBottom: 0,
  },
  competitionsTitle: {
    fontFamily: defFontType,
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 3,
    color: '#FFFFFF',
    marginBottom: 16,
    textAlign: 'center',
  },
  noCompetitionsContainer: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
  },
  noCompetitionsText: {
    fontFamily: defFontType,
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  noCompetitionsSubtext: {
    fontFamily: defFontType,
    fontSize: 14,
    color: '#B0B0B0',
    textAlign: 'center',
  },
  competitionContainer: {
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  competitionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  competitionTitle: {
    fontFamily: defFontType,
    letterSpacing: 0,
    fontSize: 18,
    color: '#FFFFFF',
    flex: 1,
  },
  statusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusTagText: {
    fontFamily: defFontType,
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  compId: {
    fontSize: 14,
    color: '#B0B0B0',
    fontFamily: defFontType,
  },
  dateRange: {
    fontSize: 14,
    color: '#B0B0B0',
    fontFamily: defFontType,
    marginBottom: 20,
  },
  competitionStatsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  competitionStatBox: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 8,
  },
  competitionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  competitionStatNumber: {
    fontFamily: defFontType,
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  dataNumber: {
    fontFamily: defFontType,
    fontSize: 30,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  competitionStatLabel: {
    fontFamily: defFontType,
    fontSize: 12,
    color: '#B0B0B0',
    textAlign: 'center',
  },
  joinButton: {
    backgroundColor: l2bgColor,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: strongColor,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: strongColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  joinButtonDisabled: {
    backgroundColor: l2bgColor,
    borderWidth: 0,
    shadowOpacity: 0,
  },
  collapseButton: {
    alignSelf: 'flex-start',
    backgroundColor: l2bgColor,
    borderRadius: 12,
    padding: 8,
    flexDirection: 'row',
    elevation: 5,
    marginBottom: 16,
  },
  theButton: {
    backgroundColor: strongColor,
    borderRadius: 24,
    padding: 12,
    flexDirection: 'row',
    elevation: 5,
    marginBottom: 16,

    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonIcon: {
    marginRight: 8,
  },
  joinButtonText: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  collapseButtonText: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  theButtonText: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
  },
  userStatsContainer: {
    marginBottom: 30,
  },
  userStatsTitle: {
    fontFamily: defFontType,
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 20,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statCard: {
    width: '48%',
    backgroundColor: l3bgColor,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  statValue: {
    fontFamily: defFontType,
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  statTitle: {
    fontFamily: defFontType,
    fontSize: 12,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 16,
  },
  resetContainer: {
    marginTop: 20,
    marginBottom: 40,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  lockedInInner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  lockClockText: {
    fontFamily: defFontType,
    fontSize: 52,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 16,
    textAlign: 'center',
  },

  lockedInLabel: {
    fontFamily: defFontType,
    fontSize: 18,
    color: '#B0B0B0',
    marginBottom: 8,
    textAlign: 'center',
  },

  lockedInTimerText: {
    fontFamily: defFontType,
    fontSize: 36,
    fontWeight: '700',
    color: strongColor,
    textAlign: 'center',
  },
  
});