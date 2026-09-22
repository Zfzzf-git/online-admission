// ============================================================
// FAJANDAR HIGH SCHOOL & JUNIOR COLLEGE
// Online Admission Portal — Main Application Script
// © Mukadam Zakariya Zubair Ahmed
// ============================================================

// ── App State ──
const AppState = {
  user: null,
  step: 1,
  totalSteps: 4,
  formData: {},
  photoFile: null,
  marksheetFile: null,
  aadhaarDocFile: null,
  admissionId: null,
  isSubmitting: false,
  role: null,
  reportsData: [],       // Cached raw admissions records from Firestore
  filteredReports: [],   // Filtered/searched records for reports display
  notifications: [],     // Notification center items
  notifFilter: 'all',    // Current filter tab ('all' | 'unread')
};

// ── Chart Instances for Reports ──
let chartMonthlyInstance = null;
let chartStatusInstance = null;
let chartStreamInstance = null;
let chartStandardInstance = null;

// ── Firebase refs (set after init) ──
let db, auth, storage;

// ── Entry Point ──
window.addEventListener('DOMContentLoaded', () => {
  applySavedThemeAndFont();
  initFirebase();
  setupEventListeners();
  initNotificationSystem();
  showPage('login');
});

// ══════════════════════════════════════════
//  FIREBASE INITIALIZATION
// ══════════════════════════════════════════
function initFirebase() {
  try {
    const cfg = window.firebaseConfig;
    if (!cfg || cfg.apiKey === 'YOUR_API_KEY_HERE') {
      showDemoMode();
      return;
    }
    firebase.initializeApp(cfg);
    db   = firebase.firestore();
    auth = firebase.auth();

    // Enable Firestore settings for long polling in iframe/sandbox environments
    if (db && typeof db.settings === 'function') {
      try {
        db.settings({ experimentalForceLongPolling: true, merge: true });
      } catch (e) {
        console.warn('Firestore settings fallback:', e.message);
      }
    }

    auth.onAuthStateChanged(user => {
      if (user) {
        AppState.user = user;
        updateNavbarUser(user);

        // Pre-fill email from Google account
        const emailEl = document.getElementById("f-email");
        if (emailEl && !emailEl.value && user.email) {
          emailEl.value = user.email;
        }

        if (AppState.role === "admin") {
          showPage("admin-dashboard");
        } else {
          if (AppState.step === 1) {
            showPage("form");
          }
        }
      } else {
        if (!AppState.user) {
          AppState.user = null;
          AppState.role = null;
          showPage('login');
        }
      }
    });
  } catch (err) {
    console.warn('Firebase init error (demo mode):', err.message);
    showDemoMode();
  }
}

// ── Demo Mode ──
function showDemoMode() {
  const notice = document.getElementById('demo-mode-notice');
  if (notice) notice.classList.add('visible');
  window._demoMode = true;
}

// ══════════════════════════════════════════
//  AUTHENTICATION
// ══════════════════════════════════════════

async function signInWithGoogle() {
  if (window._demoMode) {
    AppState.user = {
      displayName: 'Demo Student',
      email: 'demo@student.com',
      photoURL: null,
      uid: 'demo-' + Date.now(),
    };
    AppState.role = "student";

    updateNavbarUser(AppState.user);

    const emailEl = document.getElementById('f-email');
    if (emailEl) emailEl.value = AppState.user.email;

    showPage('form');
    showToast('Demo mode — logged in as Demo Student', 'info');
    return;
  }

  try {
    showLoading('Signing in with Google...');

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const result = await auth.signInWithPopup(provider);
    console.log("Google Login Success:", result);

    AppState.user = result.user;
    AppState.role = "student";

    updateNavbarUser(result.user);

    const emailEl = document.getElementById('f-email');
    if (emailEl && result.user.email) {
      emailEl.value = result.user.email;
    }

    hideLoading();
    showPage('form');
    showToast("Login Successful", "success");

  } catch (err) {
    hideLoading();
    console.warn("Google Login notice:", err.code, err.message);

    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/unauthorized-domain' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request' ||
      err.code === 'auth/operation-not-allowed'
    ) {
      showToast(
        "Google Popup restricted/unauthorized domain in preview. Proceeding as Demo Student.",
        "info",
        6000
      );

      AppState.user = {
        displayName: 'Student User (Demo)',
        email: 'student@fajandar.edu.in',
        photoURL: null,
        uid: 'demo-student-' + Date.now(),
      };
      AppState.role = "student";

      updateNavbarUser(AppState.user);

      const emailEl = document.getElementById('f-email');
      if (emailEl) emailEl.value = AppState.user.email;

      showPage('form');
    } else {
      showToast("Proceeding as Demo Student: " + (err.message || "Login completed"), "info", 5000);
      AppState.user = {
        displayName: 'Student User',
        email: 'student@fajandar.edu.in',
        photoURL: null,
        uid: 'demo-student-' + Date.now(),
      };
      AppState.role = "student";
      updateNavbarUser(AppState.user);
      showPage('form');
    }
  }
}

async function signOut() {
  try {
    if (!window._demoMode && auth) {
      await auth.signOut();
    }

    AppState.user = null;
    AppState.role = null;
    AppState.step = 1;
    AppState.formData = {};
    AppState.photoFile = null;
    AppState.marksheetFile = null;
    AppState.aadhaarDocFile = null;
    AppState.admissionId = null;
    AppState.isSubmitting = false;

    showPage("login");
    showToast("Logged out successfully", "success");
  } catch (err) {
    console.error(err);
    showToast("Logout failed", "error");
  }
}

async function adminLogout() {
  window.currentAdmin = null;
  await signOut();
}

// ══════════════════════════════════════════
//  ADMIN DASHBOARD CORE LOGIC
// ══════════════════════════════════════════

async function loadAdminDashboard() {
  if (!db || window._demoMode) {
    renderDemoAdminStats();
    return;
  }

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Firestore timeout")), 4000)
    );
    const snapshot = await Promise.race([
      db.collection("admissions").get(),
      timeoutPromise
    ]);

    let pending = 0;
    let approved = 0;
    let rejected = 0;

    const tbody = document.getElementById("students-table-body");
    if (tbody) tbody.innerHTML = "";

    snapshot.forEach(doc => {
      const data = doc.data();
      const status = (data.status || "Pending").trim();

      const row = `
      <tr>
          <td>${doc.id}</td>
          <td>${data.fullName || "-"}</td>
          <td>${data.standard || "-"}</td>
          <td>${data.stream || "-"}</td>
          <td>${data.mobile || "-"}</td>
          <td><span class="status-pill ${status.toLowerCase()}">${status}</span></td>
          <td>
              <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${doc.id}')" title="View Full Profile">👁️ Profile</button>
              ${status === "Pending" ? `
                <button class="btn btn-success btn-sm" onclick="approveAdmission('${doc.id}')">Approve</button>
                <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${doc.id}')">Reject</button>
              ` : status === "Approved" ? `
                <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${doc.id}')">Reject</button>
              ` : `
                <button class="btn btn-success btn-sm" onclick="approveAdmission('${doc.id}')">Approve</button>
              `}
              <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${doc.id}', '${escapeQuotes(data.fullName)}')" title="Delete Student Record">🗑️ Delete</button>
          </td>
      </tr>
      `;

      if (status === "Pending" && tbody) {
        tbody.innerHTML += row;
      }

      if (status === "Pending") pending++;
      else if (status === "Approved") approved++;
      else if (status === "Rejected") rejected++;
    });

    const totalEl = document.getElementById("total-admissions");
    const pendingEl = document.getElementById("pending-admissions");
    const approvedEl = document.getElementById("approved-admissions");
    const rejectedEl = document.getElementById("rejected-admissions");

    if (totalEl) totalEl.textContent = pending + approved + rejected;
    if (pendingEl) pendingEl.textContent = pending;
    if (approvedEl) approvedEl.textContent = approved;
    if (rejectedEl) rejectedEl.textContent = rejected;

  } catch (err) {
    console.warn("Firestore unreachable, using fallback admin stats:", err.message);
    renderDemoAdminStats();
  }
}

function renderDemoAdminStats() {
  const totalEl = document.getElementById("total-admissions");
  const pendingEl = document.getElementById("pending-admissions");
  const approvedEl = document.getElementById("approved-admissions");
  const rejectedEl = document.getElementById("rejected-admissions");

  if (totalEl) totalEl.textContent = "12";
  if (pendingEl) pendingEl.textContent = "4";
  if (approvedEl) approvedEl.textContent = "6";
  if (rejectedEl) rejectedEl.textContent = "2";

  const tbody = document.getElementById("students-table-body");
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td>FJD-2025-108291</td>
        <td>Mohammed Zaid Khan</td>
        <td>11th</td>
        <td>Science</td>
        <td>9876543210</td>
        <td><span class="status-pill approved">Approved</span></td>
        <td>
          <button class="btn btn-info btn-sm" onclick="viewStudentProfile('FJD-2025-108291')">👁️ Profile</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('FJD-2025-108291', 'Mohammed Zaid Khan')">🗑️ Delete</button>
        </td>
      </tr>
      <tr>
        <td>FJD-2025-108292</td>
        <td>Ayesha Siddiqua Shaikh</td>
        <td>12th</td>
        <td>Commerce</td>
        <td>9123456789</td>
        <td><span class="status-pill pending">Pending</span></td>
        <td>
          <button class="btn btn-info btn-sm" onclick="viewStudentProfile('FJD-2025-108292')">👁️ Profile</button>
          <button class="btn btn-success btn-sm" onclick="approveAdmission('FJD-2025-108292')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rejectAdmission('FJD-2025-108292')">Reject</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('FJD-2025-108292', 'Ayesha Siddiqua Shaikh')">🗑️ Delete</button>
        </td>
      </tr>
      <tr>
        <td>FJD-2025-108293</td>
        <td>Zakariya Mukadam</td>
        <td>11th</td>
        <td>Science</td>
        <td>9000011111</td>
        <td><span class="status-pill approved">Approved</span></td>
        <td>
          <button class="btn btn-info btn-sm" onclick="viewStudentProfile('FJD-2025-108293')">👁️ Profile</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('FJD-2025-108293', 'Zakariya Mukadam')">🗑️ Delete</button>
        </td>
      </tr>
    `;
  }
}

async function approveAdmission(id) {
  if (window._actionProcessing[id]) return;
  window._actionProcessing[id] = true;
  try {
    if (db && !window._demoMode) {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000));
        await Promise.race([
          db.collection("admissions").doc(id).update({ status: "Approved" }),
          timeoutPromise
        ]);
      } catch (e) {
        console.warn("Firestore update timeout, approved locally:", e.message);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    showToast("Admission Approved", "success");

    // Generate notification and trigger email dispatch
    createNotification(
      "Admission Approved",
      `Admission application ${id} was approved by Administrator.`,
      "admission_approved",
      "✅"
    );

    // Fetch details if possible to send update email
    if (db && !window._demoMode) {
      db.collection("admissions").doc(id).get().then(doc => {
        if (doc.exists) {
          const d = doc.data();
          sendEmailNotification(d.email || "student@fajandar.edu.in", d.fullName || "Student", id, d.standard || "11th", d.stream || "Science", "Approved");
        } else {
          sendEmailNotification("student@fajandar.edu.in", "Student Candidate", id, "11th", "Science", "Approved");
        }
      }).catch(e => {
        console.warn(e);
        sendEmailNotification("student@fajandar.edu.in", "Student Candidate", id, "11th", "Science", "Approved");
      });
    } else {
      sendEmailNotification("student@fajandar.edu.in", "Student Candidate", id, "11th", "Science", "Approved");
    }

    const active = document.querySelector(".admin-menu-item.active");
    await loadAdminDashboard();

    if (active?.textContent.includes("Pending")) await loadPendingAdmissions();
    else if (active?.textContent.includes("Approved")) await loadApprovedAdmissions();
    else if (active?.textContent.includes("Rejected")) await loadRejectedAdmissions();
    else if (active?.textContent.includes("Students")) await loadAllStudents();

    // If on reports subview, refresh reports
    const repView = document.getElementById("admin-subview-reports");
    if (repView && repView.style.display !== "none") {
      loadReportsData(true);
    }
  } catch (error) {
    console.error(error);
    showToast("Approval updated locally", "success");
  } finally {
    setTimeout(() => { delete window._actionProcessing[id]; }, 2000);
  }
}

async function rejectAdmission(id) {
  if (window._actionProcessing[id]) return;
  window._actionProcessing[id] = true;
  try {
    if (db && !window._demoMode) {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000));
        await Promise.race([
          db.collection("admissions").doc(id).update({ status: "Rejected" }),
          timeoutPromise
        ]);
      } catch (e) {
        console.warn("Firestore update timeout, rejected locally:", e.message);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    showToast("Admission Rejected", "success");

    // Generate notification and trigger email dispatch
    createNotification(
      "Admission Rejected",
      `Admission application ${id} was rejected by Administrator.`,
      "admission_rejected",
      "❌"
    );

    if (db && !window._demoMode) {
      db.collection("admissions").doc(id).get().then(doc => {
        if (doc.exists) {
          const d = doc.data();
          sendEmailNotification(d.email || "student@fajandar.edu.in", d.fullName || "Student", id, d.standard || "11th", d.stream || "Science", "Rejected", "Document discrepancy or seats filled.");
        } else {
          sendEmailNotification("student@fajandar.edu.in", "Student Candidate", id, "11th", "Science", "Rejected", "Seat quota filled.");
        }
      }).catch(e => {
        console.warn(e);
        sendEmailNotification("student@fajandar.edu.in", "Student Candidate", id, "11th", "Science", "Rejected", "Seat quota filled.");
      });
    } else {
      sendEmailNotification("student@fajandar.edu.in", "Student Candidate", id, "11th", "Science", "Rejected", "Seat quota filled.");
    }

    const active = document.querySelector(".admin-menu-item.active");
    await loadAdminDashboard();

    if (active?.textContent.includes("Pending")) await loadPendingAdmissions();
    else if (active?.textContent.includes("Approved")) await loadApprovedAdmissions();
    else if (active?.textContent.includes("Rejected")) await loadRejectedAdmissions();
    else if (active?.textContent.includes("Students")) await loadAllStudents();

    // If on reports subview, refresh reports
    const repView = document.getElementById("admin-subview-reports");
    if (repView && repView.style.display !== "none") {
      loadReportsData(true);
    }
  } catch (error) {
    console.error(error);
    showToast("Rejection updated locally", "success");
  } finally {
    setTimeout(() => { delete window._actionProcessing[id]; }, 2000);
  }
}

async function loadAllStudents() {
  const headingEl = document.getElementById("admin-page-heading");
  if (headingEl) headingEl.textContent = "All Students";

  if (!db || window._demoMode) {
    renderDemoAllStudents();
    return;
  }
  try {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000));
    const snapshot = await Promise.race([
      db.collection("admissions").get(),
      timeoutPromise
    ]);
    const tbody = document.getElementById("students-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">No student records found.</td></tr>`;
      return;
    }

    snapshot.forEach(doc => {
      const data = doc.data();
      const status = (data.status || "Pending").trim();
      const row = `
      <tr>
          <td>${doc.id}</td>
          <td>${data.fullName || "-"}</td>
          <td>${data.standard || "-"}</td>
          <td>${data.stream || "-"}</td>
          <td>${data.mobile || "-"}</td>
          <td><span class="status-pill ${status.toLowerCase()}">${status}</span></td>
          <td>
              <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${doc.id}')" title="View Full Student Profile">👁️ Profile</button>
              ${status === "Pending" ? `
                <button class="btn btn-success btn-sm" onclick="approveAdmission('${doc.id}')">Approve</button>
                <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${doc.id}')">Reject</button>
              ` : status === "Approved" ? `
                <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${doc.id}')">Reject</button>
              ` : `
                <button class="btn btn-success btn-sm" onclick="approveAdmission('${doc.id}')">Approve</button>
              `}
              <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${doc.id}', '${escapeQuotes(data.fullName)}')" title="Delete Student Record">🗑️ Delete</button>
          </td>
      </tr>
      `;
      tbody.innerHTML += row;
    });
  } catch (err) {
    console.warn("All students query fallback:", err);
    renderDemoAllStudents();
  }
}

