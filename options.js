document.addEventListener('DOMContentLoaded', function() {
  // Load current settings
  loadSettings();
  
  // Add event listener for save button
  document.getElementById('save-button').addEventListener('click', saveSettings);
  
  // Add event listener for save email button
  document.getElementById('saveEmail').addEventListener('click', () => {
    const email = document.getElementById('userEmail').value;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // First save to Chrome storage
      chrome.storage.local.set({ recipientEmail: email }, () => {
        // Then send to server
        fetch('http://localhost:3000/api/set-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            userId: 'default',
            email: email
          })
        })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            showStatus('Email saved to extension and server!', 'success');
          } else {
            showStatus('Email saved to extension only. Server error: ' + data.error, 'error');
          }
        })
        .catch(error => {
          console.error('Server communication error:', error);
          showStatus('Email saved to extension only. Server unreachable.', 'error');
        });
      });
    } else {
      showStatus('Invalid email format', 'error');
    }
  });
});

// Function to load settings from storage
function loadSettings() {
  chrome.storage.local.get([
    'checkInterval',
    'notificationMethod',
    'userEmail',
    'apiEndpoint'
  ], function(result) {
    // Set check interval
    const checkIntervalSelect = document.getElementById('check-interval');
    if (result.checkInterval) {
      checkIntervalSelect.value = result.checkInterval;
    }
    
    // Set notification method
    const notificationMethodSelect = document.getElementById('notification-method');
    if (result.notificationMethod) {
      notificationMethodSelect.value = result.notificationMethod;
    }
    
    // Set email address
    const emailInput = document.getElementById('email-address');
    if (result.userEmail) {
      emailInput.value = result.userEmail;
    }
    
    // Set API endpoint
    const apiEndpointInput = document.getElementById('api-endpoint');
    if (result.apiEndpoint) {
      apiEndpointInput.value = result.apiEndpoint;
    } else {
      apiEndpointInput.value = 'http://localhost:3000/api';
    }
  });
}

// Function to save settings
function saveSettings() {
  const checkInterval = document.getElementById('check-interval').value;
  const notificationMethod = document.getElementById('notification-method').value;
  const userEmail = document.getElementById('email-address').value;
  const apiEndpoint = document.getElementById('api-endpoint').value;
  
  // Validate email if notification method requires it
  if ((notificationMethod === 'email' || notificationMethod === 'both') && !isValidEmail(userEmail)) {
    showStatus('Please enter a valid email address for notifications');
    return;
  }
  
  // Save settings to storage
  chrome.storage.local.set({
    checkInterval: checkInterval,
    notificationMethod: notificationMethod,
    userEmail: userEmail,
    apiEndpoint: apiEndpoint
  }, function() {
    // Update alarm interval
    chrome.alarms.clear('checkPrices', function() {
      chrome.alarms.create('checkPrices', { periodInMinutes: parseInt(checkInterval) });
    });
    
    showStatus('Settings saved successfully!');
  });
}

// Helper function to show status message
function showStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  
  if (type === 'success') {
    status.classList.add('success');
  } else if (type === 'error') {
    status.classList.add('error');
  }
  
  // Clear message after a few seconds
  setTimeout(function() {
    status.textContent = '';
    status.classList.remove('success', 'error');
  }, 3000);
}

// Helper function to validate email
function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
} 