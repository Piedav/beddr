import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlobAvatar } from './BlobAvatar';
import { firestore } from '../firebase';
import { sendFriendRequestToUid } from '../lib/friends';

const RESULT_AVATAR_SIZE = 40;

const bgColor = '#111124ff';
const l2bgColor = '#322f4eff';
const strongColor = '#cc7bdbff';
const labelColor = 'rgb(180, 180, 188)';
const defFontType = 'OpenSansSemiBold';

type SearchResult = {
  uid: string;
  name: string;
  companionHue: number;
};

type FriendSearchModalProps = {
  visible: boolean;
  onClose: () => void;
  uid: string;
  myName: string;
  friendUids: string[];
};

export function FriendSearchModal({
  visible,
  onClose,
  uid,
  myName,
  friendUids,
}: FriendSearchModalProps) {
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [outgoingPendingUids, setOutgoingPendingUids] = useState<Set<string>>(new Set());
  const [sendingToUid, setSendingToUid] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setSearchInput('');
      setResults([]);
      return;
    }

    getDocs(
      query(
        collection(firestore, 'friendRequests'),
        where('fromUid', '==', uid),
        where('status', '==', 'pending')
      )
    )
      .then((snap) => {
        setOutgoingPendingUids(new Set(snap.docs.map((d) => (d.data() as any).toUid)));
      })
      .catch((err) => console.error('Failed to load pending requests:', err));
  }, [visible, uid]);

  useEffect(() => {
    const trimmed = searchInput.trim().toLowerCase();

    if (trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const timeout = setTimeout(async () => {
      try {
        const snap = await getDocs(
          query(
            collection(firestore, 'profiledb'),
            where('searchable', '==', true),
            where('nameLower', '>=', trimmed),
            where('nameLower', '<=', trimmed + ''),
            limit(20)
          )
        );

        setResults(
          snap.docs
            .map((docSnap) => ({
              uid: docSnap.id,
              name: (docSnap.data() as any).name?.trim() || 'User',
              companionHue: (docSnap.data() as any).companionHue ?? 0,
            }))
            .filter((result) => result.uid !== uid)
        );
      } catch (error) {
        console.error('Friend search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchInput, uid]);

  const handleSendRequest = async (result: SearchResult) => {
    setSendingToUid(result.uid);

    try {
      await sendFriendRequestToUid(uid, myName, result.uid);
      setOutgoingPendingUids((prev) => new Set(prev).add(result.uid));
    } catch (error: any) {
      Alert.alert('Could not send request', error?.message ?? 'Please try again.');
    } finally {
      setSendingToUid(null);
    }
  };

  const trimmedQuery = searchInput.trim();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Find Friends</Text>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={labelColor} />
          <TextInput
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search by name"
            placeholderTextColor="#8A8A8A"
            style={styles.searchInput}
            autoFocus
            autoCapitalize="none"
          />
        </View>

        <ScrollView style={styles.resultsScroll} keyboardShouldPersistTaps="handled">
          {isSearching && <ActivityIndicator color={strongColor} style={styles.loadingIndicator} />}

          {!isSearching && trimmedQuery.length >= 2 && results.length === 0 && (
            <Text style={styles.helperText}>No one found with that name.</Text>
          )}

          {!isSearching && trimmedQuery.length < 2 && (
            <Text style={styles.helperText}>Type at least 2 letters of someone&apos;s name.</Text>
          )}

          {results.map((result) => {
            const isFriend = friendUids.includes(result.uid);
            const isPending = outgoingPendingUids.has(result.uid);
            const isSending = sendingToUid === result.uid;

            return (
              <View key={result.uid} style={styles.resultRow}>
                <View style={styles.resultAvatar}>
                  <BlobAvatar hue={result.companionHue} size={RESULT_AVATAR_SIZE} />
                </View>

                <Text style={styles.resultName} numberOfLines={1}>
                  {result.name}
                </Text>

                {isFriend ? (
                  <View style={styles.statusPill}>
                    <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                    <Text style={styles.statusPillText}>Friends</Text>
                  </View>
                ) : isPending ? (
                  <View style={styles.statusPill}>
                    <Text style={styles.statusPillText}>Requested</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.addButton}
                    onPress={() => handleSendRequest(result)}
                    disabled={isSending}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${result.name} as a friend`}
                  >
                    {isSending ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Ionicons name="person-add-outline" size={16} color="#FFFFFF" />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '18%',
    backgroundColor: bgColor,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: defFontType,
    padding: 0,
  },
  resultsScroll: {
    flex: 1,
  },
  loadingIndicator: {
    marginTop: 24,
  },
  helperText: {
    fontFamily: defFontType,
    color: labelColor,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 20,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  resultAvatar: {
    width: RESULT_AVATAR_SIZE,
    height: RESULT_AVATAR_SIZE,
    borderRadius: RESULT_AVATAR_SIZE / 2,
    backgroundColor: 'rgba(157, 78, 221, 0.15)',
    borderWidth: 1,
    borderColor: strongColor,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resultName: {
    flex: 1,
    fontFamily: defFontType,
    color: '#FFFFFF',
    fontSize: 15,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: l2bgColor,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 4,
  },
  statusPillText: {
    fontFamily: defFontType,
    color: labelColor,
    fontSize: 12,
    fontWeight: '600',
  },
  addButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: strongColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
