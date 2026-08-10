import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { onAuthStateChanged } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlobCompanion } from '../components/BlobCompanion';
import { FriendSearchModal } from '../components/FriendSearchModal';
import { auth, firestore } from '../firebase';
import {
  acceptFriendRequest,
  declineFriendRequest,
  ensureFriendCode,
  sendFriendRequest,
  setFriendStarred,
  unfriend,
} from '../lib/friends';
import { inviteFriendToLockIn, leaveLockSession, type LockSession } from '../lib/lockSessions';
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

const PRESENCE_HEARTBEAT_MS = 45000;
const ONLINE_THRESHOLD_MS = 120000;

const GROUP_BLOB_MAX_SIZE = 140;
const GROUP_BLOB_MIN_SIZE = 56;
const GROUP_GRID_GAP = 12;

// Arranges N companions into as square a grid as possible (columns first,
// wrapping via flexWrap), and shrinks each blob to fit the measured width —
// so 2 stay a line, 3 naturally wraps into a 2-over-1 triangle, and larger
// groups settle into a roughly square formation instead of just scrolling
// off-screen at a fixed size.
function computeGroupGridLayout(memberCount: number, containerWidth: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(memberCount)));

  // Anchored so 2 people render at the max size (matching how it's always
  // looked), then shrinks from there as more join. Sqrt scaling keeps each
  // blob's on-screen AREA roughly proportional to 1/memberCount, so the
  // group as a whole uses about the same total screen space rather than
  // just cramming more full-size blobs in — this is what actually
  // differentiates e.g. 2 vs 3, which both use 2 columns and would
  // otherwise come out identically sized if only fit-to-width mattered.
  const countBasedSize = GROUP_BLOB_MAX_SIZE * Math.sqrt(2 / Math.max(1, memberCount));

  if (containerWidth <= 0) {
    return {
      columns,
      size: Math.max(GROUP_BLOB_MIN_SIZE, Math.min(GROUP_BLOB_MAX_SIZE, Math.floor(countBasedSize))),
    };
  }

  const widthFitSize = (containerWidth - (columns - 1) * GROUP_GRID_GAP) / columns;
  const size = Math.max(
    GROUP_BLOB_MIN_SIZE,
    Math.min(GROUP_BLOB_MAX_SIZE, Math.floor(Math.min(countBasedSize, widthFitSize)))
  );

  return { columns, size };
}

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
  companionHue?: number;
  lockedEvents: [];
  pastcomps: Array<{
    date: string;
    money: number;
    points: number;
    rank: number;
    won: boolean;
  }>;
  competitions: {};
  friendCode?: string;
  lastActiveAt?: number;
  activeLockSessionId?: string | null;
  nameLower?: string;
  searchable?: boolean;
  starredFriends?: string[];
}

type FriendRequest = {
  id: string;
  fromUid: string;
  fromName: string;
};

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
  // Recompute Date.now() fresh here rather than trusting each competition's
  // cached `status` — that field only updates when the competitiondb
  // snapshot listener fires, so it can lag behind real time by however long
  // it's been since anyone last wrote to that doc. Once a competition is
  // truly over (now > end), its points must never be touched again: nothing
  // should be able to retroactively change a finished competition's rank or
  // winner status, including a future change to this very calculation.
  const now = Date.now();
  const joined = competitions.filter((c) => c.userJoined && now <= c.end);

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

