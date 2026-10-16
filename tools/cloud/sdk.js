import { initializeApp } from 'firebase/app';
import { getAuth, browserLocalPersistence, setPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, runTransaction, serverTimestamp, collection, query, orderBy, limit, getDocsFromServer, connectFirestoreEmulator } from 'firebase/firestore';
import { connectAuthEmulator } from 'firebase/auth';
window.G.CloudSDK = { initializeApp, getAuth, browserLocalPersistence, setPersistence, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile, onAuthStateChanged, getFirestore, doc, getDocFromServer, runTransaction, serverTimestamp, collection, query, orderBy, limit, getDocsFromServer, connectFirestoreEmulator, connectAuthEmulator };
