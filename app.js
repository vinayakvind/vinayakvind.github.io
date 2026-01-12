// Main Application Logic for World Priority Platform
// Uses Google Authentication for user login

let currentUser = null;
let userVotes = [];
let currentFilter = 'all';

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  checkAuthState();
  loadPriorities();
  loadStats();
  setupRealtimeListeners();
});

// ==================== GOOGLE AUTHENTICATION ====================

function checkAuthState() {
  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      updateUIForLoggedInUser(user);
      loadUserVotes();
    } else {
      currentUser = null;
      updateUIForLoggedOutUser();
    }
  });
}

function updateUIForLoggedInUser(user) {
  document.getElementById('headerActions').style.display = 'none';
  document.getElementById('userInfo').style.display = 'flex';
  
  // Update user info with Google account details
  const photoURL = user.photoURL || 'https://www.gravatar.com/avatar/?d=mp';
  const displayName = user.displayName || user.email.split('@')[0];
  
  document.getElementById('userPhoto').src = photoURL;
  document.getElementById('userName').textContent = displayName;
}

function updateUIForLoggedOutUser() {
  document.getElementById('headerActions').style.display = 'flex';
  document.getElementById('userInfo').style.display = 'none';
}

function loginWithGoogle() {
  closeLoginModal(); // Close modal if open
  
  // Sign in with Google popup
  auth.signInWithPopup(googleProvider)
    .then((result) => {
      const user = result.user;
      
      // Save user data to Firestore
      return db.collection('users').doc(user.uid).set({
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    })
    .then(() => {
      console.log('Successfully signed in with Google');
    })
    .catch((error) => {
      console.error('Error signing in with Google:', error);
      if (error.code !== 'auth/popup-closed-by-user') {
        alert('Error signing in: ' + error.message);
      }
    });
}

function openLoginModal() {
  document.getElementById('loginModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLoginModal() {
  document.getElementById('loginModal').classList.remove('active');
  document.body.style.overflow = 'auto';
}

function logout() {
  if (confirm('Are you sure you want to sign out?')) {
    auth.signOut().then(() => {
      userVotes = [];
      loadPriorities(); // Reload to reset vote buttons
    });
  }
}

// ==================== PRIORITIES ====================

function loadPriorities() {
  const priorityList = document.getElementById('priorityList');
  priorityList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading priorities...</p></div>';
  
  // Query approved priorities, ordered by votes
  db.collection('priorities')
    .where('status', '==', 'approved')
    .orderBy('votes', 'desc')
    .get()
    .then((querySnapshot) => {
      if (querySnapshot.empty) {
        priorityList.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #999;">
            <p style="font-size: 18px; margin-bottom: 10px;">🌟 No priorities yet!</p>
            <p>Be the first to suggest a global priority.</p>
          </div>
        `;
        return;
      }
      
      priorityList.innerHTML = '';
      let rank = 1;
      
      querySnapshot.forEach((doc) => {
        const priority = doc.data();
        const priorityElement = createPriorityElement(doc.id, priority, rank);
        priorityList.appendChild(priorityElement);
        rank++;
      });
    })
    .catch((error) => {
      console.error('Error loading priorities:', error);
      priorityList.innerHTML = `
        <div class="alert alert-error">
          Failed to load priorities. Please refresh the page.
        </div>
      `;
    });
}

function createPriorityElement(id, priority, rank) {
  const div = document.createElement('div');
  div.className = 'priority-item';
  div.setAttribute('data-category', priority.category || 'Other');
  
  const hasVoted = userVotes.includes(id);
  const canVote = !hasVoted; // Users can only vote once per item
  
  // Medal emoji for top 3
  let rankDisplay = `#${rank}`;
  if (rank === 1) rankDisplay = '🥇';
  else if (rank === 2) rankDisplay = '🥈';
  else if (rank === 3) rankDisplay = '🥉';
  
  div.innerHTML = `
    <div class="priority-rank">${rankDisplay}</div>
    <div class="priority-content">
      <div class="priority-title">${escapeHtml(priority.title)}</div>
      <div class="priority-meta">
        <span class="priority-category">${escapeHtml(priority.category || 'Other')}</span>
        ${priority.description ? escapeHtml(priority.description.substring(0, 100)) + '...' : ''}
      </div>
    </div>
    <div class="vote-section">
      <button class="vote-btn ${hasVoted ? 'voted' : ''}" 
              onclick="vote('${id}')" 
              ${!canVote ? 'disabled' : ''}
              title="${hasVoted ? 'You already voted' : 'Click to vote'}">
        ${hasVoted ? '✓' : '▲'}
      </button>
      <div class="vote-count">${priority.votes || 0}</div>
    </div>
  `;
  
  return div;
}

function vote(priorityId) {
  if (!currentUser) {
    openLoginModal();
    return;
  }
  
  if (userVotes.includes(priorityId)) {
    alert('You have already voted for this priority!');
    return;
  }
  
  // Add vote
  const priorityRef = db.collection('priorities').doc(priorityId);
  const voteRef = db.collection('votes').doc();
  
  // Use batch write for atomic operation
  const batch = db.batch();
  
  batch.update(priorityRef, {
    votes: firebase.firestore.FieldValue.increment(1),
    lastVoteAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  
  batch.set(voteRef, {
    userId: currentUser.uid,
    priorityId: priorityId,
    votedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  
  batch.commit()
    .then(() => {
      userVotes.push(priorityId);
      loadPriorities(); // Reload to update UI
      loadStats(); // Update stats
    })
    .catch((error) => {
      console.error('Error voting:', error);
      alert('Failed to register vote. Please try again.');
    });
}

function loadUserVotes() {
  if (!currentUser) {
    userVotes = [];
    return;
  }
  
  db.collection('votes')
    .where('userId', '==', currentUser.uid)
    .get()
    .then((querySnapshot) => {
      userVotes = [];
      querySnapshot.forEach((doc) => {
        userVotes.push(doc.data().priorityId);
      });
      loadPriorities(); // Reload to update vote buttons
    })
    .catch((error) => {
      console.error('Error loading user votes:', error);
    });
}

function filterPriorities(filter) {
  currentFilter = filter;
  
  // Update button states
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  const items = document.querySelectorAll('.priority-item');
  
  if (filter === 'all') {
    items.forEach(item => item.style.display = 'flex');
  } else if (filter === 'trending') {
    // Show items with most votes in last 7 days
    // For simplicity, showing top 10
    items.forEach((item, index) => {
      item.style.display = index < 10 ? 'flex' : 'none';
    });
  } else if (filter === 'new') {
    // This would need timestamp filtering in real implementation
    // For now, show last 5 items
    const itemsArray = Array.from(items);
    itemsArray.reverse().forEach((item, index) => {
      item.style.display = index < 5 ? 'flex' : 'none';
    });
  }
}

// ==================== ADD PRIORITY ====================

function openAddPriorityModal() {
  if (!currentUser) {
    openLoginModal();
    return;
  }
  
  document.getElementById('addPriorityModal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeAddPriorityModal() {
  document.getElementById('addPriorityModal').classList.remove('active');
  document.body.style.overflow = 'auto';
  document.getElementById('addPriorityForm').reset();
  document.getElementById('addPriorityAlert').innerHTML = '';
}

function submitPriority(event) {
  event.preventDefault();
  
  if (!currentUser) {
    showAddPriorityAlert('Please sign in with Google first', 'error');
    closeAddPriorityModal();
    setTimeout(() => loginWithGoogle(), 300);
    return;
  }
  
  const title = document.getElementById('priorityTitle').value.trim();
  const description = document.getElementById('priorityDescription').value.trim();
  const category = document.getElementById('priorityCategory').value;
  
  if (!title || !description || !category) {
    showAddPriorityAlert('Please fill in all fields', 'error');
    return;
  }
  
  showAddPriorityAlert('Submitting your priority...', 'info');
  
  db.collection('priorities').add({
    title: title,
    description: description,
    category: category,
    submittedBy: currentUser.uid,
    submittedByEmail: currentUser.email,
    submittedByName: currentUser.displayName || currentUser.email.split('@')[0],
    status: 'pending', // Will be reviewed by admin
    votes: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })
  .then(() => {
    showAddPriorityAlert('✅ Priority submitted successfully! Admin will review within 24-48 hours.', 'success');
    setTimeout(() => {
      closeAddPriorityModal();
    }, 2000);
  })
  .catch((error) => {
    console.error('Error submitting priority:', error);
    showAddPriorityAlert('Error submitting priority: ' + error.message, 'error');
  });
}

function showAddPriorityAlert(message, type) {
  const alertDiv = document.getElementById('addPriorityAlert');
  alertDiv.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
}

// ==================== STATISTICS ====================

function loadStats() {
  // Total votes
  db.collection('votes').get().then(snapshot => {
    document.getElementById('totalVotes').textContent = snapshot.size.toLocaleString();
  });
  
  // Total priorities (approved)
  db.collection('priorities')
    .where('status', '==', 'approved')
    .get()
    .then(snapshot => {
      document.getElementById('totalPriorities').textContent = snapshot.size;
    });
  
  // Active users
  db.collection('users').get().then(snapshot => {
    document.getElementById('activeUsers').textContent = snapshot.size.toLocaleString();
  });
  
  // Countries (based on email domains)
  db.collection('users').get().then(snapshot => {
    const countries = new Set();
    snapshot.forEach(doc => {
      const email = doc.data().email || '';
      // Extract country from email domain (simplified)
      const domain = email.split('@')[1] || '';
      countries.add(domain);
    });
    document.getElementById('countriesRepresented').textContent = Math.min(countries.size, 195); // Cap at max countries
  });
}

// ==================== REALTIME UPDATES ====================

function setupRealtimeListeners() {
  // Listen for new approved priorities
  db.collection('priorities')
    .where('status', '==', 'approved')
    .onSnapshot((snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          // Reload priorities when changes occur
          if (document.getElementById('priorityList').children.length > 0) {
            loadPriorities();
            loadStats();
          }
        }
      });
    });
}

// ==================== UTILITY FUNCTIONS ====================

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}