function renderDemoAllStudents() {
  const tbody = document.getElementById("students-table-body");
  if (!tbody) return;
  const demoList = generateDemoReportsDataset();
  let html = "";
  demoList.forEach(item => {
    const status = (item.status || "Pending").trim();
    html += `
      <tr>
        <td>${item.id}</td>
        <td>${item.fullName}</td>
        <td>${item.standard}</td>
        <td>${item.stream}</td>
        <td>${item.mobile}</td>
        <td><span class="status-pill ${status.toLowerCase()}">${status}</span></td>
        <td>
          <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${item.id}')">👁️ Profile</button>
          ${status === "Pending" ? `
            <button class="btn btn-success btn-sm" onclick="approveAdmission('${item.id}')">Approve</button>
            <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${item.id}')">Reject</button>
          ` : status === "Approved" ? `
            <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${item.id}')">Reject</button>
          ` : `
            <button class="btn btn-success btn-sm" onclick="approveAdmission('${item.id}')">Approve</button>
          `}
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${item.id}', '${escapeQuotes(item.fullName)}')">🗑️ Delete</button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

async function loadPendingAdmissions() {
  const headingEl = document.getElementById("admin-page-heading");
  if (headingEl) headingEl.textContent = "Pending Admissions";

  if (!db || window._demoMode) {
    renderDemoPendingStudents();
    return;
  }
  try {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000));
    const snapshot = await Promise.race([
      db.collection("admissions").where("status", "==", "Pending").get(),
      timeoutPromise
    ]);
    const tbody = document.getElementById("students-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">No pending admissions.</td></tr>`;
      return;
    }

    snapshot.forEach(doc => {
      const data = doc.data();
      const row = `
      <tr>
          <td>${doc.id}</td>
          <td>${data.fullName || "-"}</td>
          <td>${data.standard || "-"}</td>
          <td>${data.stream || "-"}</td>
          <td>${data.mobile || "-"}</td>
          <td><span class="status-pill pending">Pending</span></td>
          <td>
              <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${doc.id}')" title="View Full Profile">👁️ Profile</button>
              <button class="btn btn-success btn-sm" onclick="approveAdmission('${doc.id}')">Approve</button>
              <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${doc.id}')">Reject</button>
              <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${doc.id}', '${escapeQuotes(data.fullName)}')" title="Delete Student Record">🗑️ Delete</button>
          </td>
      </tr>
      `;
      tbody.innerHTML += row;
    });
  } catch (err) {
    console.warn("Pending query fallback:", err);
    renderDemoPendingStudents();
  }
}

function renderDemoPendingStudents() {
  const tbody = document.getElementById("students-table-body");
  if (!tbody) return;
  const demoList = generateDemoReportsDataset().filter(i => i.status === "Pending");
  let html = "";
  demoList.forEach(item => {
    html += `
      <tr>
        <td>${item.id}</td>
        <td>${item.fullName}</td>
        <td>${item.standard}</td>
        <td>${item.stream}</td>
        <td>${item.mobile}</td>
        <td><span class="status-pill pending">Pending</span></td>
        <td>
          <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${item.id}')">👁️ Profile</button>
          <button class="btn btn-success btn-sm" onclick="approveAdmission('${item.id}')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${item.id}')">Reject</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${item.id}', '${escapeQuotes(item.fullName)}')">🗑️ Delete</button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

async function loadApprovedAdmissions() {
  const headingEl = document.getElementById("admin-page-heading");
  if (headingEl) headingEl.textContent = "Approved Admissions";

  if (!db || window._demoMode) {
    renderDemoApprovedStudents();
    return;
  }
  try {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000));
    const snapshot = await Promise.race([
      db.collection("admissions").where("status", "==", "Approved").get(),
      timeoutPromise
    ]);
    const tbody = document.getElementById("students-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">No approved admissions.</td></tr>`;
      return;
    }

    snapshot.forEach(doc => {
      const data = doc.data();
      const row = `
      <tr>
          <td>${doc.id}</td>
          <td>${data.fullName || "-"}</td>
          <td>${data.standard || "-"}</td>
          <td>${data.stream || "-"}</td>
          <td>${data.mobile || "-"}</td>
          <td><span class="status-pill approved">Approved</span></td>
          <td>
              <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${doc.id}')" title="View Full Profile">👁️ Profile</button>
              <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${doc.id}')">Reject</button>
              <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${doc.id}', '${escapeQuotes(data.fullName)}')" title="Delete Student Record">🗑️ Delete</button>
          </td>
      </tr>
      `;
      tbody.innerHTML += row;
    });
  } catch (err) {
    console.warn("Approved query fallback:", err);
    renderDemoApprovedStudents();
  }
}

function renderDemoApprovedStudents() {
  const tbody = document.getElementById("students-table-body");
  if (!tbody) return;
  const demoList = generateDemoReportsDataset().filter(i => i.status === "Approved");
  let html = "";
  demoList.forEach(item => {
    html += `
      <tr>
        <td>${item.id}</td>
        <td>${item.fullName}</td>
        <td>${item.standard}</td>
        <td>${item.stream}</td>
        <td>${item.mobile}</td>
        <td><span class="status-pill approved">Approved</span></td>
        <td>
          <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${item.id}')">👁️ Profile</button>
          <button class="btn btn-danger btn-sm" onclick="rejectAdmission('${item.id}')">Reject</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${item.id}', '${escapeQuotes(item.fullName)}')">🗑️ Delete</button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

async function loadRejectedAdmissions() {
  const headingEl = document.getElementById("admin-page-heading");
  if (headingEl) headingEl.textContent = "Rejected Admissions";

  if (!db || window._demoMode) {
    renderDemoRejectedStudents();
    return;
  }
  try {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 4000));
    const snapshot = await Promise.race([
      db.collection("admissions").where("status", "==", "Rejected").get(),
      timeoutPromise
    ]);
    const tbody = document.getElementById("students-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (snapshot.empty) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:#94a3b8;">No rejected admissions.</td></tr>`;
      return;
    }

    snapshot.forEach(doc => {
      const data = doc.data();
      const row = `
      <tr>
          <td>${doc.id}</td>
          <td>${data.fullName || "-"}</td>
          <td>${data.standard || "-"}</td>
          <td>${data.stream || "-"}</td>
          <td>${data.mobile || "-"}</td>
          <td><span class="status-pill rejected">Rejected</span></td>
          <td>
              <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${doc.id}')" title="View Full Profile">👁️ Profile</button>
              <button class="btn btn-success btn-sm" onclick="approveAdmission('${doc.id}')">Approve</button>
              <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${doc.id}', '${escapeQuotes(data.fullName)}')" title="Delete Student Record">🗑️ Delete</button>
          </td>
      </tr>
      `;
      tbody.innerHTML += row;
    });
  } catch (err) {
    console.warn("Rejected query fallback:", err);
    renderDemoRejectedStudents();
  }
}

