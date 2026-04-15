import { Ionicons } from '@expo/vector-icons'; //icons
import AsyncStorage from '@react-native-async-storage/async-storage'; //storage on the device
import { useFonts } from "expo-font";
import { Tabs } from 'expo-router'; //this is for the tab bar at the bottom :)
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from 'expo-status-bar'; //status of bar style and whatnot
import React, { createContext, useContext, useEffect, useState } from 'react'; //shares data across the oteher files
import OnboardingScreen from './onboarding'; //yeah


const dbgColor = "#0a0513ff"; //dark background
const bgColor = "#111124ff"; //background
const lbgColor = "#322f4e81"; //light background
const l2bgColor = "#322f4eff"; //2nd light background
const l3bgColor = "#323150"; //3nd light background
const strongColor = "#cc7bdbff"; //strong color

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

function TabsLayout() { //the tabs at the bottom :))
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: dbgColor,
          borderTopWidth: 2,
          borderTopColor: l3bgColor,
          height: 80,
          paddingBottom: 20,
          paddingTop: 8,
        },
        tabBarActiveTintColor: strongColor,
        tabBarInactiveTintColor: '#B0B0B0',
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
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
          href: null, //hide it
          title: 'Competition',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="log"
        options={{
          title: 'Log',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" size={size} color={color} />
          ),
          href: null,
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
          href: null, // change this david if you wanna get onboarding
        }}
      />
    </Tabs>
  );
}

export default function RootLayout() {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userData, setUserData] = useState<UserData | null>(null);

  const [fontsLoaded] = useFonts({
    Molengo: require("../assets/fonts/Molengo-Regular.ttf"),
    OpenSans: require("../assets/fonts/OpenSans-Regular.ttf"),
    OpenSansSemiBold: require("../assets/fonts/OpenSans-SemiBold.ttf")
  });

  useEffect(() => {
    SplashScreen.preventAutoHideAsync();
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

  // Function to logout (clear all data) - now uses resetToOnboarding
  const logout = async () => {
    await resetToOnboarding();
  };
  if (isLoading || !fontsLoaded) {
    return <StatusBar style="light" backgroundColor="#000000" />;
  }
  // Show a loading state while checking AsyncStorage
  if (isLoading) {
    return <StatusBar style="light" backgroundColor="#000000" />;
  }

  return (
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
        <TabsLayout />
      ) : (
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      )}
    </UserContext.Provider>
  );
}
