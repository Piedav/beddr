import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '../firebase';

const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomFriendCode(len = 6) {
  let code = '';
  for (let i = 0; i < len; i++) {
    code += FRIEND_CODE_ALPHABET[Math.floor(Math.random() * FRIEND_CODE_ALPHABET.length)];
  }
  return code;
}

export function friendshipId(uidA: string, uidB: string) {
  return [uidA, uidB].sort().join('_');
}

/**
 * Lazily creates and persists a friend code for a user if they don't already
 * have one. Safe to call repeatedly (e.g. on every profile load).
 */
export async function ensureFriendCode(
  uid: string,
  existingCode?: string | null
): Promise<string> {
  if (existingCode) return existingCode;

  for (let i = 0; i < 5; i++) {
    const code = randomFriendCode();
    const codeRef = doc(firestore, 'friendCodes', code);
    const snap = await getDoc(codeRef);
    if (snap.exists()) continue;

    await setDoc(codeRef, { uid });
    await updateDoc(doc(firestore, 'profiledb', uid), { friendCode: code });
    return code;
  }

  throw new Error('Could not generate a unique friend code. Please try again.');
}

async function createFriendRequest(
  fromUid: string,
  fromName: string,
  toUid: string
): Promise<void> {
  if (toUid === fromUid) {
    throw new Error("That's you!");
  }

  const existingFriendship = await getDoc(
    doc(firestore, 'friendships', friendshipId(fromUid, toUid))
  );
  if (existingFriendship.exists()) {
    throw new Error('You are already friends.');
  }

  const [outgoing, incoming] = await Promise.all([
    getDocs(
      query(
        collection(firestore, 'friendRequests'),
        where('fromUid', '==', fromUid),
        where('toUid', '==', toUid),
        where('status', '==', 'pending')
      )
    ),
    getDocs(
      query(
        collection(firestore, 'friendRequests'),
        where('fromUid', '==', toUid),
        where('toUid', '==', fromUid),
        where('status', '==', 'pending')
      )
    ),
  ]);

  if (!outgoing.empty) {
    throw new Error("You've already sent this person a request.");
  }
  if (!incoming.empty) {
    throw new Error(
      'This person already sent you a request — check your pending requests to accept it.'
    );
  }

  await setDoc(doc(collection(firestore, 'friendRequests')), {
    fromUid,
    fromName,
    toUid,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function sendFriendRequest(
  fromUid: string,
  fromName: string,
  codeInput: string
): Promise<void> {
  const code = codeInput.trim().toUpperCase();
  if (!code) throw new Error('Enter a friend code.');

  const codeSnap = await getDoc(doc(firestore, 'friendCodes', code));
  if (!codeSnap.exists()) {
    throw new Error('No one has that friend code.');
  }

  const toUid = (codeSnap.data() as { uid: string }).uid;
  await createFriendRequest(fromUid, fromName, toUid);
}

/**
 * Same as sendFriendRequest, but for when the recipient's uid is already
 * known (e.g. from a search result) instead of needing to resolve a code.
 */
export async function sendFriendRequestToUid(
  fromUid: string,
  fromName: string,
  toUid: string
): Promise<void> {
  await createFriendRequest(fromUid, fromName, toUid);
}

export async function acceptFriendRequest(
  requestId: string,
  fromUid: string,
  toUid: string
): Promise<void> {
  const batch = writeBatch(firestore);

  batch.update(doc(firestore, 'friendRequests', requestId), { status: 'accepted' });
  batch.set(doc(firestore, 'friendships', friendshipId(fromUid, toUid)), {
    uids: [fromUid, toUid],
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await updateDoc(doc(firestore, 'friendRequests', requestId), { status: 'declined' });
}

export async function unfriend(myUid: string, friendUid: string): Promise<void> {
  await deleteDoc(doc(firestore, 'friendships', friendshipId(myUid, friendUid)));
}

/**
 * Starring is a personal, one-directional preference — it lives on the
 * starrer's own profiledb doc, not the shared friendship doc, so it never
 * needs the other person's permission to change.
 */
export async function setFriendStarred(
  myUid: string,
  friendUid: string,
  starred: boolean
): Promise<void> {
  await updateDoc(doc(firestore, 'profiledb', myUid), {
    starredFriends: starred ? arrayUnion(friendUid) : arrayRemove(friendUid),
  });
}