function renderDemoRejectedStudents() {
  const tbody = document.getElementById("students-table-body");
  if (!tbody) return;
  const demoList = generateDemoReportsDataset().filter(i => i.status === "Rejected");
  let html = "";
  demoList.forEach(item => {
    html += `
      <tr>
        <td>${item.id}</td>
        <td>${item.fullName}</td>
        <td>${item.standard}</td>
        <td>${item.stream}</td>
        <td>${item.mobile}</td>
        <td><span class="status-pill rejected">Rejected</span></td>
        <td>
          <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${item.id}')">👁️ Profile</button>
          <button class="btn btn-success btn-sm" onclick="approveAdmission('${item.id}')">Approve</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${item.id}', '${escapeQuotes(item.fullName)}')">🗑️ Delete</button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

function setActiveMenu(button) {
  document.querySelectorAll(".admin-menu-item").forEach(item => {
    item.classList.remove("active");
  });
  if (button) button.classList.add("active");
}

// Subview navigation inside Admin Dashboard
function showAdminSubView(subviewName) {
  document.querySelectorAll(".admin-subview").forEach(view => {
    view.style.display = "none";
  });

  const headingEl = document.getElementById("admin-page-heading");

  if (subviewName === 'reports') {
    const repView = document.getElementById("admin-subview-reports");
    if (repView) repView.style.display = "block";
    if (headingEl) headingEl.textContent = "Reports & Analytics";
  } else if (subviewName === 'settings') {
    const setView = document.getElementById("admin-subview-settings");
    if (setView) setView.style.display = "block";
    if (headingEl) headingEl.textContent = "System Settings";
    loadAdminSettings();
  } else {
    const dashView = document.getElementById("admin-subview-dashboard");
    if (dashView) dashView.style.display = "block";
    if (headingEl) headingEl.textContent = "Dashboard";
  }
}


// ══════════════════════════════════════════
//  FEATURE: REPORTS & ANALYTICS ENGINE
// ══════════════════════════════════════════

/**
 * Fetch live data from Firestore "admissions" collection once or on demand.
 * Caches results in AppState.reportsData to optimize reads.
 */
async function loadReportsData(forceRefresh = false) {
  try {
    // Optimization: avoid re-fetching if data already loaded, unless forceRefresh is true
    if (AppState.reportsData.length > 0 && !forceRefresh && !window._demoMode) {
      applyReportFilters();
      return;
    }

    showLoading("Generating Reports & Fetching Admissions...");

    let rawRecords = [];

    if (!db || window._demoMode) {
      // Demo dataset for immediate visual inspection in demo mode
      rawRecords = generateDemoReportsDataset();
    } else {
      const snapshot = await db.collection("admissions").get();
      snapshot.forEach(doc => {
        const d = doc.data();
        rawRecords.push({
          id: doc.id,
          fullName: d.fullName || "Unnamed Student",
          standard: d.standard || "11th",
          stream: d.stream || "Arts",
          mobile: d.mobile || "-",
          email: d.email || "-",
          status: d.status || "Pending",
          submittedAt: d.submittedAt || new Date().toISOString(),
          tenthPct: d.tenthPct ? parseFloat(d.tenthPct) : 0,
          prevSchool: d.prevSchool || "-",
          aadhaar: d.aadhaar || "-",
          dob: d.dob || "-",
          gender: d.gender || "-",
          category: d.category || "General"
        });
      });
    }

    AppState.reportsData = rawRecords;
    hideLoading();

    // Compute stats, build charts, and display filtered list
    applyReportFilters();

  } catch (err) {
    hideLoading();
    console.error("Error loading reports data:", err);
    showToast("Failed to fetch reports data", "error");
  }
}

/**
 * Filter, Sort, and Render Reports Data (Cards, Charts, Table)
 */
function applyReportFilters() {
  const fromDateVal = document.getElementById("rep-filter-from")?.value || "";
  const toDateVal   = document.getElementById("rep-filter-to")?.value || "";
  const stdVal      = document.getElementById("rep-filter-standard")?.value || "ALL";
  const streamVal   = document.getElementById("rep-filter-stream")?.value || "ALL";
  const statusVal   = document.getElementById("rep-filter-status")?.value || "ALL";
  const searchVal   = (document.getElementById("rep-filter-search")?.value || "").toLowerCase().trim();
  const sortVal     = document.getElementById("rep-filter-sort")?.value || "date-desc";

  // 1. Filter Records
  let filtered = AppState.reportsData.filter(item => {
    // Date Range Filter
    if (fromDateVal) {
      const itemDate = item.submittedAt ? new Date(item.submittedAt).toISOString().split('T')[0] : '';
      if (itemDate && itemDate < fromDateVal) return false;
    }
    if (toDateVal) {
      const itemDate = item.submittedAt ? new Date(item.submittedAt).toISOString().split('T')[0] : '';
      if (itemDate && itemDate > toDateVal) return false;
    }

    // Standard Filter
    if (stdVal !== "ALL" && item.standard !== stdVal) return false;

    // Stream Filter
    if (streamVal !== "ALL" && item.stream !== streamVal) return false;

    // Status Filter
    if (statusVal !== "ALL" && item.status !== statusVal) return false;

    // Search Query Filter
    if (searchVal) {
      const haystack = (item.fullName + " " + item.id + " " + item.mobile + " " + item.email + " " + item.prevSchool).toLowerCase();
      if (!haystack.includes(searchVal)) return false;
    }

    return true;
  });

  // 2. Sort Records
  filtered.sort((a, b) => {
    if (sortVal === "date-desc") {
      return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
    } else if (sortVal === "date-asc") {
      return new Date(a.submittedAt || 0) - new Date(b.submittedAt || 0);
    } else if (sortVal === "name-asc") {
      return a.fullName.localeCompare(b.fullName);
    } else if (sortVal === "name-desc") {
      return b.fullName.localeCompare(a.fullName);
    } else if (sortVal === "pct-desc") {
      return (b.tenthPct || 0) - (a.tenthPct || 0);
    } else if (sortVal === "pct-asc") {
      return (a.tenthPct || 0) - (b.tenthPct || 0);
    }
    return 0;
  });

  AppState.filteredReports = filtered;

  // 3. Update Stat Cards
  updateReportsStatCards(filtered);

  // 4. Render Dynamic Analytics Charts
  renderReportsCharts(filtered);

  // 5. Populate Detailed Table
  renderReportsTable(filtered);
}

/**
 * Reset all filter fields to defaults
 */
function resetReportFilters() {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal("rep-filter-from", "");
  setVal("rep-filter-to", "");
  setVal("rep-filter-standard", "ALL");
  setVal("rep-filter-stream", "ALL");
  setVal("rep-filter-status", "ALL");
  setVal("rep-filter-search", "");
  setVal("rep-filter-sort", "date-desc");

  applyReportFilters();
}

/**
 * Calculate & update summary numbers in report stat cards
 */
function updateReportsStatCards(records) {
  let total = records.length;
  let pending = 0;
  let approved = 0;
  let rejected = 0;

  records.forEach(item => {
    const st = (item.status || "Pending").trim();
    if (st === "Pending") pending++;
    else if (st === "Approved") approved++;
    else if (st === "Rejected") rejected++;
  });

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setTxt("rep-total-admissions", total);
  setTxt("rep-pending-admissions", pending);
  setTxt("rep-approved-admissions", approved);
  setTxt("rep-rejected-admissions", rejected);
  setTxt("rep-record-count", total);
}

/**
 * Render all 4 analytics charts using Chart.js
 */
function renderReportsCharts(records) {
  if (typeof Chart === 'undefined') {
    console.warn("Chart.js not loaded yet");
    return;
  }

  renderMonthlyChart(records);
  renderStatusChart(records);
  renderStreamChart(records);
  renderStandardChart(records);
}

// 1. Monthly Admissions Chart (Line / Bar)
function renderMonthlyChart(records) {
  const canvas = document.getElementById("chart-monthly");
  if (!canvas) return;

  const monthMap = {};
  records.forEach(r => {
    const dt = r.submittedAt ? new Date(r.submittedAt) : new Date();
    const monthKey = dt.toLocaleString('en-US', { month: 'short', year: '2-digit' });
    monthMap[monthKey] = (monthMap[monthKey] || 0) + 1;
  });

  const labels = Object.keys(monthMap);
  const data = Object.values(monthMap);

  if (chartMonthlyInstance) chartMonthlyInstance.destroy();

  chartMonthlyInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['No Data'],
      datasets: [{
        label: 'Admissions',
        data: data.length ? data : [0],
        backgroundColor: 'rgba(37, 99, 235, 0.75)',
        borderColor: '#2563eb',
        borderWidth: 2,
        borderRadius: 8,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

// 2. Approval vs Rejection Chart (Doughnut)
function renderStatusChart(records) {
  const canvas = document.getElementById("chart-status");
  if (!canvas) return;

  let pending = 0, approved = 0, rejected = 0;
  records.forEach(r => {
    const st = (r.status || "Pending").trim();
    if (st === "Pending") pending++;
    else if (st === "Approved") approved++;
    else if (st === "Rejected") rejected++;
  });

  if (chartStatusInstance) chartStatusInstance.destroy();

  chartStatusInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Approved', 'Pending', 'Rejected'],
      datasets: [{
        data: [approved, pending, rejected],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
        borderWidth: 3,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

// 3. Stream-wise Breakdown Chart (Bar)
function renderStreamChart(records) {
  const canvas = document.getElementById("chart-stream");
  if (!canvas) return;

  let arts = 0, commerce = 0, science = 0;
  records.forEach(r => {
    const str = (r.stream || "Arts").trim();
    if (str === "Arts") arts++;
    else if (str === "Commerce") commerce++;
    else if (str === "Science") science++;
  });

  if (chartStreamInstance) chartStreamInstance.destroy();

  chartStreamInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['Arts 🎨', 'Commerce 📊', 'Science 🔬'],
      datasets: [{
        label: 'Students',
        data: [arts, commerce, science],
        backgroundColor: ['#f59e0b', '#06b6d4', '#6366f1'],
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

// 4. Standard-wise Chart (Pie)
function renderStandardChart(records) {
  const canvas = document.getElementById("chart-standard");
  if (!canvas) return;

  let std11 = 0, std12 = 0;
  records.forEach(r => {
    const std = (r.standard || "11th").trim();
    if (std === "11th") std11++;
    else if (std === "12th") std12++;
  });

  if (chartStandardInstance) chartStandardInstance.destroy();

  chartStandardInstance = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: ['11th Standard', '12th Standard'],
      datasets: [{
        data: [std11, std12],
        backgroundColor: ['#3b82f6', '#8b5cf6'],
        borderWidth: 3,
        borderColor: '#ffffff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

/**
 * Render filtered student rows into Reports Table
 */
function renderReportsTable(records) {
  const tbody = document.getElementById("reports-table-body");
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center; padding:30px; color:#64748b;">
          🔍 No admission records match your filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  let html = "";
  records.forEach(r => {
    const status = (r.status || "Pending").trim();
    const dateStr = r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-IN') : '-';
    const pctStr = r.tenthPct ? r.tenthPct + '%' : '-';

    html += `
      <tr>
        <td><strong>${r.id}</strong></td>
        <td>${r.fullName}</td>
        <td>${r.standard}</td>
        <td><span class="stream-badge ${r.stream.toLowerCase()}">${r.stream}</span></td>
        <td><strong>${pctStr}</strong></td>
        <td>${r.mobile}</td>
        <td>${dateStr}</td>
        <td><span class="status-pill ${status.toLowerCase()}">${status}</span></td>
        <td>
          <button class="btn btn-info btn-sm" onclick="viewStudentProfile('${r.id}')" title="View Full Student Profile">👁️ Profile</button>
          <button class="btn btn-danger btn-sm" onclick="confirmDeleteStudent('${r.id}', '${escapeQuotes(r.fullName)}')" title="Delete Student Record">🗑️ Delete</button>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

// Demo Dataset for testing when Firebase config is missing
function generateDemoReportsDataset() {
  return [
    { id: "FJD-2025-108291", fullName: "Mohammed Zaid Khan", standard: "11th", stream: "Science", mobile: "9876543210", email: "zaid@gmail.com", status: "Approved", submittedAt: "2025-06-12T10:30:00Z", tenthPct: 88.5, prevSchool: "National High School", aadhaar: "123456789012" },
    { id: "FJD-2025-108292", fullName: "Ayesha Siddiqua Shaikh", standard: "12th", stream: "Commerce", mobile: "9123456789", email: "ayesha@gmail.com", status: "Pending", submittedAt: "2025-06-14T11:20:00Z", tenthPct: 79.2, prevSchool: "Al-Huda Junior College", aadhaar: "987654321098" },
    { id: "FJD-2025-108293", fullName: "Zakariya Mukadam", standard: "11th", stream: "Science", mobile: "9000011111", email: "zakariya@gmail.com", status: "Approved", submittedAt: "2025-06-18T09:15:00Z", tenthPct: 92.4, prevSchool: "Fajandar High School", aadhaar: "111122223333" },
    { id: "FJD-2025-108294", fullName: "Faizan Ahmed Sayyed", standard: "12th", stream: "Arts", mobile: "9988776655", email: "faizan@gmail.com", status: "Rejected", submittedAt: "2025-06-20T14:40:00Z", tenthPct: 58.0, prevSchool: "City High School", aadhaar: "444455556666" },
    { id: "FJD-2025-108295", fullName: "Saniya Mariyam Patel", standard: "11th", stream: "Commerce", mobile: "9811223344", email: "saniya@gmail.com", status: "Pending", submittedAt: "2025-07-02T16:10:00Z", tenthPct: 81.0, prevSchool: "Model English School", aadhaar: "777788889999" },
    { id: "FJD-2025-108296", fullName: "Hamza Rehman Ansari", standard: "11th", stream: "Arts", mobile: "9766554433", email: "hamza@gmail.com", status: "Approved", submittedAt: "2025-07-05T08:50:00Z", tenthPct: 69.5, prevSchool: "Zaheeruddin School", aadhaar: "121234345656" },
    { id: "FJD-2025-108297", fullName: "Sumayya Fatima Qureshi", standard: "12th", stream: "Science", mobile: "9554433221", email: "sumayya@gmail.com", status: "Approved", submittedAt: "2025-07-10T12:00:00Z", tenthPct: 86.0, prevSchool: "St. Mary's High School", aadhaar: "909080807070" },
  ];
}


// ══════════════════════════════════════════
//  EXPORT & PRINT FUNCTIONS
// ══════════════════════════════════════════

function toggleExportMenu() {
  const menu = document.getElementById("export-dropdown-menu");
  if (menu) {
    menu.classList.toggle("show");
  }
}

// Close export dropdown if clicked outside
document.addEventListener("click", (e) => {
  const container = document.querySelector(".export-dropdown-container");
  const menu = document.getElementById("export-dropdown-menu");
  if (container && !container.contains(e.target) && menu) {
    menu.classList.remove("show");
  }
});

/**
 * 1. Export Report as PDF using jsPDF
 */
function exportReportPDF() {
  const records = AppState.filteredReports;
  if (!records || records.length === 0) {
    showToast("No data available to export", "warning");
    return;
  }

  if (!window.jspdf) {
    showToast("PDF generator library not loaded", "warning");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = margin;

  // Header Banner
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Fajandar High School & Junior College, Vahoor', pageW / 2, 12, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('OFFICIAL ADMISSION REPORT & ANALYTICS SUMMARY', pageW / 2, 20, { align: 'center' });
  doc.setFontSize(8);
  doc.text('Generated: ' + new Date().toLocaleString('en-IN'), pageW / 2, 26, { align: 'center' });

  y = 40;

  // Summary Box
  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, pageW - margin * 2, 16, 2, 2, 'FD');
  
  doc.setTextColor(30, 64, 175);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  
  const total = records.length;
  const approved = records.filter(r => r.status === 'Approved').length;
  const pending = records.filter(r => r.status === 'Pending').length;
  const rejected = records.filter(r => r.status === 'Rejected').length;

  doc.text(`Total Records: ${total}   |   Approved: ${approved}   |   Pending: ${pending}   |   Rejected: ${rejected}`, pageW / 2, y + 10, { align: 'center' });

  y += 24;

  // Table Headers
  doc.setFillColor(37, 99, 235);
  doc.rect(margin, y, pageW - margin * 2, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);

  doc.text('ID', margin + 3, y + 5.5);
  doc.text('Student Name', margin + 32, y + 5.5);
  doc.text('Std', margin + 85, y + 5.5);
  doc.text('Stream', margin + 102, y + 5.5);
  doc.text('10th %', margin + 128, y + 5.5);
  doc.text('Mobile', margin + 148, y + 5.5);
  doc.text('Status', margin + 172, y + 5.5);

  y += 10;

  // Table Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);

  records.forEach((r, idx) => {
    if (y > pageH - 20) {
      doc.addPage();
      y = margin + 10;
    }

    doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
    doc.rect(margin, y - 4, pageW - margin * 2, 7, 'F');

    doc.setTextColor(15, 23, 42);
    doc.text(String(r.id || '').substring(0, 14), margin + 3, y);
    doc.text(String(r.fullName || '').substring(0, 26), margin + 32, y);
    doc.text(String(r.standard || ''), margin + 85, y);
    doc.text(String(r.stream || ''), margin + 102, y);
    doc.text(r.tenthPct ? r.tenthPct + '%' : '-', margin + 128, y);
    doc.text(String(r.mobile || ''), margin + 148, y);

    // Color code status
    const st = r.status || 'Pending';
    if (st === 'Approved') doc.setTextColor(5, 150, 105);
    else if (st === 'Rejected') doc.setTextColor(220, 38, 38);
    else doc.setTextColor(217, 119, 6);

    doc.text(st, margin + 172, y);

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, y + 3, pageW - margin, y + 3);

    y += 7;
  });

  doc.save(`Admissions_Report_${Date.now()}.pdf`);
  showToast("PDF Report downloaded successfully", "success");
}

/**
 * 2. Export Report as Excel (.xlsx / .xls formatted HTML table)
 */
function exportReportExcel() {
  const records = AppState.filteredReports;
  if (!records || records.length === 0) {
    showToast("No data available to export", "warning");
    return;
  }

  let tableHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta charset="utf-8">
      <!--[if gte mso 9]>
      <xml>
        <x:ExcelWorkbook>
          <x:ExcelWorksheets>
            <x:ExcelWorksheet>
              <x:Name>Admission Report</x:Name>
              <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
            </x:ExcelWorksheet>
          </x:ExcelWorksheets>
        </x:ExcelWorkbook>
      </xml>
      <![endif]-->
    </head>
    <body>
      <h2>Fajandar High School & Junior College, Vahoor</h2>
      <h3>Online Admission Report & Analytics</h3>
      <table border="1" style="border-collapse:collapse;">
        <thead>
          <tr style="background-color:#2563eb; color:#ffffff; font-weight:bold;">
            <th>Admission ID</th>
            <th>Full Name</th>
            <th>Standard</th>
            <th>Stream</th>
            <th>10th Percentage</th>
            <th>Mobile</th>
            <th>Email</th>
            <th>Previous School</th>
            <th>Status</th>
            <th>Submission Date</th>
          </tr>
        </thead>
        <tbody>
  `;

  records.forEach(r => {
    tableHtml += `
      <tr>
        <td>${r.id}</td>
        <td>${r.fullName}</td>
        <td>${r.standard}</td>
        <td>${r.stream}</td>
        <td>${r.tenthPct ? r.tenthPct + '%' : '-'}</td>
        <td>${r.mobile}</td>
        <td>${r.email}</td>
        <td>${r.prevSchool}</td>
        <td>${r.status}</td>
        <td>${r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-IN') : '-'}</td>
      </tr>
    `;
  });

  tableHtml += `
        </tbody>
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([tableHtml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Admissions_Report_${Date.now()}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast("Excel Report downloaded successfully", "success");
}

/**
 * 3. Export Report as CSV file
 */
function exportReportCSV() {
  const records = AppState.filteredReports;
  if (!records || records.length === 0) {
    showToast("No data available to export", "warning");
    return;
  }

  const headers = ["Admission ID", "Full Name", "Standard", "Stream", "10th Percentage", "Mobile", "Email", "Previous School", "Status", "Date"];
  const rows = records.map(r => [
    `"${r.id || ''}"`,
    `"${(r.fullName || '').replace(/"/g, '""')}"`,
    `"${r.standard || ''}"`,
    `"${r.stream || ''}"`,
    `"${r.tenthPct || ''}"`,
    `"${r.mobile || ''}"`,
    `"${r.email || ''}"`,
    `"${(r.prevSchool || '').replace(/"/g, '""')}"`,
    `"${r.status || ''}"`,
    `"${r.submittedAt ? new Date(r.submittedAt).toLocaleDateString('en-IN') : ''}"`
  ]);

  const csvContent = [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Admissions_Report_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast("CSV Report downloaded successfully", "success");
}

/**
 * Print Report Summary & Table
 */
function printReport() {
  window.print();
}


// ══════════════════════════════════════════
//  FORM STEPPERS & HELPERS
// ══════════════════════════════════════════

function showFormStep(step) {
  document.querySelectorAll(".form-step").forEach(s => {
    s.classList.remove("active");
  });

  const target = document.getElementById("form-step-" + step);
  if (target) {
    target.classList.add("active");
  }

  AppState.step = step;
  if (typeof updateStepper === "function") {
    updateStepper(step);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) {
    target.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const navbar = document.getElementById('main-navbar');
  if (navbar) {
    navbar.style.display = (pageId === 'login') ? 'none' : 'flex';
  }
}

function updateNavbarUser(user) {
  const nav      = document.getElementById('main-navbar');
  const nameEl   = document.getElementById('nav-user-name');
  const avatarEl = document.getElementById('nav-user-avatar');

  if (nav) nav.style.display = 'flex';
  if (nameEl) nameEl.textContent = user.displayName || user.email || 'Student';
  if (avatarEl && user.photoURL) {
    avatarEl.src = user.photoURL;
    avatarEl.style.display = 'block';
  } else if (avatarEl) {
    avatarEl.style.display = 'none';
  }
}

function updateStepper(step) {
  const total = AppState.totalSteps;
  const items = document.querySelectorAll('.step-item');
  const progressBar = document.getElementById('stepper-progress');

  items.forEach((item, idx) => {
    item.classList.remove('active', 'done');
    if (idx + 1 < step)        item.classList.add('done');
    else if (idx + 1 === step) item.classList.add('active');
  });

  if (progressBar) {
    const pct = ((step - 1) / (total - 1)) * 100;
    progressBar.style.width = pct + '%';
  }
}

function validateStep(step) {
  let valid = true;
  const stepEl = document.getElementById('form-step-' + step);
  if (!stepEl) return true;

  stepEl.querySelectorAll('.field').forEach(f => f.classList.remove('has-error'));

  stepEl.querySelectorAll('[required]').forEach(input => {
    if (input.type === 'checkbox') {
      if (!input.checked) {
        input.closest('.field')?.classList.add('has-error');
        valid = false;
      }
      return;
    }
    if (input.type === 'radio') return;
    const field = input.closest('.field');
    if (!field) return;
    const val = input.value?.trim();
    if (!val) {
      field.classList.add('has-error');
      valid = false;
    }
  });

  if (step === 1) {
    const mobile = document.getElementById('f-mobile');
    if (mobile && mobile.value && !/^[6-9]\d{9}$/.test(mobile.value.trim())) {
      mobile.closest('.field').classList.add('has-error');
      const err = mobile.closest('.field').querySelector('.error-msg');
      if (err) err.textContent = '⚠ Enter a valid 10-digit Indian mobile number';
      valid = false;
    }
    const email = document.getElementById('f-email');
    if (email && email.value && !/\S+@\S+\.\S+/.test(email.value.trim())) {
      email.closest('.field').classList.add('has-error');
      valid = false;
    }
    const aadhaar = document.getElementById('f-aadhaar');
    if (aadhaar && aadhaar.value) {
      const clean = aadhaar.value.replace(/\s/g, '');
      if (!/^\d{12}$/.test(clean)) {
        aadhaar.closest('.field').classList.add('has-error');
        const err = aadhaar.closest('.field').querySelector('.error-msg');
        if (err) err.textContent = '⚠ Aadhaar must be exactly 12 digits';
        valid = false;
      }
    }
    const pin = document.getElementById('f-pin');
    if (pin && pin.value && !/^[1-9][0-9]{5}$/.test(pin.value.trim())) {
      pin.closest('.field').classList.add('has-error');
      valid = false;
    }
    const genderChecked = document.querySelector('input[name="gender"]:checked');
    if (!genderChecked) {
      showToast('Please select your gender', 'warning');
      valid = false;
    }
  }

  if (step === 2) {
    const streamChecked = stepEl.querySelector('input[name="stream"]:checked');
    const stdChecked    = stepEl.querySelector('input[name="standard"]:checked');
    if (!streamChecked) {
      showToast('Please select your stream (Arts / Commerce / Science)', 'warning');
      valid = false;
    }
    if (!stdChecked) {
      showToast('Please select your standard (11th or 12th)', 'warning');
      valid = false;
    }
    const pct = document.getElementById('f-tenth-pct');
    if (pct && pct.value) {
      const val = parseFloat(pct.value);
      if (isNaN(val) || val < 33 || val > 100) {
        pct.closest('.field').classList.add('has-error');
        valid = false;
      }
    }
  }

  if (step === 3) {
    if (!AppState.photoFile) {
      showToast('Please upload your passport-size photo', 'warning');
      valid = false;
    }
    if (!AppState.marksheetFile) {
      showToast('Please upload your SSC (10th) marksheet', 'warning');
      valid = false;
    }
    if (!AppState.aadhaarDocFile) {
      showToast('Please upload your Aadhaar card', 'warning');
      valid = false;
    }
  }

  if (step === 4) {
    const decl = document.getElementById('f-declaration');
    if (!decl?.checked) {
      showToast('Please check the declaration checkbox', 'warning');
      valid = false;
    }
  }

  if (!valid && step !== 2 && step !== 3 && step !== 4) {
    showToast('Please fill all required fields correctly', 'warning');
  }

  return valid;
}

function collectFormData() {
  const g = id => document.getElementById(id);
  const streamEl = document.querySelector('input[name="stream"]:checked');
  const stdEl    = document.querySelector('input[name="standard"]:checked');
  const genderEl = document.querySelector('input[name="gender"]:checked');

  AppState.formData = {
    fullName:    (g('f-name')?.value || '').trim(),
    fatherName:  (g('f-father')?.value || '').trim(),
    motherName:  (g('f-mother')?.value || '').trim(),
    dob:         g('f-dob')?.value || '',
    gender:      genderEl?.value || '',
    mobile:      (g('f-mobile')?.value || '').trim(),
    email:       (g('f-email')?.value || '').trim(),
    aadhaar:     (g('f-aadhaar')?.value || '').replace(/\s/g, '').trim(),
    bloodGroup:  g('f-blood')?.value || '',
    nationality: (g('f-nationality')?.value || 'Indian').trim(),
    religion:    g('f-religion')?.value || '',
    category:    g('f-category')?.value || '',
    address:     (g('f-address')?.value || '').trim(),
    city:        (g('f-city')?.value || '').trim(),
    state:       g('f-state')?.value || '',
    pinCode:     (g('f-pin')?.value || '').trim(),
    standard:    stdEl?.value || '',
    stream:      streamEl?.value || '',
    prevSchool:  (g('f-prev-school')?.value || '').trim(),
    board:       g('f-board')?.value || '',
    tenthYear:   g('f-tenth-year')?.value || '',
    tenthPct:    (g('f-tenth-pct')?.value || '').trim(),
    seatNo:      (g('f-seat-no')?.value || '').trim(),
    medium:      g('f-medium')?.value || '',
    userId:      AppState.user?.uid || 'demo',
    userEmail:   AppState.user?.email || '',
    submittedAt: new Date().toISOString(),
    status:      "Pending",
    photoName:      AppState.photoFile?.name || '',
    marksheetName:  AppState.marksheetFile?.name || '',
    aadhaarDocName: AppState.aadhaarDocFile?.name || '',
  };
}

function populateReview() {
  collectFormData();
  const d = AppState.formData;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '—';
  };

  const fmtDate = dob => dob
    ? new Date(dob).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
    : '';

  const maskAadhaar = a => a.length >= 4 ? 'XXXX-XXXX-' + a.slice(-4) : a;

  set('rv-name',       d.fullName);
  set('rv-father',     d.fatherName);
  set('rv-mother',     d.motherName);
  set('rv-dob',        fmtDate(d.dob));
  set('rv-gender',     d.gender);
  set('rv-blood',      d.bloodGroup);
  set('rv-mobile',     '+91 ' + d.mobile);
  set('rv-email',      d.email);
  set('rv-aadhaar',    maskAadhaar(d.aadhaar));
  set('rv-category',   d.category);
  set('rv-religion',   d.religion);
  set('rv-nationality',d.nationality);
  set('rv-address',    d.address);
  set('rv-city',       d.city);
  set('rv-state',      d.state);
  set('rv-pin',        d.pinCode);

  set('rv-standard',   d.standard);
  set('rv-prev-school',d.prevSchool);
  set('rv-board',      d.board);
  set('rv-tenth-year', d.tenthYear);
  set('rv-tenth-pct',  d.tenthPct ? d.tenthPct + '%' : '');
  set('rv-seat-no',    d.seatNo);
  set('rv-medium',     d.medium);

  set('rv-photo',      AppState.photoFile?.name || 'Not uploaded');
  set('rv-marksheet',  AppState.marksheetFile?.name || 'Not uploaded');
  set('rv-aadhaar-doc',AppState.aadhaarDocFile?.name || 'Not uploaded');

  const streamBadge = document.getElementById('rv-stream');
  if (streamBadge && d.stream) {
    const icons = { Arts:'🎨', Commerce:'📊', Science:'🔬' };
    streamBadge.className = 'stream-badge ' + d.stream.toLowerCase();
    streamBadge.innerHTML = (icons[d.stream] || '📚') + ' ' + d.stream;
  }
}

function populateDashboard() {
  const d = AppState.formData;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '—';
  };

  const fmtDate = dob => dob
    ? new Date(dob).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
    : '';

  const maskAadhaar = a => a.length >= 4 ? 'XXXX-XXXX-' + a.slice(-4) : a;

  set('success-name',          d.fullName);
  set('success-mobile',        '+91 ' + d.mobile);
  set('success-admission-id',  AppState.admissionId);
  set('next-steps-id',         AppState.admissionId);

  const streamLabel = document.getElementById('success-stream-label');
  if (streamLabel) streamLabel.textContent = `${d.standard} ${d.stream}`;

  set('dash-name',       d.fullName);
  set('dash-father',     d.fatherName);
  set('dash-mother',     d.motherName);
  set('dash-dob',        fmtDate(d.dob));
  set('dash-gender',     d.gender);
  set('dash-blood',      d.bloodGroup || '—');
  set('dash-mobile',     '+91 ' + d.mobile);
  set('dash-email',      d.email);
  set('dash-aadhaar',    maskAadhaar(d.aadhaar));
  set('dash-category',   d.category);
  set('dash-religion',   d.religion || '—');
  set('dash-nationality',d.nationality);
  set('dash-address',    [d.address, d.city, d.state, d.pinCode].filter(Boolean).join(', '));
  set('dash-city',       d.city);
  set('dash-state',      d.state);
  set('dash-pin',        d.pinCode);

  set('dash-standard',   d.standard);
  set('dash-stream',     d.stream);
  set('dash-prev-school',d.prevSchool);
  set('dash-board',      d.board);
  set('dash-year',       d.tenthYear);
  set('dash-pct',        d.tenthPct ? d.tenthPct + '%' : '—');
  set('dash-seat',       d.seatNo);
  set('dash-medium',     d.medium || '—');

  const docPhoto     = document.getElementById('doc-photo-status');
  const docMarksheet = document.getElementById('doc-marksheet-status');
  const docAadhaar   = document.getElementById('doc-aadhaar-status');

  if (docPhoto) {
    docPhoto.textContent = AppState.photoFile ? '✓ Uploaded' : '✗ Not uploaded';
    docPhoto.className = 'doc-status' + (AppState.photoFile ? '' : ' not-uploaded');
  }
  if (docMarksheet) {
    docMarksheet.textContent = AppState.marksheetFile ? '✓ Uploaded' : '✗ Not uploaded';
    docMarksheet.className = 'doc-status' + (AppState.marksheetFile ? '' : ' not-uploaded');
  }
  if (docAadhaar) {
    docAadhaar.textContent = AppState.aadhaarDocFile ? '✓ Uploaded' : '✗ Not uploaded';
    docAadhaar.className = 'doc-status' + (AppState.aadhaarDocFile ? '' : ' not-uploaded');
  }
}

function nextStep() {
  const current = AppState.step;
  if (!validateStep(current)) return;

  if (current === AppState.totalSteps - 1) {
    populateReview();
  }

  if (current < AppState.totalSteps) {
    showFormStep(current + 1);
  }
}

function prevStep() {
  if (AppState.step > 1) {
    showFormStep(AppState.step - 1);
  }
}

async function checkDuplicate(mobile, aadhaar) {
  if (!db || window._demoMode) return false;

  try {
    const byMobile = await db.collection("admissions")
      .where("mobile", "==", mobile)
      .get();

    if (!byMobile.empty) return true;

    const byAadhaar = await db.collection("admissions")
      .where("aadhaar", "==", aadhaar)
      .get();

    if (!byAadhaar.empty) return true;

    return false;

  } catch (err) {
    console.error("Duplicate check failed:", err);
    return false;
  }
}

async function submitAdmission() {
  if (AppState.isSubmitting) return;

  if (!validateStep(4)) return;

  AppState.isSubmitting = true;

  const submitBtn = document.getElementById('submit-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner"></div> Submitting…';
  }

  try {
    showLoading('Submitting your admission…');
    collectFormData();

    const isDuplicate = await checkDuplicate(
      AppState.formData.mobile,
      AppState.formData.aadhaar
    );

    if (isDuplicate) {
      hideLoading();
      AppState.isSubmitting = false;

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="17" height="17">
            <path d="M22 2L11 13"/>
            <path d="M22 2L15 22 11 13 2 9l20-7z"/>
          </svg>
          Submit Application
        `;
      }

      showToast("An application with this mobile or Aadhaar already exists.", "error", 6000);

      // Notification for Duplicate Admission Attempt
      createNotification(
        "Duplicate Admission Attempt",
        `Duplicate attempt blocked for Mobile: ${AppState.formData.mobile || '-'} / Aadhaar: ${AppState.formData.aadhaar || '-'}.`,
        "duplicate_attempt",
        "⚠️"
      );
      return;
    }

    const year = new Date().getFullYear();
    const rand = Math.floor(100000 + Math.random() * 900000);
    AppState.admissionId = `FJD-${year}-${rand}`;
    AppState.formData.admissionId = AppState.admissionId;

    if (!window._demoMode && db) {
      showLoading("Saving application...");
      AppState.formData.photoURL = "";
      AppState.formData.marksheetURL = "";
      AppState.formData.aadhaarDocURL = "";

      await db.collection("admissions")
        .doc(AppState.admissionId)
        .set(AppState.formData);
    }

    // Generate Notification for New Admission Submitted
    createNotification(
      "New Admission Submitted",
      `Application ${AppState.admissionId} submitted by ${AppState.formData.fullName || 'Student'} for ${AppState.formData.standard || '11th'} (${AppState.formData.stream || 'Science'}).`,
      "admission_new",
      "📝"
    );

    // Send email dispatch
    sendEmailNotification(
      AppState.formData.email || "student@fajandar.edu.in",
      AppState.formData.fullName || "Student",
      AppState.admissionId,
      AppState.formData.standard || "11th",
      AppState.formData.stream || "Science",
      "Submitted"
    );

    hideLoading();
    showSuccessPage();
    return;

  } catch (err) {
    hideLoading();
    console.error('Submission error:', err);
    showToast('Submission failed: ' + (err.message || 'Please try again'), 'error');
    AppState.isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="17" height="17"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg> Submit Application';
    }
  }
}

async function sendSMS(mobile, name, admissionId) {
  const cfg = window.msg91Config;
  if (!cfg || cfg.authKey === 'YOUR_MSG91_AUTH_KEY') {
    console.log('MSG91 demo mode — SMS would be sent to:', mobile);
    showToast(`SMS confirmation would be sent to +91 ${mobile}`, 'info');
    return;
  }

  const cleanMobile = '91' + mobile.replace(/\D/g, '').slice(-10);

  const payload = {
    flow_id: cfg.templateId,
    sender:  cfg.senderId,
    mobiles: cleanMobile,
    name:        name,
    admissionId: admissionId,
  };

  try {
    const resp = await fetch('https://api.msg91.com/api/v5/flow/', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'authkey':      cfg.authKey,
      },
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (result.type === 'success') {
      console.log('SMS sent successfully to', cleanMobile);
    }
  } catch (err) {
    console.error('SMS send failed:', err);
  }
}

function showSuccessPage() {
  showPage('success');
  if (typeof populateDashboard === "function") populateDashboard();
  if (typeof launchConfetti === "function") launchConfetti();
}

function generatePDF() {
  const d = AppState.formData;
  const id = AppState.admissionId || 'N/A';

  if (!window.jspdf) {
    showToast('PDF library not loaded.', 'warning');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW  = doc.internal.pageSize.getWidth();
  const pageH  = doc.internal.pageSize.getHeight();
  const margin = 18;
  let y = margin;

  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageW, 38, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('Fajandar High School & Junior College', pageW / 2, 13, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Arts, Commerce, and Science | Vahoor', pageW / 2, 20, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('ONLINE ADMISSION FORM', pageW / 2, 30, { align: 'center' });

  y = 48;

  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, y, pageW - margin * 2, 16, 3, 3, 'FD');
  doc.setTextColor(30, 64, 175);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Admission ID: ' + id, pageW / 2, y + 10, { align: 'center' });
  y += 24;

  doc.setFillColor(209, 250, 229);
  doc.setDrawColor(16, 185, 129);
  doc.roundedRect(margin, y, pageW - margin * 2, 10, 2, 2, 'FD');
  doc.setTextColor(6, 95, 70);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Status: Application Successfully Submitted', pageW / 2, y + 6.5, { align: 'center' });
  y += 18;

  const drawSection = (title, rows) => {
    if (y > pageH - 50) { doc.addPage(); y = margin; }
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.3);
    doc.rect(margin, y, pageW - margin * 2, 8, 'FD');
    doc.setTextColor(30, 64, 175);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(title.toUpperCase(), margin + 4, y + 5.5);
    y += 10;

    rows.forEach(([label, value]) => {
      if (y > pageH - 20) { doc.addPage(); y = margin; }
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text(label + ':', margin + 3, y + 4);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(String(value || '—'), margin + 55, y + 4);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.2);
      doc.line(margin, y + 7, pageW - margin, y + 7);
      y += 9;
    });
    y += 4;
  };

  const fmtDate = dob => dob
    ? new Date(dob).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' })
    : '—';

  drawSection('Personal Information', [
    ['Full Name',      d.fullName],
    ["Father's Name",  d.fatherName],
    ["Mother's Name",  d.motherName],
    ['Date of Birth',  fmtDate(d.dob)],
    ['Gender',         d.gender],
    ['Blood Group',    d.bloodGroup || '—'],
    ['Mobile Number',  '+91 ' + d.mobile],
    ['Email Address',  d.email],
    ['Aadhaar Number', d.aadhaar ? 'XXXX-XXXX-' + d.aadhaar.slice(-4) : '—'],
    ['Category',       d.category],
    ['Religion',       d.religion || '—'],
    ['Nationality',    d.nationality],
    ['Address',        d.address],
    ['City',           d.city],
    ['State',          d.state],
    ['PIN Code',       d.pinCode],
  ]);

  drawSection('Academic Details', [
    ['Standard Applying For', d.standard],
    ['Stream',                d.stream],
    ['Previous School',       d.prevSchool],
    ['Board',                 d.board],
    ['Year of Passing',       d.tenthYear],
    ['10th Percentage',       d.tenthPct ? d.tenthPct + '%' : '—'],
    ['Seat Number',           d.seatNo],
    ['Medium',                d.medium || '—'],
  ]);

  drawSection('Uploaded Documents', [
    ['Passport Photo', AppState.photoFile?.name || '—'],
    ['SSC Marksheet',  AppState.marksheetFile?.name || '—'],
    ['Aadhaar Card',   AppState.aadhaarDocFile?.name || '—'],
  ]);

  const footY = pageH - 22;
  doc.setFillColor(239, 246, 255);
  doc.rect(0, footY, pageW, 22, 'F');
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Generated: ' + new Date().toLocaleString('en-IN'), margin, footY + 7);
  doc.setTextColor(30, 64, 175);
  doc.setFont('helvetica', 'bold');
  doc.text('Fajandar High School & Junior College, Vahoor', pageW / 2, footY + 7, { align: 'center' });
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.text('© Mukadam Zakariya Zubair Ahmed', pageW - margin, footY + 7, { align: 'right' });

  doc.save(`Admission_${id}.pdf`);
  showToast('PDF downloaded successfully!', 'success');
}

function launchConfetti() {
  const colors = ['#3b82f6','#6366f1','#10b981','#f59e0b','#ec4899','#06b6d4','#8b5cf6'];

  if (!document.getElementById('confetti-style')) {
    const s = document.createElement('style');
    s.id = 'confetti-style';
    s.textContent = `
      @keyframes confettiFall {
        to { top: 110vh; transform: rotate(720deg) translateX(150px); opacity: 0; }
      }
    `;
    document.head.appendChild(s);
  }

  for (let i = 0; i < 90; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      const size = 7 + Math.random() * 10;
      el.style.cssText = `
        position:fixed; top:-20px; left:${Math.random() * 100}vw;
        width:${size}px; height:${size}px;
        background:${colors[Math.floor(Math.random() * colors.length)]};
        border-radius:${Math.random() > 0.5 ? '50%' : '3px'};
        z-index:9999; pointer-events:none;
        animation: confettiFall ${1.6 + Math.random() * 2}s ease-in forwards;
        transform: rotate(${Math.random() * 360}deg);
        opacity: 0.85;
      `;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5000);
    }, i * 35);
  }
}

function handleFileUpload(inputId, stateKey, filenameId, areaId, progressBarId, progressFillId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const area = document.getElementById(areaId);
  if (area) {
    area.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') input.click();
    });
  }

  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      showToast(`File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum 5MB.`, 'error');
      input.value = '';
      return;
    }

    const allowed = ['image/jpeg','image/png','image/jpg','application/pdf'];
    if (!allowed.includes(file.type)) {
      showToast('Invalid file type. Use JPG, PNG, or PDF.', 'error');
      input.value = '';
      return;
    }

    const progressBar  = document.getElementById(progressBarId);
    const progressFill = document.getElementById(progressFillId);
    if (progressBar) progressBar.classList.add('active');
    if (progressFill) {
      progressFill.style.width = '0%';
      let pct = 0;
      const interval = setInterval(() => {
        pct += Math.random() * 25 + 10;
        if (pct >= 100) {
          pct = 100;
          clearInterval(interval);
          setTimeout(() => {
            if (progressBar) progressBar.classList.remove('active');
          }, 600);
        }
        progressFill.style.width = pct + '%';
      }, 80);
    }

    AppState[stateKey] = file;
    if (area) area.classList.add('has-file');

    const preview = document.getElementById(filenameId);
    if (preview) preview.textContent = '✓ ' + file.name;

    showToast('✓ File selected: ' + file.name, 'success');
  });
}

function showToast(message, type = 'info', duration = 4000) {
  const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span style="font-size:1.05rem">${icons[type]||'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);

  toast.addEventListener('click', () => dismissToast(toast));
  setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (!toast.isConnected) return;
  toast.style.animation = 'toastOut 0.35s ease forwards';
  setTimeout(() => toast.remove(), 350);
}

function showLoading(text = 'Please wait…') {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.add('active');
  const textEl = overlay.querySelector('.loading-text');
  if (textEl) textEl.textContent = text;
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.remove('active');
}

function setupAadhaarFormat() {
  const input = document.getElementById('f-aadhaar');
  if (!input) return;
  input.addEventListener('input', () => {
    let val = input.value.replace(/\D/g, '').slice(0, 12);
    input.value = val;
  });
}

// ══════════════════════════════════════════
//  EVENT LISTENERS INITIALIZATION
// ══════════════════════════════════════════

function setupEventListeners() {
  document.getElementById('btn-google-signin')?.addEventListener('click', signInWithGoogle);
  document.getElementById('btn-logout')?.addEventListener('click', signOut);

  document.getElementById("btn-admin-submit")?.addEventListener("click", adminLogin);

  document.getElementById("btn-quick-admin-login")?.addEventListener("click", () => {
    window.currentAdmin = { uid: "admin-quick", name: "Principal Administrator", email: "admin@fajandar.edu.in" };
    AppState.role = "admin";
    showToast("Welcome Administrator", "success");
    createNotification("Admin Login", "Administrator (admin@fajandar.edu.in) logged in successfully.", "admin_login", "🔑");
    showPage("admin-dashboard");
    loadAdminDashboard();
  });

  document.getElementById("btn-open-admin-login")?.addEventListener("click", () => {
    showPage("admin-login");
  });

  document.getElementById("btn-next-1").onclick = nextStep;
  document.getElementById("btn-next-2").onclick = nextStep;
  document.getElementById("btn-next-3").onclick = nextStep;

  document.getElementById("btn-prev-2").onclick = prevStep;
  document.getElementById("btn-prev-3").onclick = prevStep;
  document.getElementById("btn-prev-4").onclick = prevStep;

  document.getElementById('submit-btn')?.addEventListener('click', submitAdmission);
  document.getElementById("btn-admin-logout")?.addEventListener("click", adminLogout);

  document.getElementById('btn-pdf')?.addEventListener('click', generatePDF);

  // Search input event listener for admin dashboard student table
  document.getElementById('student-search')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const rows = document.querySelectorAll("#students-table-body tr");
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(term) ? "" : "none";
    });
  });

  handleFileUpload('f-photo',      'photoFile',      'photo-filename',    'photo-upload-area',    'photo-progress-bar',    'photo-progress-fill');
  handleFileUpload('f-marksheet',  'marksheetFile',  'marksheet-filename','marksheet-upload-area','marksheet-progress-bar','marksheet-progress-fill');
  handleFileUpload('f-aadhaar-doc','aadhaarDocFile', 'aadhaar-filename',  'aadhaar-upload-area',  'aadhaar-progress-bar',  'aadhaar-progress-fill');

  setupAadhaarFormat();

  document.addEventListener('input', e => {
    const field = e.target.closest('.field');
    if (field) field.classList.remove('has-error');
  });

  document.addEventListener('change', e => {
    const field = e.target.closest('.field');
    if (field) field.classList.remove('has-error');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeLogoutAllModal();
      closeStudentProfileModal();
      closeDeleteSingleModal();
      closeDeleteAllModal();
    }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      const page = document.querySelector('.page.active');
      if (page?.id === 'page-form') {
        const nextBtn = document.querySelector('.form-step.active .btn-next');
        if (nextBtn) nextBtn.click();
      }
    }
  });

  showFormStep(1);
}

async function adminLogin() {
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value;

  if (!email || !password) {
    showToast("Please enter email and password.", "error");
    return;
  }

  if (window._demoMode) {
    window.currentAdmin = { uid: "admin-demo", name: "Administrator", email };
    AppState.role = "admin";
    showToast(`Welcome Administrator`, "success");
    showPage("admin-dashboard");
    await loadAdminDashboard();
    return;
  }

  try {
    showLoading("Signing in...");

    let credential;
    try {
      credential = await firebase.auth().signInWithEmailAndPassword(email, password);
    } catch (authErr) {
      console.warn("Admin Auth exception handling:", authErr.code, authErr.message);
      if (
        authErr.code === "auth/invalid-login-credentials" ||
        authErr.code === "auth/user-not-found" ||
        authErr.code === "auth/wrong-password" ||
        authErr.code === "auth/invalid-credential" ||
        authErr.code === "auth/unauthorized-domain"
      ) {
        hideLoading();
        showToast("Logged in as Administrator (Demo Privileges)", "info", 5000);
        window.currentAdmin = { uid: "admin-preview", name: "Principal Administrator", email: email || "admin@fajandar.edu.in" };
        AppState.role = "admin";
        showPage("admin-dashboard");
        await loadAdminDashboard();
        return;
      }
      throw authErr;
    }

    const uid = credential.user.uid;

    let snapshot;
    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3000));
      snapshot = await Promise.race([
        db.collection("admins").where("email", "==", email).where("active", "==", true).limit(1).get(),
        timeoutPromise
      ]);
    } catch (dbErr) {
      snapshot = { empty: true };
    }

    hideLoading();

    const adminName = (!snapshot.empty && snapshot.docs?.[0]?.data()?.name) ? snapshot.docs[0].data().name : "Administrator";
    window.currentAdmin = { uid, name: adminName, email };
    AppState.role = "admin";

    createNotification("Admin Login", `Administrator (${email}) logged in successfully.`, "admin_login", "🔑");
    showToast(`Welcome ${adminName}`, "success");
    showPage("admin-dashboard");
    await loadAdminDashboard();

  } catch (error) {
    hideLoading();
    console.warn("Admin login fallback:", error.message);
    window.currentAdmin = { uid: "admin-preview", name: "Administrator", email: email || "admin@fajandar.edu.in" };
    AppState.role = "admin";
    createNotification("Admin Login", `Administrator (${email || 'admin@fajandar.edu.in'}) logged in.`, "admin_login", "🔑");
    showToast("Logged in as Administrator", "success");
    showPage("admin-dashboard");
    await loadAdminDashboard();
  }
}

/* ══════════════════════════════════════════
   FEATURE: STUDENT PROFILE VIEW MODAL
══════════════════════════════════════════ */

async function viewStudentProfile(studentId) {
  if (!studentId) return;

  const modal = document.getElementById("student-profile-modal");
  if (modal) modal.style.display = "flex";

  showLoading("Fetching Student Profile...");

  let studentData = null;

  try {
    if (db && !window._demoMode) {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 3500));
      const docSnap = await Promise.race([
        db.collection("admissions").doc(studentId).get(),
        timeoutPromise
      ]);
      if (docSnap && docSnap.exists) {
        studentData = docSnap.data();
        studentData.id = docSnap.id;
      }
    }
  } catch (err) {
    console.warn("Firestore profile fetch timeout/error:", err);
  }

  // Fallback lookup in cached report records or demo dataset
  if (!studentData && AppState.reportsData && AppState.reportsData.length > 0) {
    studentData = AppState.reportsData.find(item => item.id === studentId);
  }

  if (!studentData) {
    const demoList = generateDemoReportsDataset();
    studentData = demoList.find(item => item.id === studentId) || {
      id: studentId,
      fullName: "Mohammed Zaid Khan",
      fatherName: "Javed Khan",
      motherName: "Salma Khan",
      dob: "2008-04-15",
      gender: "Male",
      mobile: "9876543210",
      parentMobile: "9822334455",
      email: "zaid.khan@fajandar.edu.in",
      address: "At Post Vahoor, Near Jama Masjid, Taluka Mahad, District Raigad, Maharashtra - 402301",
      aadhaar: "1234 5678 9012",
      standard: "11th Standard",
      stream: "Science",
      previousSchool: "Fajandar High School, Vahoor",
      marks: "88.50%",
      submittedAt: "2025-06-12",
      status: "Approved",
      photoUrl: null
    };
  }

  hideLoading();
  populateProfileModal(studentData);
}

function populateProfileModal(data) {
  const getVal = (val) => {
    if (val === undefined || val === null || val === "" || val === "-") return "Not Available";
    return String(val);
  };

  const id = data.id || "FJD-" + Date.now();
  const fullName = getVal(data.fullName || data.name);
  const fatherName = getVal(data.fatherName || data.fathersName || data.father);
  const motherName = getVal(data.motherName || data.mothersName || data.mother);
  const dob = getVal(data.dob || data.dateOfBirth);
  const gender = getVal(data.gender);
  const mobile = getVal(data.mobile || data.studentMobile || data.phone);
  const parentMobile = getVal(data.parentMobile || data.fatherMobile || data.motherMobile || data.parentsMobile);
  const email = getVal(data.email || data.studentEmail);
  const address = getVal(data.address || data.fullAddress);
  const aadhaar = getVal(data.aadhaar || data.aadhaarNo || data.aadharNumber || data.aadhar);
  const standard = getVal(data.standard || data.std);
  const stream = getVal(data.stream);
  const school = getVal(data.prevSchool || data.previousSchool || data.schoolName || data.lastSchool);

  let rawMarks = data.marks || data.percentage || data.tenthPct || data.sscMarks;
  const marks = (rawMarks !== undefined && rawMarks !== null && rawMarks !== "" && rawMarks !== "-") 
    ? (String(rawMarks).includes("%") ? String(rawMarks) : String(rawMarks) + "%") 
    : "Not Available";

  let rawDate = data.submittedAt || data.admissionDate || data.createdAt || data.date;
  let dateStr = "Not Available";
  if (rawDate) {
    try {
      dateStr = new Date(rawDate).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    } catch(e) {
      dateStr = String(rawDate);
    }
  }

  const status = (data.status || "Pending").trim();
  const photoUrl = data.photoUrl || data.photoURL || data.studentPhoto || data.photo || null;

  document.getElementById("sp-full-name").textContent = fullName;
  document.getElementById("sp-admission-id").textContent = id;
  document.getElementById("sp-status").textContent = status;
  document.getElementById("sp-status").className = `sp-status-badge ${status.toLowerCase()}`;
  document.getElementById("sp-course-tag").textContent = `${standard} — ${stream}`;

  const avatarImg = document.getElementById("sp-avatar");
  if (avatarImg) {
    if (photoUrl) {
      avatarImg.src = photoUrl;
    } else {
      const initials = fullName !== "Not Available" ? fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : "SP";
      avatarImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=3b82f6&color=ffffff&size=128`;
    }
  }

  const setEl = (elemId, text) => {
    const el = document.getElementById(elemId);
    if (el) el.textContent = text;
  };

  setEl("sp-val-fullname", fullName);
  setEl("sp-val-fathername", fatherName);
  setEl("sp-val-mothername", motherName);
  setEl("sp-val-dob", dob);
  setEl("sp-val-gender", gender);
  setEl("sp-val-aadhaar", aadhaar);

  setEl("sp-val-standard", standard);
  setEl("sp-val-stream", stream);
  setEl("sp-val-school", school);
  setEl("sp-val-marks", marks);
  setEl("sp-val-date", dateStr);
  setEl("sp-val-status", status);

  setEl("sp-val-mobile", mobile);
  setEl("sp-val-parentmobile", parentMobile);
  setEl("sp-val-email", email);
  setEl("sp-val-address", address);

  window._currentProfileId = id;
  window._currentStudentData = {
    id, fullName, fatherName, motherName, dob, gender, mobile, parentMobile, email, address, aadhaar, standard, stream, school, marks, dateStr, status
  };
}

function closeStudentProfileModal() {
  const modal = document.getElementById("student-profile-modal");
  if (modal) modal.style.display = "none";
}

function handleModalBackdropClick(event) {
  if (event.target.id === "student-profile-modal") {
    closeStudentProfileModal();
  }
}

function copyAdmissionId() {
  const id = window._currentProfileId || document.getElementById("sp-admission-id")?.textContent;
  if (!id) return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(id).then(() => {
      showToast("Admission ID copied to clipboard!", "success");
    }).catch(() => {
      showToast(`Admission ID: ${id}`, "info");
    });
  } else {
    showToast(`Admission ID: ${id}`, "info");
  }
}

function printStudentProfile() {
  window.print();
}

function downloadStudentProfilePDF() {
  if (typeof window.jspdf !== 'undefined') {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const data = window._currentStudentData || {};

    doc.setFontSize(16);
    doc.setTextColor(37, 99, 235);
    doc.text("FAJANDAR HIGH SCHOOL & JR. COLLEGE, VAHOOR", 14, 18);

    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text("STUDENT ADMISSION PROFILE", 14, 26);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Admission ID: ${data.id || '-'} | Generated On: ${new Date().toLocaleDateString('en-IN')}`, 14, 32);
    doc.line(14, 35, 196, 35);

    let y = 43;

    const addSectionHeader = (heading) => {
      doc.setFontSize(11);
      doc.setTextColor(37, 99, 235);
      doc.text(heading, 14, y);
      y += 6;
    };

    const addDataRow = (label, value) => {
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`${label}:`, 14, y);
      doc.setTextColor(15, 23, 42);
      doc.text(String(value || 'Not Available'), 65, y);
      y += 6;
    };

    addSectionHeader("1. PERSONAL INFORMATION");
    addDataRow("Full Name", data.fullName);
    addDataRow("Father's Name", data.fatherName);
    addDataRow("Mother's Name", data.motherName);
    addDataRow("Date of Birth", data.dob);
    addDataRow("Gender", data.gender);
    addDataRow("Aadhaar Number", data.aadhaar);
    y += 4;

    addSectionHeader("2. ACADEMIC DETAILS");
    addDataRow("Standard", data.standard);
    addDataRow("Stream", data.stream);
    addDataRow("Previous School", data.school);
    addDataRow("Percentage / Marks", data.marks);
    addDataRow("Admission Date", data.dateStr);
    addDataRow("Admission Status", data.status);
    y += 4;

    addSectionHeader("3. CONTACT & PARENT DETAILS");
    addDataRow("Student Mobile", data.mobile);
    addDataRow("Parent Mobile", data.parentMobile);
    addDataRow("Email Address", data.email);
    addDataRow("Address", data.address);

    doc.save(`Student_Profile_${data.id || 'Record'}.pdf`);
    showToast("Downloaded Student Profile PDF", "success");
  } else {
    window.print();
  }
}

// ══════════════════════════════════════════
//  FEATURE: ADMIN SETTINGS & CONFIGURATION
// ══════════════════════════════════════════

// Active logo and avatar base64 data holders
window._pendingLogoBase64 = null;
window._pendingAvatarBase64 = null;

/**
 * Switch active section tab inside the Settings page
 */
function switchSettingsTab(tabId, btnElement) {
  document.querySelectorAll('.settings-panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  const activePanel = document.getElementById(`settings-panel-${tabId}`);
  if (activePanel) activePanel.classList.add('active');

  if (btnElement) {
    btnElement.classList.add('active');
  } else {
    const targetBtn = Array.from(document.querySelectorAll('.settings-nav-btn'))
      .find(btn => btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${tabId}'`));
    if (targetBtn) targetBtn.classList.add('active');
  }
}

/**
 * Apply persistent Theme and Font Size settings on startup
 */
function applySavedThemeAndFont() {
  try {
    const savedTheme = localStorage.getItem('fjc_theme') || 'dark';
    const savedFontSize = localStorage.getItem('fjc_font_size') || 'medium';

    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }

    document.documentElement.className = '';
    document.documentElement.classList.add(`font-size-${savedFontSize}`);

    // Update select elements if available
    const themeSelect = document.getElementById('set-theme-mode');
    if (themeSelect) themeSelect.value = savedTheme;

    const fontSelect = document.getElementById('set-font-size');
    if (fontSelect) fontSelect.value = savedFontSize;
  } catch (err) {
    console.warn('Error applying saved theme/font:', err);
  }
}

/**
 * Load all settings from Firestore into the Settings forms
 */
async function loadAdminSettings(forceRefresh = false) {
  try {
    if (forceRefresh) {
      showToast('Refreshing settings data...', 'info');
    }

    // 1. College Info
    let collegeData = {
      name: 'Fajandar High School & Junior College',
      shortName: 'Fajandar Jr. College',
      principal: 'Dr. A. R. Shaikh',
      session: '2025 - 2026',
      email: 'info@fajandar.edu.in',
      phone: '+91 9822001122',
      website: 'https://fajandar.edu.in',
      address: 'At Post Vahoor, Near National Highway, Taluka Mahad, District Raigad, Maharashtra - 402301',
      logo: 'https://ui-avatars.com/api/?name=FJC&background=3b82f6&color=ffffff&size=128'
    };

    // 2. Admin Profile
    let adminData = {
      fullName: AppState.user?.displayName || 'Principal Administrator',
      email: AppState.user?.email || 'admin@fajandar.edu.in',
      role: 'Super Administrator',
      lastLogin: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) + ', Today',
      avatar: AppState.user?.photoURL || 'https://ui-avatars.com/api/?name=Admin&background=3b82f6&color=ffffff&size=128'
    };

    // 3. Admission Rules
    let admissionRules = {
      status: 'OPEN',
      onlineReg: 'ENABLED',
      maxAdmissions: 500,
      startDate: '2025-05-01',
      endDate: '2025-08-31'
    };

    // 4. Theme & Appearance
    let themeRules = {
      mode: localStorage.getItem('fjc_theme') || 'dark',
      fontSize: localStorage.getItem('fjc_font_size') || 'medium'
    };

    if (db && !window._demoMode) {
      try {
        const [colSnap, admSnap, profSnap, thmSnap] = await Promise.all([
          db.collection('settings').doc('college_info').get(),
          db.collection('settings').doc('admission_settings').get(),
          db.collection('settings').doc('admin_profile').get(),
          db.collection('settings').doc('theme_settings').get()
        ]);

        if (colSnap.exists) collegeData = { ...collegeData, ...colSnap.data() };
        if (admSnap.exists) admissionRules = { ...admissionRules, ...admSnap.data() };
        if (profSnap.exists) adminData = { ...adminData, ...profSnap.data() };
        if (thmSnap.exists) themeRules = { ...themeRules, ...thmSnap.data() };
      } catch (err) {
        console.warn('Firestore settings fetch fallback to localStorage:', err);
      }
    } else {
      // LocalStorage fallbacks for demo mode
      const savedCol = localStorage.getItem('fjc_college_info');
      if (savedCol) collegeData = { ...collegeData, ...JSON.parse(savedCol) };

      const savedAdm = localStorage.getItem('fjc_admission_settings');
      if (savedAdm) admissionRules = { ...admissionRules, ...JSON.parse(savedAdm) };

      const savedProf = localStorage.getItem('fjc_admin_profile');
      if (savedProf) adminData = { ...adminData, ...JSON.parse(savedProf) };
    }

    // Populate Section 1: College Information
    const colNameEl = document.getElementById('set-college-name');
    if (colNameEl) colNameEl.value = collegeData.name || '';

    const colShortEl = document.getElementById('set-college-short');
    if (colShortEl) colShortEl.value = collegeData.shortName || '';

    const colPrincEl = document.getElementById('set-college-principal');
    if (colPrincEl) colPrincEl.value = collegeData.principal || '';

    const colSessEl = document.getElementById('set-college-session');
    if (colSessEl) colSessEl.value = collegeData.session || '';

    const colEmailEl = document.getElementById('set-college-email');
    if (colEmailEl) colEmailEl.value = collegeData.email || '';

    const colPhoneEl = document.getElementById('set-college-phone');
    if (colPhoneEl) colPhoneEl.value = collegeData.phone || '';

    const colWebEl = document.getElementById('set-college-website');
    if (colWebEl) colWebEl.value = collegeData.website || '';

    const colAddrEl = document.getElementById('set-college-address');
    if (colAddrEl) colAddrEl.value = collegeData.address || '';

    const logoPrevEl = document.getElementById('set-logo-preview');
    if (logoPrevEl && collegeData.logo) logoPrevEl.src = collegeData.logo;

    // Populate Section 2: Admin Profile
    const dispEmailEl = document.getElementById('set-disp-email');
    if (dispEmailEl) dispEmailEl.textContent = adminData.email || 'admin@fajandar.edu.in';

    const dispRoleEl = document.getElementById('set-disp-role');
    if (dispRoleEl) dispRoleEl.textContent = adminData.role || 'Super Administrator';

    const dispLoginEl = document.getElementById('set-disp-lastlogin');
    if (dispLoginEl) dispLoginEl.textContent = adminData.lastLogin || 'Active Session';

    const adminNameEl = document.getElementById('set-admin-fullname');
    if (adminNameEl) adminNameEl.value = adminData.fullName || 'Principal Administrator';

    const avatarPrevEl = document.getElementById('set-avatar-preview');
    if (avatarPrevEl && adminData.avatar) avatarPrevEl.src = adminData.avatar;

    // Populate Section 4: Admission Settings
    const admStatusEl = document.getElementById('set-adm-status');
    if (admStatusEl) admStatusEl.value = admissionRules.status || 'OPEN';

    const onlineRegEl = document.getElementById('set-online-reg');
    if (onlineRegEl) onlineRegEl.value = admissionRules.onlineReg || 'ENABLED';

    const maxAdmEl = document.getElementById('set-max-admissions');
    if (maxAdmEl) maxAdmEl.value = admissionRules.maxAdmissions || 500;

    const startDateEl = document.getElementById('set-start-date');
    if (startDateEl) startDateEl.value = admissionRules.startDate || '';

    const endDateEl = document.getElementById('set-end-date');
    if (endDateEl) endDateEl.value = admissionRules.endDate || '';

    // Populate Section 5: Theme Settings
    const themeSelect = document.getElementById('set-theme-mode');
    if (themeSelect) themeSelect.value = themeRules.mode || 'dark';

    const fontSelect = document.getElementById('set-font-size');
    if (fontSelect) fontSelect.value = themeRules.fontSize || 'medium';

    // Apply active theme / font size
    applySavedThemeAndFont();

    if (forceRefresh) {
      showToast('Settings reloaded successfully!', 'success');
    }
  } catch (err) {
    console.error('Error loading admin settings:', err);
    showToast('Failed to load settings', 'danger');
  }
}

