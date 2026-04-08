import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { collection, doc, onSnapshot, query, updateDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { firestore as db } from '../firebase';
import { useUser } from './_layout';

const dbgColor = "#0a0513ff"; //dark background
const bgColor = "#111124ff"; //background
const lbgColor = "#322f4e81"; //light background
const l2bgColor = "#322f4eff"; //2nd light background
const l3bgColor = "#323150";
const strongColor = "#cc7bdbff"; //strong color

const warmFontType = "Molengo";
const defFontType = "OpenSansSemiBold";

export default function CompetitionScreen() {
  const {userData} = useUser();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [competitionData, setCompetitionData] = useState(null);
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasJoinedCompetition, setHasJoinedCompetition] = useState(false);
  const [currentCompetitionId, setCurrentCompetitionId] = useState(null);
  const [allCompetitions, setAllCompetitions] = useState({});
  const scrollViewRef = React.useRef(null);
  
  const firestore = db;

  const [currentRank, setCurrentRank] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [currentPoints, setCurrentPoints] = useState(0);
  const [projectedEarnings, setProjectedEarnings] = useState(0);
  const [weeklyProgress, setWeeklyProgress] = useState([]);
  const [cutoffPoints, setCutoffPoints] = useState(0);
  const [actualWinners, setActualWinners] = useState(0);
  const [rewardInfo, setRewardInfo] = useState({
    isMonetary: true,
    value: '5.00',
    description: 'Cash prize'
  });

  const [compStartDate, setCompStartDate] = useState<string>('');
  const [compEndDate, setCompEndDate] = useState<string>('');
  const [sleepTimesMap, setSleepTimesMap] = useState<Record<string, number>>({});

  const [name, setName] = useState("");
  const route = useRoute<any>();
  const routedCompetitionId: string | undefined = route.params?.competitionId;
  // Animation references - start at 0 to prevent flash
  const titleAnimation = useRef(new Animated.Value(0)).current;
  const statusAnimation = useRef(new Animated.Value(0)).current;
  const progressAnimation = useRef(new Animated.Value(0)).current;
  const toggleAnimation = useRef(new Animated.Value(0)).current;
  const contentAnimation = useRef(new Animated.Value(0)).current;
  
  // Track if this is the initial render to prevent flash
  const [hasInitialized, setHasInitialized] = useState(false);
  
  // Competition parameters
  const ENTRY_FEE = 5;
  const WEIGHT_FACTOR = 0.9;

  // Animation trigger function
  const startAnimations = () => {
    titleAnimation.setValue(0);
    statusAnimation.setValue(0);
    progressAnimation.setValue(0);
    toggleAnimation.setValue(0);
    contentAnimation.setValue(0);

    setHasInitialized(true);

    const animationDuration = 400;
    const staggerDelay = 150;

    Animated.timing(titleAnimation, {
      toValue: 1,
      duration: animationDuration,
      useNativeDriver: true,
    }).start();

    setTimeout(() => {
      Animated.timing(statusAnimation, {
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
      Animated.timing(toggleAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay * 3);

    setTimeout(() => {
      Animated.timing(contentAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay * 4);
  };

  const getAnimatedStyle = (animationValue) => ({
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
  const updateMyPoints = async (competitionId: string, uid: string, points: number) => {
    const compRef = doc(db, "competitiondb", competitionId);

    await updateDoc(compRef, {
      [`players.${uid}.points`]: points,
    });
  };
  const findActiveCompetition = (competitions) => {
    const now = new Date();
    const currentDateStr = now.toISOString().split('T')[0];
    
    for (const [compId, compData] of Object.entries(competitions)) {
      const dates = compData.metadata?.dates || compData.dates;
      
      if (dates && dates.start && dates.end) {
        const startDate = dates.start;
        const endDate = dates.end;
        
        if (currentDateStr >= startDate && currentDateStr <= endDate) {
          return compId;
        }
      }
    }
    
    const sortedComps = Object.entries(competitions)
      .filter(([_, data]) => {
        const dates = data.metadata?.dates || data.dates;
        return dates && dates.end;
      })
      .sort(([_, a], [__, b]) => {
        const datesA = a.metadata?.dates || a.dates;
        const datesB = b.metadata?.dates || b.dates;
        return datesB.end.localeCompare(datesA.end);
      });
    
    return sortedComps.length > 0 ? sortedComps[0][0] : null;
  };
  
  const calculateWeight = (rank, totalWinners) => {
    const i = rank - 1;
    const T = totalWinners;
    
    const denominator = (1 - Math.pow(WEIGHT_FACTOR, T)) / (1 - WEIGHT_FACTOR);
    const weight = Math.pow(WEIGHT_FACTOR, i) / denominator;
    
    return weight;
  };
  
  const calculatePointsFromWeektime = (weekTimeValue) => {
    if (weekTimeValue < 0) return 0;
    
    const fivePM = 17 * 60; //in case they try to sleep overly early
    const ninePM = 21 * 60;
    const threeAM = 3 * 60;
    let timeFromNinePM;
    
    if (weekTimeValue >= ninePM) { //if you are between 9 pm and 12 am
      timeFromNinePM = weekTimeValue - ninePM;
    }
    else if (weekTimeValue >= fivePM) { //if you sleep early, after five PM but before 9 pm
      return 30;
    }
    else { //you are sleeping late
      timeFromNinePM = (24 * 60 - ninePM) + weekTimeValue; //time from 9 pm lol
    }
    
    const totalDuration = 6 * 60;
    
    if (timeFromNinePM <= totalDuration) { //if you are between 9 and 3
      const dayPoints = Math.round(30 * (1 - timeFromNinePM / totalDuration) * 1000) / 1000;
      return Math.max(0, dayPoints); //no negatives
    }
    
    return 0; //bru you slept past 3 am
  };

  const calculatePoints = (dailyMap: Record<string, number> | undefined | null): number => {
  if (!dailyMap) return 0;
  if (!compStartDate || !compEndDate) return 0;

  let totalPoints = 0;
  for (const [date, minutes] of Object.entries(dailyMap)) {
    if (date >= compStartDate && date <= compEndDate) {
      totalPoints += calculatePointsFromWeektime(minutes);
    }
  }
  return totalPoints;
};

  const formatTimeFromMinutes = (weekTimeValue) => {
    if (weekTimeValue < 0) return '--';
    
    const hours = Math.floor(weekTimeValue / 60);
    const minutes = Math.floor(weekTimeValue % 60);
    //return `${hours}`;
    return `${hours === 0 ? 12 : (hours > 12 ? (hours > 24 ? hours-24 : hours - 12) : hours)}:${minutes.toString().padStart(2, '0')} ${(hours >= 12 && hours < 24) ? 'PM' : 'AM'}`;
  };

  const convertWeektimesToProgressData = (weektimes) => {
    if (!weektimes) return [];
    
    const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return weekDays.map((day, index) => {
      const weekTimeValue = weektimes[index];
      const points = calculatePointsFromWeektime(weekTimeValue);
      const lastPutDown = formatTimeFromMinutes(weekTimeValue);
      
      return { day, points, lastPutDown };
    });
  };

  const calculateMedian = (pointsArray) => {
    if (!pointsArray.length) return 0;
    
    const sortedPoints = [...pointsArray].sort((a, b) => a - b);
    const middle = Math.floor(sortedPoints.length / 2);
    
    if (sortedPoints.length % 2 === 0) {
      return (sortedPoints[middle - 1] + sortedPoints[middle]) / 2;
    } else {
      return sortedPoints[middle];
    }
  };

  const formatCompetitionDates = (data) => {
    const dates = data?.metadata?.dates || data?.dates;
    if (!dates || !dates.start || !dates.end) return '';
    
    const startDate = dates.start;
    const endDate = dates.end;
    
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    
    const start = new Date(startYear, startMonth - 1, startDay);
    const end = new Date(endYear, endMonth - 1, endDay);
    
    const startMonthName = start.toLocaleDateString('en-US', { month: 'short' });
    const startDayNum = start.getDate();
    const endMonthName = end.toLocaleDateString('en-US', { month: 'short' });
    const endDayNum = end.getDate();
    
    return `${startMonthName} ${startDayNum} - ${endMonthName} ${endDayNum}`;
  };

  const processLeaderboardWithTies = (leaderboard, totalPlayers, entryFee) => {
    const sortedPlayers = [...leaderboard].sort((a, b) => b.points - a.points);
    
    const pointGroups = [];
    let currentGroup = [];
    let currentPoints = null;
    
    sortedPlayers.forEach(player => {
      if (currentPoints === null || player.points === currentPoints) {
        currentGroup.push(player);
        currentPoints = player.points;
      } else {
        pointGroups.push(currentGroup);
        currentGroup = [player];
        currentPoints = player.points;
      }
    });
    
    if (currentGroup.length > 0) {
      pointGroups.push(currentGroup);
    }
    
    const nominalCutoff = Math.ceil(totalPlayers / 2);
    let actualWinners = 0;
    
    for (let i = 0; i < pointGroups.length; i++) {
      const group = pointGroups[i];
      const groupSize = group.length;
      
      if (actualWinners < nominalCutoff) {
        actualWinners += groupSize;
      } else {
        break;
      }
    }
    
    if (actualWinners === 0 && totalPlayers > 0) {
      actualWinners = pointGroups[0].length;
    }
    
    const actualLosers = totalPlayers - actualWinners;
    const bonusPool = actualLosers * entryFee;
    
    const rankedLeaderboard = [];
    let currentRank = 1;
    let playersProcessed = 0;
    
    pointGroups.forEach(group => {
      const groupRank = currentRank;
      const isWinnerGroup = playersProcessed < actualWinners;
      
      if (isWinnerGroup) {
        const tieRanks = [];
        for (let i = 0; i < group.length; i++) {
          tieRanks.push(groupRank + i);
        }
        
        const tiePayouts = tieRanks.map(rank => {
          if (rank > actualWinners) {
            return entryFee;
          }
          
          const weight = calculateWeight(rank, actualWinners);
          const bonus = weight * bonusPool;
          return entryFee + bonus;
        });
        
        const averagePayout = tiePayouts.reduce((sum, payout) => sum + payout, 0) / tiePayouts.length;
        
        group.forEach(player => {
          rankedLeaderboard.push({
            ...player,
            rank: groupRank,
            earnings: Math.round(averagePayout * 100) / 100
          });
        });
      } else {
        group.forEach(player => {
          rankedLeaderboard.push({
            ...player,
            rank: groupRank,
            earnings: 0
          });
        });
      }
      
      playersProcessed += group.length;
      currentRank += group.length;
    });
    
    return { rankedLeaderboard, actualWinners, actualLosers };
  };

  const processCompetitionData = (data: any, competitionId: string) => {
    setName(data?.name ?? '');

    if (data?.reward === 'money') {
    setRewardInfo({ isMonetary: true, value: ENTRY_FEE.toString(), description: 'Cash prize' });
    } else {
      setRewardInfo({ isMonetary: false, value: '0', description: data?.reward ?? '' });
    }
    setCompetitionData(data);

    const dates = data?.metadata?.dates || data?.dates;
    setCompStartDate(dates?.start ?? "");
    setCompEndDate(dates?.end ?? "");

    const players = data?.players ?? {};

    // joined?
    const mePlayers = data?.players?.[userData.uid];
    const meLegacy  = (data as any)?.[userData.uid]; // old schema

    const userHasJoined = !!mePlayers || !!meLegacy;
    setHasJoinedCompetition(userHasJoined);
    // my points (display)
    if (!userHasJoined) setCurrentPoints(0);

    // leaderboard
    const leaderboard: any[] = [];
    const allPoints: number[] = [];

    for (const [uid, pdata] of Object.entries(players)) {
      const pts = (pdata as any)?.points ?? 0;
      allPoints.push(pts);

      leaderboard.push({
        id: uid,
        name: uid === userData.uid ? "You" : uid,
        points: pts,
        isUser: uid === userData.uid,
      });
    }
    
    let medianPoints;
    if (leaderboard.length === 1) {
      medianPoints = leaderboard[0].points;
    } else {
      medianPoints = calculateMedian(allPoints);
    }
    setCutoffPoints(Math.round(medianPoints));
    
    const entryFee = data?.reward === "money" ? ENTRY_FEE : 0;
    
    const totalPlayers = leaderboard.length;
    const { rankedLeaderboard, actualWinners: calculatedWinners } = 
      processLeaderboardWithTies(leaderboard, totalPlayers, entryFee);

    setLeaderboardData(rankedLeaderboard);
    setTotalUsers(leaderboard.length);
    setActualWinners(calculatedWinners);
    
    const userEntry = rankedLeaderboard.find(player => player.isUser);
    if (userEntry) {
      setCurrentRank(userEntry.rank);
      setProjectedEarnings(userEntry.earnings);
    }
  };
  useEffect(() => {
    if (!userData?.uid) return;
    if (!currentCompetitionId) return;
    if (!compStartDate || !compEndDate) return;
    if (!hasJoinedCompetition) return; // IMPORTANT: don't create players entries for non-joiners

    const pts = calculatePoints(sleepTimesMap);

    // avoid spamming writes if unchanged
    if (pts === currentPoints) return;

    setCurrentPoints(pts);

    updateMyPoints(currentCompetitionId, userData.uid, pts).catch(console.error);
  }, [
    sleepTimesMap,
    compStartDate,
    compEndDate,
    currentCompetitionId,
    userData?.uid,
    hasJoinedCompetition,
    currentPoints,
  ]);
  useEffect(() => {
    if (!userData?.uid) return;

    const profileRef = doc(db, 'profiledb', userData.uid);

    const unsub = onSnapshot(
      profileRef,
      (snap) => {
        const data = snap.data() as any;
        setSleepTimesMap((data?.sleepTimes as Record<string, number>) ?? {});
      },
      (err) => {
        console.error('profile onSnapshot error:', err);
      }
    );

    return () => unsub();
  }, [userData?.uid]);

  useEffect(() => {
    if (!userData?.uid) return;

    const competitionCollectionRef = collection(firestore, 'competitiondb');
    
    const unsubscribe = onSnapshot(query(competitionCollectionRef), (querySnapshot) => {
      const competitions = {};
      
      querySnapshot.forEach((doc) => {
        competitions[doc.id] = doc.data();
      });
      
      setAllCompetitions(competitions);
      
      //use the thingy passed by the listner
      const activeCompId = (routedCompetitionId && competitions[routedCompetitionId]) ? routedCompetitionId : findActiveCompetition(competitions);
      
      if (activeCompId && competitions[activeCompId]) {
        setCurrentCompetitionId(activeCompId);
        processCompetitionData(competitions[activeCompId], activeCompId);
        setLoading(false);
      } else {
        setCurrentCompetitionId(null);
        setCompetitionData(null);
        setHasJoinedCompetition(false);
        setLeaderboardData([]);
        setWeeklyProgress([]);
        setLoading(false);
      }
    }, (error) => {
      console.error('Error fetching competition data:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userData?.uid, firestore, routedCompetitionId]);

  useEffect(() => {
    if (!loading && userData) {
      setTimeout(() => {
        startAnimations();
      }, 100);
    }
  }, [loading, userData]);

  useFocusEffect(
    React.useCallback(() => {
      if (!loading && userData) {
        setHasInitialized(false);
        setTimeout(() => {
          startAnimations();
        }, 50);
      }
    }, [loading, userData])
  );

  const generatePointDistribution = () => {
    if (!leaderboardData.length) return { labels: [], data: [] };
    
    const data = [];
    const labels = [];
    
    for (let i = 0; i <= 210; i += 15) {
      labels.push(i % 30 === 0 ? i.toString() : '');
      
      const usersInRange = leaderboardData.filter(user => 
        user.points >= i && user.points < i + 15
      ).length;
      
      data.push(usersInRange);
    }
    
    return { labels, data };
  };

  const distributionData = generatePointDistribution();
  const screenWidth = Dimensions.get('window').width;

  const CustomBarChart = () => {
    const chartHeight = 180;
    const chartWidth = screenWidth - 80;
    const barWidth = (chartWidth - 40) / 15;
    const maxUsers = Math.max(...distributionData.data, 1);
    
    return (
      <View style={styles.chartWrapper}>
        <View style={[styles.customChartWrapper, { width: screenWidth - 40 }]}>
          <View style={[styles.yAxisContainer, { 
            height: chartHeight + 20 + 30,
          }]}>
            {[0, Math.ceil(maxUsers/4), Math.ceil(maxUsers/2), Math.ceil(3*maxUsers/4), maxUsers].map((value, idx) => (
              <View key={`y-axis-${value}-${idx}`} style={[styles.yAxisLabel, { 
                bottom: 30 + (value / maxUsers) * chartHeight - 8 
              }]}>
                <Text style={styles.yAxisText}>{value}</Text>
              </View>
            ))}
          </View>
          
          <View style={[styles.chartArea, { 
            width: chartWidth,
            height: chartHeight 
          }]}>
            {distributionData.data.map((users, index) => {
              const barHeight = maxUsers > 0 ? (users / maxUsers) * chartHeight : 0;
              const xPosition = index * barWidth + 25;
              
              return (
                <View
                  key={`bar-${index}-${users}`}
                  style={[styles.customBar, {
                    left: xPosition,
                    width: barWidth - 4,
                    height: barHeight,
                  }]}
                />
              );
            })}
            
            {hasJoinedCompetition && actualWinners < leaderboardData.length && (
              <View style={[styles.customIndicatorLine, styles.cutoffLine, {
                left: (cutoffPoints / 15) * barWidth + 20 + (barWidth / 2) - 5,
                height: chartHeight+10,
              }]}>
              </View>
            )}
            
            {hasJoinedCompetition && (
              <View style={[styles.customIndicatorLine, styles.userLine, {
                left: (currentPoints / 15) * barWidth + 20 + (barWidth / 2) - 5,
                height: chartHeight+10,
              }]}>
              </View>
            )}
          </View>
          
          <View style={[styles.xAxisContainer, { 
            width: chartWidth,
          }]}>
            {distributionData.labels.map((label, index) => {
              if (label !== '') {
                return (
                  <View key={`x-axis-${index}-${label}`} style={[styles.xAxisLabel, { 
                    left: index * barWidth + 20 + (barWidth / 2) - 10
                  }]}>
                    <Text style={styles.xAxisText}>{label}</Text>
                  </View>
                );
              }
              return null;
            })}
          </View>
          
          <View style={styles.legendContainer}>
            {hasJoinedCompetition ? (
              <>
                <View style={styles.legendItem}>
                  <View style={[styles.legendColor, styles.userLegendColor]} />
                  <Text style={styles.legendText}>Your Position ({currentPoints} pts)</Text>
                </View>
                {leaderboardData.length > 1 && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendColor, styles.cutoffLegendColor]} />
                    <Text style={styles.legendText}>50% Cutoff ({cutoffPoints} pts)</Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.legendItem}>
                <Text style={styles.legendText}>Join the competition to see your position</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const getTodayIndex = () => {
    return new Date().getDay();
  };

  const handleScroll = (event) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    setScrollPosition(contentOffset.x);
    setScrollViewWidth(layoutMeasurement.width);
    setContentWidth(contentSize.width);
  };

  const handleContentSizeChange = (contentWidth, contentHeight) => {
    setContentWidth(contentWidth);
  };

  const handleLayout = (event) => {
    setScrollViewWidth(event.nativeEvent.layout.width);
  };

  const canScrollLeft = scrollPosition > 5;
  const canScrollRight = scrollViewWidth > 0 && contentWidth > 0 && scrollPosition < (contentWidth - scrollViewWidth - 5);

  const scrollLeft = () => {
    const newPosition = Math.max(0, scrollPosition - 200);
    scrollViewRef.current?.scrollTo({ x: newPosition, animated: true });
  };

  const scrollRight = () => {
    const maxScroll = contentWidth - scrollViewWidth;
    const newPosition = Math.min(maxScroll, scrollPosition + 200);
    scrollViewRef.current?.scrollTo({ x: newPosition, animated: true });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.content, { justifyContent: 'center', alignItems: 'center', flex: 1 }]}>
          <Text style={styles.loadingText}>Loading competition data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentCompetitionId || !competitionData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.content, { justifyContent: 'center', alignItems: 'center', flex: 1 }]}>
          <Ionicons name="trophy-outline" size={64} color="#666" />
          <Text style={styles.noCompetitionTitle}>No Active Competition</Text>
          <Text style={styles.noCompetitionSubtext}>There are currently no ongoing competitions</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {hasInitialized && (
            <>
              <Animated.View style={getAnimatedStyle(titleAnimation)}>
                <Text style={styles.title}>{name}</Text>
                {currentCompetitionId && (
                  <Text style={styles.competitionSubtitle}>
                    {formatCompetitionDates(competitionData)}
                  </Text>
                )}
                <Text style={styles.competitionSubtitle}>
                  Reward: {rewardInfo.isMonetary 
                    ? ` $${(parseFloat(rewardInfo.value) * totalUsers).toFixed(2)}` 
                    : rewardInfo.description}
                </Text>
              </Animated.View>
              
              <Animated.View style={getAnimatedStyle(statusAnimation)}>
                {!hasJoinedCompetition ? (
                  <View style={styles.notJoinedContainer}>
                    <View style={styles.notJoinedCard}>
                      <Ionicons name="information-circle" size={48} color={strongColor} />
                      <Text style={styles.notJoinedTitle}>You have not joined this competition</Text>
                      <Text style={styles.notJoinedSubtitle}>Start tracking your sleep to participate</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.statusContainer}>
                    <View style={styles.statusCard}>
                      <View style={styles.iconContainer}>
                        <Ionicons name="trophy" size={24} color={strongColor} />
                      </View>
                      <Text style={styles.rankText}>#{currentRank}</Text>
                      <Text style={styles.statusLabel}>Your Rank</Text>
                      <Text style={styles.statusLabel}>out of {totalUsers.toLocaleString()}</Text>
                    </View>
                    
                    <View style={styles.statusCard}>
                      <View style={styles.iconContainer}>
                        <Ionicons name="star" size={24} color={strongColor} />
                      </View>
                      <Text style={styles.pointsText}>{currentPoints}</Text>
                      <Text style={styles.statusLabel}>Points</Text>
                    </View>
                    
                    <View style={styles.statusCard}>
                      <View style={styles.iconContainer}>
                        <Ionicons 
                          name={rewardInfo.isMonetary ? "cash" : "trophy"} 
                          size={24} 
                          color={strongColor}
                        />
                      </View>
                      <Text style={styles.earningsText}>
                        {rewardInfo.isMonetary 
                          ? `$${(projectedEarnings-5).toFixed(2)}` 
                          : (currentRank <= actualWinners ? '✓' : '✗')}
                      </Text>
                      <Text style={styles.statusLabel}>
                        {rewardInfo.isMonetary ? 'Projected' : 'Winner'}
                      </Text>
                    </View>
                  </View>
                )}
              </Animated.View>

              
              
              <Animated.View style={getAnimatedStyle(toggleAnimation)}>
                <View style={styles.toggleContainer}>
                  <TouchableOpacity 
                    style={[styles.toggleButton, !showLeaderboard && styles.activeToggle]}
                    onPress={() => setShowLeaderboard(false)}
                  >
                    <Ionicons name="bar-chart" size={20} color={!showLeaderboard ? "#FFFFFF" : "#B0B0B0"} />
                    <Text style={[styles.toggleText, !showLeaderboard && styles.activeToggleText]}>
                      Distribution
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.toggleButton, showLeaderboard && styles.activeToggle]}
                    onPress={() => setShowLeaderboard(true)}
                  >
                    <Ionicons name="list" size={20} color={showLeaderboard ? "#FFFFFF" : "#B0B0B0"} />
                    <Text style={[styles.toggleText, showLeaderboard && styles.activeToggleText]}>
                      Leaderboard
                    </Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
              
              <Animated.View style={getAnimatedStyle(contentAnimation)}>
                {!showLeaderboard ? (
                  <View style={styles.chartContainer}>
                    <Text style={styles.sectionTitle}>Point Distribution</Text>
                    {leaderboardData.length === 0 ? (
                      <View style={styles.noDataContainer}>
                        <Ionicons name="bar-chart-outline" size={48} color="#666" />
                        <Text style={styles.noDataText}>No competition data available yet</Text>
                        <Text style={styles.noDataSubtext}>Check back when participants join</Text>
                      </View>
                    ) : (
                      <CustomBarChart />
                    )}
                  </View>
                ) : (
                  <View style={styles.leaderboardContainer}>
                    <Text style={styles.sectionTitle}>Leaderboard</Text>
                    {leaderboardData.length === 0 ? (
                      <View style={styles.noDataContainer}>
                        <Ionicons name="list-outline" size={48} color="#666" />
                        <Text style={styles.noDataText}>No competition data available yet</Text>
                        <Text style={styles.noDataSubtext}>Check back when participants join</Text>
                      </View>
                    ) : (
                      <>
                      {leaderboardData.map((player, index) => {
                        const isWinner = player.rank <= actualWinners;
                        const isFirstLoser = !isWinner && index > 0 && leaderboardData[index - 1].rank <= actualWinners;
                        
                        return (
                          <React.Fragment key={player.id}>
                            {isFirstLoser && actualWinners < leaderboardData.length && (
                              <View style={styles.cutoffSeparator}>
                                <View style={styles.cutoffLineLeft} />
                                <View style={styles.cutoffLabelContainer}>
                                  <Text style={styles.cutoffLabel}>CUTOFF</Text>
                                </View>
                                <View style={styles.cutoffLineRight} />
                              </View>
                            )}
                            
                            <View style={[
                              styles.leaderboardItem,
                              player.isUser && isWinner && styles.userWinnerItem,
                              player.isUser && !isWinner && styles.userLoserItem,
                              !player.isUser && !isWinner && styles.loserItem
                            ]}>
                                <View style={styles.leaderboardLeft}>
                                  <Text style={[
                                    styles.leaderboardRank,
                                    player.isUser && isWinner && styles.userWinnerText,
                                    player.isUser && !isWinner && styles.userLoserText
                                  ]}>#{player.rank}</Text>
                                  <Text style={[
                                    styles.leaderboardName,
                                    player.isUser && isWinner && styles.userWinnerText,
                                    player.isUser && !isWinner && styles.userLoserText
                                  ]}>{player.name}</Text>
                                </View>
                                
                                <View style={styles.leaderboardCenter}>
                                  <Text style={[
                                    styles.leaderboardPoints,
                                    player.isUser && isWinner && styles.userWinnerText,
                                    player.isUser && !isWinner && styles.userLoserText
                                  ]}>{player.points} pts</Text>
                                </View>
                                
                                <Text style={[
                                  styles.leaderboardEarnings,
                                  !rewardInfo.isMonetary && isWinner && styles.winnerReward,
                                  player.earnings < parseFloat(rewardInfo.value) && rewardInfo.isMonetary && styles.noEarnings
                                ]}>
                                  {rewardInfo.isMonetary 
                                    ? `${(player.earnings-5).toFixed(2)}` 
                                    : (isWinner ? '✓' : '--')}
                                </Text>
                              </View>
                            </React.Fragment>
                          );
                        })}
                      </>
                    )}
                  </View>
                )}
              </Animated.View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: bgColor,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingTop: 40,
  },
  title: {
    fontSize: 40,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: warmFontType
  },
  competitionSubtitle: {
    fontSize: 20,
    color: strongColor,
    textAlign: 'center',
    marginBottom: 15,
    fontWeight: '500',
    fontFamily: defFontType
  },
  loadingText: {
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  noCompetitionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: defFontType
  },
  noCompetitionSubtext: {
    fontSize: 16,
    color: '#B0B0B0',
    textAlign: 'center',
  },
  statusBanner: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    color: strongColor,
    fontWeight: '600',
    textTransform: 'capitalize',
    fontFamily: defFontType
  },
  notJoinedContainer: {
    marginBottom: 30,
  },
  notJoinedCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#333',
  },
  notJoinedTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: defFontType
  },
  notJoinedSubtitle: {
    fontSize: 14,
    color: '#B0B0B0',
    textAlign: 'center',
    fontFamily: defFontType
  },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  statusCard: {
    flex: 1,
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    minWidth: 0,
    maxWidth: '33%',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  rankText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    fontFamily: defFontType
  },
  pointsText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    fontFamily: defFontType
  },
  earningsText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
    fontFamily: defFontType
  },
  statusLabel: {
    fontSize: 12,
    color: '#B0B0B0',
    textAlign: 'center',
    fontFamily: defFontType
  },
  subText: {
    fontSize: 10,
    color: '#666',
    textAlign: 'center',
    fontFamily: defFontType
  },
  weeklyProgressContainer: {
    marginBottom: 30,
  },
  notJoinedProgressCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#333',
  },
  notJoinedProgressText: {
    fontSize: 16,
    color: '#B0B0B0',
    textAlign: 'center',
    fontFamily: defFontType
  },
  weeklyProgressWrapper: {
    backgroundColor: dbgColor,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    position: 'relative',
  },
  weeklyScrollView: {
    marginHorizontal: -4,
  },
  weeklyProgressRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
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
    fontFamily: defFontType
  },
  incompleteDayLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B0B0B0',
    marginBottom: 8,
    fontFamily: defFontType
  },
  todayText: {
    color: strongColor,
    fontFamily: defFontType
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
    fontFamily: defFontType
  },
  incompleteDayPoints: {
    color: '#666',
    fontFamily: defFontType
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
    fontFamily: defFontType
  },
  incompleteTime: {
    color: '#666',
    fontFamily: defFontType
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
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 16,
    fontFamily: defFontType
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: lbgColor,
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  activeToggle: {
    backgroundColor: strongColor,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B0B0B0',
    marginLeft: 6,
    fontFamily: defFontType
  },
  activeToggleText: {
    color: '#FFFFFF',
    fontFamily: defFontType
  },
  chartContainer: {
    marginBottom: 20,
  },
  noDataContainer: {
    backgroundColor: dbgColor,
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    marginTop: 8,
  },
  noDataText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: defFontType
  },
  noDataSubtext: {
    fontSize: 14,
    color: '#B0B0B0',
    textAlign: 'center',
    fontFamily: defFontType
  },
  chartWrapper: {
    marginTop: 8,
    alignItems: 'center',
  },
  customChartWrapper: {
    position: 'relative',
    backgroundColor: lbgColor,
    borderRadius: 16,
    paddingVertical: 20,
  },
  yAxisContainer: {
    position: 'absolute',
    top: 20,
    left: 18,
  },
  yAxisLabel: {
    position: 'absolute',
    right: -20,
  },
  yAxisText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: defFontType
  },
  chartArea: {
    position: 'relative',
    marginLeft: 30,
    marginTop: 20,
    marginBottom: 30,
  },
  customBar: {
    position: 'absolute',
    borderRadius: 2,
    bottom: 0,
    backgroundColor: strongColor,
  },
  customIndicatorLine: {
    position: 'absolute',
    width: 2,
    zIndex: 10,
    bottom: 0,
  },
  userLine: {
    backgroundColor: '#10B981',
  },
  cutoffLine: {
    backgroundColor: '#EF4444',
  },
  xAxisContainer: {
    position: 'relative',
    height: 20,
    marginLeft: 22,
    marginTop: 0,
  },
  xAxisLabel: {
    position: 'absolute',
    bottom: 21,
  },
  xAxisText: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 12,
    textAlign: 'center',
    width: 30,
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 4,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendColor: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginRight: 6,
  },
  userLegendColor: {
    backgroundColor: '#10B981',
  },
  cutoffLegendColor: {
    backgroundColor: '#EF4444',
  },
  legendText: {
    fontSize: 12,
    color: '#B0B0B0',
    fontFamily: defFontType
  },
  leaderboardContainer: {
    marginBottom: 20,
  },
  leaderboardItem: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userWinnerItem: {
    backgroundColor: '#0A4A2A',
    borderWidth: 2,
    borderColor: '#10B981',
  },
  userLoserItem: {
    backgroundColor: '#4A0A0A',
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  loserItem: {
    backgroundColor: '#3A1A1A',
  },
  cutoffSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    marginHorizontal: 8,
  },
  cutoffLineLeft: {
    flex: 1,
    height: 1,
    backgroundColor: '#EF4444',
  },
  cutoffLineRight: {
    flex: 1,
    height: 1,
    backgroundColor: '#EF4444',
  },
  cutoffLabelContainer: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginHorizontal: 8,
  },
  cutoffLabel: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  leaderboardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  leaderboardRank: {
    fontFamily: defFontType,
    fontSize: 16,
    fontWeight: '700',
    color: strongColor,
    width: 30,
  },
  leaderboardName: {
    fontSize: 16,
    fontFamily: defFontType,
    color: '#FFFFFF',
    marginLeft: 12,
    fontWeight: '500',
  },
  userText: {
    color: '#10B981',
  },
  userWinnerText: {
    color: '#10B981',
  },
  userLoserText: {
    color: '#EF4444',
  },
  leaderboardCenter: {
    alignItems: 'center',
    flex: 1,
  },
  leaderboardPoints: {
    fontSize: 14,
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontWeight: '600',
    marginBottom: 2,
  },
  leaderboardEarnings: {
    fontSize: 14,
    fontFamily: defFontType,
    color: '#10B981',
    fontWeight: '600',
    textAlign: 'right',
    minWidth: 50,
  },
  noEarnings: {
    color: '#EF4444',
    fontFamily: defFontType,
  },
  winnerReward: {
    color: '#10B981',
    fontSize: 18,
    fontFamily: defFontType,
  },
});