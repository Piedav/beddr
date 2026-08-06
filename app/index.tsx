import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { onAuthStateChanged } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SlimeCompanion } from '../components/SlimeCompanion';
import { auth, firestore } from '../firebase';
import { useLockControl, useUser } from './_layout';

const dbgColor = '#0a0513ff';
const bgColor = '#111124ff';
const lbgColor = '#111124ff';
const l2bgColor = '#111124ff';
const l3bgColor = '#111124ff';
// const lbgColor = '#322f4e81';
// const l2bgColor = '#322f4eff';
// const l3bgColor = '#323150';
const strongColor = '#cc7bdbff';
const buttonPressedColor = 'rgb(100, 65, 106)';

const warmFontType = 'Molengo';
const defFontType = 'OpenSansSemiBold';

type BeddrScreenTimeLockModule = {
  applyBlockedAppRestrictions: () => Promise<{
    applied?: boolean;
    selectedApps?: number;
    selectedCategories?: number;
    selectedWebDomains?: number;
  }>;
  clearBlockedAppRestrictions: () => Promise<{ cleared?: boolean }>;
};

const BeddrScreenTime = NativeModules.BeddrScreenTime as
  | BeddrScreenTimeLockModule
  | undefined;

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
  const { registerLockToggle, setIsLockedIn } = useLockControl();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  const showBottomFade = contentHeight > layoutHeight && scrollY + layoutHeight < contentHeight - 8;
  const [allTimeLockedMinutes, setAllTimeLockedMinutes] = useState(0);
  const [thisWeekLockedMinutes, setThisWeekLockedMinutes] = useState(0);
  const [lockedEvents, setLockedEvents] = useState<LockedEvent[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [unlockedHeaderHeight, setUnlockedHeaderHeight] = useState(0);


  
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

  const [theButtonPressed, setTheButtonPressed] = useState(false);

  useEffect(() => {
    if (!theButtonPressed) return;

    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [theButtonPressed]);

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

  

  const recordEvent = React.useCallback(async (lockedIn: boolean, timestamp?: number): Promise<boolean> => {
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
  }, [uid]);
  

  

  

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

  const currentMinuteBucket = Math.floor(nowMs / 60000);

  useEffect(() => {
    if (!uid) return;
    if (!competitions.length) return;

    syncAllJoinedCompetitionPoints(uid, lockedEvents, competitions).catch(console.error);
  }, [uid, lockedEvents, competitions.length, currentMinuteBucket]);

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

  const isWritingFalseEventRef = useRef(false);
  const clearLegacyPendingLockOut = async (profileData?: any) => {
    if (!uid) return false;
    if (!profileData?.pendingLockOut) return false;
    if (isWritingFalseEventRef.current) return false;

    isWritingFalseEventRef.current = true;
    const profileRef = doc(firestore, 'profiledb', uid);

    try {
      await updateDoc(profileRef, {
        pendingLockOut: false,
        pendingLockOutTimestamp: null,
      });

      console.log('Cleared legacy pending lock-out without ending session');
      return true;
    } catch (e) {
      console.error('Failed to clear legacy pending lock-out', e);
      return false;
    } finally {
      isWritingFalseEventRef.current = false;
    }
  };

  useEffect(() => {
    console.log('AppState effect registered');

    const handleAppStateChange = async (nextAppState: AppStateStatus) => {
      const prevState = appStateRef.current;
      console.log('AppState:', prevState, '->', nextAppState);

      if (
        (prevState === 'background' || prevState === 'inactive') &&
        nextAppState === 'active'
      ) {
        setNowMs(Date.now());
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
            clearLegacyPendingLockOut(profileData).catch(console.error);
          }
          const events = (profileData?.lockedEvents ?? []) as LockedEvent[];
          setLockedEvents(events);
          const latestEvent = normalizeLockedEvents(events).at(-1);
          const isCurrentlyLocked = latestEvent?.lockedIn === true;
          theButtonPressedRef.current = isCurrentlyLocked;
          setTheButtonPressed(isCurrentlyLocked);
          setIsLockedIn(isCurrentlyLocked);

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

  const applyLockInRestrictions = React.useCallback(async () => {
    if (Platform.OS !== 'ios' || !BeddrScreenTime) return true;

    try {
      const result = await BeddrScreenTime.applyBlockedAppRestrictions();
      const selectedCount =
        (result.selectedApps ?? 0) +
        (result.selectedCategories ?? 0) +
        (result.selectedWebDomains ?? 0);

      if (!result.applied || selectedCount === 0) {
        Alert.alert(
          'Choose apps first',
          'Pick at least one app, category, or website in Profile before locking in.'
        );
        return false;
      }

      return true;
    } catch (error: any) {
      console.error('Failed to apply Screen Time restrictions:', error);
      Alert.alert(
        'Could not block apps',
        error?.message ||
          'Beddr could not apply Screen Time restrictions, so lock-in did not start.'
      );
      return false;
    }
  }, []);

  const clearLockInRestrictions = React.useCallback(async () => {
    if (Platform.OS !== 'ios' || !BeddrScreenTime) return;

    try {
      await BeddrScreenTime.clearBlockedAppRestrictions();
    } catch (error) {
      console.error('Failed to clear Screen Time restrictions:', error);
    }
  }, []);

  const toggleLockIn = React.useCallback(async () => {
    const next = !theButtonPressedRef.current;
    const now = Date.now();
    const optimisticEvent: LockedEvent = {
      timestamp: now,
      lockedIn: next,
    };

    if (next) {
      const restrictionsApplied = await applyLockInRestrictions();
      if (!restrictionsApplied) return;
    }

    theButtonPressedRef.current = next;
    setNowMs(now);
    setLockedEvents((prev) => [...normalizeLockedEvents(prev), optimisticEvent]);
    setTheButtonPressed(next);
    setIsLockedIn(next);

    if (!next) {
      clearLockInRestrictions().catch(console.error);
    }

    await recordEvent(next, now);

    // if (next) {
    //   await startLockInLiveActivity(now);
    // } else {
    //   await stopLockInLiveActivity();
    // }
  }, [applyLockInRestrictions, clearLockInRestrictions, recordEvent, setIsLockedIn]);

  useEffect(() => {
    setIsLockedIn(theButtonPressed);
  }, [setIsLockedIn, theButtonPressed]);

  useEffect(() => {
    registerLockToggle(toggleLockIn);
    return () => registerLockToggle(null);
  }, [registerLockToggle, toggleLockIn]);

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

  const sortedLockedEvents = normalizeLockedEvents(lockedEvents);
  const currentLockStartMs =
    theButtonPressed && sortedLockedEvents.length > 0
      ? sortedLockedEvents.at(-1)?.lockedIn
        ? sortedLockedEvents.at(-1)?.timestamp ?? null
        : null
      : null;
  const lockedInSeconds = currentLockStartMs
    ? Math.max(0, Math.floor((nowMs - currentLockStartMs) / 1000))
    : 0;

  return (
    <SafeAreaView style={{ ...styles.container, backgroundColor: bgColor,}}>
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


                <View>
                  {!theButtonPressed ? (
                  <View
                    onLayout={(event) =>
                      setUnlockedHeaderHeight(event.nativeEvent.layout.height)
                    }
                  >
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
                        <Text style={styles.statusText}>You&apos;re currently in a competition!</Text>
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
                  </View>
                  ) : (
                    <View
                      style={[
                        styles.lockedInContainer,
                        unlockedHeaderHeight > 0 && { height: unlockedHeaderHeight },
                      ]}
                    >
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
                  <SlimeCompanion style={styles.companion} />
                </View>

        {/* This is the button that toggles giving points and whanot*/}
                {/*
                <Animated.View style={getAnimatedStyle(progressAnimation)}>
                  <TouchableOpacity
                    style={[styles.theButton, theButtonPressed&&{backgroundColor: buttonPressedColor}]}
                    onPress={toggleLockIn}
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
                */}
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
    marginBottom: 8,
    textAlign: 'center',
  },
  companion: {
    marginBottom: 12,
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
    paddingVertical: 24,
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
