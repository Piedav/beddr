import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { deleteUser } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  onSnapshot,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, firestore } from '../firebase';
import { useUser } from './_layout';

const dbgColor = "#0a0513ff";
const bgColor = "#111124ff";
const lbgColor = "#322f4e81";
const l2bgColor = "#322f4eff";
const l3bgColor = "#323150";
const strongColor = "#cc7bdbff";

const warmFontType = "Molengo";
const defFontType = "OpenSansSemiBold";

interface UserProfile {
  name?: string;
  totalLockedMinutes?: number;
  thisWeekLockedMinutes?: number;
}

type WinType = 'number' | 'percentage' | 'team';

interface Competition {
  id: string;
  name: string;
  start: number;
  end: number;
  reward?: string;
  winType?: WinType;
  winVal?: number;
  players: Record<string, { points?: number; joinedAt?: any; name?: string }>;
}

type LeaderboardEntry = {
  uid: string;
  name: string;
  points: number;
  rank: number;
  isUser: boolean;
  isWinner: boolean;
};

function getRankedLeaderboard(
  players: Record<string, { points?: number; joinedAt?: any; name?: string }> | undefined,
  winType: WinType | undefined,
  winVal: number | undefined,
  myUid?: string
): LeaderboardEntry[] {
  const entries = Object.entries(players ?? {}).map(([uid, pdata]) => ({
    uid,
    name: uid === myUid ? 'You' : pdata.name ?? 'Player',
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
}
interface ResetButtonProps {
  style?: any;
  buttonStyle?: any;
  textStyle?: any;
  showIcon?: boolean;
  title?: string;
}

const ResetButton: React.FC<ResetButtonProps> = ({
  style,
  buttonStyle,
  textStyle,
  showIcon = true,
  title = "Reset App"
}) => {
  const { resetToOnboarding, userData } = useUser();

  const handleReset = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              if (userData?.uid) {
                const profileRef = doc(firestore, 'profiledb', userData.uid);

                await updateDoc(profileRef, {
                  lockedEvents: arrayUnion({
                    timestamp: Date.now(),
                    lockedIn: false,
                  }),
                });
              }
            } catch (error) {
              console.error('Failed to record logout lock-out event:', error);
            } finally {
              resetToOnboarding();
            }
          },
        },
      ]
    );
  };

  return (
    <View style={[resetStyles.container, style]}>
      <TouchableOpacity
        style={[resetStyles.resetButton, buttonStyle]}
        onPress={handleReset}
      >
        {showIcon && (
          <Ionicons name="log-out" size={20} color="rgb(255, 255, 255)" />
        )}
        <Text style={[resetStyles.resetText, textStyle]}>{title}</Text>
      </TouchableOpacity>
    </View>
  );
};


function getCompetitionStatus(start: number, end: number): 'ongoing' | 'upcoming' | 'finished' {
  const now = Date.now();
  if (now < start) return 'upcoming';
  if (now > end) return 'finished';
  return 'ongoing';
}

function formatDateRange(startMs: number, endMs: number) {
  const start = new Date(startMs);
  const end = new Date(endMs);

  const startFormatted = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const endFormatted = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return `${startFormatted} - ${endFormatted}`;
}



