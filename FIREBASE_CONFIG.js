"use strict";

/* ═══════════════════════════════════════════════
   FIREBASE AYARLARI
   ───────────────────────────────────────────────
   Aşağıdaki bilgileri kendi Firebase projenizden alıp
   buraya yapıştırın. Adımlar:

   1. https://console.firebase.google.com adresine girin.
   2. "Add project" ile yeni bir proje oluşturun (ücretsiz).
   3. Proje içinde sol menüden "Build > Firestore Database"
      seçin, "Create database" deyip "Start in test mode"
      seçeneğiyle oluşturun (sonra kuralları aşağıdaki gibi
      güncelleyin).
   4. Proje ayarlarından (⚙️ simgesi > Project settings)
      "Your apps" bölümünde "</>" (Web) ikonuna tıklayıp bir
      uygulama kaydedin. Size aşağıdaki gibi bir obje verecek
      — onu kopyalayıp buraya yapıştırın.
═══════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC6MaQnrlBuINhqowrcxQ1IfSQwtp7PqnQ",
  authDomain: "veloracaffe2.firebaseapp.com",
  projectId: "veloracaffe2",
  storageBucket: "veloracaffe2.firebasestorage.app",
  messagingSenderId: "196549083369",
  appId: "1:196549083369:web:f9d6c12a89dc871f667078"
};

/* ═══════════════════════════════════════════════
   FIRESTORE GÜVENLİK KURALLARI
   ───────────────────────────────────────────────
   Firebase Console > Firestore Database > Rules sekmesine
   gidip aşağıdaki kuralı yapıştırıp "Publish" deyin.

   Not: Bu kural, sadece veritabanı adresinizi (URL/projectId)
   bilen biri dışarıdan da yazabilir/okuyabilir anlamına gelir.
   Uygulamanızda zaten PIN korumalı giriş olduğu için küçük bir
   işletme için kabul edilebilir bir başlangıçtır, ama proje
   id'nizi/ayarlarınızı herkese açık paylaşmayın. İleride
   Firebase Authentication eklenerek daha güvenli hale
   getirilebilir.

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /aura_pos/{document=**} {
         allow read, write: if true;
       }
     }
   }
═══════════════════════════════════════════════ */
