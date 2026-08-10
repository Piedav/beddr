import { Ionicons } from '@expo/vector-icons'; //icons
import AsyncStorage from '@react-native-async-storage/async-storage'; //storage on the device
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useFonts } from "expo-font";
import { Tabs } from 'expo-router'; //this is for the tab bar at the bottom :)
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from 'expo-status-bar'; //status of bar style and whatnot
import { signOut } from 'firebase/auth';
import React, { createContext, useContext, useEffect, useState } from 'react'; //shares data across the oteher files
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LockInviteBanner } from '../components/LockInviteBanner';
import { auth } from '../firebase';
import OnboardingScreen from './onboarding'; //yeah


const bgColor = "#111124ff"; //background
const strongColor = "#cc7bdbff"; //strong color
const inactiveColor = '#B0B0B0';

interface UserData { //format of data that gets shared through the async thingy
  uid: string;
  name: string;
  email: string;
  profilePicture?: string;
  bedtime: string;
  wakeTime: string;
  notifications: boolean;
}

const UserContext = createContext<{ //creates a thing for the user
  userData: UserData | null;
  setUserData: (data: UserData | null) => void;
  resetToOnboarding: () => Promise<void>;
}>({ //defaults
  userData: null,
  setUserData: () => {},
  resetToOnboarding: async () => {},
});

const LockControlContext = createContext<{
  isLockedIn: boolean;
  setIsLockedIn: (locked: boolean) => void;
  toggleLockIn: () => Promise<boolean>;
  registerLockToggle: (handler: (() => Promise<boolean>) | null) => void;
}>({
  isLockedIn: false,
  setIsLockedIn: () => {},
  toggleLockIn: async () => false,
  registerLockToggle: () => {},
});

// hook to use user context
export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  if(context == null) {
    throw new Error('the user is returning null');
  }
  return context;
};

export const useLockControl = () => {
  const context = useContext(LockControlContext);
  if (!context) {
    throw new Error('useLockControl must be used within a LockControlProvider');
  }
  return context;
};

const tabIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home',
  competition: 'trophy',
  join: 'add-circle-outline',
  profile: 'person',
};

const tabLabels: Record<string, string> = {
  index: 'Home',
  competition: 'Competition',
  join: 'Join/Create',
  profile: 'Profile',
};

function BeddrTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { isLockedIn, toggleLockIn } = useLockControl();
  const visibleRoutes = state.routes.filter((route) => route.name !== 'onboarding');

  const renderRouteButton = (route: (typeof state.routes)[number]) => {
    const routeIndex = state.routes.findIndex((item) => item.key === route.key);
    const focused = state.index === routeIndex;
    const color = focused ? strongColor : inactiveColor;
    const options = descriptors[route.key]?.options;
    const label =
      typeof options?.title === 'string'
        ? options.title
        : tabLabels[route.name] ?? route.name;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name, route.name === 'competition' ? {} : route.params);
      }
    };

    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={options?.tabBarAccessibilityLabel}
        activeOpacity={0.72}
        onPress={onPress}
        style={styles.tabItem}
      >
        <Ionicons
          name={tabIcons[route.name] ?? 'ellipse-outline'}
          size={24}
          color={color}
        />
        <Text style={[styles.tabLabel, { color }]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View pointerEvents="box-none" style={styles.tabBarWrap}>
      <View style={styles.tabBar}>
        {visibleRoutes.slice(0, 2).map(renderRouteButton)}

        <TouchableOpacity
          activeOpacity={0.82}
          accessibilityRole="button"
          accessibilityLabel={isLockedIn ? 'Lock out' : 'Lock in'}
          onPress={toggleLockIn}
          style={[
            styles.lockTabButton,
            isLockedIn && styles.lockTabButtonPressed,
          ]}
        >
          <Ionicons
            name={isLockedIn ? 'lock-closed' : 'lock-open-outline'}
            size={30}
            color="#FFFFFF"
          />
        </TouchableOpacity>

        {visibleRoutes.slice(2).map(renderRouteButton)}
      </View>
    </View>
  );
}