function getStartOfDayMs(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Locked-in minutes since local midnight — a sliding window, so it resets
// itself naturally at midnight with no separate "reset" logic needed. A
// session spanning midnight is automatically clipped to only its portion
// after the new day's start (getLockedMinutesInRange already clamps to the
// given range), so sparkles correctly restart at 0 for the new day even if
// you were locked in when the clock rolled over.
function getTodayLockedMinutes(
  events?: LockedEvent[],
  nowMs: number = Date.now()
): number {
  return getLockedMinutesInRange(events, getStartOfDayMs(new Date(nowMs)), nowMs, nowMs);
}

const SPARKLE_FULL_HOURS = 6;

function getSparkleLevel(events?: LockedEvent[], nowMs: number = Date.now()): number {
  const todayMinutes = getTodayLockedMinutes(events, nowMs);
  return Math.max(0, Math.min(1, todayMinutes / (SPARKLE_FULL_HOURS * 60)));
}

export default function HomeScreen() {
  const { userData } = useUser();
  const { registerLockToggle, setIsLockedIn } = useLockControl();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [friendUids, setFriendUids] = useState<string[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<
    Record<
      string,
      {
        name: string;
        companionHue: number;
        acceptingInvites: boolean;
        shareOnlineStatus: boolean;
        lastActiveAt: number;
      }
    >
  >({});
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [isSendingFriendRequest, setIsSendingFriendRequest] = useState(false);
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null);
  const [friendCodeCopied, setFriendCodeCopied] = useState(false);
  const [invitingFriendUid, setInvitingFriendUid] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<LockSession | null>(null);
  const [sessionMemberProfiles, setSessionMemberProfiles] = useState<
    Record<string, { name: string; companionHue: number }>
  >({});
  const [groupCompanionGridWidth, setGroupCompanionGridWidth] = useState(0);
  const [isLeavingGroup, setIsLeavingGroup] = useState(false);
  const [isSearchModalVisible, setIsSearchModalVisible] = useState(false);
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
  const [todayLockedMinutes, setTodayLockedMinutes] = useState(0);
  const [lockedEvents, setLockedEvents] = useState<LockedEvent[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [unlockedHeaderHeight, setUnlockedHeaderHeight] = useState(0);
  const [welcomeNeedsBreak, setWelcomeNeedsBreak] = useState(false);


  
  useEffect(() => {
    const total = getAllTimeLockedMinutes(lockedEvents, nowMs);
    const week = getThisWeekLockedMinutes(lockedEvents, nowMs);
    const today = getTodayLockedMinutes(lockedEvents, nowMs);

    setAllTimeLockedMinutes(total);
    setThisWeekLockedMinutes(week);
    setTodayLockedMinutes(today);
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

  useEffect(() => {
    if (!uid) return;

    const sendPresenceHeartbeat = () => {
      updateDoc(doc(firestore, 'profiledb', uid), { lastActiveAt: Date.now() }).catch((err) =>
        console.error('Failed to update presence heartbeat:', err)
      );
    };

    sendPresenceHeartbeat();
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        sendPresenceHeartbeat();
      }
    }, PRESENCE_HEARTBEAT_MS);

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        sendPresenceHeartbeat();
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
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
          if (!profileData?.friendCode) {
            ensureFriendCode(uid, profileData?.friendCode).catch((err) =>
              console.error('Failed to ensure friend code:', err)
            );
          }
          // Backfill for accounts created before search existed. Firestore's
          // `where('searchable','==',true)` won't match a document where the
          // field is entirely absent, so without this, pre-existing users
          // would be silently invisible in search despite defaulting to
          // "public" everywhere else the field is read with `?? true`.
          const backfill: Record<string, unknown> = {};
          if (profileData?.name && !profileData?.nameLower) {
            backfill.nameLower = String(profileData.name).trim().toLowerCase();
          }
          if (profileData?.searchable === undefined) {
            backfill.searchable = true;
          }
          if (Object.keys(backfill).length > 0) {
            updateDoc(userDocRef, backfill).catch((err) =>
              console.error('Failed to backfill search fields:', err)
            );
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
    if (!uid) {
      setFriendUids([]);
      return;
    }

    const friendshipsQuery = query(
      collection(firestore, 'friendships'),
      where('uids', 'array-contains', uid)
    );

    const unsubscribe = onSnapshot(
      friendshipsQuery,
      (snapshot) => {
        const uids = snapshot.docs
          .map((docSnap) => (docSnap.data() as { uids: string[] }).uids.find((u) => u !== uid))
          .filter((u): u is string => !!u);
        setFriendUids(uids);
      },
      (error) => {
        console.error('Error fetching friendships:', error);
      }
    );

    return unsubscribe;
  }, [uid]);

  useEffect(() => {
    if (friendUids.length === 0) {
      setFriendProfiles({});
      return;
    }

    const unsubscribers = friendUids.map((friendUid) =>
      onSnapshot(
        doc(firestore, 'profiledb', friendUid),
        (snap) => {
          const data = snap.exists() ? (snap.data() as any) : null;
          setFriendProfiles((prev) => ({
            ...prev,
            [friendUid]: {
              name: data?.name?.trim() || 'Friend',
              companionHue: data?.companionHue ?? 0,
              acceptingInvites: data?.acceptingInvites ?? true,
              shareOnlineStatus: data?.shareOnlineStatus ?? true,
              lastActiveAt: data?.lastActiveAt ?? 0,
            },
          }));
        },
        (error) => {
          console.error(`Error fetching friend profile for ${friendUid}:`, error);
        }
      )
    );

    return () => unsubscribers.forEach((unsub) => unsub());
  }, [friendUids]);

  useEffect(() => {
    if (!uid) {
      setIncomingRequests([]);
      return;
    }

    const requestsQuery = query(
      collection(firestore, 'friendRequests'),
      where('toUid', '==', uid),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      requestsQuery,
      (snapshot) => {
        setIncomingRequests(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            fromUid: (docSnap.data() as any).fromUid,
            fromName: (docSnap.data() as any).fromName || 'Someone',
          }))
        );
      },
      (error) => {
        console.error('Error fetching friend requests:', error);
      }
    );

    return unsubscribe;
  }, [uid]);

  useEffect(() => {
    const sessionId = userProfile?.activeLockSessionId;
    if (!sessionId) {
      setActiveSession(null);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(firestore, 'lockSessions', sessionId),
      (snap) => {
        setActiveSession(snap.exists() ? (snap.data() as LockSession) : null);
      },
      (error) => {
        console.error('Error fetching active lock session:', error);
      }
    );

    return unsubscribe;
  }, [userProfile?.activeLockSessionId]);

  // Member uids as a stable string key so this effect only re-subscribes
  // when who's in the session actually changes, not on every unrelated
  // session-doc write.
  const sessionMemberUidsKey = activeSession
    ? Object.keys(activeSession.members).sort().join(',')
    : '';

  useEffect(() => {
    const memberUids = sessionMemberUidsKey ? sessionMemberUidsKey.split(',') : [];

    if (memberUids.length === 0) {
      setSessionMemberProfiles({});
      return;
    }

    // The session doc's stored name/companionHue are just a snapshot from
    // whenever each person joined — live-listen to each member's own
    // profiledb doc so a blob color (or name) change shows up immediately
    // for everyone in the session, not just at the next join/leave.
    const unsubscribers = memberUids.map((memberUid) =>
      onSnapshot(
        doc(firestore, 'profiledb', memberUid),
        (snap) => {
          const data = snap.exists() ? (snap.data() as any) : null;
          setSessionMemberProfiles((prev) => ({
            ...prev,
            [memberUid]: {
              name: data?.name?.trim() || 'Friend',
              companionHue: data?.companionHue ?? 0,
            },
          }));
        },
        (error) => {
          console.error(`Error fetching session member profile for ${memberUid}:`, error);
        }
      )
    );

    return () => unsubscribers.forEach((unsub) => unsub());
  }, [sessionMemberUidsKey]);

  const handleCopyFriendCode = React.useCallback(async () => {
    if (!userProfile?.friendCode) return;
    await Clipboard.setStringAsync(userProfile.friendCode);
    setFriendCodeCopied(true);
    setTimeout(() => setFriendCodeCopied(false), 1500);
  }, [userProfile?.friendCode]);

  const handleSendFriendRequest = React.useCallback(async () => {
    if (!uid) return;

    setIsSendingFriendRequest(true);
    try {
      await sendFriendRequest(uid, userProfile?.name ?? userData?.name ?? 'Player', friendCodeInput);
      setFriendCodeInput('');
      Alert.alert('Request sent', 'Your friend request has been sent.');
    } catch (error: any) {
      Alert.alert('Could not send request', error?.message ?? 'Please try again.');
    } finally {
      setIsSendingFriendRequest(false);
    }
  }, [uid, userProfile?.name, userData?.name, friendCodeInput]);

  const handleAcceptRequest = React.useCallback(
    async (request: FriendRequest) => {
      if (!uid) return;

      setRespondingRequestId(request.id);
      try {
        await acceptFriendRequest(request.id, request.fromUid, uid);
      } catch (error) {
        console.error('Failed to accept friend request:', error);
        Alert.alert('Error', 'Could not accept the request. Please try again.');
      } finally {
        setRespondingRequestId(null);
      }
    },
    [uid]
  );

  const handleDeclineRequest = React.useCallback(async (requestId: string) => {
    setRespondingRequestId(requestId);
    try {
      await declineFriendRequest(requestId);
    } catch (error) {
      console.error('Failed to decline friend request:', error);
    } finally {
      setRespondingRequestId(null);
    }
  }, []);

  const handleInviteFriend = React.useCallback(
    async (friendUid: string) => {
      if (!uid) return;

      setInvitingFriendUid(friendUid);
      try {
        await inviteFriendToLockIn(
          uid,
          userProfile?.name ?? userData?.name ?? 'Player',
          userProfile?.companionHue ?? 0,
          friendUid,
          userProfile?.activeLockSessionId
        );
      } catch (error) {
        console.error('Failed to invite friend to lock in:', error);
        Alert.alert('Error', 'Could not send the invite. Please try again.');
      } finally {
        setInvitingFriendUid(null);
      }
    },
    [uid, userProfile?.name, userProfile?.companionHue, userProfile?.activeLockSessionId, userData?.name]
  );

  const handleToggleStar = React.useCallback(
    async (friendUid: string, isCurrentlyStarred: boolean) => {
      if (!uid) return;
      try {
        await setFriendStarred(uid, friendUid, !isCurrentlyStarred);
      } catch (error) {
        console.error('Failed to toggle starred friend:', error);
      }
    },
    [uid]
  );

  const handleUnfriend = React.useCallback(
    async (friendUid: string, friendName: string) => {
      if (!uid) return;
      try {
        await unfriend(uid, friendUid);
      } catch (error) {
        console.error('Failed to remove friend:', error);
        Alert.alert('Error', `Could not remove ${friendName}. Please try again.`);
      }
    },
    [uid]
  );

  const handleFriendOptions = React.useCallback(
    (friendUid: string, friendName: string, canInvite: boolean) => {
      const options: {
        text: string;
        style?: 'default' | 'destructive' | 'cancel';
        onPress?: () => void;
      }[] = [];

      if (canInvite) {
        options.push({ text: 'Invite to Lock In', onPress: () => handleInviteFriend(friendUid) });
      }

      options.push({
        text: 'Remove Friend',
        style: 'destructive',
        onPress: () => handleUnfriend(friendUid, friendName),
      });
      options.push({ text: 'Cancel', style: 'cancel' });

      Alert.alert(friendName, undefined, options);
    },
    [handleInviteFriend, handleUnfriend]
  );

  const handleLeaveGroup = React.useCallback(async () => {
    const sessionId = userProfile?.activeLockSessionId;
    if (!uid || !sessionId) return;

    setIsLeavingGroup(true);
    try {
      // leaveLockSession only ever touches the shared session doc and
      // activeLockSessionId — it doesn't clear Screen Time restrictions or
      // touch lockedEvents, so calling it here (outside of toggleLockIn's
      // lock-out branch) leaves your own solo lock-in session untouched.
      await leaveLockSession(sessionId, uid);
    } catch (error) {
      console.error('Failed to leave group session:', error);
      Alert.alert('Error', 'Could not leave the group. Please try again.');
    } finally {
      setIsLeavingGroup(false);
    }
  }, [uid, userProfile?.activeLockSessionId]);

  const hasAnimatedRef = useRef(false);

  useFocusEffect(
    React.useCallback(() => {
      if (hasAnimatedRef.current) return;
      if (!profileLoading && !competitionsLoading && uid) {
        hasAnimatedRef.current = true;
        setTimeout(() => startAnimations(), 100);
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

  const toggleLockIn = React.useCallback(async (): Promise<boolean> => {
    const next = !theButtonPressedRef.current;
    const now = Date.now();
    const optimisticEvent: LockedEvent = {
      timestamp: now,
      lockedIn: next,
    };

    if (next) {
      const restrictionsApplied = await applyLockInRestrictions();
      if (!restrictionsApplied) return false;
    }

    theButtonPressedRef.current = next;
    setNowMs(now);
    setLockedEvents((prev) => [...normalizeLockedEvents(prev), optimisticEvent]);
    setTheButtonPressed(next);
    setIsLockedIn(next);

    if (!next) {
      clearLockInRestrictions().catch(console.error);

      const activeSessionId = userProfile?.activeLockSessionId;
      if (activeSessionId && uid) {
        leaveLockSession(activeSessionId, uid).catch((err) =>
          console.error('Failed to leave lock session:', err)
        );
      }
    }

    await recordEvent(next, now);

    // if (next) {
    //   await startLockInLiveActivity(now);
    // } else {
    //   await stopLockInLiveActivity();
    // }

    return true;
  }, [
    applyLockInRestrictions,
    clearLockInRestrictions,
    recordEvent,
    setIsLockedIn,
    uid,
    userProfile?.activeLockSessionId,
  ]);

  useEffect(() => {
    setIsLockedIn(theButtonPressed);
  }, [setIsLockedIn, theButtonPressed]);

  useEffect(() => {
    registerLockToggle(toggleLockIn);
    return () => registerLockToggle(null);
  }, [registerLockToggle, toggleLockIn]);

  const displayName = userProfile?.name ?? userData?.name ?? 'User';

  // Re-attempt a single line whenever the name changes — onTextLayout below
  // flips this back to true if it turns out too long for this device width.
  useEffect(() => {
    setWelcomeNeedsBreak(false);
  }, [displayName]);

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

  const sparkleLevel = getSparkleLevel(lockedEvents, nowMs);

  const starredFriendUids = userProfile?.starredFriends ?? [];
  const sortedFriendUids = [...friendUids].sort((a, b) => {
    const aStarred = starredFriendUids.includes(a);
    const bStarred = starredFriendUids.includes(b);
    if (aStarred === bStarred) return 0;
    return aStarred ? -1 : 1;
  });

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
                      <Text
                        style={[styles.warmFont, styles.welcomeText]}
                        onTextLayout={(event) => {
                          if (event.nativeEvent.lines.length > 1 && !welcomeNeedsBreak) {
                            setWelcomeNeedsBreak(true);
                          }
                        }}
                      >
                        Welcome,{welcomeNeedsBreak ? '\n' : ' '}
                        <Text style={styles.username}>{displayName}</Text>
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
                          
                          <Text
                            style={styles.dataNumber}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.4}
                          >
                            {formatMinutes(allTimeLockedMinutes)}
                          </Text>
                          <Text style={styles.competitionStatLabel}>life time locked in</Text>
                        </View>     
                        <View style={styles.competitionStatBox}>

                          <Text
                            style={styles.dataNumber}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.4}
                          >
                            {formatMinutes(thisWeekLockedMinutes)}
                          </Text>
                          <Text style={styles.competitionStatLabel}>weekly time locked in</Text>
                        </View>
                        <View style={styles.competitionStatBox}>

                          <Text
                            style={styles.dataNumber}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.4}
                          >
                            {formatMinutes(todayLockedMinutes)}
                          </Text>
                          <Text style={styles.competitionStatLabel}>today&apos;s time locked in</Text>
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
                  {activeSession && Object.keys(activeSession.members).length > 1 ? (
                    (() => {
                      const memberEntries = Object.entries(activeSession.members);
                      const { size: blobSize } = computeGroupGridLayout(
                        memberEntries.length,
                        groupCompanionGridWidth
                      );

                      return (
                        <>
                          <View
                            style={styles.groupCompanionGrid}
                            onLayout={(e) => setGroupCompanionGridWidth(e.nativeEvent.layout.width)}
                          >
                            {memberEntries.map(([memberUid, member]) => {
                              const liveProfile = sessionMemberProfiles[memberUid];
                              const displayHue = liveProfile?.companionHue ?? member.companionHue;
                              const displayName =
                                memberUid === uid ? 'You' : liveProfile?.name ?? member.name;

                              return (
                                <View
                                  key={memberUid}
                                  style={[styles.groupCompanionItem, { width: blobSize }]}
                                >
                                  <BlobCompanion
                                    hue={displayHue}
                                    size={blobSize}
                                    sparkleLevel={memberUid === uid ? sparkleLevel : 0}
                                  />
                                  <Text
                                    style={[styles.groupCompanionName, { maxWidth: blobSize }]}
                                    numberOfLines={1}
                                  >
                                    {displayName}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>

                          <TouchableOpacity
                            style={styles.leaveGroupButton}
                            onPress={handleLeaveGroup}
                            disabled={isLeavingGroup}
                            accessibilityRole="button"
                            accessibilityLabel="Leave group lock-in"
                          >
                            {isLeavingGroup ? (
                              <ActivityIndicator size="small" color={strongColor} />
                            ) : (
                              <>
                                <Ionicons name="exit-outline" size={14} color={strongColor} />
                                <Text style={styles.leaveGroupButtonText}>Leave Group</Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </>
                      );
                    })()
                  ) : (
                    <BlobCompanion
                      hue={userProfile?.companionHue ?? 0}
                      style={styles.companion}
                      sparkleLevel={sparkleLevel}
                    />
                  )}
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

              <Animated.View style={[getAnimatedStyle(statsAnimation), styles.friendsCard]}>
                <View style={styles.friendsHeaderRow}>
                  <Text style={styles.sectionTitle}>Friends</Text>
                  <View style={styles.friendsHeaderActions}>
                    <TouchableOpacity
                      style={styles.searchFriendsButton}
                      onPress={() => setIsSearchModalVisible(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Search for friends"
                    >
                      <Ionicons name="search" size={15} color={strongColor} />
                    </TouchableOpacity>
                    {userProfile?.friendCode && (
                      <TouchableOpacity
                        style={styles.myCodePill}
                        onPress={handleCopyFriendCode}
                        activeOpacity={0.75}
                      >
                        <Ionicons name="copy-outline" size={13} color={strongColor} />
                        <Text style={styles.myCodePillText}>
                          {friendCodeCopied ? 'Copied!' : userProfile.friendCode}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={styles.addFriendRow}>
                  <TextInput
                    value={friendCodeInput}
                    onChangeText={setFriendCodeInput}
                    placeholder="Enter a friend code"
                    placeholderTextColor="#8A8A8A"
                    autoCapitalize="characters"
                    style={styles.addFriendInput}
                  />
                  <TouchableOpacity
                    style={[
                      styles.addFriendButton,
                      isSendingFriendRequest && styles.addFriendButtonDisabled,
                    ]}
                    onPress={handleSendFriendRequest}
                    disabled={isSendingFriendRequest}
                  >
                    <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>

                {incomingRequests.length > 0 && (
                  <View style={styles.requestsSection}>
                    <Text style={styles.requestsTitle}>Friend Requests</Text>
                    {incomingRequests.map((request) => (
                      <View key={request.id} style={styles.requestRow}>
                        <Text style={styles.requestName}>{request.fromName}</Text>
                        <View style={styles.requestActions}>
                          <TouchableOpacity
                            style={styles.requestAcceptButton}
                            onPress={() => handleAcceptRequest(request)}
                            disabled={respondingRequestId === request.id}
                          >
                            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.requestDeclineButton}
                            onPress={() => handleDeclineRequest(request.id)}
                            disabled={respondingRequestId === request.id}
                          >
                            <Ionicons name="close" size={16} color="#FFFFFF" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {sortedFriendUids.length === 0 ? (
                  <Text style={styles.noFriendsText}>
                    No friends yet — share your code above or enter a friend&apos;s code to add them.
                  </Text>
                ) : (
                  sortedFriendUids.map((friendUid) => {
                    const friend = friendProfiles[friendUid];
                    const isOnline =
                      !!friend?.shareOnlineStatus &&
                      Date.now() - (friend?.lastActiveAt ?? 0) < ONLINE_THRESHOLD_MS;
                    const isFriendInGroup = !!activeSession?.members[friendUid];
                    const canInvite =
                      theButtonPressed && !!friend?.acceptingInvites && !isFriendInGroup;
                    const isStarred = starredFriendUids.includes(friendUid);
                    const friendName = friend?.name ?? 'Friend';

                    return (
                      <View key={friendUid} style={styles.friendRowWrap}>
                        <View style={styles.friendRow}>
                          <View style={styles.friendAvatarWrap}>
                            <View style={styles.friendAvatar}>
                              <Text style={styles.friendAvatarText}>
                                {(friend?.name ?? '?').slice(0, 1).toUpperCase()}
                              </Text>
                            </View>
                            {isOnline && <View style={styles.onlineDot} />}
                          </View>
                          <Text style={styles.friendName} numberOfLines={1}>
                            {friendName}
                          </Text>

                          <TouchableOpacity
                            style={styles.friendIconButton}
                            onPress={() => handleToggleStar(friendUid, isStarred)}
                            accessibilityRole="button"
                            accessibilityLabel={isStarred ? `Unstar ${friendName}` : `Star ${friendName}`}
                          >
                            <Ionicons
                              name={isStarred ? 'star' : 'star-outline'}
                              size={17}
                              color={isStarred ? '#FBBF24' : '#8A8A9A'}
                            />
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.friendIconButton}
                            onPress={() => handleFriendOptions(friendUid, friendName, canInvite)}
                            accessibilityRole="button"
                            accessibilityLabel={`More options for ${friendName}`}
                          >
                            <Ionicons name="ellipsis-horizontal" size={17} color="#8A8A9A" />
                          </TouchableOpacity>
                        </View>

                        {theButtonPressed && !isFriendInGroup && (
                          <TouchableOpacity
                            style={[
                              styles.inviteFriendButton,
                              !canInvite && styles.inviteFriendButtonDisabled,
                            ]}
                            onPress={() => handleInviteFriend(friendUid)}
                            disabled={!canInvite || invitingFriendUid === friendUid}
                          >
                            {canInvite ? (
                              invitingFriendUid === friendUid ? (
                                <Ionicons name="hourglass-outline" size={14} color="#FFFFFF" />
                              ) : (
                                <Ionicons name="moon-outline" size={14} color="#FFFFFF" />
                              )
                            ) : (
                              <Ionicons name="close-circle-outline" size={14} color="#FFFFFF" />
                            )}
                            {canInvite ? (
                              <Text style={styles.inviteFriendButtonText}>
                                {invitingFriendUid === friendUid ? 'Inviting…' : 'Invite to Lock In'}
                              </Text>
                            ) : (
                              <Text style={styles.inviteFriendButtonText}>
                                {'Invites are off'}
                              </Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </Animated.View>

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
      <FriendSearchModal
        visible={isSearchModalVisible}
        onClose={() => setIsSearchModalVisible(false)}
        uid={uid ?? ''}
        myName={userProfile?.name ?? userData?.name ?? 'Player'}
        friendUids={friendUids}
      />
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
  friendsCard: {
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
  friendsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  friendsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchFriendsButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  myCodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  myCodePillText: {
    fontFamily: defFontType,
    color: strongColor,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  addFriendRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  addFriendInput: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    color: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: defFontType,
  },
  addFriendButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: strongColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendButtonDisabled: {
    opacity: 0.6,
  },
  requestsSection: {
    marginBottom: 14,
  },
  requestsTitle: {
    fontFamily: defFontType,
    color: '#B0B0B0',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  requestName: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 15,
    flex: 1,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
  },
  requestAcceptButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestDeclineButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noFriendsText: {
    fontFamily: defFontType,
    color: '#B0B0B0',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 8,
  },
  friendRowWrap: {
    paddingVertical: 8,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  friendAvatarWrap: {
    position: 'relative',
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    borderWidth: 1,
    borderColor: strongColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarText: {
    fontFamily: defFontType,
    color: strongColor,
    fontSize: 14,
    fontWeight: '700',
  },
  onlineDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: lbgColor,
  },
  friendName: {
    flex: 1,
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 15,
  },
  inviteFriendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 8,
    marginLeft: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: strongColor,
  },
  inviteFriendButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  inviteFriendButtonText: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  friendIconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupCompanionGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-start',
    gap: GROUP_GRID_GAP,
    paddingHorizontal: 4,
  },
  groupCompanionItem: {
    alignItems: 'center',
  },
  groupCompanionName: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  leaveGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  leaveGroupButtonText: {
    fontFamily: defFontType,
    color: strongColor,
    fontSize: 13,
    fontWeight: '600',
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
    fontSize: 32,
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
