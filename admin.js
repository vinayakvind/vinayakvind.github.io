// Admin authentication and management for World Priority platform
const ADMIN_EMAILS = ['vinayakvind@gmail.com']; // Add your Gmail addresses here

let currentAdminUser = null;

// Admin Google Login
async function adminLoginWithGoogle() {
  try {
    document.getElementById('loginAlert').innerHTML = '<div class="loading"><div class="spinner"></div><p>Signing in...</p></div>';
    const result = await auth.signInWithPopup(googleProvider);
    const user = result.user;
    
    // Check if user email is authorized as admin
    if (!ADMIN_EMAILS.includes(user.email)) {
      await auth.signOut();
      showLoginAlert('❌ Access Denied: You are not authorized to access the admin dashboard.', 'error');
      return;
    }
    
    currentAdminUser = user;
    showAdminDashboard();
  } catch (error) {
    console.error('Login error:', error);
    showLoginAlert('❌ Login failed: ' + error.message, 'error');
  }
}

function showLoginAlert(message, type) {
  const alertClass = type === 'error' ? 'alert-error' : 'alert-success';
  document.getElementById('loginAlert').innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
}

function showAdminAlert(message, type) {
  const alertClass = type === 'error' ? 'alert-error' : 'alert-success';
  document.getElementById('adminAlert').innerHTML = `<div class="alert ${alertClass}">${message}</div>`;
  setTimeout(() => { document.getElementById('adminAlert').innerHTML = ''; }, 5000);
}

function showAdminDashboard() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'block';
  document.getElementById('adminUserInfo').innerHTML = `<span style="margin-right: 10px;">✅ ${currentAdminUser.email}</span>`;
  
  loadStats();
  loadSubmissions();
}

function adminLogout() {
  auth.signOut().then(() => {
    currentAdminUser = null;
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('loginAlert').innerHTML = '';
  });
}

// Load statistics
async function loadStats() {
  try {
    const pendingSnap = await db.collection('priorities').where('status', '==', 'pending').get();
    const approvedSnap = await db.collection('priorities').where('status', '==', 'approved').get();
    const usersSnap = await db.collection('users').get();
    
    let totalVotes = 0;
    approvedSnap.forEach(doc => { totalVotes += (doc.data().votes || 0); });
    
    document.getElementById('statPending').textContent = pendingSnap.size;
    document.getElementById('statApproved').textContent = approvedSnap.size;
    document.getElementById('statUsers').textContent = usersSnap.size;
    document.getElementById('statVotes').textContent = totalVotes.toLocaleString();
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load submissions by status
async function loadSubmissions() {
  loadSubmissionsByStatus('pending', 'pendingList', 'countPending');
  loadSubmissionsByStatus('approved', 'approvedList', 'countApproved');
  loadSubmissionsByStatus('rejected', 'rejectedList', 'countRejected');
}

async function loadSubmissionsByStatus(status, listId, countId) {
  try {
    const listEl = document.getElementById(listId);
    listEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';
    
    const snapshot = await db.collection('priorities').where('status', '==', status).orderBy('createdAt', 'desc').get();
    
    if (snapshot.empty) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📄</div><p>No ${status} submissions</p></div>`;
      document.getElementById(countId).textContent = '0';
      return;
    }
    
    document.getElementById(countId).textContent = snapshot.size;
    
    let html = '';
    snapshot.forEach(doc => {
      const priority = doc.data();
      const date = priority.createdAt ? new Date(priority.createdAt.toDate()).toLocaleString() : 'Unknown';
      
      html += `
        <div class="submission-item">
          <div class="submission-header">
            <div>
              <div class="submission-title">${escapeHtml(priority.title)}</div>
              <div class="submission-meta">
                <span class="submission-category">${escapeHtml(priority.category)}</span>
                Submitted: ${date}
                ${priority.submittedBy ? ' by ' + escapeHtml(priority.submittedBy) : ''}
              </div>
            </div>
            <span class="status-badge status-${status}">${status.toUpperCase()}</span>
          </div>
          <div class="submission-description">${escapeHtml(priority.description)}</div>
          ${priority.votes !== undefined ? `<div style="color: #667eea; font-weight: 600; margin-bottom: 15px;">🔺 ${priority.votes} votes</div>` : ''}
          <div class="submission-actions">
            ${status === 'pending' ? `
              <button class="btn btn-approve" onclick="approveSubmission('${doc.id}')">✅ Approve</button>
              <button class="btn btn-reject" onclick="rejectSubmission('${doc.id}')">❌ Reject</button>
            ` : status === 'approved' ? `
              <button class="btn btn-reject" onclick="rejectSubmission('${doc.id}')">❌ Reject</button>
              <button class="btn btn-delete" onclick="deleteSubmission('${doc.id}')">🗑️ Delete</button>
            ` : `
              <button class="btn btn-approve" onclick="approveSubmission('${doc.id}')">✅ Approve</button>
              <button class="btn btn-delete" onclick="deleteSubmission('${doc.id}')">🗑️ Delete</button>
            `}
          </div>
        </div>
      `;
    });
    
    listEl.innerHTML = html;
  } catch (error) {
    console.error('Error loading submissions:', error);
    document.getElementById(listId).innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p>Error loading submissions</p></div>';
  }
}

// Approve submission
async function approveSubmission(priorityId) {
  if (!confirm('Approve this priority? It will be visible to all users.')) return;
  
  try {
    await db.collection('priorities').doc(priorityId).update({
      status: 'approved',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: currentAdminUser.email
    });
    
    showAdminAlert('✅ Priority approved successfully!', 'success');
    loadStats();
    loadSubmissions();
  } catch (error) {
    console.error('Error approving:', error);
    showAdminAlert('❌ Error approving priority: ' + error.message, 'error');
  }
}

// Reject submission
async function rejectSubmission(priorityId) {
  const reason = prompt('Reason for rejection (optional):');
  if (reason === null) return; // User cancelled
  
  try {
    await db.collection('priorities').doc(priorityId).update({
      status: 'rejected',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      rejectedBy: currentAdminUser.email,
      rejectionReason: reason || 'No reason provided'
    });
    
    showAdminAlert('❌ Priority rejected.', 'success');
    loadStats();
    loadSubmissions();
  } catch (error) {
    console.error('Error rejecting:', error);
    showAdminAlert('❌ Error rejecting priority: ' + error.message, 'error');
  }
}

// Delete submission permanently
async function deleteSubmission(priorityId) {
  if (!confirm('⚠️ PERMANENTLY DELETE this priority? This action cannot be undone!')) return;
  
  try {
    await db.collection('priorities').doc(priorityId).delete();
    showAdminAlert('🗑️ Priority deleted permanently.', 'success');
    loadStats();
    loadSubmissions();
  } catch (error) {
    console.error('Error deleting:', error);
    showAdminAlert('❌ Error deleting priority: ' + error.message, 'error');
  }
}

// Switch tabs
function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  event.target.classList.add('active');
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById(tabName + 'Tab').classList.add('active');
}

// Utility function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Check authentication state on page load
auth.onAuthStateChanged(user => {
  if (user && ADMIN_EMAILS.includes(user.email)) {
    currentAdminUser = user;
    showAdminDashboard();
  } else {
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('adminDashboard').style.display = 'none';
  }
});