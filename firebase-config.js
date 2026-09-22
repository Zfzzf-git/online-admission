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
// HOW TO SET UP:
// 1. Sign up at https://msg91.com
// 2. Settings → API Keys → copy your Auth Key
// 3. SMS → Sender ID → register your sender ID (e.g., FJDJRS)
// 4. SMS → DLT → Register the template below:
//
// TEMPLATE TEXT (register this on DLT & MSG91):
// "Dear {#name#}, Your admission has been successfully submitted at
//  Fajandar High School & Junior College Arts, Commerce, and Science,
//  Vahoor. Admission ID: {#admissionId#}. Thank you."
//
// 5. Copy the Template/Flow ID after registration
// ============================================================

const msg91Config = {
  authKey:    "YOUR_MSG91_AUTH_KEY",
  senderId:   "FJDJRS",              // Your DLT-approved Sender ID
  templateId: "YOUR_TEMPLATE_ID",   // MSG91 Flow/Template ID

  // DLT Approved Template Message:
  // "Dear {#name#}, Your admission has been successfully submitted
  //  at Fajandar High School & Junior College Arts, Commerce, and
  //  Science, Vahoor. Admission ID: {#admissionId#}. Thank you."
};

// Export for app.js
window.firebaseConfig = firebaseConfig;
window.msg91Config    = msg91Config;