function TabsLayout() { //the tabs at the bottom :))
  return (
    <Tabs
      tabBar={(props) => <BeddrTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: false,
        sceneStyle: {
          backgroundColor: bgColor,
        },
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          borderTopColor: 'transparent',
          elevation: 0,
          shadowColor: 'transparent',
          shadowOpacity: 0,
          height: 80,
          paddingBottom: 20,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="competition"
        options={{
          //href: null, //hide it
          title: 'Competition',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="join"
        options={{
          title: 'Join/Create',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="onboarding"
        options={{
          // title: 'Onboarding',
          // tabBarIcon: ({ color, size }) => (
          //   <Ionicons name="person" size={size} color={color} />
          // ),
          href: null, // change this if you wanna get onboarding
        }}
      />
    </Tabs>
  );
}

export default function RootLayout() {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLockedIn, setIsLockedIn] = useState(false);
  const [lockToggleHandler, setLockToggleHandler] = useState<(() => Promise<boolean>) | null>(null);

  const [fontsLoaded] = useFonts({
    Molengo: require("../assets/fonts/Molengo-Regular.ttf"),
    OpenSans: require("../assets/fonts/OpenSans-Regular.ttf"),
    OpenSansSemiBold: require("../assets/fonts/OpenSans-SemiBold.ttf")
  });

  useEffect(() => {
    SplashScreen.preventAutoHideAsync();
  }, []);

  useEffect(() => {
    // Configured here (not just in onboarding) so GoogleSignin.signOut() in
    // resetToOnboarding works even if OnboardingScreen never mounted this
    // session (i.e. the user is logging out from an already-signed-in state).
    GoogleSignin.configure({
      iosClientId:
        '188667592970-h4hmpdbimh2ghdv49srbcmoun8h670g7.apps.googleusercontent.com',
      scopes: ['profile', 'email', 'openid'],
    });
  }, []);

  useEffect(() => {
    if (!isLoading && fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [isLoading, fontsLoaded]);

  useEffect(() => {
    checkOnboardingStatus(); //check from the async storage (see the thing below)
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      // Check if user has completed onboarding
      const status = await AsyncStorage.getItem('hasCompletedOnboarding'); // 'true' or 'false'
      
      // If onboarding is complete, load user data
      if (status === 'true') { 
        const savedUserData = await AsyncStorage.getItem('userData');
        if (savedUserData) { //if it exists
          const parsedUserData = JSON.parse(savedUserData);
          setUserData(parsedUserData);
          setHasCompletedOnboarding(true);
        } else {
          // If onboarding status is true but no user data, reset onboarding
          await AsyncStorage.removeItem('hasCompletedOnboarding');
        }
      }
    } catch (error) {
      console.error('Error checking onboarding status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOnboardingComplete = async (onboardingData: any) => {
    try {
      // Extract user data from onboarding
      const newUserData: UserData = {
        uid: onboardingData.user.uid,
        name: onboardingData.user.name,
        email: onboardingData.user.email,
        profilePicture: onboardingData.user.profilePicture,
        bedtime: onboardingData.bedtime,
        wakeTime: onboardingData.wakeTime,
        notifications: onboardingData.notifications,
      };

      // Save user data to AsyncStorage and state
      await AsyncStorage.setItem('userData', JSON.stringify(newUserData));
      await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
      
      setUserData(newUserData);
      setHasCompletedOnboarding(true);
      
      console.log('User data saved:', newUserData);
    } catch (error) {
      console.error('Error saving onboarding data:', error);
    }
  };

  // Function to update user data (useful for profile updates)
  const updateUserData = async (updatedData: Partial<UserData>) => {
    if (userData) {
      const newUserData = { ...userData, ...updatedData };
      try {
        await AsyncStorage.setItem('userData', JSON.stringify(newUserData));
        setUserData(newUserData);
      } catch (error) {
        console.error('Error updating user data:', error);
      }
    }
  };

  // Function to completely reset all AsyncStorage and return to onboarding
  const resetToOnboarding = async () => {
    try {
      console.log('Starting app reset...');

      // Actually sign out of Firebase (and Google, if that's how the user
      // signed in) so this is a real logout. Without this, Firebase Auth
      // stays signed in behind the scenes, onboarding's "still signed in"
      // gate screen shows up, and if the user then signs back in with a
      // *different* provider than they originally used (Apple vs Google),
      // Firebase silently creates a brand new account with an empty
      // profile instead of returning to their existing one.
      await signOut(auth).catch((err) =>
        console.error('Error signing out of Firebase:', err)
      );
      await GoogleSignin.signOut().catch(() => {});

      // Clear all AsyncStorage data
      await AsyncStorage.clear();
      console.log('AsyncStorage cleared');
      
      // Reset all state variables
      setUserData(null);
      setHasCompletedOnboarding(false);
      setIsLoading(false);
      
      console.log('State reset complete - should show onboarding now');
    } catch (error) {
      console.error('Error during reset:', error);
      // Force state reset even if AsyncStorage fails
      setUserData(null);
      setHasCompletedOnboarding(false);
      setIsLoading(false);
    }
  };

  const registerLockToggle = React.useCallback((handler: (() => Promise<boolean>) | null) => {
    setLockToggleHandler(() => handler);
  }, []);

  const toggleLockIn = React.useCallback(async () => {
    if (lockToggleHandler) {
      return await lockToggleHandler();
    }
    return false;
  }, [lockToggleHandler]);

  if (isLoading || !fontsLoaded) {
    return <StatusBar style="light" backgroundColor="#000000" />;
  }
  // Show a loading state while checking AsyncStorage
  if (isLoading) {
    return <StatusBar style="light" backgroundColor="#000000" />;
  }

  return (
    <LockControlContext.Provider
      value={{
        isLockedIn,
        setIsLockedIn,
        toggleLockIn,
        registerLockToggle,
      }}
    >
      <UserContext.Provider 
        value={{ 
          userData, 
          setUserData: (data) => {
            setUserData(data);
            if (data) {
              updateUserData(data);
            }
          },
          resetToOnboarding
        }}
      >
        <StatusBar style="light" backgroundColor="#000000" />
        {hasCompletedOnboarding ? (
          <>
            <TabsLayout />
            <LockInviteBanner
              uid={userData?.uid ?? null}
              myName={userData?.name ?? 'You'}
              isLockedIn={isLockedIn}
              triggerLockIn={toggleLockIn}
            />
          </>
        ) : (
          <OnboardingScreen onComplete={handleOnboardingComplete} />
        )}
      </UserContext.Provider>
    </LockControlContext.Provider>
  );
}

const styles = StyleSheet.create({
  tabBarWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 86,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  tabBar: {
    height: 80,
    paddingBottom: 18,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: 'transparent',
  },
  tabItem: {
    width: 70,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
  },
  lockTabButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: strongColor,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: strongColor,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  lockTabButtonPressed: {
    backgroundColor: 'rgb(100, 65, 106)',
    shadowColor: 'rgb(100, 65, 106)',
  },
});
