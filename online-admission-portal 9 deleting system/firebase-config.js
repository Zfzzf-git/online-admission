// ============================================================
// FIREBASE CONFIGURATION
// Fajandar High School & Junior College — Online Admission
// ============================================================
// HOW TO SET UP:
// 1. Go to https://console.firebase.google.com
// 2. Create or open your project
// 3. Project Settings → Your Apps → Add Web App
// 4. Copy the config values below
// 5. Authentication → Sign-in method → Enable Google
// 6. Firestore Database → Create database (test mode)
// 7. Storage → Get started
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyA5WTegjkP-Kp1PiwNcupeiL0a3TVC1l3w",
  authDomain: "fajandar-admission.firebaseapp.com",
  projectId: "fajandar-admission",
  storageBucket: "fajandar-admission.firebasestorage.app",
  messagingSenderId: "739647306608",
  appId: "1:739647306608:web:ddaf40fbd48bff03ddadb5"
};

// ============================================================
// MSG91 SMS CONFIGURATION
// ============================================================

const msg91Config = {
  authKey:    "YOUR_MSG91_AUTH_KEY",
  senderId:   "FJDJRS",              // Your DLT-approved Sender ID
  templateId: "YOUR_TEMPLATE_ID",   // MSG91 Flow/Template ID
};

// Export for app.js
window.firebaseConfig = firebaseConfig;
window.msg91Config    = msg91Config;