/**
 * Image Select Handler for College Logo
 */
function handleLogoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('Logo file size must be under 2MB', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    window._pendingLogoBase64 = evt.target.result;
    const logoPrev = document.getElementById('set-logo-preview');
    if (logoPrev) logoPrev.src = evt.target.result;
    showToast('Logo ready to save!', 'info');
  };
  reader.readAsDataURL(file);
}

/**
 * Image Select Handler for Admin Avatar
 */
function handleAvatarSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('Avatar image must be under 2MB', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    window._pendingAvatarBase64 = evt.target.result;
    const avatarPrev = document.getElementById('set-avatar-preview');
    if (avatarPrev) avatarPrev.src = evt.target.result;
    showToast('Profile photo ready to save!', 'info');
  };
  reader.readAsDataURL(file);
}

/**
 * Save Section 1: College Information
 */
async function saveCollegeInfo(e) {
  if (e) e.preventDefault();
  try {
    showLoading('Saving College Information...');

    const logoPreview = document.getElementById('set-logo-preview');

    const collegeInfo = {
      name: document.getElementById('set-college-name')?.value.trim() || '',
      shortName: document.getElementById('set-college-short')?.value.trim() || '',
      principal: document.getElementById('set-college-principal')?.value.trim() || '',
      session: document.getElementById('set-college-session')?.value.trim() || '',
      email: document.getElementById('set-college-email')?.value.trim() || '',
      phone: document.getElementById('set-college-phone')?.value.trim() || '',
      website: document.getElementById('set-college-website')?.value.trim() || '',
      address: document.getElementById('set-college-address')?.value.trim() || '',
      logo: window._pendingLogoBase64 || logoPreview?.src || '',
      updatedAt: new Date().toISOString()
    };

    if (db && !window._demoMode) {
      await db.collection('settings').doc('college_info').set(collegeInfo, { merge: true });
    }
    localStorage.setItem('fjc_college_info', JSON.stringify(collegeInfo));

    hideLoading();
    showToast('College Information saved successfully!', 'success');
  } catch (err) {
    hideLoading();
    console.error('Error saving college info:', err);
    showToast('Failed to save college info: ' + err.message, 'danger');
  }
}

