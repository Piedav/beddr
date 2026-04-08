import { Ionicons } from '@expo/vector-icons';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, KeyboardAvoidingView, Platform, SafeAreaView,
  ScrollView, StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { auth, firestore } from '../firebase'; // adjust path

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

const dbgColor = "#0a0513ff"; //dark background
const bgColor = "#111124ff"; //background
const lbgColor = "#322f4e81"; //light background
const l2bgColor = "#322f4eff"; //2nd light background
const l3bgColor = "#323150";
const strongColor = "#cc7bdbff"; //strong color

const warmFontType = "Molengo";
const defFontType = "OpenSansSemiBold";

interface OnboardingStep {
  id: number;
  title: string;
  subtitle: string;
  icon: string;
  content: React.ReactNode;
}

interface User {
  name: string;
  email: string;
  profilePicture?: string;
  uid: string;
}


export default function OnboardingScreen({ onComplete }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [bedtime, setBedtime] = useState('10:00 PM');
  const [wakeTime, setWakeTime] = useState('7:00 AM');
  const [notifications, setNotifications] = useState(true);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [showBedtimeDropdown, setShowBedtimeDropdown] = useState(false);
  const [showWakeTimeDropdown, setShowWakeTimeDropdown] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  // Animation reference for content only
  const contentAnimation = useRef(new Animated.Value(1)).current;

  // Animation trigger function for content only
  const animateContent = () => {
    // Reset content animation
    contentAnimation.setValue(0);

    // Animate content in
    Animated.timing(contentAnimation, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  };

  // Animate content when step changes
  useEffect(() => {
    animateContent();
  }, [currentStep]);

  // Animation style generator for content only
  const getContentAnimatedStyle = () => ({
    opacity: contentAnimation,
    transform: [
      {
        translateY: contentAnimation.interpolate({
          inputRange: [0, 1],
          outputRange: [30, 0],
        }),
      },
    ],
  });

  // Generate time options for bedtime (7pm to 3am)
  const generateBedtimeOptions = () => {
    const times = [];
    // 7:00 PM to 11:45 PM
    for (let hour = 9; hour <= 11; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const minuteStr = minute.toString().padStart(2, '0');
        const displayHour = hour > 12 ? hour - 12 : hour;
        times.push(`${displayHour}:${minuteStr} PM`);
      }
    }
    // 12:00 AM to 3:00 AM
    for (let hour = 0; hour <= 3; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const minuteStr = minute.toString().padStart(2, '0');
        const displayHour = hour === 0 ? 12 : hour;
        times.push(`${displayHour}:${minuteStr} AM`);
        if (hour === 3 && minute === 0) break; // Stop at 3:00 AM
      }
    }
    return times;
  };

  // Generate time options for wake time (5am to 10am)
  const generateWakeTimeOptions = () => {
    const times = [];
    for (let hour = 5; hour <= 10; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const minuteStr = minute.toString().padStart(2, '0');
        times.push(`${hour}:${minuteStr} AM`);
      }
    }
    return times;
  };

  const bedtimeOptions = generateBedtimeOptions();
  const wakeTimeOptions = generateWakeTimeOptions();

  // Configure Google Sign-In
  useEffect(() => {
    GoogleSignin.configure({
      iosClientId: '188667592970-h4hmpdbimh2ghdv49srbcmoun8h670g7.apps.googleusercontent.com', 
      scopes: ['profile', 'email', 'openid'], 
    }); 
  }, []);

  // Convert time string to minutes from midnight for points calculation
  const timeToMinutes = (timeStr: string): number => {
    const [time, period] = timeStr.split(' ');
    const [hours, minutes] = time.split(':').map(Number);
    let totalMinutes = minutes;
    
    if (period === 'AM') {
      if (hours === 12) {
        totalMinutes += 0; // 12:xx AM is midnight hour
      } else {
        totalMinutes += hours * 60;
      }
    } else { // PM
      if (hours === 12) {
        totalMinutes += 12 * 60; // 12:xx PM is noon hour
      } else {
        totalMinutes += (hours + 12) * 60;
      }
    }
    
    return totalMinutes;
  };

  // Calculate points based on bedtime with new system: 9pm = 30 points, 3am = 0 points, lose 5 points per hour
  const calculatePoints = (bedtimeStr: string): number => {
    const bedtimeMinutes = timeToMinutes(bedtimeStr);
    const baseBedtime = timeToMinutes('9:00 PM'); // 1260 minutes (21:00)
    const latestBedtime = timeToMinutes('3:00 AM'); // 180 minutes (next day)
    
    let adjustedBedtime = bedtimeMinutes;
    
    // Handle times after midnight (next day)
    if (bedtimeMinutes < 720) { // Before noon = next day
      adjustedBedtime = bedtimeMinutes + 1440; // Add 24 hours
    }
    
    // If bedtime is at or after 3:00 AM, return 0 points
    if (adjustedBedtime >= latestBedtime + 1440) {
      return 0;
    }
    
    // Calculate hours difference from 9pm
    const hoursLate = (adjustedBedtime - baseBedtime) / 60;
    const points = Math.max(0, 30 - (hoursLate * 5));
    
    return Math.round(points * 10) / 10; // Round to 1 decimal place
  };

  // Create user profile in Firestore
  const createUserProfile = async (userData: User) => {
    try {
      setIsCreatingProfile(true);
      
      const userDocRef = doc(firestore, 'profiledb', userData.uid);
      
      // Check if user profile already exists
      const userDoc = await getDoc(userDocRef);
      
      if (userDoc.exists()) {
        // User already has a profile, don't overwrite
        console.log('User profile already exists, skipping creation');
        Alert.alert('Welcome Back', 'Your existing profile has been loaded!');
        return;
      }
      
      // Create new profile only if it doesn't exist
      const profileData = {
        avgbedtime: -1,
        name: userData.name,
        numdays: 0, 
        pastcomps: [],
        sleepTimes: [],
        competitions: []
      };

      await setDoc(userDocRef, profileData);
      
      console.log('User profile created successfully:', profileData);
      Alert.alert('Success', 'Your profile has been created!');
      
    } catch (error) {
      console.error('Error creating user profile:', error);
      Alert.alert('Error', 'Failed to create your profile. Please try again.');
      throw error;
    } finally {
      setIsCreatingProfile(false);
    }
  };

  // Google Sign-In function
  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    
    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      
      if (userInfo.data) {
        const idToken = GoogleAuthProvider.credential(userInfo.data.idToken);
        console.log(JSON.stringify(userInfo, null, 2));
        
        // Sign in with Firebase
        const authResult = await signInWithCredential(auth, idToken);
        
        // Set user data for the onboarding flow
        const userData: User = {
          name: userInfo.data.user.givenName || 'User',
          email: userInfo.data.user.email,
          profilePicture: userInfo.data.user.photo || undefined,
          uid: authResult.user.uid
        };
        
        setUser(userData);
      }
    } catch (error: any) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        Alert.alert('Cancelled', 'Login was cancelled');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        Alert.alert('In Progress', 'Login is already in progress');
      } else {
        console.log(error);
        Alert.alert('Error', 'An error occurred during login');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const TimeDropdown = ({ 
    value, 
    onSelect, 
    isVisible, 
    onToggle, 
    label, 
    icon,
    options
  }: {
    value: string;
    onSelect: (time: string) => void;
    isVisible: boolean;
    onToggle: () => void;
    label: string;
    icon: string;
    options: string[];
  }) => (
    <View style={styles.timeInputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TouchableOpacity style={styles.timeInput} onPress={onToggle}>
        <Ionicons name={icon as any} size={20} color={strongColor} />
        <Text style={styles.timeText}>{value}</Text>
        <Ionicons 
          name={isVisible ? "chevron-up" : "chevron-down"} 
          size={20} 
          color="#666" 
        />
      </TouchableOpacity>
      
      {isVisible && (
        <View style={styles.dropdown}>
          <ScrollView 
            style={styles.dropdownScroll} 
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
          >
            {options.map((time, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.dropdownItem,
                  time === value && styles.dropdownItemSelected
                ]}
                onPress={() => {
                  onSelect(time);
                  onToggle();
                }}
              >
                <Text style={[
                  styles.dropdownItemText,
                  time === value && styles.dropdownItemTextSelected
                ]}>
                  {time}
                </Text>
                {time === value && (
                  <Ionicons name="checkmark" size={16} color={strongColor} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      
      <Text style={styles.timeHint}>
        {label.includes('Bedtime') 
          ? 'When you\'ll put down your phone each night'
          : 'When you\'ll claim your points each morning'
        }
      </Text>
    </View>
  );

  const steps: OnboardingStep[] = [
    {
      id: 0,
      title: 'Welcome to Beddr',
      subtitle: 'Play your way to better sleep',
      icon: 'moon',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <Ionicons name="trophy" size={24} color={strongColor} />
              <Text style={styles.featureText}>Play others in competitions</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="time" size={24} color={strongColor} />
              <Text style={styles.featureText}>Earn points for sleeping early</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="cash" size={24} color={strongColor} />
              <Text style={styles.featureText}>Earn money, dinner with friends, etc.</Text>
            </View>
          </View>
        </View>
      )
    },
    {
      id: 1,
      title: 'Earn Points for Sleeping',
      subtitle: 'The earlier you sleep, the more points you earn',
      icon: 'stats-chart',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.pointsExplanation}>
            <View style={styles.pointsScale}>
              <View style={styles.pointsRow}>
                <Text style={styles.bedtimeText}>9:00 PM</Text>
                <View style={styles.pointsBar}>
                  <View style={[styles.pointsFill, { width: '100%' }]} />
                </View>
                <Text style={styles.pointsValue}>30 pts</Text>
              </View>
              
              <View style={styles.pointsRow}>
                <Text style={styles.bedtimeText}>10:00 PM</Text>
                <View style={styles.pointsBar}>
                  <View style={[styles.pointsFill, { width: '83%' }]} />
                </View>
                <Text style={styles.pointsValue}>25 pts</Text>
              </View>
              
              <View style={styles.pointsRow}>
                <Text style={styles.bedtimeText}>11:00 PM</Text>
                <View style={styles.pointsBar}>
                  <View style={[styles.pointsFill, { width: '67%' }]} />
                </View>
                <Text style={styles.pointsValue}>20 pts</Text>
              </View>
              
              <View style={styles.pointsRow}>
                <Text style={styles.bedtimeText}>12:00 AM</Text>
                <View style={styles.pointsBar}>
                  <View style={[styles.pointsFill, { width: '50%' }]} />
                </View>
                <Text style={styles.pointsValue}>15 pts</Text>
              </View>
              
              <View style={styles.pointsRow}>
                <Text style={styles.bedtimeText}>1:00 AM</Text>
                <View style={styles.pointsBar}>
                  <View style={[styles.pointsFill, { width: '33%' }]} />
                </View>
                <Text style={styles.pointsValue}>10 pts</Text>
              </View>
              
              <View style={styles.pointsRow}>
                <Text style={styles.bedtimeText}>2:00 AM</Text>
                <View style={styles.pointsBar}>
                  <View style={[styles.pointsFill, { width: '17%' }]} />
                </View>
                <Text style={styles.pointsValue}>5 pts</Text>
              </View>
              
              <View style={styles.pointsRow}>
                <Text style={styles.bedtimeText}>3:00 AM+</Text>
                <View style={styles.pointsBar}>
                  <View style={[styles.pointsFill, { width: '0%' }]} />
                </View>
                <Text style={styles.pointsValue}>0 pts</Text>
              </View>
            </View>
          </View>
          
          <View style={styles.claimInfo}>
            <Ionicons name="sunny" size={30} color={strongColor} />
            <Text style={styles.claimTitle}>Claim Points Each Morning</Text>
            <Text style={styles.claimText}>Open the app each morning to claim your points from the previous night</Text>
          </View>
        </View>
      )
    },
    {
      id: 2,
      title: 'Competitions',
      subtitle: 'Simple steps to compete and earn',
      icon: 'trophy',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.stepsContainer}>
            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Join Weekly Competition</Text>
                <Text style={styles.stepText}>Join a friend, family, or foe, or make your own</Text>
              </View>
            </View>
            
            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Sleep Early & Earn Points</Text>
                <Text style={styles.stepText}>Go to bed early each night to maximize your points</Text>
              </View>
            </View>
            
            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Claim Daily Points</Text>
                <Text style={styles.stepText}>Open the app each morning to claim your points</Text>
              </View>
            </View>
            
            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>4</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Win in Life</Text>
                <Text style={styles.stepText}>Split a prize pool or other reward among the top scorers on top of your better sleep</Text>
              </View>
            </View>
          </View>
          
          <View style={styles.prizingExample}>
            <Text style={styles.prizingTitle}>Example Weekly Prizes</Text>
            <Text style={styles.prizingSubtitle}>(large scale public game)</Text>
            <Text style={styles.prizingSubtitle}>100 players × $5 entry fee = $500 prize pool</Text>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>🥇 1st Place</Text>
              <Text style={styles.prizingAmount}>$25.12</Text>
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>🥈 2nd Place</Text>
              <Text style={styles.prizingAmount}>$22.61</Text>
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>🥉 3rd Place</Text>
              <Text style={styles.prizingAmount}>$20.35</Text>
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>⭐ 10th Place</Text>
              <Text style={styles.prizingAmount}>$9.73</Text>
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>⭐ 25th Place</Text>
              <Text style={styles.prizingAmount}>$2.00</Text>
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>⭐ 50th Place</Text>
              <Text style={styles.prizingAmount}>$0.14</Text>
            </View>
            <View style={styles.cutoffLine}>
              <View style={styles.cutoffDivider} />
              <Text style={styles.cutoffText}>CUTOFF</Text>
              <View style={styles.cutoffDivider} />
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>❌ 51st-100th</Text>
              <Text style={styles.prizingLoss}>-$5.00</Text>
            </View>
          </View>
          <Text></Text>
          <View style={styles.prizingExample}>
            <Text style={styles.prizingSubtitle}>(family sized private game)</Text>
            <Text style={styles.prizingSubtitle}>person in last has to pay for an ice cream trip</Text>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>🥇 Mom</Text>
              <Text style={styles.prizingAmount}>free ice cream</Text>
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>🥈 Dad</Text>
              <Text style={styles.prizingAmount}>free ice cream</Text>
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>🥉 Helen</Text>
              <Text style={styles.prizingAmount}>free ice cream</Text>
            </View>
            <View style={styles.cutoffLine}>
              <View style={styles.cutoffDivider} />
              <Text style={styles.cutoffText}>CUTOFF</Text>
              <View style={styles.cutoffDivider} />
            </View>
            <View style={styles.prizingRow}>
              <Text style={styles.prizingRank}>❌ David</Text>
              <Text style={styles.prizingLoss}>must fund ice cream trip</Text>
            </View>
          </View>
        </View>
      )
    },
    {
      id: 3,
      title: 'Create Your Account',
      subtitle: 'Connect your Google account to get started',
      icon: 'person',
      content: (
        <View style={styles.stepContent}>
          {!user ? (
            <>
              <View style={styles.signInContainer}>
                <TouchableOpacity 
                  style={[styles.googleSignInButton, isSigningIn && styles.googleSignInButtonDisabled]}
                  onPress={handleGoogleSignIn}
                  disabled={isSigningIn}
                >
                  {isSigningIn ? (
                    <>
                      <View style={styles.loadingSpinner} />
                      <Text style={styles.googleSignInButtonText}>Signing In...</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="logo-google" size={20} color="#FFFFFF" />
                      <Text style={styles.googleSignInButtonText}>Continue with Google</Text>
                    </>
                  )}
                </TouchableOpacity>
                
                <View style={styles.privacyInfo}>
                  <Text style={styles.privacyText}>
                    By signing in, you agree to our Terms of Service and Privacy Policy
                  </Text>
                </View>
              </View>
            </>
          ) : (
            <View style={styles.signInSuccess}>
              <View style={styles.successCheckmark}>
                <Ionicons name="checkmark-circle" size={60} color={strongColor} />
              </View>
              
              <Text style={styles.welcomeMessage}>
                Welcome <Text style={styles.welcomeName}>{user.name}!</Text>
              </Text>
              
              <View style={styles.userInfo}>
                <Text style={styles.userEmail}>{user.email}</Text>
              </View>
              
              <Text style={styles.successDescription}>
                Your account has been created successfully. Ready to start competing for better sleep?
              </Text>
            </View>
          )}
        </View>
      )
    },
    {
      id: 4,
      title: 'Set Your Sleep Goal',
      subtitle: 'What time do you want to aim for?',
      icon: 'time',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.timeInputsContainer}>
            <TimeDropdown
              value={bedtime}
              onSelect={setBedtime}
              isVisible={showBedtimeDropdown}
              onToggle={() => {
                setShowBedtimeDropdown(!showBedtimeDropdown);
                setShowWakeTimeDropdown(false);
              }}
              label="Target Bedtime"
              icon="moon"
              options={bedtimeOptions}
            />
            
            <TimeDropdown
              value={wakeTime}
              onSelect={setWakeTime}
              isVisible={showWakeTimeDropdown}
              onToggle={() => {
                setShowWakeTimeDropdown(!showWakeTimeDropdown);
                setShowBedtimeDropdown(false);
              }}
              label="Wake Up Time"
              icon="sunny"
              options={wakeTimeOptions}
            />
          </View>
          
          <View style={styles.sleepSummary}>
            <Text style={styles.summaryTitle}>Your Competition Strategy</Text>
            <Text style={styles.summaryText}>
              Bedtime: {bedtime} = {calculatePoints(bedtime)} points/night
            </Text>
            <Text style={styles.summarySubtext}>
              {(calculatePoints(bedtime) * 7).toFixed(1)} points per week if you stick to it!
            </Text>
          </View>
        </View>
      )
    },
    {
      id: 5,
      title: 'Stay Motivated',
      subtitle: 'Get reminders to maximize your earnings',
      icon: 'notifications',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.notificationOption}>
            <TouchableOpacity 
              style={styles.notificationToggle}
              onPress={() => setNotifications(!notifications)}
            >
              <View style={styles.toggleInfo}>
                <Ionicons name="notifications" size={24} color={strongColor} />
                <View style={styles.toggleText}>
                  <Text style={styles.toggleTitle}>Push Notifications</Text>
                  <Text style={styles.toggleSubtitle}>Bedtime reminders and competition updates</Text>
                </View>
              </View>
              <View style={[styles.toggle, notifications && styles.toggleActive]}>
                <View style={[styles.toggleHandle, notifications && styles.toggleHandleActive]} />
              </View>
            </TouchableOpacity>
          </View>
          
          <View style={styles.notificationTypes}>
            <Text style={styles.notificationTypesTitle}>You'll receive notifications for:</Text>
            
            <View style={styles.notificationType}>
              <Ionicons name="time" size={20} color={strongColor} />
              <Text style={styles.notificationTypeText}>Bedtime reminders</Text>
            </View>
            
            <View style={styles.notificationType}>
              <Ionicons name="sunny" size={20} color={strongColor} />
              <Text style={styles.notificationTypeText}>Morning point claiming reminders</Text>
            </View>
            
            <View style={styles.notificationType}>
              <Ionicons name="trophy" size={20} color={strongColor} />
              <Text style={styles.notificationTypeText}>Competition results & rankings</Text>
            </View>
            
            <View style={styles.notificationType}>
              <Ionicons name="cash" size={20} color={strongColor} />
              <Text style={styles.notificationTypeText}>Prize pool & earnings updates</Text>
            </View>
          </View>
          
          <Text style={styles.privacyNote}>
            You can change notification settings anytime in your profile.
          </Text>
        </View>
      )
    },
    {
      id: 6,
      title: 'You\'re All Set!',
      subtitle: 'Ready to start competing',
      icon: 'checkmark-circle',
      content: (
        <View style={styles.stepContent}>
          {isCreatingProfile && (
            <View style={styles.creatingProfile}>
              <View style={styles.loadingSpinner} />
              <Text style={styles.creatingProfileText}>Creating your profile...</Text>
            </View>
          )}
        </View>
      )
    }
  ];

  const nextStep = async () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
      scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: true });
    } else {
      // Complete onboarding - create user profile in database
      if (user) {
        try {
          await createUserProfile(user);
          onComplete({ 
            user, 
            bedtime, 
            wakeTime, 
            notifications,
          });
        } catch (error) {
          console.error('Failed to complete onboarding:', error);
          // Don't proceed if profile creation failed
          return;
        }
      }
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: true });
    }
  };

  const canProceed = () => {
    if (currentStep === 3) return user !== null;
    if (currentStep === steps.length - 1) return !isCreatingProfile;
    return true;
  };

  const getButtonText = () => {
    if (currentStep === steps.length - 1) {
      return isCreatingProfile ? 'Creating Profile...' : 'Start Competing';
    }
    if (currentStep === 0) return 'Let\'s Begin';
    return 'Continue';
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Static Progress Indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View 
              style={[
                styles.progressFill, 
                { width: `${((currentStep + 1) / steps.length) * 100}%` }
              ]} 
            />
          </View>
          <Text style={styles.progressText}>
            {currentStep + 1} of {steps.length}
          </Text>
        </View>

        <ScrollView 
          ref={scrollViewRef}
          style={styles.scrollView} 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.content}>
            {/* Animated Content */}
            <Animated.View style={getContentAnimatedStyle()}>
              {/* Header */}
              <View style={styles.header}>
                <View style={styles.iconContainer}>
                  <Ionicons 
                    name={steps[currentStep].icon as any} 
                    size={40} 
                    color={strongColor} 
                  />
                </View>
                <Text style={styles.title}>{steps[currentStep].title}</Text>
                <Text style={styles.subtitle}>{steps[currentStep].subtitle}</Text>
              </View>

              {/* Step Content */}
              {steps[currentStep].content}
            </Animated.View>
          </View>
        </ScrollView>

        {/* Static Navigation */}
        <View style={styles.navigationContainer}>
          <TouchableOpacity 
            style={[styles.navButton, styles.backButton, currentStep === 0 && styles.navButtonDisabled]}
            onPress={prevStep}
            disabled={currentStep === 0}
          >
            <Ionicons name="chevron-back" size={20} color={currentStep === 0 ? "#666" : strongColor} />
            <Text style={[styles.backButtonText, currentStep === 0 && styles.navButtonTextDisabled]}>
              Back
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.navButton, styles.nextButton, !canProceed() && styles.navButtonDisabled]}
            onPress={nextStep}
            disabled={!canProceed()}
          >
            <Text style={[styles.nextButtonText, !canProceed() && styles.navButtonTextDisabled]}>
              {getButtonText()}
            </Text>
            {currentStep < steps.length - 1 && (
              <Ionicons name="chevron-forward" size={20} color={!canProceed() ? "#666" : "#FFFFFF"} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: bgColor,
  },
  keyboardView: {
    flex: 1,
  },
  progressContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
  },
  progressBar: {
    height: 4,
    backgroundColor: lbgColor,
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: strongColor,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: '#B0B0B0',
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    padding: 20,
    paddingTop: 10,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 22,
  },
  stepContent: {
    flex: 1,
    alignItems: 'center',
  },

  // Welcome Step
  featuresList: {
    width: '100%',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: lbgColor,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  featureText: {
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 16,
    fontWeight: '500',
  },

  // Points Explanation Step
  pointsExplanation: {
    width: '100%',
    marginBottom: 30,
  },
  pointsScale: {
    backgroundColor: bgColor,
    borderRadius: 16,
    padding: 20,
  },
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  bedtimeText: {
    fontSize: 14,
    color: '#FFFFFF',
    width: 70,
    fontWeight: '500',
  },
  pointsBar: {
    flex: 1,
    height: 8,
    backgroundColor: l3bgColor,
    borderRadius: 4,
    marginHorizontal: 12,
  },
  pointsFill: {
    height: '100%',
    backgroundColor: strongColor,
    borderRadius: 4,
  },
  pointsValue: {
    fontSize: 14,
    color: strongColor,
    fontWeight: '600',
    width: 50,
    textAlign: 'right',
  },
  claimInfo: {
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
  },
  claimTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 10,
    marginBottom: 8,
    textAlign: 'center',
  },
  claimText: {
    fontSize: 14,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 20,
  },

  // How It Works Step
  stepsContainer: {
    width: '100%',
    marginBottom: 30,
  },
  howItWorksStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 24,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: strongColor,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  stepNumberText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stepInfo: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  stepText: {
    fontSize: 14,
    color: '#B0B0B0',
    lineHeight: 20,
  },
  prizingExample: {
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 20,
    width: '100%',
  },
  prizingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
    textAlign: 'center',
  },
  prizingSubtitle: {
    fontSize: 12,
    color: '#B0B0B0',
    marginBottom: 16,
    textAlign: 'center',
  },
  prizingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  prizingRank: {
    fontSize: 14,
    color: '#B0B0B0',
  },
  prizingAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10B981',
  },
  prizingLoss: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
  },
  cutoffLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
  cutoffDivider: {
    flex: 1,
    height: 1,
    backgroundColor: '#EF4444',
  },
  cutoffText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
    marginHorizontal: 12,
  },

  // Google Sign-In Step
  signInContainer: {
    width: '100%',
    alignItems: 'center',
  },
  googleSignInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: strongColor,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
    width: '100%',
    marginBottom: 20,
  },
  googleSignInButtonDisabled: {
    backgroundColor: '#666',
  },
  googleSignInButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 12,
  },
  loadingSpinner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    borderTopColor: 'transparent',
  },
  privacyInfo: {
    backgroundColor: lbgColor,
    borderRadius: 12,
    padding: 16,
    width: '100%',
  },
  privacyText: {
    fontSize: 12,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 16,
  },
  
  // Sign-In Success
  signInSuccess: {
    width: '100%',
    alignItems: 'center',
  },
  successCheckmark: {
    marginBottom: 20,
  },
  welcomeMessage: {
    fontSize: 22,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 20,
  },
  welcomeName: {
    color: strongColor,
  },
  userInfo: {
    backgroundColor: lbgColor,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  userEmail: {
    fontSize: 14,
    color: '#B0B0B0',
  },
  successDescription: {
    fontSize: 16,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 24,
  },

  // Sleep Schedule Step - Enhanced with dropdowns
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  timeInputsContainer: {
    width: '100%',
    marginBottom: 30,
  },
  timeInputGroup: {
    marginBottom: 24,
    position: 'relative',
    zIndex: 1,
  },
  timeInput: {
    backgroundColor: lbgColor,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    flex: 1,
    marginLeft: 12,
  },
  timeHint: {
    fontSize: 12,
    color: strongColor,
    marginTop: 4,
    fontWeight: '500',
  },
  
  // Dropdown styles
  dropdown: {
    backgroundColor: lbgColor,
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 200,
    borderWidth: 1,
    borderColor: '#333',
    zIndex: 1000,
  },
  dropdownScroll: {
    maxHeight: 200,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  dropdownItemSelected: {
    backgroundColor: 'rgba(157, 78, 221, 0.1)',
  },
  dropdownItemText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  dropdownItemTextSelected: {
    color: strongColor,
    fontWeight: '600',
  },
  
  sleepSummary: {
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
  },
  summaryTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  summaryText: {
    fontSize: 17,
    fontWeight: '700',
    color: strongColor,
    marginBottom: 4,
  },
  summarySubtext: {
    fontSize: 14,
    color: '#10B981',
    textAlign: 'center',
    // marginBottom: 8,
  },
  pointsBreakdown: {
    width: '100%',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  breakdownTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B0B0B0',
    marginBottom: 8,
    textAlign: 'center',
  },
  breakdownText: {
    fontSize: 12,
    color: '#B0B0B0',
    textAlign: 'center',
    marginBottom: 4,
  },
  breakdownHighlight: {
    fontSize: 12,
    color: strongColor,
    textAlign: 'center',
    fontWeight: '600',
  },

  // Notifications Step
  notificationOption: {
    width: '100%',
    marginBottom: 30,
  },
  notificationToggle: {
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  toggleText: {
    marginLeft: 20,
    flex: 1,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  toggleSubtitle: {
    fontSize: 14,
    color: '#B0B0B0',
  },
  toggle: {
    width: 50,
    height: 28,
    backgroundColor: '#333',
    borderRadius: 14,
    padding: 2,
    justifyContent: 'center',
  },
  toggleActive: {
    backgroundColor: strongColor,
  },
  toggleHandle: {
    width: 24,
    height: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  toggleHandleActive: {
    alignSelf: 'flex-end',
  },
  notificationTypes: {
    width: '100%',
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  notificationTypesTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#B0B0B0',
    marginBottom: 16,
  },
  notificationType: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  notificationTypeText: {
    fontSize: 14,
    color: '#FFFFFF',
    marginLeft: 12,
  },
  privacyNote: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    lineHeight: 16,
  },

  // Final Step - Creating Profile
  creatingProfile: {
    alignItems: 'center',
    padding: 20,
  },
  creatingProfileText: {
    fontSize: 16,
    color: '#B0B0B0',
    marginTop: 20,
    textAlign: 'center',
  },

  // Navigation
  navigationContainer: {
    flexDirection: 'row',
    padding: 20,
    paddingTop: 10,
  },
  navButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginHorizontal: 6,
  },
  backButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: strongColor,
  },
  nextButton: {
    backgroundColor: strongColor,
  },
  navButtonDisabled: {
    backgroundColor: dbgColor,
    borderColor: dbgColor,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: strongColor,
    marginLeft: 4,
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginRight: 4,
  },
  navButtonTextDisabled: {
    color: '#666',
  },
});