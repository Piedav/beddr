import {
  collection,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { firestore } from '../firebase';

export type SessionMember = {
  joinedAt: number;
  name: string;
  companionHue: number;
};

export type LockSession = {
  hostUid: string;
  createdAt: unknown;
  status: 'active' | 'ended';
  members: Record<string, SessionMember>;
};

async function ensureOwnSession(
  uid: string,
  name: string,
  companionHue: number,
  existingSessionId?: string | null
): Promise<string> {
  if (existingSessionId) {
    const snap = await getDoc(doc(firestore, 'lockSessions', existingSessionId));
    if (snap.exists()) {
      const data = snap.data() as LockSession;
      // Also confirm we're still actually a member — activeLockSessionId can
      // go stale if leaveLockSession's trailing profile update ever fails
      // after its transaction already removed us, and reusing a session
      // we're not part of would silently attach a friend to it without us.
      if (data.status === 'active' && uid in data.members) {
        return existingSessionId;
      }
    }
  }

  const sessionRef = doc(collection(firestore, 'lockSessions'));

  await setDoc(sessionRef, {
    hostUid: uid,
    createdAt: serverTimestamp(),
    status: 'active',
    members: {
      [uid]: { joinedAt: Date.now(), name, companionHue },
    },
  });

  await updateDoc(doc(firestore, 'profiledb', uid), {
    activeLockSessionId: sessionRef.id,
  });

  return sessionRef.id;
}

/**
 * Invites a friend to lock in together. Creates (or reuses) the inviter's
 * own active session, then drops a pending invite for the recipient.
 */
export async function inviteFriendToLockIn(
  fromUid: string,
  fromName: string,
  fromCompanionHue: number,
  toUid: string,
  existingSessionId?: string | null
): Promise<void> {
  const sessionId = await ensureOwnSession(fromUid, fromName, fromCompanionHue, existingSessionId);

  await setDoc(doc(collection(firestore, 'lockInvites')), {
    fromUid,
    fromName,
    toUid,
    sessionId,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

export async function acceptLockInvite(
  inviteId: string,
  sessionId: string,
  uid: string,
  name: string,
  companionHue: number,
  previousSessionId?: string | null
): Promise<void> {
  // A user's activeLockSessionId can only ever point to one session, so they
  // must never remain a `members` entry in a different, older one — leave it
  // first. Without this, accepting a second invite while already in a
  // session leaves you a stale member of the old session (everyone still in
  // it keeps seeing you there) while you and the new host see yourselves as
  // a separate pair.
  if (previousSessionId && previousSessionId !== sessionId) {
    await leaveLockSession(previousSessionId, uid);
  }

  await updateDoc(doc(firestore, 'lockInvites', inviteId), { status: 'accepted' });

  await updateDoc(doc(firestore, 'lockSessions', sessionId), {
    [`members.${uid}`]: { joinedAt: Date.now(), name, companionHue },
  });

  await updateDoc(doc(firestore, 'profiledb', uid), {
    activeLockSessionId: sessionId,
  });
}

export async function declineLockInvite(inviteId: string): Promise<void> {
  await updateDoc(doc(firestore, 'lockInvites', inviteId), { status: 'declined' });
}

/**
 * Removes the user from a lock session (called on lock-out). Ends the
 * session if that was the last member. Transaction-safe against concurrent
 * leaves.
 */
export async function leaveLockSession(sessionId: string, uid: string): Promise<void> {
  const sessionRef = doc(firestore, 'lockSessions', sessionId);

  await runTransaction(firestore, async (transaction) => {
    const snap = await transaction.get(sessionRef);
    if (!snap.exists()) return;

    const data = snap.data() as LockSession;
    const remainingMembers = { ...data.members };
    delete remainingMembers[uid];

    transaction.update(sessionRef, {
      [`members.${uid}`]: deleteField(),
      ...(Object.keys(remainingMembers).length === 0 ? { status: 'ended' } : {}),
    });
  });

  await updateDoc(doc(firestore, 'profiledb', uid), {
    activeLockSessionId: null,
  });
}
