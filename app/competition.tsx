import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { doc, onSnapshot } from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { firestore } from '../firebase';
import { useUser } from './_layout';

const bgColor = '#111124ff';
const lbgColor = '#322f4e81';
const l2bgColor = '#322f4eff';
const l3bgColor = '#323150';
const strongColor = '#cc7bdbff';
const labelColor = 'rgb(180, 180, 188)';
const defFontType = 'OpenSansSemiBold';
const warmFontType = 'Molengo';

type WinType = 'number' | 'percentage' | 'team';

type PlayerInfo = {
  points?: number;
  joinedAt?: number;
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

type LeaderboardEntry = {
  uid: string;
  name: string;
  points: number;
  rank: number;
  isUser: boolean;
  isWinner: boolean;
};

export default function CompetitionScreen() {
  const { userData } = useUser();
  const route = useRoute<any>();
  const competitionId: string | undefined = route.params?.competitionId;

  const [competition, setCompetition] = useState<CompetitionDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasInitialized, setHasInitialized] = useState(false);

  const titleAnimation = useRef(new Animated.Value(0)).current;
  const statusAnimation = useRef(new Animated.Value(0)).current;
  const progressAnimation = useRef(new Animated.Value(0)).current;
  const contentAnimation = useRef(new Animated.Value(0)).current;

  const startAnimations = () => {
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
  };

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
    if (!competitionId) {
      setLoading(false);
      return;
    }

    const compRef = doc(firestore, 'competitiondb', competitionId);
    const unsub = onSnapshot(
      compRef,
      (snap) => {
        setCompetition(snap.exists() ? (snap.data() as CompetitionDoc) : null);
        setLoading(false);
      },
      (err) => {
        console.error('competition onSnapshot error:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [competitionId]);

  useEffect(() => {
    if (!loading) {
      const t = setTimeout(startAnimations, 80);
      return () => clearTimeout(t);
    }
  }, [loading]);

  useFocusEffect(
    React.useCallback(() => {
      if (!loading) {
        setHasInitialized(false);
        const t = setTimeout(startAnimations, 50);
        return () => clearTimeout(t);
      }
    }, [loading])
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

  const getRankedLeaderboard = (
    players: Record<string, PlayerInfo> | undefined,
    winType: WinType | undefined,
    winVal: number | undefined,
    myUid?: string
  ): LeaderboardEntry[] => {
    const entries = Object.entries(players ?? {}).map(([uid, pdata]) => ({
      uid,
      name: uid === myUid ? 'You' : uid.slice(0, 6),
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

  const rankedLeaderboard = useMemo(
    () =>
      getRankedLeaderboard(
        competition?.players,
        competition?.winType,
        competition?.winVal,
        userData?.uid
      ),
    [competition?.players, competition?.winType, competition?.winVal, userData?.uid]
  );

  const myEntry = rankedLeaderboard.find((e) => e.isUser);
  const myStoredPoints = competition?.players?.[userData?.uid ?? '']?.points ?? 0;
  const totalPlayers = Object.keys(competition?.players ?? {}).length;
  const totalTeamPoints = rankedLeaderboard.reduce((sum, e) => sum + e.points, 0);

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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading competition...</Text>
        </View>
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

        {hasJoinedCompetition ? (
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
            <Text style={styles.cardTitle}>You haven’t joined this competition</Text>
            <Text style={styles.cardBody}>
              Join from the home screen or code page to start earning points.
            </Text>
          </Animated.View>
        )}

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
                  entry.isUser && styles.leaderboardRowUser,
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

        <Animated.View style={[getAnimatedStyle(contentAnimation), styles.card]}>
          <Text style={styles.cardTitle}>How scoring works</Text>
          <Text style={styles.cardBody}>
            Competition points are pulled directly from the stored values in the
            competition document. They should already reflect your locked-in
            minutes within this competition’s start and end dates.
          </Text>
        </Animated.View>
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
    paddingTop: 28,
    paddingBottom: 40,
    gap: 18,
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
    fontSize: 20,
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