export default function ProfileScreen() {
  const { userData, setUserData, resetToOnboarding } = useUser();

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isLoadingCompetitions, setIsLoadingCompetitions] = useState(true);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const titleAnimation = useRef(new Animated.Value(0)).current;
  const statsAnimation = useRef(new Animated.Value(0)).current;
  const competitionsAnimation = useRef(new Animated.Value(0)).current;
  const resetButtonAnimation = useRef(new Animated.Value(0)).current;
  const nameEditorAnimation = useRef(new Animated.Value(0)).current;
  const competitionAnimations = useRef<Animated.Value[]>([]).current;

  const [hasInitialized, setHasInitialized] = useState(false);

  const [scrollY, setScrollY] = useState(0);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  const showBottomFade =
    contentHeight > layoutHeight &&
    scrollY + layoutHeight < contentHeight - 8;

  useEffect(() => {
    if (!userData?.uid) return;

    const userDocRef = doc(firestore, 'profiledb', userData.uid);

    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data() as UserProfile;
          setUserProfile(data);
          setNameInput(data?.name || userData?.name || '');
        } else {
          setUserProfile(null);
          setNameInput(userData?.name || '');
        }
        setIsLoadingProfile(false);
      },
      (error) => {
        console.error('Error fetching user profile:', error);
        setIsLoadingProfile(false);
      }
    );

    return unsubscribe;
  }, [userData?.uid]);

  useEffect(() => {
    if (!userData?.uid) return;

    const competitionsRef = collection(firestore, 'competitiondb');

    const unsubscribe = onSnapshot(
      competitionsRef,
      (snapshot) => {
        const comps: Competition[] = [];

        snapshot.forEach((docSnap) => {
          const cur = docSnap.data() as any;
          if (!cur?.start || !cur?.end || !cur?.players || typeof cur.players !== 'object') return;

          comps.push({
            id: docSnap.id,
            name: cur.name ?? 'Untitled Competition',
            start: cur.start,
            end: cur.end,
            reward: cur.reward,
            winType: cur.winType,
            winVal: cur.winVal,
            players: cur.players,
          });
        });

        setCompetitions(comps);
        setIsLoadingCompetitions(false);
      },
      (error) => {
        console.error('Error fetching competitions:', error);
        setIsLoadingCompetitions(false);
      }
    );

    return unsubscribe;
  }, [userData?.uid]);

  const finishedCompetitions = useMemo(() => {
    if (!userData?.uid) return [];

    return competitions
      .filter((comp) => {
        const joined = !!comp.players?.[userData.uid];
        return joined && getCompetitionStatus(comp.start, comp.end) === 'finished';
      })
      .map((comp) => {
        const leaderboard = getRankedLeaderboard(
          comp.players,
          comp.winType,
          comp.winVal,
          userData.uid
        );

        const myEntry = leaderboard.find((entry) => entry.uid === userData.uid);

        return {
          id: comp.id,
          name: comp.name,
          start: comp.start,
          end: comp.end,
          points: comp.players?.[userData.uid]?.points ?? 0,
          rank: myEntry?.rank ?? 0,
          totalPlayers: Object.keys(comp.players || {}).length,
          reward: comp.reward,
          winType: comp.winType,
          winVal: comp.winVal,
          isWinner: myEntry?.isWinner ?? false,
        };
      })
      .sort((a, b) => b.end - a.end);
  }, [competitions, userData?.uid]);

  useEffect(() => {
    competitionAnimations.length = 0;
    finishedCompetitions.forEach(() => {
      competitionAnimations.push(new Animated.Value(0));
    });
  }, [finishedCompetitions.length]);

  const stats = useMemo(() => {
    const totalCompetitions = finishedCompetitions.length;

    const bestRank =
      totalCompetitions > 0
        ? Math.min(...finishedCompetitions.map((c) => c.rank))
        : null;

    const wins = finishedCompetitions.filter((c) => c.isWinner).length;

    const winRate =
      totalCompetitions > 0
        ? Math.round((wins / totalCompetitions) * 100)
        : 0;

    const avgRank =
      totalCompetitions > 0
        ? (
            finishedCompetitions.reduce((sum, c) => sum + c.rank, 0) / totalCompetitions
          ).toFixed(1)
        : null;

    const totalCompetitionPoints = finishedCompetitions.reduce(
      (sum, c) => sum + c.points,
      0
    );

    return {
      totalCompetitions,
      bestRank,
      wins,
      winRate,
      avgRank,
      totalCompetitionPoints,
    };
  }, [finishedCompetitions]);

  const startAnimations = () => {
    titleAnimation.setValue(0);
    statsAnimation.setValue(0);
    nameEditorAnimation.setValue(0);
    competitionsAnimation.setValue(0);
    resetButtonAnimation.setValue(0);
    competitionAnimations.forEach((anim) => anim.setValue(0));

    setHasInitialized(true);

    const animationDuration = 220;
    const staggerDelay = 90;

    Animated.timing(titleAnimation, {
      toValue: 1,
      duration: animationDuration,
      useNativeDriver: true,
    }).start();

    setTimeout(() => {
      Animated.timing(nameEditorAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay);

    setTimeout(() => {
      Animated.timing(statsAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay * 2);

    setTimeout(() => {
      Animated.timing(resetButtonAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay * 3);

    setTimeout(() => {
      Animated.timing(competitionsAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();

      competitionAnimations.forEach((anim, index) => {
        setTimeout(() => {
          Animated.timing(anim, {
            toValue: 1,
            duration: animationDuration,
            useNativeDriver: true,
          }).start();
        }, 70 * index);
      });
    }, staggerDelay * 4);
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
    if (!isLoadingProfile && !isLoadingCompetitions && userData) {
      setTimeout(() => startAnimations(), 100);
    }
  }, [isLoadingProfile, isLoadingCompetitions, userData, finishedCompetitions.length]);

  useFocusEffect(
    React.useCallback(() => {
      if (!isLoadingProfile && !isLoadingCompetitions && userData) {
        setHasInitialized(false);
        setTimeout(() => startAnimations(), 50);
      }
    }, [isLoadingProfile, isLoadingCompetitions, userData, finishedCompetitions.length])
  );

  const saveName = async () => {
    const trimmed = nameInput.trim();

    if (!userData?.uid) return;

    if (!trimmed) {
      Alert.alert('Invalid name', 'Please enter a name.');
      return;
    }

    if (trimmed.length > 30) {
      Alert.alert('Name too long', 'Please keep your name under 30 characters.');
      return;
    }

    setIsSavingName(true);

    try {
      await updateDoc(doc(firestore, 'profiledb', userData.uid), {
        name: trimmed,
      });

      if (setUserData) {
        setUserData({
          ...userData,
          name: trimmed,
        });
      }

      setIsEditingName(false);
    } catch (error) {
      console.error('Failed to update name:', error);
      Alert.alert('Error', 'Could not update your name.');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This will permanently delete your account, profile, and competition data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!userData?.uid) return;

            const currentUser = auth.currentUser;

            if (!currentUser) {
              Alert.alert('Error', 'No signed-in user found.');
              return;
            }

            setIsDeletingAccount(true);

            try {
              const uid = userData.uid;
              setUserProfile(null);
              setCompetitions([]);
              const batch = writeBatch(firestore);

              competitions.forEach((comp) => {
                if (comp.players?.[uid]) {
                  batch.update(doc(firestore, 'competitiondb', comp.id), {
                    [`players.${uid}`]: deleteField(),
                  });
                }
              });

              batch.delete(doc(firestore, 'profiledb', uid));

              await batch.commit();

              await deleteUser(currentUser);
              await AsyncStorage.multiRemove(['userData', 'hasCompletedOnboarding']);

              setUserData?.(null as any);
              resetToOnboarding();
            } catch (error: any) {
              console.error('Failed to delete account:', error);

              if (error?.code === 'auth/requires-recent-login') {
                Alert.alert(
                  'Please log in again',
                  'For security, log out, log back in, then try deleting your account again.'
                );
              } else {
                Alert.alert('Error', 'Could not delete your account. Please try again.');
              }
              if (!auth.currentUser) {
                resetToOnboarding();
              }
            } finally {
              setIsDeletingAccount(false);
            }
          },
        },
      ]
    );
  };
  if (isLoadingProfile || isLoadingCompetitions || !userData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="person" size={48} color={strongColor} />
          <Text style={styles.loadingText}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const displayName = userProfile?.name || userData?.name || 'User';

  return (
    <SafeAreaView style={styles.container}>
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
              <Animated.View style={getAnimatedStyle(titleAnimation)}>
                <Text style={styles.title}>
                  <Text style={styles.username}>{displayName}</Text>
                  <Text style={styles.username}>'s</Text> Profile
                </Text>
              </Animated.View>

              <Animated.View style={[getAnimatedStyle(nameEditorAnimation), styles.nameEditorCard]}>
                <Text style={styles.sectionMiniTitle}>Display Name: {displayName}</Text>

                {isEditingName ? (
                  <>
                    <TextInput
                      value={nameInput}
                      onChangeText={setNameInput}
                      placeholder="Enter your name"
                      placeholderTextColor="#8A8A8A"
                      style={styles.nameInput}
                      maxLength={30}
                    />

                    <View style={styles.nameButtonRow}>
                      <TouchableOpacity
                        style={[styles.smallButton, styles.cancelButton]}
                        onPress={() => {
                          setNameInput(displayName);
                          setIsEditingName(false);
                        }}
                        disabled={isSavingName}
                      >
                        <Text style={styles.smallButtonText}>Cancel</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.smallButton, styles.saveButton]}
                        onPress={saveName}
                        disabled={isSavingName}
                      >
                        <Text style={styles.smallButtonText}>
                          {isSavingName ? 'Saving...' : 'Save Name'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <TouchableOpacity
                    style={styles.editNameButton}
                    onPress={() => setIsEditingName(true)}
                  >
                    <Ionicons name="create-outline" size={18} color={strongColor} />
                    <Text style={styles.editNameText}>Edit Name</Text>
                  </TouchableOpacity>
                )}
              </Animated.View>

              <Animated.View style={[getAnimatedStyle(statsAnimation), styles.statsContainer]}>
                <View style={styles.statCard}>
                  <View style={styles.iconContainer}>
                    <Ionicons name="trophy" size={28} color={strongColor} />
                  </View>
                  <Text style={styles.statValue}>{stats.totalCompetitions}</Text>
                  <Text style={styles.statLabel}>Finished Competitions</Text>
                </View>

                <View style={styles.statCard}>
                  <View style={styles.iconContainer}>
                    <Ionicons name="medal-outline" size={28} color={strongColor} />
                  </View>
                  <Text style={styles.statValue}>{stats.wins}</Text>
                  <Text style={styles.statLabel}>Wins</Text>          
                </View>
              </Animated.View>

              <Animated.View style={[getAnimatedStyle(statsAnimation), styles.statsContainer]}>
                <View style={styles.statCard}>
                  <View style={styles.iconContainer}>
                    <Ionicons name="bar-chart" size={28} color={strongColor} />
                  </View>
                  <Text style={styles.statValue}>{stats.avgRank ?? 'N/A'}</Text>
                  <Text style={styles.statLabel}>Average Rank</Text>
                </View>

                <View style={styles.statCard}>
                  <View style={styles.iconContainer}>
                    <Ionicons name="star" size={28} color={strongColor} />
                  </View>
                  <Text style={styles.statValue}>{stats.totalCompetitionPoints}</Text>
                  <Text style={styles.statLabel}>Total Finished Competition Points</Text>
                </View>
              </Animated.View>
              
              <Animated.View style={[getAnimatedStyle(resetButtonAnimation), styles.linksContainer]}>
                <Text style={styles.sectionMiniTitle}>Help & Legal</Text>

                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => Linking.openURL('https://www.davidmao.net/beddr/privacy')}
                >
                  <Ionicons name="shield-checkmark-outline" size={20} color={strongColor} />
                  <Text style={styles.linkRowText}>Privacy Policy</Text>
                  <Ionicons name="chevron-forward" size={18} color="#A0A0B8" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => Linking.openURL('https://www.davidmao.net/beddr/terms')}
                >
                  <Ionicons name="document-text-outline" size={20} color={strongColor} />
                  <Text style={styles.linkRowText}>Terms of Service</Text>
                  <Ionicons name="chevron-forward" size={18} color="#A0A0B8" />
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.linkRow}
                  onPress={() => Linking.openURL('https://www.davidmao.net/beddr/support')}
                >
                  <Ionicons name="help-circle-outline" size={20} color={strongColor} />
                  <Text style={styles.linkRowText}>Support</Text>
                  <Ionicons name="chevron-forward" size={18} color="#A0A0B8" />
                </TouchableOpacity>
              </Animated.View>

              <Animated.View style={[getAnimatedStyle(resetButtonAnimation), styles.resetContainer]}>
                <ResetButton title="Logout" style={{ marginBottom: 8 }} />
                
              </Animated.View>

              <Animated.View style={getAnimatedStyle(competitionsAnimation)}>
                <View style={styles.competitionsSection}>
                  <Text style={styles.sectionTitle}>Past Competitions</Text>

                  {finishedCompetitions.length > 0 ? (
                    finishedCompetitions.map((competition, index) => (
                      <Animated.View
                        key={competition.id}
                        style={[
                          styles.competitionCard,
                          getAnimatedStyle(
                            competitionAnimations[index] || new Animated.Value(1)
                          ),
                        ]}
                      >
                        <View style={styles.competitionHeader}>
                          <Text style={styles.competitionWeek}>{competition.name}</Text>
                          <Text style={styles.competitionRank}>
                            Rank #{competition.rank} / {competition.totalPlayers}
                          </Text>
                        </View>

                        <Text style={styles.competitionDate}>
                          {formatDateRange(competition.start, competition.end)}
                        </Text>

                        <View style={styles.competitionFooter}>
                          <Text style={styles.competitionPoints}>
                            Points: {competition.points}
                          </Text>

                          <View
                            style={[
                              styles.statusBadge,
                              competition.isWinner
                                ? { backgroundColor: 'rgba(16, 185, 129, 0.15)' }
                                : { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
                            ]}
                          >
                            <Ionicons
                              name={competition.isWinner ? 'trophy' : 'close-circle'}
                              size={16}
                              color={competition.isWinner ? '#10B981' : '#EF4444'}
                            />
                            <Text
                              style={[
                                styles.statusText,
                                { color: competition.isWinner ? '#10B981' : '#EF4444' },
                              ]}
                            >
                              {competition.isWinner ? 'Won' : 'Lost'}
                            </Text>
                          </View>
                        </View>
                      </Animated.View>
                    ))
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons name="trophy-outline" size={48} color="#666666" />
                      <Text style={styles.emptyStateText}>No finished competitions yet</Text>
                      <Text style={styles.emptyStateSubtext}>
                        Once you finish a competition, it will show up here.
                      </Text>
                    </View>
                  )}
                </View>
              </Animated.View>

              <View style={resetStyles.container}>
                <TouchableOpacity
                  style={resetStyles.deleteButton}
                  onPress={handleDeleteAccount}
                  disabled={isDeletingAccount}
                >
                  <Ionicons name="trash-outline" size={20} color="#FF4444" />
                  <Text style={[resetStyles.resetText, {color: "#FF4444"}]}>
                    {isDeletingAccount ? 'Deleting...' : 'Delete Account'}
                  </Text>
                </TouchableOpacity>
              </View>
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
        style={styles.bottomFade}
      />
    )}
    </SafeAreaView>
  );
}

