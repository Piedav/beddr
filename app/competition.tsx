import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
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
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { firestore } from '../firebase';
import { useUser } from './_layout';

const bgColor = '#111124ff';
const lbgColor = '#322f4e81';
const l2bgColor = '#322f4eff';
const strongColor = '#cc7bdbff';
const labelColor = 'rgb(180, 180, 188)';
const defFontType = 'OpenSansSemiBold';
const warmFontType = 'Molengo';

type WinType = 'number' | 'percentage' | 'team';

type PlayerInfo = {
  points?: number;
  joinedAt?: number;
  name?: string;
};

type CompetitionDoc = {
  name?: string;
  start?: number;
  end?: number;
  reward?: string;
  winType?: WinType;
  winVal?: number;
  players?: Record<string, PlayerInfo>;
};

type CompetitionSummary = Required<Pick<CompetitionDoc, 'players'>> & {
  id: string;
  name: string;
  start: number;
  end: number;
  reward: string;
  status: 'ongoing' | 'upcoming' | 'finished';
  userJoined: boolean;
};

type LockedEvent = {
  timestamp: number;
  lockedIn: boolean;
};

type LeaderboardEntry = {
  uid: string;
  name: string;
  points: number;
  rank: number;
  isUser: boolean;
  isWinner: boolean;
};