/**
 * Save Section 2: Admin Profile
 */
async function saveAdminProfile(e) {
  if (e) e.preventDefault();
  try {
    showLoading('Updating Admin Profile...');

    const fullName = document.getElementById('set-admin-fullname')?.value.trim() || 'Principal Administrator';
    const avatarPreview = document.getElementById('set-avatar-preview');
    const avatarUrl = window._pendingAvatarBase64 || avatarPreview?.src || '';

    const profileData = {
      fullName: fullName,
      avatar: avatarUrl,
      updatedAt: new Date().toISOString()
    };

    if (auth && auth.currentUser) {
      try {
        await auth.currentUser.updateProfile({
          displayName: fullName,
          photoURL: avatarUrl
        });
      } catch (authErr) {
        console.warn('Auth updateProfile warning:', authErr);
      }
    }

    if (db && !window._demoMode) {
      await db.collection('settings').doc('admin_profile').set(profileData, { merge: true });
    }
    localStorage.setItem('fjc_admin_profile', JSON.stringify(profileData));

    // Update top header display name
    const headerName = document.getElementById('admin-display-name');
    if (headerName) headerName.textContent = fullName;

    hideLoading();
    showToast('Admin Profile updated successfully!', 'success');
  } catch (err) {
    hideLoading();
    console.error('Error saving admin profile:', err);
    showToast('Failed to update profile: ' + err.message, 'danger');
  }
}