const resetStyles = StyleSheet.create({
  deleteButton: {
    
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: bgColor,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF4444',
    gap: 8,
  },
  container: {
    alignItems: 'center',
    marginVertical: 10,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: bgColor,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffffff',
    gap: 8,
  },
  resetText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: defFontType,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: bgColor,
  },
  bottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 110,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 16,
    fontFamily: defFontType,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingTop: 40,
    paddingBottom: 40,
  },
  title: {
    fontSize: 36,
    fontWeight: '300',
    color: '#FFFFFF',
    marginBottom: 24,
    textAlign: 'center',
    fontFamily: warmFontType,
  },
  username: {
    fontWeight: '600',
    color: strongColor,
    fontFamily: warmFontType,
  },
  nameEditorCard: {
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  sectionMiniTitle: {
    fontSize: 14,
    color: '#B0B0B0',
    marginBottom: 12,
    fontFamily: defFontType,
  },
  nameInput: {
    backgroundColor: l2bgColor,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: defFontType,
    borderWidth: 1,
    borderColor: strongColor,
  },
  nameButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    gap: 10,
  },
  smallButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelButton: {
    backgroundColor: '#2A2A2A',
  },
  saveButton: {
    backgroundColor: strongColor,
  },
  smallButtonText: {
    color: '#FFFFFF',
    fontFamily: defFontType,
    fontSize: 14,
    fontWeight: '600',
  },
  editNameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
  },
  editNameText: {
    color: strongColor,
    fontFamily: defFontType,
    fontSize: 15,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  statCard: {
    flex: 1,
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginHorizontal: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    fontFamily: defFontType,
  },
  statLabel: {
    fontSize: 12,
    color: '#B0B0B0',
    textAlign: 'center',
    fontFamily: defFontType,
  },
  competitionsSection: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 16,
    fontFamily: defFontType,
  },
  competitionCard: {
    backgroundColor: lbgColor,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  competitionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 12,
  },
  competitionWeek: {
    flex: 1,
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '600',
    fontFamily: defFontType,
  },
  competitionRank: {
    fontSize: 14,
    color: '#B0B0B0',
    fontFamily: defFontType,
  },
  competitionDate: {
    fontSize: 13,
    color: '#9B9B9B',
    marginBottom: 12,
    fontFamily: defFontType,
  },
  competitionPoints: {
    fontSize: 15,
    color: '#FFFFFF',
    fontFamily: defFontType,
  },
  competitionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
    color: strongColor,
    fontFamily: defFontType,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
    fontFamily: defFontType,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#B0B0B0',
    textAlign: 'center',
    fontFamily: defFontType,
  },
  resetContainer: {
    marginTop: 10,
    marginBottom: 30,
  },
  linksContainer: {
    backgroundColor: lbgColor,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },

  linkRowText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: defFontType,
    marginLeft: 12,
  },
});