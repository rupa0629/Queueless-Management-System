import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase.ts';
import type { QueueTokenPass, TokenStatus } from '../shared/types.ts';

export interface CloudSavedToken {
  uid: string;
  tokenId: string;
  tokenCode: string;
  serviceCode: 'HOPD' | 'BANK' | 'PASS' | 'LIB';
  pin: string;
  status: TokenStatus;
  bookedForName: string;
}

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  authError: string | null;
  cloudTokens: CloudSavedToken[];
  signInWithGoogle: () => Promise<void>;
  signOutCitizen: () => Promise<void>;
  syncTokenToCloud: (pass: QueueTokenPass) => Promise<void>;
  updateCloudTokenStatus: (tokenId: string, status: TokenStatus) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloudTokens, setCloudTokens] = useState<CloudSavedToken[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (nextUser && nextUser.emailVerified && nextUser.email) {
        const profilePath = `users/${nextUser.uid}/private/profile`;
        try {
          await setDoc(
            doc(db, 'users', nextUser.uid, 'private', 'profile'),
            {
              uid: nextUser.uid,
              displayName: (nextUser.displayName || nextUser.email.split('@')[0]).slice(0, 100),
              email: nextUser.email.slice(0, 160),
              preferredLang: 'en',
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (err) {
          console.warn('Citizen profile sync skipped:', err);
          if (err instanceof Error && err.message.includes('Missing or insufficient permissions')) {
            handleFirestoreError(err, OperationType.WRITE, profilePath);
          }
        }
      } else {
        setCloudTokens([]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) {
      setCloudTokens([]);
      return;
    }

    const tokensPath = `users/${user.uid}/tokens`;
    const q = query(
      collection(db, 'users', user.uid, 'tokens'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: CloudSavedToken[] = [];
        snap.forEach((d) => {
          const data = d.data() as CloudSavedToken;
          items.push(data);
        });
        setCloudTokens(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, tokensPath);
      }
    );

    return () => unsub();
  }, [authReady, user]);

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to sign in with Google.');
    }
  }, []);

  const signOutCitizen = useCallback(async () => {
    setAuthError(null);
    await signOut(auth);
  }, []);

  const syncTokenToCloud = useCallback(
    async (pass: QueueTokenPass) => {
      if (!user || !user.emailVerified) return;
      const docPath = `users/${user.uid}/tokens/${pass.id}`;
      try {
        await setDoc(doc(db, 'users', user.uid, 'tokens', pass.id), {
          uid: user.uid,
          tokenId: pass.id,
          tokenCode: pass.tokenCode,
          serviceCode: pass.serviceCode,
          pin: pass.pin,
          status: pass.status,
          bookedForName: pass.fullName.slice(0, 100),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, docPath);
      }
    },
    [user]
  );

  const updateCloudTokenStatus = useCallback(
    async (tokenId: string, status: TokenStatus) => {
      if (!user || !user.emailVerified) return;
      const docPath = `users/${user.uid}/tokens/${tokenId}`;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'tokens', tokenId), {
          status,
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Non-blocking if token wasn't previously synced to this account
      }
    },
    [user]
  );

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        authError,
        cloudTokens,
        signInWithGoogle,
        signOutCitizen,
        syncTokenToCloud,
        updateCloudTokenStatus,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const ctx = useContext(FirebaseContext);
  if (!ctx) throw new Error('useFirebase must be used inside FirebaseProvider');
  return ctx;
}