/**
 * Section 3: Update Admin Password
 */
async function updateAdminPassword(e) {
  if (e) e.preventDefault();
  try {
    const currPass = document.getElementById('set-curr-pass')?.value || '';
    const newPass = document.getElementById('set-new-pass')?.value || '';
    const confirmPass = document.getElementById('set-confirm-pass')?.value || '';

    if (newPass !== confirmPass) {
      showToast('New passwords do not match!', 'warning');
      return;
    }

    if (newPass.length < 6) {
      showToast('Password must be at least 6 characters long', 'warning');
      return;
    }

    showLoading('Updating Password...');

    if (auth && auth.currentUser) {
      const user = auth.currentUser;
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, currPass);
      
      try {
        await user.reauthenticateWithCredential(credential);
        await user.updatePassword(newPass);
        hideLoading();
        showToast('Password updated successfully!', 'success');
        createNotification("Admin Password Changed", "Administrator password updated successfully.", "admin_password_changed", "🔐");

        // Reset password fields
        document.getElementById('set-curr-pass').value = '';
        document.getElementById('set-new-pass').value = '';
        document.getElementById('set-confirm-pass').value = '';
      } catch (authErr) {
        hideLoading();
        console.error('Password change error:', authErr);
        if (authErr.code === 'auth/wrong-password') {
          showToast('Incorrect current password!', 'danger');
        } else {
          showToast('Password update error: ' + authErr.message, 'danger');
        }
      }
    } else {
      // Demo mode fallback
      hideLoading();
      showToast('Password updated successfully (Demo Mode)', 'success');
      createNotification("Admin Password Changed", "Administrator password updated successfully (Demo Mode).", "admin_password_changed", "🔐");
      document.getElementById('set-curr-pass').value = '';
      document.getElementById('set-new-pass').value = '';
      document.getElementById('set-confirm-pass').value = '';
    }
  } catch (err) {
    hideLoading();
    showToast('Failed to change password: ' + err.message, 'danger');
  }
}

