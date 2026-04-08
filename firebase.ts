import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth as fallbackGetAuth, initializeAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";

// @ts-ignore
import { getReactNativePersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC_N4RLmNAa8II0jW0Vxf-EZ_UMQIdkem4",
  authDomain: "beddr-7eebe.firebaseapp.com",
  projectId: "beddr-7eebe",
  storageBucket: "beddr-7eebe.firebasestorage.app",
  messagingSenderId: "188667592970",
  appId: "1:188667592970:web:2be38262e5f077cd75faf3",
  measurementId: "G-QW956Q8NZN",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Firestore once. If it already exists, reuse it.
export const firestore = (() => {
  try {
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
  } catch (e: any) {
    return getFirestore(app);
  }
})();

// Initialize Auth once. If it already exists, reuse it.
export const auth = (() => {
  try {
    return initializeAuth(app, {
      // @ts-ignore
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (e: any) {
    return fallbackGetAuth(app);
  }
})();