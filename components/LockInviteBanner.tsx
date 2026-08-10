import { Ionicons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { firestore } from '../firebase';
import { acceptLockInvite, declineLockInvite } from '../lib/lockSessions';

const strongColor = '#cc7bdbff';
const bannerColor = '#1c1c3aff';
const defFontType = 'OpenSansSemiBold';

type PendingInvite = {
  id: string;
  fromUid: string;
  fromName: string;
  sessionId: string;
};

type LockInviteBannerProps = {
  uid: string | null;
  myName: string;
  isLockedIn: boolean;
  triggerLockIn: () => Promise<boolean>;
};

export function LockInviteBanner({ uid, myName, isLockedIn, triggerLockIn }: LockInviteBannerProps) {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [companionHue, setCompanionHue] = useState(0);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) {
      setInvites([]);
      return;
    }

    const invitesQuery = query(
      collection(firestore, 'lockInvites'),
      where('toUid', '==', uid),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      invitesQuery,
      (snapshot) => {
        setInvites(
          snapshot.docs.map((docSnap) => {
            const data = docSnap.data() as any;
            return {
              id: docSnap.id,
              fromUid: data.fromUid,
              fromName: data.fromName || 'A friend',
              sessionId: data.sessionId,
            };
          })
        );
      },
      (error) => {
        console.error('Error fetching lock invites:', error);
      }
    );

    return unsubscribe;
  }, [uid]);

  useEffect(() => {
    if (!uid) return;

    const unsubscribe = onSnapshot(
      doc(firestore, 'profiledb', uid),
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : null;
        setCompanionHue(data?.companionHue ?? 0);
        setActiveSessionId(data?.activeLockSessionId ?? null);
      },
      (error) => {
        console.error('Error fetching own profile:', error);
      }
    );

    return unsubscribe;
  }, [uid]);

  if (!uid || invites.length === 0) return null;

  const invite = invites[0];
  const isResponding = respondingId === invite.id;

  const handleAccept = async () => {
    setRespondingId(invite.id);
    try {
      if (!isLockedIn) {
        const lockedInSuccessfully = await triggerLockIn();
        if (!lockedInSuccessfully) return;
      }
      await acceptLockInvite(invite.id, invite.sessionId, uid, myName, companionHue, activeSessionId);
    } catch (error) {
      console.error('Failed to accept lock invite:', error);
      Alert.alert('Error', 'Could not join the lock-in session. Please try again.');
    } finally {
      setRespondingId(null);
    }
  };

  const handleDecline = async () => {
    setRespondingId(invite.id);
    try {
      await declineLockInvite(invite.id);
    } catch (error) {
      console.error('Failed to decline lock invite:', error);
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.banner}>
        <Ionicons name="moon" size={20} color={strongColor} />
        <Text style={styles.text} numberOfLines={2}>
          <Text style={styles.name}>{invite.fromName}</Text> wants to lock in with you
        </Text>

        {isResponding ? (
          <ActivityIndicator color={strongColor} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.acceptButton}
              onPress={handleAccept}
              accessibilityLabel="Accept lock-in invite"
            >
              <Ionicons name="checkmark" size={18} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.declineButton}
              onPress={handleDecline}
              accessibilityLabel="Decline lock-in invite"
            >
              <Ionicons name="close" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 999,
  },
  banner: {
    marginTop: 60,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: bannerColor,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
    maxWidth: '90%',
    borderWidth: 1,
    borderColor: 'rgba(204, 123, 219, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  text: {
    flex: 1,
    color: '#FFFFFF',
    fontFamily: defFontType,
    fontSize: 13,
  },
  name: {
    color: strongColor,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