function normalizeLockedEvents(events?: LockedEvent[]): LockedEvent[] {
  if (!Array.isArray(events)) return [];
  return [...events]
    .filter(
      (event) =>
        event &&
        typeof event.timestamp === 'number' &&
        typeof event.lockedIn === 'boolean'
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

function getLockedMinutesInRange(
  events: LockedEvent[] | undefined,
  rangeStart: number,
  rangeEnd: number,
  nowMs: number = Date.now()
) {
  if (rangeEnd <= rangeStart) return 0;

  const sorted = normalizeLockedEvents(events);
  let totalMs = 0;
  let currentStart: number | null = null;

  sorted.forEach((event) => {
    if (event.lockedIn) {
      if (currentStart === null) currentStart = event.timestamp;
      return;
    }

    if (currentStart !== null && event.timestamp > currentStart) {
      const start = Math.max(currentStart, rangeStart);
      const end = Math.min(event.timestamp, rangeEnd);
      totalMs += Math.max(0, end - start);
      currentStart = null;
    }
  });

  if (currentStart !== null && nowMs > currentStart) {
    const start = Math.max(currentStart, rangeStart);
    const end = Math.min(nowMs, rangeEnd);
    totalMs += Math.max(0, end - start);
  }

  return Math.floor(totalMs / 60000);
}

export default function CompetitionScreen() {
  const { userData } = useUser();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const competitionId: string | undefined = route.params?.competitionId;
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const [competition, setCompetition] = useState<CompetitionDoc | null>(null);
  const [loadedCompetitionId, setLoadedCompetitionId] = useState<string | null>(null);
  const [competitions, setCompetitions] = useState<CompetitionSummary[]>([]);
  const [lockedEvents, setLockedEvents] = useState<LockedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [competitionsLoading, setCompetitionsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState<string | null>(null);
  const [collapseFinished, setCollapseFinished] = useState(true);
  const [hasInitialized, setHasInitialized] = useState(false);
  const hasAnimatedRef = useRef(false);

  const titleAnimation = useRef(new Animated.Value(0)).current;
  const statusAnimation = useRef(new Animated.Value(0)).current;
  const progressAnimation = useRef(new Animated.Value(0)).current;
  const contentAnimation = useRef(new Animated.Value(0)).current;

  const startAnimations = React.useCallback(() => {
    titleAnimation.setValue(0);
    statusAnimation.setValue(0);
    progressAnimation.setValue(0);
    contentAnimation.setValue(0);
    setHasInitialized(true);

    Animated.timing(titleAnimation, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();

    setTimeout(() => {
      Animated.timing(statusAnimation, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, 80);

    setTimeout(() => {
      Animated.timing(progressAnimation, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, 160);

    setTimeout(() => {
      Animated.timing(contentAnimation, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }, 240);
  }, [contentAnimation, progressAnimation, statusAnimation, titleAnimation]);

  const getAnimatedStyle = (animationValue: Animated.Value) => ({
    opacity: animationValue,
    transform: [
      {
        translateY: animationValue.interpolate({
          inputRange: [0, 1],
          outputRange: [24, 0],
        }),
      },
    ],
  });

  useEffect(() => {
    hasAnimatedRef.current = false;

    if (!competitionId) {
      setCompetition(null);
      setLoadedCompetitionId(null);
      setLoading(false);
      return;
    }

    setCompetition(null);
    setLoadedCompetitionId(null);
    setLoading(true);
    setHasInitialized(false);

    const compRef = doc(firestore, 'competitiondb', competitionId);
    const unsub = onSnapshot(
      compRef,
      (snap) => {
        setCompetition(snap.exists() ? (snap.data() as CompetitionDoc) : null);
        setLoadedCompetitionId(competitionId);
        setLoading(false);
      },
      (err) => {
        console.error('competition onSnapshot error:', err);
        setLoadedCompetitionId(competitionId);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [competitionId]);

  useEffect(() => {
    if (!userData?.uid) {
      setCompetitions([]);
      setCompetitionsLoading(false);
      return;
    }

    setCompetitionsLoading(true);
    const competitionsRef = collection(firestore, 'competitiondb');

    const unsubscribe = onSnapshot(
      competitionsRef,
      (snapshot) => {
        const nextCompetitions: CompetitionSummary[] = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as CompetitionDoc;
          if (!data?.start || !data?.end || !data?.players) return;

          nextCompetitions.push({
            id: docSnap.id,
            name: data.name ?? 'Untitled Competition',
            start: data.start,
            end: data.end,
            reward: data.reward ?? 'No reward set',
            players: data.players,
            status: getCompetitionStatus(data.start, data.end),
            userJoined: !!data.players?.[userData.uid],
          });
        });

        nextCompetitions.sort((a, b) => {
          if (a.status === 'finished' && b.status !== 'finished') return 1;
          if (a.status !== 'finished' && b.status === 'finished') return -1;
          return a.start - b.start;
        });

        setCompetitions(nextCompetitions);
        setCompetitionsLoading(false);
      },
      (error) => {
        console.error('competitions onSnapshot error:', error);
        setCompetitionsLoading(false);
      }
    );

    return unsubscribe;
  }, [userData?.uid]);

  useEffect(() => {
    if (!userData?.uid) {
      setLockedEvents([]);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(firestore, 'profiledb', userData.uid),
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;
        setLockedEvents((data?.lockedEvents ?? []) as LockedEvent[]);
      },
      (error) => {
        console.error('profile lockedEvents onSnapshot error:', error);
      }
    );

    return unsubscribe;
  }, [userData?.uid]);
  useEffect(() => {
    const uids = Object.keys(competition?.players ?? {});

    if (uids.length === 0) {
      setPlayerNames({});
      return;
    }

    const unsubscribers = uids.map((uid) =>
      onSnapshot(
        doc(firestore, 'profiledb', uid),
        (snap) => {
          const data = snap.exists() ? (snap.data() as any) : null;

          setPlayerNames((prev) => ({
            ...prev,
            [uid]: data?.name?.trim() || 'Player',
          }));
        },
        (err) => {
          console.error(`profile name onSnapshot error for ${uid}:`, err);
        }
      )
    );

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [competition?.players]);
  useFocusEffect(
    React.useCallback(() => {
      if (hasAnimatedRef.current) return;
      if (!loading) {
        hasAnimatedRef.current = true;
        startAnimations();
      }
    }, [loading, startAnimations])
  );

  const getCompetitionStatus = (
    start?: number,
    end?: number
  ): 'ongoing' | 'upcoming' | 'finished' => {
    const now = Date.now();
    if (!start || !end) return 'upcoming';
    if (now < start) return 'upcoming';
    if (now > end) return 'finished';
    return 'ongoing';
  };

  const formatDateRange = (start?: number, end?: number) => {
    if (!start || !end) return '';
    const s = new Date(start);
    const e = new Date(end);

    const sText = s.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const eText = e.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    return `${sText} - ${eText}`;
  };

  const formatRewardText = (reward?: string) => {
    if (!reward) return 'No reward set';
    return reward;
  };

  const getStatusColor = (competitionStatus: CompetitionSummary['status']) => {
    switch (competitionStatus) {
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

  const getStatusIcon = (competitionStatus: CompetitionSummary['status']) => {
    switch (competitionStatus) {
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

  const goToCompetition = (id: string) => {
    navigation.navigate('competition', { competitionId: id });
  };

  const handleJoinCompetition = async (id: string) => {
    if (!userData?.uid) {
      Alert.alert('Error', 'Unable to join competition. Please try again.');
      return;
    }

    const targetCompetition = competitions.find((comp) => comp.id === id);
    if (!targetCompetition) {
      Alert.alert('Error', 'Competition not found.');
      return;
    }

    if (targetCompetition.userJoined) {
      Alert.alert('Already Joined', 'You are already in this competition!');
      return;
    }

    if (targetCompetition.status === 'finished') {
      Alert.alert('Competition Ended', 'This competition has already finished.');
      return;
    }

    setIsJoining(id);

    try {
      const competitionDocRef = doc(firestore, 'competitiondb', id);
      const snap = await getDoc(competitionDocRef);

      if (!snap.exists()) {
        Alert.alert('Error', 'Competition doc not found.');
        return;
      }

      const compData = snap.data() as CompetitionDoc;
      const initialPoints = getLockedMinutesInRange(
        lockedEvents,
        compData.start ?? targetCompetition.start,
        compData.end ?? targetCompetition.end
      );

      await setDoc(
        competitionDocRef,
        {
          players: {
            [userData.uid]: {
              joinedAt: serverTimestamp(),
              points: initialPoints,
              name: userData.name ?? 'Player',
            },
          },
        },
        { merge: true }
      );

      const profileRef = doc(firestore, 'profiledb', userData.uid);
      try {
        await updateDoc(profileRef, {
          competitions: arrayUnion(id),
        });
      } catch {
        await setDoc(profileRef, { competitions: [id] }, { merge: true });
      }

      goToCompetition(id);
    } catch (error) {
      console.error('Error joining competition:', error);
      Alert.alert('Error', 'Failed to join competition. Please try again.');
    } finally {
      setIsJoining(null);
    }
  };

  const getRankedLeaderboard = (
    players: Record<string, PlayerInfo> | undefined,
    winType: WinType | undefined,
    winVal: number | undefined,
    myUid?: string
  ): LeaderboardEntry[] => {
    const entries = Object.entries(players ?? {}).map(([uid, pdata]) => ({
      uid,
      name: uid === myUid ? 'You' : playerNames?.[uid] ?? pdata?.name ?? 'Player',
      points: pdata?.points ?? 0,
      isUser: uid === myUid,
    }));

    entries.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const aJoined = players?.[a.uid]?.joinedAt ?? 0;
      const bJoined = players?.[b.uid]?.joinedAt ?? 0;
      return aJoined - bJoined;
    });

    let rank = 0;
    let prevPoints: number | null = null;

    const ranked = entries.map((entry, index) => {
      if (prevPoints === null || entry.points !== prevPoints) {
        rank = index + 1;
        prevPoints = entry.points;
      }
      return { ...entry, rank, isWinner: false };
    });

    if (winType === 'number') {
      const cutoff = Math.max(1, winVal ?? 0);
      return ranked.map((e) => ({ ...e, isWinner: e.rank <= cutoff }));
    }

    if (winType === 'percentage') {
      const pct = Math.max(1, Math.min(100, winVal ?? 0));
      const winnerCount = Math.max(1, Math.ceil((ranked.length * pct) / 100));
      return ranked.map((e) => ({ ...e, isWinner: e.rank <= winnerCount }));
    }

    if (winType === 'team') {
      const goal = Math.max(1, winVal ?? 0);
      const teamWon = ranked.reduce((sum, e) => sum + e.points, 0) >= goal;
      return ranked.map((e) => ({ ...e, isWinner: teamWon }));
    }

    return ranked;
  };

  const status = getCompetitionStatus(competition?.start, competition?.end);
  const hasJoinedCompetition = !!competition?.players?.[userData?.uid ?? ''];

  const rankedLeaderboard = getRankedLeaderboard(
    competition?.players,
    competition?.winType,
    competition?.winVal,
    userData?.uid
  );

  const myEntry = rankedLeaderboard.find((e) => e.isUser);
  const myStoredPoints = competition?.players?.[userData?.uid ?? '']?.points ?? 0;
  const totalPlayers = Object.keys(competition?.players ?? {}).length;
  const totalTeamPoints = rankedLeaderboard.reduce((sum, e) => sum + e.points, 0);
  const activeCompetitions = competitions.filter(
    (item) => item.status !== 'finished' && item.userJoined
  );
  const finishedCompetitions = competitions.filter(
    (item) => item.status === 'finished' && item.userJoined
  );
  const isLoadingSelectedCompetition =
    !!competitionId && (loading || loadedCompetitionId !== competitionId);

  const handleBack = () => {
    navigation.navigate({ name: 'competition', params: {}, merge: false });
  };

  const renderCompetitionCard = (item: CompetitionSummary) => (
    <View key={item.id} style={styles.competitionContainer}>
      <View style={styles.competitionHeader}>
        <Text style={styles.competitionTitle}>
          {item.name}{' '}
          {item.status !== 'finished' ? (
            <Text style={styles.compId}>({item.id})</Text>
          ) : null}
        </Text>

        <View
          style={[
            styles.statusTag,
            { backgroundColor: `${getStatusColor(item.status)}20` },
          ]}
        >
          <Ionicons
            name={getStatusIcon(item.status) as any}
            size={20}
            color={getStatusColor(item.status)}
          />
          <Text
            style={[
              styles.statusTagText,
              { color: getStatusColor(item.status) },
            ]}
          >
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <Text style={styles.dateRange}>{formatDateRange(item.start, item.end)}</Text>

      <View style={styles.competitionStatsContainer}>
        <View style={styles.competitionStatBox}>
          <View style={styles.competitionIconContainer}>
            <Ionicons name="people" size={24} color={strongColor} />
          </View>
          <Text style={styles.competitionStatNumber}>
            {Object.keys(item.players || {}).length}
          </Text>
          <Text style={styles.competitionStatLabel}>Users</Text>
        </View>

        <View style={styles.competitionStatBox}>
          <View style={styles.competitionIconContainer}>
            <Ionicons name="cash" size={24} color={strongColor} />
          </View>
          <Text style={styles.competitionStatNumber}>{item.reward}</Text>
          <Text style={styles.competitionStatLabel}>Prize Pool</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[
          styles.joinButton,
          item.status === 'finished' && styles.joinButtonDisabled,
          isJoining === item.id && styles.joinButtonDisabled,
        ]}
        onPress={() =>
          item.userJoined ? goToCompetition(item.id) : handleJoinCompetition(item.id)
        }
        disabled={isJoining === item.id}
      >
        {isJoining === item.id ? (
          <>
            <Ionicons name="hourglass" size={20} color="#FFFFFF" style={styles.buttonIcon} />
            <Text style={styles.joinButtonText}>Joining...</Text>
          </>
        ) : item.userJoined && item.status !== 'finished' ? (
          <>
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" style={styles.buttonIcon} />
            <Text style={styles.joinButtonText}>Joined - View Competition</Text>
          </>
        ) : item.userJoined ? (
          <>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color="#FFFFFF"
              style={styles.buttonIcon}
            />
            <Text style={styles.joinButtonText}>Ended - View Competition</Text>
          </>
        ) : item.status === 'finished' ? (
          <>
            <Ionicons name="close-circle" size={20} color="#FFFFFF" style={styles.buttonIcon} />
            <Text style={styles.joinButtonText}>Competition Ended</Text>
          </>
        ) : (
          <>
            <Ionicons name="add-circle" size={20} color="#FFFFFF" style={styles.buttonIcon} />
            <Text style={styles.joinButtonText}>Join Competition</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
  

  const winnerSummary = (() => {
    if (competition?.winType === 'number') {
      return `Top ${competition?.winVal ?? 0} players win`;
    }
    if (competition?.winType === 'percentage') {
      return `Top ${competition?.winVal ?? 0}% of players win`;
    }
    if (competition?.winType === 'team') {
      return `Team goal: ${competition?.winVal ?? 0} points`;
    }
    return 'Winner rules not set';
  })();

  if (isLoadingSelectedCompetition) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading competition...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!competitionId) {
    if (competitionsLoading) {
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.centered}>
            <Text style={styles.loadingText}>Loading competitions...</Text>
          </View>
        </SafeAreaView>
      );
    }

    if (!hasInitialized) {
      return <SafeAreaView style={styles.container} />;
    }

    return (
      <SafeAreaView style={styles.container}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
          <Animated.View style={getAnimatedStyle(titleAnimation)}>
            <Text style={styles.hubEyebrow}>Competition</Text>
            <Text style={styles.hubTitle}>Your Competitions</Text>
            <Text style={styles.hubSubtitle}>
              Track your active challenges and revisit finished ones.
            </Text>
          </Animated.View>

          <Animated.View style={getAnimatedStyle(contentAnimation)}>
            {competitions.length === 0 || activeCompetitions.length === 0 ? (
              <View style={styles.noCompetitionsContainer}>
                <Ionicons name="trophy-outline" size={48} color="#666" />
                <Text style={styles.noCompetitionsText}>No active competitions</Text>
                <Text style={styles.noCompetitionsSubtext}>
                  Join or create a competition to see it here.
                </Text>
              </View>
            ) : (
              activeCompetitions.map(renderCompetitionCard)
            )}

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
              (finishedCompetitions.length > 0 ? (
                finishedCompetitions.map(renderCompetitionCard)
              ) : (
                <View style={styles.noCompetitionsContainer}>
                  <Ionicons name="flag-outline" size={42} color="#666" />
                  <Text style={styles.noCompetitionsText}>No finished competitions yet</Text>
                </View>
              ))}
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!competitionId || !competition) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Ionicons name="trophy-outline" size={56} color="#666" />
          <Text style={styles.emptyTitle}>Competition not found</Text>
          <Text style={styles.emptySubtext}>
            Try opening it again from the home screen.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!hasInitialized) {
    return <SafeAreaView style={styles.container} />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          activeOpacity={0.75}
          style={styles.backButton}
          onPress={handleBack}
        >
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <Animated.View style={getAnimatedStyle(titleAnimation)}>
          <Text style={styles.title}>{competition.name ?? 'Competition'}</Text>
          <Text style={styles.subtitle}>
            {formatDateRange(competition.start, competition.end)}
          </Text>
          <Text style={styles.subtitle}>
            Reward: {formatRewardText(competition.reward)}
          </Text>
          <Text style={styles.subtitle}>{winnerSummary}</Text>
        </Animated.View>

        <Animated.View style={[getAnimatedStyle(statusAnimation), styles.statusRow]}>
          <View style={styles.statusCard}>
            <Text style={styles.statusValue}>{status.toUpperCase()}</Text>
            <Text style={styles.statusLabel}>Status</Text>
          </View>

          <View style={styles.statusCard}>
            <Text style={styles.statusValue}>{totalPlayers}</Text>
            <Text style={styles.statusLabel}>Players</Text>
          </View>

          <View style={styles.statusCard}>
            <Text style={styles.statusValue}>
              {competition.winType === 'team'
                ? totalTeamPoints
                : hasJoinedCompetition
                ? myStoredPoints
                : '--'}
            </Text>
            <Text style={styles.statusLabel}>
              {competition.winType === 'team' ? 'Team Points' : 'Your Points'}
            </Text>
          </View>
        </Animated.View>

        {hasJoinedCompetition && status !== "upcoming" ? (
          <Animated.View style={[getAnimatedStyle(progressAnimation), styles.card]}>
            <Text style={styles.cardTitle}>Your Standing</Text>

            <View style={styles.standingGrid}>
              <View style={styles.miniCard}>
                <Text style={styles.miniValue}>{myEntry?.rank ?? '--'}</Text>
                <Text style={styles.miniLabel}>Rank</Text>
              </View>

              <View style={styles.miniCard}>
                <Text style={styles.miniValue}>{myStoredPoints}</Text>
                <Text style={styles.miniLabel}>Points</Text>
              </View>

              <View style={styles.miniCard}>
                <Text style={styles.miniValue}>
                  {competition.winType === 'team'
                    ? totalTeamPoints >= (competition.winVal ?? 0)
                      ? 'YES'
                      : 'NO'
                    : myEntry?.isWinner
                    ? 'YES'
                    : 'NO'}
                </Text>
                <Text style={styles.miniLabel}>Winning?</Text>
              </View>
            </View>
          </Animated.View>
        ) : (
          <Animated.View style={[getAnimatedStyle(progressAnimation), styles.card]}>
            <Text style={styles.cardTitle}>This Competition Has Not Started Yet</Text>
            <Text style={styles.cardBody}>
              {"Get ready for when it does :)"}
            </Text>
          </Animated.View>
        )}
        {status !== "upcoming" &&
        <Animated.View style={[getAnimatedStyle(contentAnimation), styles.card]}>
          <Text style={styles.cardTitle}>Leaderboard</Text>

          {rankedLeaderboard.length === 0 ? (
            <Text style={styles.cardBody}>No players yet.</Text>
          ) : (
            rankedLeaderboard.map((entry) => (
              <View
                key={entry.uid}
                style={[
                  styles.leaderboardRow,
                  entry.isUser && styles.leaderboardRowUser, entry.isWinner && { backgroundColor: 'rgb(51, 97, 51)', borderColor: 'rgb(102, 153, 102)' },
                ]}
              >
                <View style={styles.leaderboardLeft}>
                  <Text style={styles.leaderboardName}>
                    #{entry.rank} {entry.name}
                  </Text>
                  <Text style={styles.leaderboardMeta}>
                    {competition.winType === 'team'
                      ? entry.isWinner
                        ? 'Team goal reached'
                        : 'Team goal not reached'
                      : entry.isWinner
                      ? 'Winner zone'
                      : 'Outside winner zone'}
                  </Text>
                </View>

                <Text style={styles.leaderboardPoints}>{entry.points}</Text>
              </View>
            ))
          )}
        </Animated.View>
    }
        
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: bgColor,
  },
  content: {
    padding: 20,
    paddingTop: 18,
    paddingBottom: 40,
    gap: 18,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  hubEyebrow: {
    color: strongColor,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontFamily: defFontType,
    textAlign: 'center',
    marginBottom: 8,
  },
  hubTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    textAlign: 'center',
    fontFamily: warmFontType,
  },
  hubSubtitle: {
    marginTop: 6,
    color: labelColor,
    fontSize: 14,
    textAlign: 'center',
    fontFamily: defFontType,
  },
  noCompetitionsContainer: {
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 34,
    alignItems: 'center',
    marginBottom: 16,
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
    color: labelColor,
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
    gap: 12,
  },
  competitionTitle: {
    fontFamily: defFontType,
    fontSize: 18,
    color: '#FFFFFF',
    flex: 1,
  },
  compId: {
    fontSize: 14,
    color: labelColor,
    fontFamily: defFontType,
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
  dateRange: {
    fontSize: 14,
    color: labelColor,
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
  competitionStatLabel: {
    fontFamily: defFontType,
    fontSize: 12,
    color: labelColor,
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
  joinButtonText: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
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
  collapseButtonText: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  buttonIcon: {
    marginRight: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: '#fff',
    fontSize: 18,
    fontFamily: defFontType,
  },
  emptyTitle: {
    marginTop: 16,
    color: '#fff',
    fontSize: 22,
    fontFamily: defFontType,
  },
  emptySubtext: {
    marginTop: 8,
    color: labelColor,
    fontSize: 14,
    textAlign: 'center',
    fontFamily: defFontType,
  },
  title: {
    color: '#fff',
    fontSize: 34,
    textAlign: 'center',
    fontFamily: warmFontType,
  },
  subtitle: {
    marginTop: 6,
    color: labelColor,
    fontSize: 14,
    textAlign: 'center',
    fontFamily: defFontType,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statusCard: {
    flex: 1,
    backgroundColor: lbgColor,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
  },
  statusValue: {
    color: '#fff',
    fontSize: 15,
    fontFamily: defFontType,
  },
  statusLabel: {
    marginTop: 6,
    color: labelColor,
    fontSize: 12,
    fontFamily: defFontType,
  },
  card: {
    backgroundColor: lbgColor,
    borderRadius: 20,
    padding: 18,
  },
  cardTitle: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 12,
    fontFamily: defFontType,
  },
  cardBody: {
    color: labelColor,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: defFontType,
  },
  standingGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  miniCard: {
    flex: 1,
    backgroundColor: l2bgColor,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  miniValue: {
    color: strongColor,
    fontSize: 20,
    fontFamily: defFontType,
  },
  miniLabel: {
    marginTop: 6,
    color: labelColor,
    fontSize: 12,
    fontFamily: defFontType,
  },
  leaderboardRow: {
    backgroundColor: l2bgColor,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leaderboardRowUser: {
    borderWidth: 1.5,
    borderColor: strongColor,
  },
  leaderboardLeft: {
    flex: 1,
    marginRight: 12,
  },
  leaderboardName: {
    color: '#fff',
    fontSize: 15,
    fontFamily: defFontType,
  },
  leaderboardMeta: {
    marginTop: 4,
    color: labelColor,
    fontSize: 12,
    fontFamily: defFontType,
  },
  leaderboardPoints: {
    color: strongColor,
    fontSize: 18,
    fontFamily: defFontType,
  },
});