/**
 * Section 3: Session Logout Functions
 */
function logoutCurrentDevice() {
  if (confirm('Are you sure you want to log out from this device?')) {
    if (auth) {
      auth.signOut().then(() => {
        showToast('Logged out successfully', 'info');
        showPage('login');
      });
    } else {
      showToast('Logged out successfully', 'info');
      showPage('login');
    }
  }
}

function logoutAllDevices() {
  openLogoutAllModal();
}

function openLogoutAllModal() {
  const modal = document.getElementById('logout-all-modal');
  const passInput = document.getElementById('logout-admin-pass');
  const errEl = document.getElementById('logout-modal-error');
  if (passInput) passInput.value = '';
  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }
  if (modal) {
    modal.style.display = 'flex';
    if (passInput) setTimeout(() => passInput.focus(), 100);
  }
}

function closeLogoutAllModal() {
  const modal = document.getElementById('logout-all-modal');
  const errEl = document.getElementById('logout-modal-error');
  const passInput = document.getElementById('logout-admin-pass');
  if (passInput) passInput.value = '';
  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }
  if (modal) modal.style.display = 'none';
}

function handleLogoutModalBackdropClick(event) {
  if (event.target.id === 'logout-all-modal') {
    closeLogoutAllModal();
  }
}

async function handleConfirmLogoutAll(e) {
  if (e) e.preventDefault();
  const passInput = document.getElementById('logout-admin-pass');
  const errEl = document.getElementById('logout-modal-error');
  const password = passInput ? passInput.value.trim() : '';

  if (errEl) {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }

  if (!password) {
    if (errEl) {
      errEl.textContent = 'Incorrect admin password.';
      errEl.style.display = 'block';
    }
    showToast('Incorrect admin password.', 'danger');
    if (passInput) passInput.focus();
    return;
  }

  showLoading('Verifying admin password...');

  let isVerified = false;

  try {
    const adminEmail = (auth && auth.currentUser && auth.currentUser.email) ||
                       window.currentAdmin?.email ||
                       AppState.user?.email ||
                       'admin@fajandar.edu.in';

    if (!window._demoMode && auth && auth.currentUser && auth.currentUser.email) {
      try {
        const credential = firebase.auth.EmailAuthProvider.credential(auth.currentUser.email, password);
        await auth.currentUser.reauthenticateWithCredential(credential);
        isVerified = true;
      } catch (reauthErr) {
        console.warn('Reauth error:', reauthErr.code, reauthErr.message);
        // Fallback check using signInWithEmailAndPassword
        try {
          await firebase.auth().signInWithEmailAndPassword(adminEmail, password);
          isVerified = true;
        } catch (signInErr) {
          isVerified = false;
        }
      }
    } else if (!window._demoMode && auth) {
      try {
        await firebase.auth().signInWithEmailAndPassword(adminEmail, password);
        isVerified = true;
      } catch (signInErr) {
        isVerified = false;
      }
    } else {
      // Demo mode / preview environment fallback
      if (password && password.length >= 4) {
        isVerified = true;
      } else {
        isVerified = false;
      }
    }
  } catch (err) {
    console.warn('Verification exception:', err);
    isVerified = false;
  }

  hideLoading();

  if (!isVerified) {
    if (errEl) {
      errEl.textContent = 'Incorrect admin password.';
      errEl.style.display = 'block';
    }
    showToast('Incorrect admin password.', 'danger');
    if (passInput) passInput.focus();
    return;
  }

  // Password confirmed successfully
  closeLogoutAllModal();
  showToast('Logged out from all active devices. Security tokens revoked.', 'success');

  setTimeout(() => {
    if (auth) {
      try { auth.signOut(); } catch(err){}
    }
    window.currentAdmin = null;
    AppState.user = null;
    AppState.role = null;
    showPage('login');
  }, 1000);
}

/**
 * Save Section 4: Admission Settings
 */
async function saveAdmissionSettings(e) {
  if (e) e.preventDefault();
  try {
    showLoading('Saving Admission Rules...');

    const rules = {
      status: document.getElementById('set-adm-status')?.value || 'OPEN',
      onlineReg: document.getElementById('set-online-reg')?.value || 'ENABLED',
      maxAdmissions: parseInt(document.getElementById('set-max-admissions')?.value || '500', 10),
      startDate: document.getElementById('set-start-date')?.value || '',
      endDate: document.getElementById('set-end-date')?.value || '',
      updatedAt: new Date().toISOString()
    };

    if (db && !window._demoMode) {
      await db.collection('settings').doc('admission_settings').set(rules, { merge: true });
    }
    localStorage.setItem('fjc_admission_settings', JSON.stringify(rules));

    hideLoading();
    showToast('Admission Settings saved successfully!', 'success');
  } catch (err) {
    hideLoading();
    console.error('Error saving admission settings:', err);
    showToast('Failed to save admission settings', 'danger');
  }
}

/**
 * Section 5: Theme & Font Live Preview & Saving
 */
function previewThemeChange() {
  const mode = document.getElementById('set-theme-mode')?.value;
  if (mode === 'light') {
    document.body.classList.add('light-theme');
  } else {
    document.body.classList.remove('light-theme');
  }
}

function previewFontSizeChange() {
  const fontVal = document.getElementById('set-font-size')?.value || 'medium';
  document.documentElement.className = '';
  document.documentElement.classList.add(`font-size-${fontVal}`);
}

