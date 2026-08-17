import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import {
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
  updateProfile
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlobCompanion } from '../components/BlobCompanion';
import { auth, firestore } from '../firebase';

const dbgColor = "#0a0513ff";
const bgColor = "#111124ff";
const lbgColor = "#322f4e81";
const strongColor = "#cc7bdbff";
const defFontType = "OpenSansSemiBold";

type BlockedSelectionSummary = {
  isAvailable: boolean;
  selectedApps: number;
  selectedCategories: number;
  selectedWebDomains: number;
};

type BeddrScreenTimeModule = {
  getBlockedSelectionSummary: () => Promise<BlockedSelectionSummary>;
  requestAuthorizationAndSelectApps: () => Promise<BlockedSelectionSummary>;
};

const BeddrScreenTime = NativeModules.BeddrScreenTime as
  | BeddrScreenTimeModule
  | undefined;

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
  uid: string;
}

export default function OnboardingScreen({
  onComplete,
}: {
  onComplete: (data: { user: User }) => void;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [isCheckingExistingAuth, setIsCheckingExistingAuth] = useState(true);
  const [companionHue, setCompanionHue] = useState(260);
  const [blockedSelectionSummary, setBlockedSelectionSummary] =
    useState<BlockedSelectionSummary | null>(null);
  const [isPickingBlockedApps, setIsPickingBlockedApps] = useState(false);

  const scrollViewRef = useRef<ScrollView>(null);
  const contentAnimation = useRef(new Animated.Value(1)).current;
  const [existingSignedInUser, setExistingSignedInUser] = useState<User | null>(null);
  const [showSignedInGate, setShowSignedInGate] = useState(false);

  const animateContent = React.useCallback(() => {
    contentAnimation.setValue(0);
    Animated.timing(contentAnimation, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [contentAnimation]);

  useEffect(() => {
    animateContent();
  }, [animateContent, currentStep]);

  const getContentAnimatedStyle = () => ({
    opacity: contentAnimation,
    transform: [
      {
        translateY: contentAnimation.interpolate({
          inputRange: [0, 1],
          outputRange: [24, 0],
        }),
      },
    ],
  });

  useEffect(() => {
    GoogleSignin.configure({
      iosClientId:
        '188667592970-h4hmpdbimh2ghdv49srbcmoun8h670g7.apps.googleusercontent.com',
      scopes: ['profile', 'email', 'openid'],
    });
  }, []);

  // Skip onboarding if already signed in
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const existingUser: User = {
            name: firebaseUser.displayName ?? '',
            email: firebaseUser.email || '',
            uid: firebaseUser.uid,
          };

          const userDocRef = doc(firestore, 'profiledb', existingUser.uid);
          const userDoc = await getDoc(userDocRef);

          let finalUser = existingUser;

          if (userDoc.exists()) {
            const data = userDoc.data();

            finalUser = {
              ...existingUser,
              name: data.name || existingUser.name || 'User',
              email: data.email || existingUser.email,
            };
          } else {
            // Only ever write identity fields here, never lockedEvents/
            // competitions/etc. Every consumer of those already falls back
            // safely when they're missing (see getAllTimeLockedMinutes,
            // calculateStats, and recordEvent's own updateDoc->setDoc
            // fallback in index.tsx). Explicitly resetting them to empty
            // defaults here is what turns a false "doesn't exist" read
            // (e.g. from a getDoc racing a fast sign-out/sign-in sequence)
            // into real, destructive data loss on an account that actually
            // has history — this write is safe/idempotent either way now.
            const initialName = existingUser.name || 'User';
            await setDoc(
              userDocRef,
              {
                name: initialName,
                nameLower: initialName.toLowerCase(),
                email: existingUser.email,
                searchable: true,
              },
              { merge: true }
            );

            finalUser = {
              ...existingUser,
              name: initialName,
            };
          }

          setExistingSignedInUser(finalUser);

          setUser((prev) => {
            // Only keep the previous name if it's for the SAME account —
            // otherwise switching accounts (e.g. testing with a second
            // test account) could keep displaying the old account's name
            // over the newly signed-in one.
            if (prev && prev.uid === finalUser.uid && prev.name && prev.name !== 'User') {
              return prev;
            }
            return finalUser;
          });
          setShowSignedInGate(true);
          return;
        }

        setExistingSignedInUser(null);
        setShowSignedInGate(false);
        setUser(null);
      } catch (error) {
        console.error('Error checking existing auth:', error);
      } finally {
        setIsCheckingExistingAuth(false);
      }
    });

    return unsub;
  }, []);

  const createUserProfile = async (userData: User) => {
    try {
      setIsCreatingProfile(true);

      const userDocRef = doc(firestore, 'profiledb', userData.uid);

      // Identity fields only — see the comment in the onAuthStateChanged
      // listener above for why lockedEvents/competitions/etc. are never
      // explicitly written (or reset) here.
      // Note: `searchable` is deliberately not written here — this call
      // isn't scoped to "doc doesn't exist yet" the way the listener above
      // is, so unconditionally writing it could reset a returning user's
      // own privacy choice back to the default. New users get it from the
      // listener's else-branch; existing users missing it get backfilled
      // once from index.tsx's profile snapshot handler.
      //
      // companionHue is different: it's picked right here in onboarding, so
      // there's no earlier write to fall back on. Still guarded the same
      // way — only set it if nothing's there yet, so a returning user who
      // signs out and re-runs onboarding never has their saved color
      // silently reset back to whatever the picker was showing.
      const existingDoc = await getDoc(userDocRef);
      const shouldSetHue = existingDoc.data()?.companionHue === undefined;

      await setDoc(
        userDocRef,
        {
          name: userData.name,
          nameLower: userData.name.toLowerCase(),
          email: userData.email,
          ...(shouldSetHue ? { companionHue: Math.round(companionHue) } : {}),
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Error creating user profile:', error);
      Alert.alert('Error', 'Failed to create your profile. Please try again.');
      throw error;
    } finally {
      setIsCreatingProfile(false);
    }
  };

  const handleAppleSignIn = async () => {
    setIsSigningIn(true);

    try {
      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!appleCredential.identityToken) {
        throw new Error('No Apple identity token returned');
      }

      const provider = new OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken: appleCredential.identityToken,
      });

      const authResult = await signInWithCredential(auth, credential);

      const fullName = appleCredential.fullName
        ? AppleAuthentication.formatFullName(appleCredential.fullName)
        : null;

      const signedInUser: User = {
        name: fullName && fullName.trim().length > 0
          ? fullName
          : authResult.user.displayName || 'User',
        email: appleCredential.email || authResult.user.email || '',
        uid: authResult.user.uid,
      };
      console.log('APPLE FULL NAME:', fullName);
      console.log('SIGNED IN USER:', signedInUser); 
      if (signedInUser.name !== 'User') {
        await updateProfile(authResult.user, {
          displayName: signedInUser.name,
        });
      }

      const userDocRef = doc(firestore, 'profiledb', signedInUser.uid);
      const userDoc = await getDoc(userDocRef);
      const existingData = userDoc.exists() ? userDoc.data() : null;

      // Identity fields only — see the comment in the onAuthStateChanged
      // listener above for why lockedEvents/competitions/etc. are never
      // written (or reset) here. Apple only returns the user's real name on
      // their very first-ever sign-in, so on later sign-ins we keep
      // whatever name is already stored instead of overwriting it with the
      // generic 'User' fallback.
      const resolvedName =
        signedInUser.name !== 'User' ? signedInUser.name : existingData?.name || signedInUser.name;

      await setDoc(
        userDocRef,
        {
          name: resolvedName,
          nameLower: resolvedName.toLowerCase(),
          email: signedInUser.email || existingData?.email || signedInUser.email,
          // Only set a default on first-ever sign-in — existingData is null
          // exactly when this doc doesn't exist yet. Never overwrite a
          // returning user's own privacy choice.
          ...(existingData ? {} : { searchable: true }),
        },
        { merge: true }
      );

      setUser(signedInUser);
      setExistingSignedInUser(signedInUser);
      setShowSignedInGate(true);

    } catch (error: any) {
      if (error.code === 'ERR_REQUEST_CANCELED') {
        Alert.alert('Cancelled', 'Apple sign-in was cancelled');
      } else {
        console.log(error);
        Alert.alert('Error', 'An error occurred during Apple sign-in');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);

    try {
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();

      if (userInfo.data) {
        const credential = GoogleAuthProvider.credential(userInfo.data.idToken);
        const authResult = await signInWithCredential(auth, credential);

        const signedInUser: User = {
          name: userInfo.data.user.givenName || 'User',
          email: userInfo.data.user.email,
          uid: authResult.user.uid,
        };

        setUser(signedInUser);
        setExistingSignedInUser(signedInUser);
        setShowSignedInGate(true);
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
  const handleUseExistingAccount = () => {
    if (existingSignedInUser) {
      onComplete({ user: existingSignedInUser });
    }
  };

  const handleSignOutFromOnboarding = async () => {
    try {
      await GoogleSignin.signOut().catch(() => {});
      await signOut(auth);
      setExistingSignedInUser(null);
      setUser(null);
      setShowSignedInGate(false);
      setCurrentStep(0);
    } catch (error) {
      console.error('Error signing out:', error);
      Alert.alert('Error', 'Could not sign out. Please try again.');
    }
  };

  const handleChooseBlockedApps = async () => {
    if (Platform.OS !== 'ios' || !BeddrScreenTime) {
      Alert.alert(
        'Screen Time setup needed',
        'App blocking uses Apple Screen Time and needs a rebuilt iOS app with the BeddrScreenTime native module.'
      );
      return;
    }

    setIsPickingBlockedApps(true);

    try {
      const summary = await BeddrScreenTime.requestAuthorizationAndSelectApps();
      setBlockedSelectionSummary(summary);
    } catch (error: any) {
      const message =
        error?.message ||
        'Could not open the Screen Time app picker. Make sure you are testing on a real iPhone with Family Controls enabled.';
      Alert.alert('Could not choose apps', message);
    } finally {
      setIsPickingBlockedApps(false);
    }
  };

  const blockedItemCount =
    (blockedSelectionSummary?.selectedApps ?? 0) +
    (blockedSelectionSummary?.selectedCategories ?? 0) +
    (blockedSelectionSummary?.selectedWebDomains ?? 0);

  const steps: OnboardingStep[] = [
    {
      id: 0,
      title: 'Welcome to Beddr',
      subtitle: 'Compete by staying off your phone',
      icon: 'trophy',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <Ionicons name="lock-closed" size={24} color={strongColor} />
              <Text style={styles.featureText}>Lock in to track focused, off-phone time</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="trophy" size={24} color={strongColor} />
              <Text style={styles.featureText}>Join competitions with friends using codes</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="cash" size={24} color={strongColor} />
              <Text style={styles.featureText}>Win rewards by finishing in the winner zone</Text>
            </View>
          </View>
        </View>
      ),
    },
    {
      id: 1,
      title: 'How Lock In Works',
      subtitle: 'Your time counts while you stay locked in',
      icon: 'timer',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.stepsContainer}>
            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Tap Lock In</Text>
                <Text style={styles.stepText}>Start a locked session from the home screen.</Text>
              </View>
            </View>

            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Stay Off Your Phone</Text>
                <Text style={styles.stepText}>
                  Your locked time builds while you stay in this app (off of other distracting apps) or have your phone locked. If you choose apps to block, Beddr actively restricts them for the length of your session using Apple Screen Time — otherwise, locked-in time is estimated based on app usage and lock state.
                </Text>
              </View>
            </View>

            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Lock Out and Earn Points</Text>
                <Text style={styles.stepText}>
                  Leaving the app or stopping the session from the home screen ends your session. You earn 1 point per minute locked-in, which goes towards your competitions.
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.claimInfo}>
            <Ionicons name="stats-chart" size={30} color={strongColor} />
            <Text style={styles.claimTitle}>Track Your Minutes</Text>
            <Text style={styles.claimText}>
              Beddr shows your lifetime locked minutes and your locked minutes this week.
            </Text>
          </View>
        </View>
      ),
    },
    {
      id: 2,
      title: 'Choose Apps to Block',
      subtitle: 'Optional — makes lock-in sessions stick',
      icon: 'shield-checkmark',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.claimInfo}>
            <Ionicons name="apps-outline" size={30} color={strongColor} />
            <Text style={styles.claimTitle}>
              {blockedItemCount > 0 ? `${blockedItemCount} selected` : 'No apps selected yet'}
            </Text>
            <Text style={styles.claimText}>
              {blockedSelectionSummary?.isAvailable === false
                ? 'Available on real iPhone builds after native setup.'
                : 'Apple keeps selected app names private, so Beddr stores secure tokens only.'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.chooseAppsButton,
              isPickingBlockedApps && styles.chooseAppsButtonDisabled,
            ]}
            onPress={handleChooseBlockedApps}
            disabled={isPickingBlockedApps}
          >
            <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.chooseAppsButtonText}>
              {isPickingBlockedApps ? 'Opening Picker...' : 'Choose Apps to Block'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.skippableNote}>
            You can skip this and set it up anytime later from your profile.
          </Text>
        </View>
      ),
    },
    {
      id: 3,
      title: 'Meet Your Blob',
      subtitle: 'Your companion lives on your home screen',
      icon: 'moon',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <Ionicons name="moon-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>
                Your blob sleeps while you&apos;re locked out, and wakes up — bouncing, blinking, and all — the moment you lock in
              </Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="sparkles-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>
                Sparkles build up around your blob the more you lock in today, and reset naturally at midnight
              </Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="headset-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>
                While locked in, give your blob a look — headphones, a book, or a laptop — from your home screen
              </Text>
            </View>
          </View>
        </View>
      ),
    },
    {
      id: 4,
      title: "Choose Your Blob's Color",
      subtitle: 'You can always change this later in your profile',
      icon: 'color-palette',
      content: (
        <View style={styles.stepContent}>
          <BlobCompanion hue={companionHue} size={140} />

          <View style={styles.companionColorHeader}>
            <Text style={styles.companionColorSubtitle}>Drag to choose your companion&apos;s hue.</Text>
            <Text style={styles.companionHueValue}>{`${Math.round(companionHue)}°`}</Text>
          </View>

          <Slider
            accessibilityLabel="Blob color hue"
            maximumTrackTintColor="rgba(255,255,255,0.18)"
            maximumValue={359}
            minimumTrackTintColor={strongColor}
            minimumValue={0}
            onValueChange={setCompanionHue}
            step={1}
            style={styles.companionHueSlider}
            thumbTintColor={`hsl(${companionHue}, 82%, 66%)`}
            value={companionHue}
          />
        </View>
      ),
    },
    {
      id: 5,
      title: 'Friends & Locking In Together',
      subtitle: 'Optional — focus is more fun together',
      icon: 'people-circle',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.stepsContainer}>
            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Add Friends</Text>
                <Text style={styles.stepText}>
                  Share your friend code or search by name from the home screen. You control whether your name is searchable and whether your online status is visible, in your privacy settings.
                </Text>
              </View>
            </View>

            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Invite Them to Lock In</Text>
                <Text style={styles.stepText}>
                  While locked in, invite a friend to join you. They&apos;ll see a banner in the app if they have it open — this doesn&apos;t send a push notification.
                </Text>
              </View>
            </View>

            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Lock In Side by Side</Text>
                <Text style={styles.stepText}>
                  Everyone&apos;s companion shows up together in real time, and you can leave the group anytime without ending your own session.
                </Text>
              </View>
            </View>
          </View>
        </View>
      ),
    },
    {
      id: 6,
      title: 'Join or Create Competitions',
      subtitle: 'Play with friends your way',
      icon: 'people',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.stepsContainer}>
            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Join by Code</Text>
                <Text style={styles.stepText}>Enter a friend’s competition code to join instantly.</Text>
              </View>
            </View>

            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Create Your Own</Text>
                <Text style={styles.stepText}>Set a name, reward, date range, and winner rule.</Text>
              </View>
            </View>

            <View style={styles.howItWorksStep}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <View style={styles.stepInfo}>
                <Text style={styles.stepTitle}>Earn Points During the Competition</Text>
                <Text style={styles.stepText}>Only locked minutes inside the competition dates count.</Text>
              </View>
            </View>
          </View>
        </View>
      ),
    },
    {
      id: 7,
      title: 'Different Ways to Win',
      subtitle: 'Each competition can have its own rules',
      icon: 'ribbon',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <Ionicons name="trophy-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>Top # wins — for example, top 1 or top 3 players</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="podium-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>Top % wins — for example, top 10% or 25%</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="people-circle-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>
                Team goal — everyone wins if total team points reach the goal
              </Text>
            </View>
          </View>
        </View>
      ),
    },
    {
      id: 8,
      title: 'See Your Progress',
      subtitle: 'Your profile keeps score',
      icon: 'person',
      content: (
        <View style={styles.stepContent}>
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <Ionicons name="time-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>View your finished competitions</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="bar-chart-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>See wins, average rank, and total competition points</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="create-outline" size={24} color={strongColor} />
              <Text style={styles.featureText}>Edit your display name anytime from your profile</Text>
            </View>
          </View>
        </View>
      ),
    },
    {
      id: 9,
      title: 'Ready to Play?',
      subtitle: 'Sign in to create your profile and start competing',
      icon: 'log-in',
      content: (
        <View style={styles.stepContent}>
          {user ? (
            <View style={styles.signInSuccess}>
              <Ionicons
                name="checkmark-circle"
                size={56}
                color="#10B981"
                style={styles.successCheckmark}
              />
              <Text style={styles.welcomeMessage}>
                Welcome, <Text style={styles.welcomeName}>{user.name}</Text>
              </Text>

              <View style={styles.userInfo}>
                <Text style={styles.userEmail}>{user.email}</Text>
              </View>

              <Text style={styles.successDescription}>
                You’re signed in and ready to start competing.
              </Text>
            </View>
          ) : (
            <View style={styles.signInContainer}>
              <TouchableOpacity
                style={[
                  styles.googleSignInButton,
                  
                ]}
                onPress={handleGoogleSignIn}
                disabled={isSigningIn}
              >
                <Ionicons name="logo-google" size={20} color="#FFFFFF" />
                <Text style={styles.googleSignInButtonText}>
                  Sign in with Google
                </Text>
              </TouchableOpacity>
              {Platform.OS === 'ios' && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={12}
                  style={styles.appleSignInButton}
                  onPress={handleAppleSignIn}
                />
              )}
              <View style={styles.privacyInfo}>
                <Text style={styles.privacyText}>
                  We use Google/Apple sign-in to create your profile and save your progress.
                </Text>

                <Text style={styles.termsText}>
                  By signing in, you agree to our{' '}
                  <Text
                    style={styles.linkText}
                    onPress={() => Linking.openURL('https://www.davidmao.net/beddr/terms')}
                  >
                    Terms of Service
                  </Text> and{' '}
                  <Text
                    style={styles.linkText}
                    onPress={() => Linking.openURL('https://www.davidmao.net/beddr/privacy')}
                  >
                    Privacy Policy
                  </Text>.
                </Text>
              </View>
            </View>
          )}
        </View>
      ),
    },
  ];

  const nextStep = async () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
      scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: true });
      return;
    }

    if (!user) return;

    try {
      await createUserProfile(user);
      onComplete({ user });
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
      scrollViewRef.current?.scrollTo({ x: 0, y: 0, animated: true });
    }
  };

  const canProceed = () => {
    if (currentStep === steps.length - 1) {
      return user !== null && !isCreatingProfile;
    }
    return true;
  };

  const getButtonText = () => {
    if (currentStep === steps.length - 1) {
      return isCreatingProfile ? 'Creating Profile...' : 'Start Competing';
    }
    if (currentStep === 0) return "Let's Begin";
    return 'Continue';
  };

  if (isCheckingExistingAuth) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Ionicons name="moon" size={48} color={strongColor} />
          <Text style={styles.loadingText}>Loading Beddr...</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (showSignedInGate && existingSignedInUser) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.centered, { padding: 24 }]}>
          <View style={styles.iconContainer}>
            <Ionicons name="person-circle-outline" size={40} color={strongColor} />
          </View>

          <Text style={styles.title}>Login</Text>
          <Text style={styles.subtitle}>
            You’re signed in as {existingSignedInUser.name}.
          </Text>

          {/* <View style={styles.userInfo}>
            <Text style={styles.userEmail}>{existingSignedInUser.email}</Text>
          </View> */}

          <View style={styles.gateButtons}>
            <TouchableOpacity
              style={[styles.primaryButton]}
              activeOpacity={0.8}
              onPress={handleUseExistingAccount}
            >
              
              <Text style={styles.primaryButtonText}>Continue</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
              
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton]}
              onPress={handleSignOutFromOnboarding}
            >
              <Text style={styles.secondaryButtonText}>Sign Out</Text>
              <Ionicons name="arrow-back" size={18} color="#B0B0B0" />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                { width: `${((currentStep + 1) / steps.length) * 100}%` },
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
            <Animated.View style={getContentAnimatedStyle()}>
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

              {steps[currentStep].content}
            </Animated.View>
          </View>
        </ScrollView>

        <View style={styles.navigationContainer}>
          <TouchableOpacity
            style={[
              styles.navButton,
              styles.backButton,
              currentStep === 0 && styles.navButtonDisabled,
            ]}
            onPress={prevStep}
            disabled={currentStep === 0}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={currentStep === 0 ? '#666' : strongColor}
            />
            <Text
              style={[
                styles.backButtonText,
                currentStep === 0 && styles.navButtonTextDisabled,
              ]}
            >
              Back
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.navButton,
              styles.nextButton,
              !canProceed() && styles.navButtonDisabled,
            ]}
            onPress={nextStep}
            disabled={!canProceed()}
          >
            <Text
              style={[
                styles.nextButtonText,
                !canProceed() && styles.navButtonTextDisabled,
              ]}
            >
              {getButtonText()}
            </Text>
            {currentStep < steps.length - 1 && (
              <Ionicons
                name="chevron-forward"
                size={20}
                color={!canProceed() ? '#666' : '#FFFFFF'}
              />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  termsText: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 16,
    fontFamily: defFontType,
  },

  linkText: {
    color: strongColor,
    textDecorationLine: 'underline',
  },
  container: {
    flex: 1,
    backgroundColor: bgColor,
  },
  keyboardView: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 14,
    fontSize: 16,
    color: '#FFFFFF',
    fontFamily: defFontType,
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
    fontFamily: defFontType,
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
    fontFamily: defFontType,
  },
  subtitle: {
    fontSize: 16,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: defFontType,
  },
  stepContent: {
    flex: 1,
    alignItems: 'center',
  },
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
    flex: 1,
    fontFamily: defFontType,
  },
  claimInfo: {
    backgroundColor: lbgColor,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  chooseAppsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: strongColor,
    borderRadius: 14,
    paddingVertical: 15,
    width: '100%',
    gap: 8,
  },
  chooseAppsButtonDisabled: {
    opacity: 0.68,
  },
  chooseAppsButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: defFontType,
  },
  skippableNote: {
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
    marginTop: 16,
    fontFamily: defFontType,
  },
  companionColorHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    width: '100%',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: 24,
  },
  companionColorSubtitle: {
    color: '#B0B0B0',
    fontFamily: defFontType,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  companionHueValue: {
    color: strongColor,
    fontFamily: defFontType,
    fontSize: 14,
    fontWeight: '700',
  },
  companionHueSlider: {
    height: 40,
    marginTop: 8,
    width: '100%',
  },
  claimTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginTop: 10,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: defFontType,
  },
  claimText: {
    fontSize: 14,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: defFontType,
  },
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
    fontFamily: defFontType,
  },
  stepInfo: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
    fontFamily: defFontType,
  },
  stepText: {
    fontSize: 14,
    color: '#B0B0B0',
    lineHeight: 20,
    fontFamily: defFontType,
  },
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
    fontFamily: defFontType,
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
    fontFamily: defFontType,
  },
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
    fontFamily: defFontType,
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
    fontFamily: defFontType,
  },
  successDescription: {
    fontSize: 16,
    color: '#B0B0B0',
    textAlign: 'center',
    lineHeight: 24,
    fontFamily: defFontType,
  },
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
    fontFamily: defFontType,
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginRight: 4,
    fontFamily: defFontType,
  },
  navButtonTextDisabled: {
    color: '#666',
  },
  appleSignInButton: {
    width: '100%',
    height: 52,
    marginBottom: 20,
  },
  gateButtons: {
    width: '100%',
    maxWidth: 320,
    alignSelf: 'center',
    marginTop: 20,
  },

  primaryButton: {
    backgroundColor: strongColor,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,

    flexDirection: "row",
    gap: 8,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: defFontType,
  },

  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',

    flexDirection: "row",
    gap: 8,
  },

  secondaryButtonText: {
    color: '#B0B0B0',
    fontSize: 14,
    fontWeight: '500',
    fontFamily: defFontType,
  },
});
