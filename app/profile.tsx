import { Ionicons } from '@expo/vector-icons';
import { doc, getFirestore, onSnapshot } from '@react-native-firebase/firestore';
import { useFocusEffect } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useUser } from './_layout';

const dbgColor = "#0a0513ff"; //dark background
const bgColor = "#111124ff"; //background
const lbgColor = "#322f4e81"; //light background
const l2bgColor = "#322f4eff"; //2nd light background
const l3bgColor = "#323150";
const strongColor = "#cc7bdbff"; //strong color

const warmFontType = "Molengo";
const defFontType = "OpenSansSemiBold";

interface UserProfile {
  avgbedtime: number;
  name: string;
  numdays: number;
  pastcomps: Array<{
    date: string;
    money: number;
    points: number;
    rank: number;
    won: boolean;
  }>;
}

// Reset Button Component - moved from _layout.tsx
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
  const { resetToOnboarding } = useUser();

  const handleReset = () => {
    console.log('Reset button pressed');
    Alert.alert(
      "Logout",
      "Are you sure you want to log out?",
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => console.log('Logout cancelled')
        },
        {
          text: "Logout",
          style: "destructive",
          onPress: () => {
            console.log('User confirmed reset');
            resetToOnboarding();
          }
        }
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
          <Ionicons name="log-out" size={20} color="#ff0000ff" />
        )}
        <Text style={[resetStyles.resetText, textStyle]}>{title}</Text>
      </TouchableOpacity>
    </View>
  );
};