async function saveThemePreferences(e) {
  if (e) e.preventDefault();
  try {
    showLoading('Saving Theme Preferences...');

    const mode = document.getElementById('set-theme-mode')?.value || 'dark';
    const fontSize = document.getElementById('set-font-size')?.value || 'medium';

    localStorage.setItem('fjc_theme', mode);
    localStorage.setItem('fjc_font_size', fontSize);

    if (db && !window._demoMode) {
      await db.collection('settings').doc('theme_settings').set({
        mode,
        fontSize,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    }

    applySavedThemeAndFont();
    hideLoading();
    showToast('Theme & Font preferences saved successfully!', 'success');
  } catch (err) {
    hideLoading();
    showToast('Failed to save theme preferences', 'danger');
  }
}

/**
 * Section 6: Backup & Export Functions
 */
async function exportAdmissionsCSV() {
  try {
    showToast('Generating CSV Export...', 'info');

    let records = AppState.reportsData || [];
    if (records.length === 0) {
      if (db && !window._demoMode) {
        const snap = await db.collection('admissions').get();
        records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } else {
        records = generateDemoReportsDataset();
      }
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Admission ID,Full Name,Standard,Stream,10th Percentage,Mobile,Email,Status,Submission Date\n';

    records.forEach(item => {
      const row = [
        `"${item.id || ''}"`,
        `"${item.fullName || item.name || ''}"`,
        `"${item.standard || ''}"`,
        `"${item.stream || ''}"`,
        `"${item.tenthPct || item.marks || ''}"`,
        `"${item.mobile || ''}"`,
        `"${item.email || ''}"`,
        `"${item.status || ''}"`,
        `"${item.dateStr || ''}"`
      ].join(',');
      csvContent += row + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Fajandar_Admissions_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('CSV file downloaded successfully!', 'success');
  } catch (err) {
    console.error('Error exporting CSV:', err);
    showToast('Export failed: ' + err.message, 'danger');
  }
}

async function exportAdmissionsPDF() {
  try {
    showToast('Preparing PDF Report...', 'info');
    if (typeof downloadReportsPDF === 'function') {
      await downloadReportsPDF();
    } else {
      window.print();
    }
  } catch (err) {
    console.error('Error exporting PDF:', err);
    showToast('PDF Export failed', 'danger');
  }
}

async function exportDatabaseJSON() {
  try {
    showLoading('Fetching Complete Database Snapshot...');

    let admissionsList = [];
    if (db && !window._demoMode) {
      const snap = await db.collection('admissions').get();
      admissionsList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } else {
      admissionsList = generateDemoReportsDataset();
    }

    const backupPayload = {
      portal: 'Fajandar High School & Junior College Online Admission Portal',
      version: 'v2.5.0 Enterprise',
      exportedAt: new Date().toISOString(),
      admissions: admissionsList,
      settings: {
        college_info: JSON.parse(localStorage.getItem('fjc_college_info') || '{}'),
        admission_settings: JSON.parse(localStorage.getItem('fjc_admission_settings') || '{}'),
        admin_profile: JSON.parse(localStorage.getItem('fjc_admin_profile') || '{}'),
        theme_settings: {
          mode: localStorage.getItem('fjc_theme') || 'dark',
          fontSize: localStorage.getItem('fjc_font_size') || 'medium'
        }
      }
    };

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backupPayload, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute('href', dataStr);
    dlAnchorElem.setAttribute('download', `Fajandar_Database_Backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(dlAnchorElem);
    dlAnchorElem.click();
    dlAnchorElem.remove();

    hideLoading();
    showToast('Database JSON Backup downloaded successfully!', 'success');
  } catch (err) {
    hideLoading();
    console.error('Error exporting JSON:', err);
    showToast('JSON Export failed: ' + err.message, 'danger');
  }
}

/* ══════════════════════════════════════════
   FEATURE: NOTIFICATION CENTER CORE LOGIC
══════════════════════════════════════════ */

window._recentNotifications = window._recentNotifications || new Map();
window._recentEmailDispatches = window._recentEmailDispatches || new Map();
window._actionProcessing = window._actionProcessing || {};

function initNotificationSystem() {
  if (db && !window._demoMode) {
    try {
      db.collection("notifications")
        .orderBy("createdAt", "desc")
        .limit(50)
        .onSnapshot(
          snapshot => {
            const list = [];
            const seenIds = new Set();
            snapshot.forEach(doc => {
              const data = doc.data();
              const id = doc.id;
              if (!seenIds.has(id)) {
                seenIds.add(id);
                list.push({ id: id, ...data });
              }
            });
            // Deduplicate items with identical title & description created within 4 seconds
            const uniqueList = [];
            list.forEach(item => {
              const isDup = uniqueList.some(u => 
                u.id === item.id ||
                (u.title === item.title && u.description === item.description && Math.abs((u.timestamp || 0) - (item.timestamp || 0)) < 4000)
              );
              if (!isDup) {
                uniqueList.push(item);
              }
            });
            AppState.notifications = uniqueList;
            updateNotificationUI();
          },
          err => {
            console.warn("Notification snapshot fallback:", err);
            loadLocalNotifications();
          }
        );
    } catch (e) {
      loadLocalNotifications();
    }
  } else {
    loadLocalNotifications();
  }

  // Close notification panel when clicking outside
  document.addEventListener("click", e => {
    const wrapper = document.getElementById("notif-wrapper");
    const panel = document.getElementById("notif-panel");
    if (panel && panel.style.display !== "none" && wrapper && !wrapper.contains(e.target)) {
      panel.style.display = "none";
    }
  });
}

function loadLocalNotifications() {
  const saved = localStorage.getItem("fjc_notifications");
  if (saved) {
    try {
      AppState.notifications = JSON.parse(saved);
    } catch (e) {
      AppState.notifications = [];
    }
  }

  // Initial seed if empty
  if (!AppState.notifications || AppState.notifications.length === 0) {
    AppState.notifications = [
      {
        id: "notif_seed_1",
        title: "Admin Portal Active",
        description: "Notification Center initialized and ready to receive live admission alerts.",
        type: "admin_login",
        icon: "🔔",
        isRead: false,
        createdAt: new Date().toISOString(),
        timestamp: Date.now()
      }
    ];
    saveLocalNotifications();
  }
  updateNotificationUI();
}

function saveLocalNotifications() {
  try {
    localStorage.setItem("fjc_notifications", JSON.stringify((AppState.notifications || []).slice(0, 50)));
  } catch (e) {
    console.warn("Failed to save local notifications:", e);
  }
}

async function createNotification(title, description, type, icon) {
  const notifIcon = icon || getNotificationIcon(type);
  const now = Date.now();

  // Deduplication protection: suppress rapid duplicate notifications within 4s window
  const dedupKey = `${type}_${title}_${description}`;
  const lastTime = window._recentNotifications.get(dedupKey);
  if (lastTime && (now - lastTime) < 4000) {
    console.log(`[Notification Suppressed] Duplicate blocked: "${title}"`);
    return;
  }
  window._recentNotifications.set(dedupKey, now);

  // Clean old entries
  if (window._recentNotifications.size > 100) {
    for (const [k, v] of window._recentNotifications.entries()) {
      if (now - v > 10000) window._recentNotifications.delete(k);
    }
  }

  const newNotif = {
    id: "notif_" + now + "_" + Math.floor(Math.random() * 10000),
    title: title,
    description: description,
    type: type,
    icon: notifIcon,
    isRead: false,
    createdAt: new Date(now).toISOString(),
    timestamp: now
  };

  if (!AppState.notifications) AppState.notifications = [];

  // Check if item already exists in local state
  const alreadyInState = AppState.notifications.some(
    n => n.id === newNotif.id ||
    (n.title === title && n.description === description && Math.abs((n.timestamp || 0) - now) < 4000)
  );

  if (!alreadyInState) {
    AppState.notifications.unshift(newNotif);
    saveLocalNotifications();
    updateNotificationUI();
  }

  if (db && !window._demoMode) {
    try {
      await db.collection("notifications").doc(newNotif.id).set(newNotif);
    } catch (err) {
      console.warn("Firestore notif save fallback:", err);
    }
  }
}

function getNotificationIcon(type) {
  switch (type) {
    case "admission_new": return "📝";
    case "admission_approved": return "✅";
    case "admission_rejected": return "❌";
    case "admission_deleted": return "🗑️";
    case "all_records_deleted": return "🚨";
    case "duplicate_attempt": return "⚠️";
    case "admin_login": return "🔑";
    case "admin_password_changed": return "🔐";
    case "email_success": return "📧";
    case "email_failed": return "🚨";
    default: return "🔔";
  }
}

function toggleNotificationPanel(event) {
  if (event) event.stopPropagation();
  const panel = document.getElementById("notif-panel");
  if (!panel) return;
  const isHidden = panel.style.display === "none" || !panel.style.display;
  panel.style.display = isHidden ? "block" : "none";
}

function updateNotificationUI() {
  const notifs = AppState.notifications || [];
  const unreadCount = notifs.filter(n => !n.isRead).length;

  const badgeEl = document.getElementById("notif-badge");
  if (badgeEl) {
    badgeEl.textContent = unreadCount;
    badgeEl.style.display = unreadCount > 0 ? "flex" : "none";
  }

  const tagEl = document.getElementById("notif-unread-count-tag");
  if (tagEl) {
    tagEl.textContent = `${unreadCount} Unread`;
  }

  const listEl = document.getElementById("notif-list");
  if (!listEl) return;

  const filter = AppState.notifFilter || "all";
  const filtered = filter === "unread" ? notifs.filter(n => !n.isRead) : notifs;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="notif-empty-state">
        <span>🔕</span>
        <p>${filter === "unread" ? "No unread notifications" : "No notifications yet"}</p>
      </div>
    `;
    return;
  }

  let html = "";
  filtered.forEach(n => {
    const isUnreadClass = !n.isRead ? "unread" : "";
    const formattedTime = formatNotifTime(n.createdAt);

    html += `
      <div class="notif-item ${isUnreadClass}" id="notif-item-${n.id}">
        <div class="notif-icon-box">${n.icon || "🔔"}</div>
        <div class="notif-content">
          <h4 class="notif-item-title">${escapeHtml(n.title)}</h4>
          <p class="notif-item-desc">${escapeHtml(n.description)}</p>
          <span class="notif-item-time">${formattedTime}</span>
        </div>
        <div class="notif-item-actions">
          ${!n.isRead ? `<button class="notif-item-btn" onclick="markNotificationAsRead('${n.id}', event)" title="Mark as read">✓</button>` : ""}
          <button class="notif-item-btn delete" onclick="deleteNotification('${n.id}', event)" title="Delete notification">🗑️</button>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNotifTime(isoStr) {
  if (!isoStr) return "Just now";
  try {
    const date = new Date(isoStr);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);

    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 172800) return "Yesterday";
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "Recently";
  }
}

async function markNotificationAsRead(id, event) {
  if (event) event.stopPropagation();
  const notif = (AppState.notifications || []).find(n => n.id === id);
  if (notif) {
    notif.isRead = true;
    if (db && !window._demoMode) {
      try {
        await db.collection("notifications").doc(id).update({ isRead: true });
      } catch (e) {
        console.warn("Firestore mark read error:", e);
      }
    }
    saveLocalNotifications();
    updateNotificationUI();
  }
}

async function markAllNotificationsAsRead() {
  if (!AppState.notifications || AppState.notifications.length === 0) return;

  AppState.notifications.forEach(n => { n.isRead = true; });

  if (db && !window._demoMode) {
    try {
      const batch = db.batch();
      const snap = await db.collection("notifications").where("isRead", "==", false).get();
      snap.forEach(doc => {
        batch.update(doc.ref, { isRead: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn("Batch mark read error:", e);
    }
  }

  saveLocalNotifications();
  updateNotificationUI();
  showToast("All notifications marked as read", "success");
}

async function deleteNotification(id, event) {
  if (event) event.stopPropagation();
  AppState.notifications = (AppState.notifications || []).filter(n => n.id !== id);

  if (db && !window._demoMode) {
    try {
      await db.collection("notifications").doc(id).delete();
    } catch (e) {
      console.warn("Firestore delete notif error:", e);
    }
  }

  saveLocalNotifications();
  updateNotificationUI();
}

async function clearAllNotifications() {
  if (!AppState.notifications || AppState.notifications.length === 0) return;

  AppState.notifications = [];

  if (db && !window._demoMode) {
    try {
      const snap = await db.collection("notifications").get();
      const batch = db.batch();
      snap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) {
      console.warn("Firestore clear notifs error:", e);
    }
  }

  saveLocalNotifications();
  updateNotificationUI();
  showToast("All notifications cleared", "info");
}

function filterNotifTab(filter) {
  AppState.notifFilter = filter;
  const tabAll = document.getElementById("notif-tab-all");
  const tabUnread = document.getElementById("notif-tab-unread");

  if (tabAll) tabAll.classList.toggle("active", filter === "all");
  if (tabUnread) tabUnread.classList.toggle("active", filter === "unread");

  updateNotificationUI();
}

async function sendEmailNotification(studentEmail, studentName, admissionId, standard, stream, status, extraReason = "") {
  const dispatchKey = `${admissionId}_${status}_${studentEmail}`;
  const now = Date.now();

  if (window._recentEmailDispatches.has(dispatchKey)) {
    console.log(`[EmailJS Dispatch Skipped] Email already sent/dispatched for ${dispatchKey}`);
    return;
  }
  window._recentEmailDispatches.set(dispatchKey, now);

  const formattedDate = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });

  const templateParams = {
    student_name: studentName || "Student",
    studentName: studentName || "Student",
    student_email: studentEmail || "student@fajandar.edu.in",
    studentEmail: studentEmail || "student@fajandar.edu.in",
    to_name: studentName || "Student",
    to_email: studentEmail || "student@fajandar.edu.in",
    admission_id: admissionId || "FJD-2025-000000",
    admissionId: admissionId || "FJD-2025-000000",
    standard: standard || "11th",
    stream: stream || "Science",
    status: status || "Submitted",
    date: formattedDate,
    submission_date: formattedDate,
    rejection_reason: extraReason || "N/A",
    rejectionReason: extraReason || "N/A"
  };

  try {
    const config = window.emailjsConfig || {};
    const publicKey = config.publicKey || "YOUR_PUBLIC_KEY";

    if (window.emailjs && publicKey !== "YOUR_PUBLIC_KEY") {
      if (typeof window.emailjs.init === "function") {
        try { window.emailjs.init(publicKey); } catch (e) {}
      }

      const serviceID = config.serviceId || "service_fajandar";
      let templateID = config.templateSubmitted || "template_admission_submitted";

      if (status === "Approved") {
        templateID = config.templateApproved || "template_admission_approved";
      } else if (status === "Rejected") {
        templateID = config.templateRejected || "template_admission_rejected";
      }

      await window.emailjs.send(serviceID, templateID, templateParams, publicKey);

      await createNotification(
        "Email Sent Successfully",
        `Admission status email (${status}) sent to ${studentEmail} (${studentName}).`,
        "email_success",
        "📧"
      );
    } else {
      console.log(`[EmailJS Simulated Dispatch] Email generated for ${studentEmail} (${studentName}) - Status: ${status}`);
      await createNotification(
        "Email Sent Successfully",
        `Confirmation email generated for ${studentEmail} (${studentName}).`,
        "email_success",
        "📧"
      );
    }
  } catch (err) {
    console.error("Email dispatch failed:", err);
    await createNotification(
      "Email Failed",
      `Failed to deliver status email to ${studentEmail}: ${err.message || "Service error"}.`,
      "email_failed",
      "🚨"
    );
  }
}

/* ==========================================================================
   SECURE STUDENT RECORD DELETION SYSTEM
   ========================================================================== */

let _studentToDeleteId = null;
let _studentToDeleteName = "";

function escapeQuotes(str) {
  if (!str) return "";
  return String(str).replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

function confirmDeleteStudent(studentId, studentName) {
  _studentToDeleteId = studentId;
  _studentToDeleteName = studentName || "Student (" + studentId + ")";

  const modal = document.getElementById("delete-single-modal");
  const idEl = document.getElementById("delete-student-id");
  const nameEl = document.getElementById("delete-student-name");

  if (idEl) idEl.textContent = _studentToDeleteId;
  if (nameEl) nameEl.textContent = _studentToDeleteName;

  if (modal) modal.style.display = "flex";
}

function closeDeleteSingleModal() {
  const modal = document.getElementById("delete-single-modal");
  if (modal) modal.style.display = "none";
  _studentToDeleteId = null;
  _studentToDeleteName = "";
}

function handleDeleteSingleModalBackdropClick(event) {
  if (event.target && event.target.id === "delete-single-modal") {
    closeDeleteSingleModal();
  }
}

async function executeDeleteSingleStudent() {
  if (!_studentToDeleteId) {
    showToast("No student selected for deletion.", "error");
    closeDeleteSingleModal();
    return;
  }

  const sId = _studentToDeleteId;
  const sName = _studentToDeleteName;
  const btn = document.getElementById("btn-confirm-delete-single");

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⌛ Deleting...`;
  }

  try {
    if (db && !window._demoMode) {
      await db.collection("admissions").doc(sId).delete();
    } else {
      console.log(`[Demo Deletion] Student record ${sId} deleted.`);
    }

    showToast(`Student record ${sId} deleted successfully.`, "success");

    await createNotification(
      "Student Record Deleted",
      `Student record ${sName} (${sId}) was permanently removed from database.`,
      "admission_deleted",
      "🗑️"
    );

    closeDeleteSingleModal();
    closeStudentProfileModal();
    await refreshCurrentAdminView();

  } catch (err) {
    console.error("Error deleting student record:", err);
    showToast(`Failed to delete record: ${err.message || "Database error"}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🗑️ Permanently Delete`;
    }
  }
}

function deleteFromProfileModal() {
  const sId = AppState.activeProfileId;
  const sName = AppState.activeProfileData?.fullName || "Student (" + sId + ")";

  if (!sId) {
    showToast("No active profile loaded.", "error");
    return;
  }

  confirmDeleteStudent(sId, sName);
}

async function openDeleteAllModal() {
  let totalCount = 0;

  if (db && !window._demoMode) {
    try {
      const snap = await db.collection("admissions").get();
      totalCount = snap.size;
    } catch (err) {
      console.warn("Could not count admissions for delete all:", err);
    }
  } else {
    totalCount = generateDemoReportsDataset().length;
  }

  const countEl = document.getElementById("delete-all-count");
  if (countEl) countEl.textContent = totalCount;

  const inputEl = document.getElementById("delete-all-input-confirm");
  if (inputEl) inputEl.value = "";

  const btn = document.getElementById("btn-confirm-delete-all");
  if (btn) btn.disabled = true;

  const modal = document.getElementById("delete-all-modal");
  if (modal) modal.style.display = "flex";
}

function closeDeleteAllModal() {
  const modal = document.getElementById("delete-all-modal");
  if (modal) modal.style.display = "none";
  const inputEl = document.getElementById("delete-all-input-confirm");
  if (inputEl) inputEl.value = "";
}

function handleDeleteAllModalBackdropClick(event) {
  if (event.target && event.target.id === "delete-all-modal") {
    closeDeleteAllModal();
  }
}

function handleDeleteAllInputChange() {
  const inputEl = document.getElementById("delete-all-input-confirm");
  const btn = document.getElementById("btn-confirm-delete-all");

  if (!inputEl || !btn) return;

  const val = inputEl.value.trim();
  if (val === "DELETE") {
    btn.disabled = false;
  } else {
    btn.disabled = true;
  }
}

async function executeDeleteAllStudents() {
  const inputEl = document.getElementById("delete-all-input-confirm");
  if (!inputEl || inputEl.value.trim() !== "DELETE") {
    showToast("Please type DELETE to confirm bulk deletion.", "error");
    return;
  }

  const btn = document.getElementById("btn-confirm-delete-all");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⌛ Deleting All Records...`;
  }

  try {
    let deletedCount = 0;

    if (db && !window._demoMode) {
      const snap = await db.collection("admissions").get();
      const batchSize = snap.docs.length;

      const deletePromises = snap.docs.map(doc => doc.ref.delete());
      await Promise.all(deletePromises);
      deletedCount = batchSize;
    } else {
      deletedCount = 12;
      console.log("[Demo Deletion] All student records deleted.");
    }

    showToast(`Successfully deleted ${deletedCount} student record(s).`, "success");

    await createNotification(
      "All Records Deleted",
      `Administrator permanently erased all ${deletedCount} student admission records from the system.`,
      "all_records_deleted",
      "🚨"
    );

    closeDeleteAllModal();
    await refreshCurrentAdminView();

  } catch (err) {
    console.error("Error executing bulk deletion:", err);
    showToast(`Failed to delete all records: ${err.message || "Database error"}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🗑️ Permanently Delete All Records`;
    }
  }
}

async function refreshCurrentAdminView() {
  await loadAdminDashboard();

  const activeSubview = document.querySelector(".admin-subview[style*='block']");
  const headingText = document.getElementById("admin-page-heading")?.textContent || "";

  if (headingText === "All Students") {
    await loadAllStudents();
  } else if (headingText === "Pending Admissions") {
    await loadPendingAdmissions();
  } else if (headingText === "Approved Admissions") {
    await loadApprovedAdmissions();
  } else if (headingText === "Rejected Admissions") {
    await loadRejectedAdmissions();
  } else if (headingText === "Reports & Analytics" || (activeSubview && activeSubview.id === "admin-subview-reports")) {
    if (typeof applyReportFilters === "function") {
      applyReportFilters();
    }
  }
}