export default function ProfileScreen() {
  const {userData, setUserData} = useUser();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Animation references
  const titleAnimation = useRef(new Animated.Value(0)).current;
  const statsAnimation = useRef(new Animated.Value(0)).current;
  const competitionsAnimation = useRef(new Animated.Value(0)).current;
  const competitionAnimations = useRef<Animated.Value[]>([]).current;
  const resetButtonAnimation = useRef(new Animated.Value(0)).current;
  
  // Track if this is the initial render to prevent flash
  const [hasInitialized, setHasInitialized] = useState(false);

  const firestore = getFirestore();

  // Initialize competition animations
  useEffect(() => {
    if (userProfile?.pastcomps) {
      // Clear existing animations
      competitionAnimations.length = 0;
      // Create new animations for each competition
      userProfile.pastcomps.forEach(() => {
        competitionAnimations.push(new Animated.Value(0));
      });
    }
  }, [userProfile?.pastcomps]);

  // Animation trigger function
  const startAnimations = () => {
    // Reset all animations to 0 first to prevent any flash
    titleAnimation.setValue(0);
    statsAnimation.setValue(0);
    competitionsAnimation.setValue(0);
    competitionAnimations.forEach(anim => anim.setValue(0));
    resetButtonAnimation.setValue(0);

    // Mark as initialized to show content
    setHasInitialized(true);

    // Staggered animation sequence
    //const animationDuration = 400;
    //const staggerDelay = 150;
    const animationDuration = 0;
    const staggerDelay = 0;

    // Title (first)
    Animated.timing(titleAnimation, {
      toValue: 1,
      duration: animationDuration,
      useNativeDriver: true,
    }).start();

    // Stats (second)
    setTimeout(() => {
      Animated.timing(statsAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();
    }, staggerDelay);
    // Reset button (3rd)
      setTimeout(() => {
        Animated.timing(resetButtonAnimation, {
          toValue: 1,
          duration: animationDuration,
          useNativeDriver: true,
        }).start();
      }, staggerDelay * 2);
    // Competitions section header (4th)
    setTimeout(() => {
      Animated.timing(competitionsAnimation, {
        toValue: 1,
        duration: animationDuration,
        useNativeDriver: true,
      }).start();

      // Animate each competition card one by one with staggered delays
      competitionAnimations.forEach((anim, index) => {
        setTimeout(() => {
          Animated.timing(anim, {
            toValue: 1,
            duration: animationDuration,
            useNativeDriver: true,
          }).start();
        }, staggerDelay * (index + 1)); // Stagger each competition
      });
    }, staggerDelay * 3);
  };

  // Animation style generator
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

  useEffect(() => {
    if (userData?.uid) {
      const userDocRef = doc(firestore, 'profiledb', userData.uid);
      
      // Set up real-time listener for user profile
      const unsubscribe = onSnapshot(userDocRef, 
        (docSnapshot) => {
          if (docSnapshot.exists()) {
            const profileData = docSnapshot.data() as UserProfile;
            setUserProfile(profileData);
          } else {
            console.log('User profile not found');
          }
          setIsLoading(false);
        },
        (error) => {
          console.error('Error fetching user profile:', error);
          setIsLoading(false);
        }
      );

      return () => unsubscribe();
    }
  }, [userData?.uid]);

  // Start animations when loading is complete and data is available
  useEffect(() => {
    if (!isLoading && userData) {
      // Small delay to ensure everything is rendered
      setTimeout(() => {
        startAnimations();
      }, 100);
    }
  }, [isLoading, userData]);

  // Trigger animations whenever the screen comes into focus (tab navigation)
  useFocusEffect(
    React.useCallback(() => {
      if (!isLoading && userData) {
        // Reset hasInitialized to ensure proper animation flow
        setHasInitialized(false);
        // Small delay to ensure everything is rendered
        setTimeout(() => {
          startAnimations();
        }, 50); // Reduced delay to minimize flash
      }
    }, [isLoading, userData])
  );

  // Calculate stats from userProfile data
  const calculateStats = () => {
    if (!userProfile?.pastcomps) {
      return {
        totalWinnings: 0,
        winRate: 0,
        totalCompetitions: 0,
        wins: 0
      };
    }

    const pastComps = userProfile.pastcomps;
    const totalCompetitions = pastComps.length;
    const wins = pastComps.filter(comp => comp.won).length;
    const totalWinnings = pastComps.reduce((sum, comp) => sum + Number(comp.money), 0);
    const winRate = totalCompetitions > 0 ? Math.round((wins / totalCompetitions) * 100) : 0;

    return {
      totalWinnings,
      winRate,
      totalCompetitions,
      wins
    };
  };

  const stats = calculateStats();

  const formatCurrency = (amount: number) => {
    if (amount < 0) {
      return `-\$${Math.abs(amount)}`;
    }
    return `+\$${amount}`;
  };

  const formatDate = (dateString: string) => {
    // Assuming the date format from Firebase might need formatting
    // You can adjust this based on your actual date format
    return dateString;
  };

  // Show loading state
  if (isLoading || !userData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Ionicons name="person" size={48} color={strongColor} />
          <Text style={styles.loadingText}>Loading your profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Only render content after initialization to prevent flash */}
          {hasInitialized && (
            <>
              {/* Animated Title */}
              <Animated.View style={getAnimatedStyle(titleAnimation)}>
                <Text style={styles.title}>
                  <Text style={styles.username}>{userProfile?.name || userData?.name || 'User'}</Text><Text style={styles.username}>'s</Text> Profile
                </Text>
              </Animated.View>
              
              {/* Animated Stats Overview */}
              <Animated.View style={[getAnimatedStyle(statsAnimation), styles.statsContainer]}>
                <View style={styles.statCard}>
                  <View style={styles.iconContainer}>
                    <Ionicons name="cash" size={28} color={strongColor} />
                  </View>
                  <Text style={styles.statValue}>${stats.totalWinnings}</Text>
                  <Text style={styles.statLabel}>Total Winnings</Text>
                </View>
                
                <View style={styles.statCard}>
                  <View style={styles.iconContainer}>
                    <Ionicons name="trending-up" size={28} color={strongColor} />
                  </View>
                  <Text style={styles.statValue}>{stats.winRate}%</Text>
                  <Text style={styles.statLabel}>Win Rate</Text>
                </View>
              </Animated.View>
              {/* Animated Reset Button */}
              <Animated.View style={[getAnimatedStyle(resetButtonAnimation), styles.resetContainer]}>
                <ResetButton 
                  title="Logout"
                  style={{ marginBottom: 20 }}
                />
              </Animated.View>
              {/* Animated Past Competitions Section Header */}
              <Animated.View style={getAnimatedStyle(competitionsAnimation)}>
                <View style={styles.competitionsSection}>
                  <Text style={styles.sectionTitle}>Past Competitions</Text>
                  
                  {userProfile?.pastcomps && userProfile.pastcomps.length > 0 ? (
                    userProfile.pastcomps
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Sort by most recent first
                      .map((competition, index) => (
                        <Animated.View 
                          key={`${competition.date}-${index}`}
                          style={[
                            styles.competitionCard,
                            { backgroundColor: competition.won ? '#0F2419' : '#2D1B1B' },
                            getAnimatedStyle(competitionAnimations[index] || new Animated.Value(1))
                          ]}
                        >
                          <View style={styles.competitionHeader}>
                            <Text style={styles.competitionWeek}>{formatDate(competition.date)}</Text>
                            <Text style={styles.competitionRank}>Rank #{competition.rank}</Text>
                          </View>
                          
                          <View style={styles.competitionDetails}>
                            <Text style={styles.competitionPoints}>Points: {competition.points}</Text>
                          </View>
                          
                          <View style={styles.competitionFooter}>
                            <View style={styles.earningsContainer}>
                              <Text style={[
                                styles.earnings,
                                { color: competition.won ? '#10B981' : '#EF4444' }
                              ]}>
                                {formatCurrency(competition.money)}
                              </Text>
                            </View>
                            
                            <View style={[
                              styles.statusBadge,
                              { backgroundColor: competition.won ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)' }
                            ]}>
                              <Ionicons 
                                name={competition.won ? "trophy" : "close-circle"} 
                                size={16} 
                                color={competition.won ? '#10B981' : '#EF4444'} 
                              />
                              <Text style={[
                                styles.statusText,
                                { color: competition.won ? '#10B981' : '#EF4444' }
                              ]}>
                                {competition.won ? 'Won' : 'Lost'}
                              </Text>
                            </View>
                          </View>
                        </Animated.View>
                      ))
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons name="trophy-outline" size={48} color="#666666" />
                      <Text style={styles.emptyStateText}>No competitions yet</Text>
                      <Text style={styles.emptyStateSubtext}>Join your first competition to see your history here!</Text>
                    </View>
                  )}
                </View>
              </Animated.View>
            </>
          )}
          
        </View>
        
      </ScrollView>
    </SafeAreaView>
  );
};
const resetStyles = StyleSheet.create({
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
    borderColor: '#FF4444',
    gap: 8,
    fontFamily: defFontType,
  },
  resetText: {
    color: '#FF4444',
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
  },
  title: {
    fontSize: 36,
    fontWeight: '300',
    color: '#FFFFFF',
    marginBottom: 30,
    textAlign: 'center',
    fontFamily: warmFontType
  },
  username: {
    fontWeight: '600',
    color: strongColor,
    fontFamily: warmFontType,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
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
    alignItems: 'center',
    marginBottom: 8,
  },
  competitionWeek: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
    fontFamily: defFontType,
  },
  competitionRank: {
    fontSize: 14,
    color: '#B0B0B0',
    fontFamily: defFontType,
  },
  competitionDetails: {
    marginBottom: 12,
  },
  competitionPoints: {
    fontSize: 14,
    color: '#B0B0B0',
    fontFamily: defFontType,
  },
  competitionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  earningsContainer: {
    flex: 1,
  },
  earnings: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: defFontType,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
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
    marginTop: 20,
    marginBottom: 40,
  },
});