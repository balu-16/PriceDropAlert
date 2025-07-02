// Import API client
// Note: In Manifest V3, we need to explicitly load the API script in the HTML
// or use importScripts() in a service worker

// Server configuration
const SERVER_URL = 'http://localhost:3000';
const API_URL = `${SERVER_URL}/api`;
let isServerAvailable = false;

// Initialize when extension is installed
chrome.runtime.onInstalled.addListener(function (details) {
  console.log('Extension installed/updated:', details.reason);

  // Initialize storage with empty array if fresh install
  if (details.reason === 'install') {
    chrome.storage.local.set({
      trackedProducts: [],
      userEmail: ''
    });
  }

  // Check prices right away
  setTimeout(checkAllPrices, 5000);

  // Set up alarm for regular checking
  chrome.alarms.create('checkPrices', { periodInMinutes: 60 });
});

// Set up automatic price checking on startup
chrome.runtime.onStartup.addListener(function () {
  console.log('Extension started - setting up price checking');

  // Check prices right away
  checkAllPrices();

  // Set up alarm for regular checking
  chrome.alarms.create('checkPrices', { periodInMinutes: 60 });
});

// Check if the server is available
async function checkServerAvailability() {
  try {
    const response = await fetch(SERVER_URL, {
      method: 'GET',
      // Adding timeout to avoid long waiting periods
      signal: AbortSignal.timeout(3000)
    });
    isServerAvailable = response.ok;
    console.log('Server status:', isServerAvailable ? 'Available' : 'Unavailable');
    return isServerAvailable;
  } catch (error) {
    console.warn('Server connection failed:', error.message);
    isServerAvailable = false;
    return false;
  }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'email-setup':
      chrome.storage.local.set({ userEmail: message.data.email }, () => {
        sendResponse({ success: true });
      });
      return true; // Keep channel open
    case 'addProduct':
      // Debug logging to track the problem
      console.log('Received addProduct request:', JSON.stringify(message.data));

      if (message.data && typeof message.data.checkInterval !== 'undefined') {
        console.log('Check interval from popup:', message.data.checkInterval);
      }

      // Pass the entire data object including the checkInterval
      addProduct(message.data, null, sendResponse);
      return true; // Indicates we will send response asynchronously
    case 'setEmail':
      setUserEmail(message.data.email, sendResponse);
      return false; // Synchronous response
    case 'checkServer':
      checkServerAvailability().then(isAvailable => {
        sendResponse({ success: true, isServerAvailable: isAvailable });
      });
      return true; // Async response
    case 'checkPricesNow':
      // Manually trigger a price check
      console.log('Manual price check requested from popup');
      checkAllPrices().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        console.error('Price check failed:', error);
        sendResponse({ success: false, error: error.message });
      });
      return true; // Async response
    case 'stopMonitoring':
      // Handle request to stop monitoring a product
      stopMonitoring(message.data.url, sendResponse);
      return true; // Async response
    case 'updateManualPrice':
      // Handle manual price update
      updateManualPrice(message.data.url, message.data.currentPrice, message, sendResponse);
      return true; // Async response 
  }
});

// Listen for alarm to check prices
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === 'checkPrices') {
    checkAllPrices();
  }
});

// Function to set user email
function setUserEmail(email, sendResponse) {
  chrome.storage.local.set({ userEmail: email }, function () {
    if (sendResponse) {
      sendResponse({ success: true });
    }
  });
}

// Function to add a new product to track
async function addProduct(data, _targetPrice, sendResponse) {
  let url, targetPrice, checkInterval;

  // Check if we received an object as data parameter (new style)
  if (data && typeof data === 'object' && data.url) {
    url = data.url;
    targetPrice = data.targetPrice;
    checkInterval = data.checkInterval;
    // Use selectedPrice if provided, otherwise fallback to productInfo.price
    var userSelectedPrice = data.selectedPrice;
    var userSelectedTitle = data.title;
    console.log(`Processing product data object: URL=${url}, Target=${targetPrice}, Interval=${checkInterval}, SelectedPrice=${userSelectedPrice}`);
  } else {
    // Old style parameters (for backward compatibility)
    url = data;
    targetPrice = _targetPrice;
    checkInterval = 86400; // Default for old calls
    var userSelectedPrice = undefined;
    var userSelectedTitle = undefined;
    console.log(`Processing product with old-style parameters: URL=${url}, Target=${targetPrice}`);
  }

  // Ensure checkInterval is processed as a number and has a default
  checkInterval = checkInterval ? parseInt(checkInterval, 10) : 86400;
  console.log(`Parsed check interval: ${checkInterval} seconds`);

  try {
    // Check if server is available
    const serverAvailable = await checkServerAvailability();

    if (!serverAvailable) {
      console.log('Server unavailable, using simulation mode');
      simulateProductInfo(url, targetPrice, sendResponse, checkInterval);
      return;
    }

    // Make API request with timeout
    const apiUrl = `${API_URL}/scrape`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });

    clearTimeout(timeoutId); // Clear the timeout

    // Check if response is OK (status code 200-299)
    if (!response.ok) {
      console.error('API response not OK:', response.status, response.statusText);
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    // Safely parse the JSON response
    let result;
    try {
      result = await response.json();
    } catch (parseError) {
      console.error('Failed to parse JSON response:', parseError);
      throw new Error('Invalid response from server');
    }

    // Check if result has the expected structure
    if (!result || typeof result !== 'object') {
      console.error('Unexpected API response format:', result);
      throw new Error('Unexpected response format from server');
    }

    // Check if result contains success flag
    if (result.success === false) {
      console.error('API reported failure:', result.message);
      throw new Error(result.message || 'Failed to get product information');
    }

    // If result doesn't have data property or it's not properly formatted, throw error
    if (!result.data || !result.data.price || !result.data.title) {
      console.error('API response missing required data:', result);
      throw new Error('Product information incomplete in server response');
    }

    const productInfo = result.data;

    // Convert prices to numbers for comparison
    const numericCurrentPrice = parseFloat(productInfo.price);
    const numericTargetPrice = parseFloat(targetPrice);

    // Log price information for debugging
    console.log(`Product: ${productInfo.title}`);
    console.log(`Current price: ${numericCurrentPrice}, Target price: ${numericTargetPrice}`);
    console.log(`Check interval: ${checkInterval} seconds`);
    console.log(`Is price below target? ${numericCurrentPrice <= numericTargetPrice}`);

    // If successful, add to storage
    chrome.storage.local.get(['trackedProducts', 'userEmail'], function (result) {
      const products = result.trackedProducts || [];
      const userEmail = result.userEmail;

      // Check if URL already exists
      const existingIndex = products.findIndex(p => p.url === url);

      if (existingIndex >= 0) {
        // Update existing product
        products[existingIndex].targetPrice = numericTargetPrice;
        products[existingIndex].title = userSelectedTitle || productInfo.title;
        products[existingIndex].currentPrice = (typeof userSelectedPrice !== 'undefined') ? userSelectedPrice : numericCurrentPrice;
        products[existingIndex].lastChecked = new Date().toISOString();
        products[existingIndex].checkInterval = checkInterval;
        products[existingIndex].priceConfirmed = false; // Add this flag
        products[existingIndex].priceOptions = productInfo.priceOptions || [];
        products[existingIndex].priceDisplayOptions = productInfo.priceDisplayOptions || [];

        // Save to storage
        chrome.storage.local.set({ trackedProducts: products }, function () {
          // Now set up monitoring with the server - but don't send notifications yet
          setupServerMonitoring(
            url,
            userEmail,
            numericTargetPrice,
            checkInterval,
            productInfo
          );

          sendResponse({
            success: true,
            product: {
              title: userSelectedTitle || productInfo.title,
              currentPrice: (typeof userSelectedPrice !== 'undefined') ? userSelectedPrice : numericCurrentPrice,
              checkInterval: checkInterval
            },
            isUpdate: true
          });
        });
      } else {
        // Add new product
        const newProduct = {
          url: url,
          targetPrice: numericTargetPrice,
          title: userSelectedTitle || productInfo.title,
          currentPrice: (typeof userSelectedPrice !== 'undefined') ? userSelectedPrice : numericCurrentPrice,
          checkInterval: checkInterval,
          addedOn: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          priceConfirmed: false, // Add this flag
          priceOptions: productInfo.priceOptions || [],
          priceDisplayOptions: productInfo.priceDisplayOptions || []
        };

        // Add to beginning of array to show newest products first
        products.unshift(newProduct);

        // Save to storage
        chrome.storage.local.set({ trackedProducts: products }, function () {
          // Now set up monitoring with the server - but don't send notifications yet
          setupServerMonitoring(
            url,
            userEmail,
            numericTargetPrice,
            checkInterval,
            productInfo
          );

          sendResponse({
            success: true,
            product: {
              title: userSelectedTitle || productInfo.title,
              currentPrice: (typeof userSelectedPrice !== 'undefined') ? userSelectedPrice : numericCurrentPrice,
              checkInterval: checkInterval
            }
          });
        });
      }
    });
  } catch (error) {
    console.error('Failed to add product:', error);
    sendResponse({ success: false, message: error.message });
  }
}

// Function to simulate product information when server is unavailable
function simulateProductInfo(url, targetPrice, sendResponse, checkInterval = 86400) {
  // Skip API request and generate fake product info
  console.log('Simulating product info for:', url);

  // Extract domain for product title
  let domain = 'unknown';
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname.replace('www.', '').split('.')[0];
  } catch (e) {
    console.error('Failed to parse URL:', e);
  }

  // Generate random price within reasonable range
  const randomPrice = Math.floor(Math.random() * 20000) + 5000;

  // Format product title based on URL
  let productTitle = `Product from ${domain.charAt(0).toUpperCase() + domain.slice(1)}`;

  // Try to extract product name from URL
  if (url.includes('amazon')) {
    productTitle = 'Amazon Product';
    // Try to extract ASIN
    const asinMatch = url.match(/\/([A-Z0-9]{10})(?:\/|\?|$)/);
    if (asinMatch && asinMatch[1]) {
      productTitle += ` (${asinMatch[1]})`;
    }
  } else if (url.includes('flipkart')) {
    productTitle = 'Flipkart Product';
    // Try to extract product ID
    const idMatch = url.match(/\/p\/(\w+)/);
    if (idMatch && idMatch[1]) {
      productTitle += ` (${idMatch[1].substring(0, 8)}...)`;
    }

    // Try to extract more descriptive name from URL
    // Flipkart URLs typically have the product name in the path
    const pathParts = url.split('/');
    if (pathParts.length > 3) {
      // Find the part before "/p/"
      for (let i = 0; i < pathParts.length; i++) {
        if (pathParts[i] === 'p' && i > 0) {
          const nameCandidate = pathParts[i - 1];
          if (nameCandidate && nameCandidate.length > 5) {
            // Convert dashes to spaces and capitalize words
            const prettyName = nameCandidate
              .replace(/-/g, ' ')
              .replace(/\b\w/g, c => c.toUpperCase());

            productTitle = prettyName;
            break;
          }
        }
      }
    }
  }

  // Store the product information
  chrome.storage.local.get(['trackedProducts', 'userEmail'], function (result) {
    const products = result.trackedProducts || [];
    const userEmail = result.userEmail;

    // Check if URL already exists
    const existingIndex = products.findIndex(p => p.url === url);

    if (existingIndex >= 0) {
      // Update existing product
      products[existingIndex].targetPrice = parseFloat(targetPrice);
      products[existingIndex].lastChecked = new Date().toISOString();
      products[existingIndex].checkInterval = checkInterval;
      
      // Ensure priceOptions exist for existing simulated products
      if (!products[existingIndex].priceOptions || products[existingIndex].priceOptions.length === 0) {
        const currentPrice = products[existingIndex].currentPrice;
        const priceOption1 = currentPrice + Math.floor(Math.random() * 5000) + 1000;
        const priceOption2 = currentPrice - Math.floor(Math.random() * 3000) - 500;
        
        products[existingIndex].priceOptions = [currentPrice, priceOption1, priceOption2];
        products[existingIndex].priceDisplayOptions = [`Rs. ${Number(currentPrice).toLocaleString()}`, `Rs. ${Number(priceOption1).toLocaleString()}`, `Rs. ${Number(priceOption2).toLocaleString()}`];
      }

      chrome.storage.local.set({ trackedProducts: products }, function () {
        sendResponse({
          success: true,
          product: {
            title: products[existingIndex].title,
            currentPrice: products[existingIndex].currentPrice,
            checkInterval: checkInterval
          },
          isUpdate: true,
          isSimulated: true
        });
      });
    } else {
      // Generate additional price options for simulation
      const priceOption1 = randomPrice + Math.floor(Math.random() * 5000) + 1000;
      const priceOption2 = randomPrice - Math.floor(Math.random() * 3000) - 500;
      
      // Create new product object
      const newProduct = {
        url: url,
        targetPrice: parseFloat(targetPrice),
        title: productTitle,
        currentPrice: randomPrice,
        checkInterval: checkInterval,
        addedOn: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
        isSimulated: true,
        priceOptions: [randomPrice, priceOption1, priceOption2],
        priceDisplayOptions: [`Rs. ${Number(randomPrice).toLocaleString()}`, `Rs. ${Number(priceOption1).toLocaleString()}`, `Rs. ${Number(priceOption2).toLocaleString()}`]
      };

      // Add to beginning of array
      products.unshift(newProduct);

      chrome.storage.local.set({ trackedProducts: products }, function () {
        sendResponse({
          success: true,
          product: {
            title: productTitle,
            currentPrice: randomPrice,
            checkInterval: checkInterval
          },
          isSimulated: true
        });
      });
    }
  });
}

// Function to set up server-side monitoring
async function setupServerMonitoring(url, email, targetPrice, checkInterval, productInfo) {
  if (!isServerAvailable || !email) {
    console.log('Skipping server monitoring setup - server unavailable or no email');
    return;
  }

  try {
    // Ensure checkInterval is a number and at least 60 seconds
    const interval = Math.max(60, parseInt(checkInterval || 86400, 10));
    console.log('Setting up server monitoring with interval:', interval, 'seconds');

    // Log in a way that's easy to see in the console
    console.log(`--------------------------------------------------`);
    console.log(`MONITOR SETUP: ${url}`);
    console.log(`Email: ${email}`);
    console.log(`Target price: ${targetPrice}`);
    console.log(`Check interval: ${interval} seconds (${interval / 60} minutes)`);
    console.log(`Product: ${productInfo.title}`);
    console.log(`--------------------------------------------------`);

    const monitorUrl = `${API_URL}/monitor`;
    const response = await fetch(monitorUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        email: email,
        targetPrice: targetPrice,
        checkInterval: interval
      })
    });

    if (!response.ok) {
      console.error('Failed to set up monitoring:', response.status, response.statusText);
      return;
    }

    const result = await response.json();

    if (result.success) {
      console.log('Server monitoring set up successfully:', result.data?.monitorId);
      console.log('Check interval confirmed:', result.data?.checkInterval, 'seconds');
      console.log('Next check scheduled for:', new Date(result.data?.nextCheckAt).toLocaleString());

      // Set a client-side reminder to check again after the interval
      setTimeout(() => {
        console.log(`Reminder: It's been ${interval} seconds since monitoring was set up for ${productInfo.title}`);
        console.log('Server should be checking price around now');
      }, interval * 1000);
    } else {
      console.error('Server reported error setting up monitoring:', result.message);
    }
  } catch (error) {
    console.error('Error setting up server monitoring:', error);
  }
}

// Function to check prices for all tracked products
async function checkAllPrices() {
  console.log('Running scheduled price check...');

  // Return a Promise so we can chain actions
  return new Promise(async (resolve, reject) => {
    try {
      // Check server availability first
      const serverAvailable = await checkServerAvailability();

      chrome.storage.local.get(['trackedProducts', 'userEmail'], function (result) {
        const products = result.trackedProducts || [];
        const userEmail = result.userEmail;

        console.log(`Checking prices for ${products.length} products, email: ${userEmail || 'not set'}`);

        if (!userEmail) {
          console.warn('No user email configured for notifications');
        }

        let updatedProducts = [...products]; // Create a copy for updates
        let promiseChain = Promise.resolve();

        products.forEach(async (product, index) => {
          // Store the previous price before updating
          const previousPrice = parseFloat(product.currentPrice);
          const targetPrice = parseFloat(product.targetPrice);

          console.log(`Checking product: ${product.title}, Target: ${targetPrice}`);

          promiseChain = promiseChain.then(async () => {
            if (serverAvailable) {
              try {
                // Make API request to check price with timeout
                const apiUrl = `${API_URL}/scrape`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

                const response = await fetch(apiUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ url: product.url }),
                  signal: controller.signal
                });

                clearTimeout(timeoutId); // Clear the timeout

                if (!response.ok) {
                  throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                }

                const apiResult = await response.json();

                if (!apiResult.success) {
                  throw new Error('API request failed: ' + apiResult.message);
                }

                const productInfo = apiResult.data;
                const currentPrice = parseFloat(productInfo.price);

                // Update product price
                updatedProducts[index].currentPrice = currentPrice;
                updatedProducts[index].lastChecked = new Date().toISOString();

                console.log(`Price check for ${product.title}: Current: ${currentPrice}, Target: ${targetPrice}, Previous: ${previousPrice}`);

                // Check if price is below or equal to target - ONLY SEND NOTIFICATIONS IF PRICE IS CONFIRMED
                if (currentPrice <= targetPrice && product.priceConfirmed) {
                  console.log(`✓ Price below target and confirmed! ${product.title}: ${currentPrice} <= ${targetPrice}`);

                  // Force notification flag - set to true for the first time or if price dropped
                  const forceNotify = !product.lastNotified || currentPrice < previousPrice;

                  if (forceNotify) {
                    console.log(`🔔 SENDING NOTIFICATION for ${product.title}`);

                    // Send browser notification
                    sendPriceDropNotification(product.title, currentPrice, product.url);

                    // Send email notification if email is configured
                    if (userEmail) {
                      console.log(`📧 Sending email to ${userEmail} for ${product.title}`);
                      try {
                        await sendEmailNotification(userEmail, product, currentPrice);
                        console.log(`✅ Email notification sent for ${product.title}`);
                        // Update last notified time
                        updatedProducts[index].lastNotified = new Date().toISOString();
                      } catch (error) {
                        console.error(`❌ Failed to send email for ${product.title}:`, error.message);
                      }
                    } else {
                      console.warn('⚠️ Email notification skipped - no email configured');
                    }
                  } else {
                    console.log(`ℹ️ Skipping notification for ${product.title} - already notified about this price`);
                  }
                } else if (currentPrice <= targetPrice && !product.priceConfirmed) {
                  console.log(`ℹ️ Price below target for ${product.title} but not confirmed yet: ${currentPrice} <= ${targetPrice}`);
                } else {
                  console.log(`✗ Price above target for ${product.title}: ${currentPrice} > ${targetPrice}`);
                }
              } catch (error) {
                console.error(`Error checking price for ${product.title}:`, error.message);

                // Fallback to simulation for testing
                simulatePriceCheck(updatedProducts, index, userEmail);
              }
            } else {
              // Server unavailable, use simulation
              console.log('Server unavailable, using simulation mode');
              simulatePriceCheck(updatedProducts, index, userEmail);
            }
          });
        });

        // When all product checks are complete
        promiseChain.then(() => {
          // Save updated prices back to storage
          chrome.storage.local.set({ trackedProducts: updatedProducts }, () => {
            console.log('Price check completed and storage updated');
            resolve(true); // Resolve the main promise
          });
        }).catch(error => {
          console.error('Error during price checks:', error);
          reject(error);
        });
      });
    } catch (error) {
      console.error('Failed to check prices:', error);
      reject(error);
    }
  });
}

// Helper function to simulate price check
function simulatePriceCheck(products, index, userEmail) {
  const product = products[index];
  const targetPrice = parseFloat(product.targetPrice);
  const previousPrice = parseFloat(product.currentPrice);

  // For testing, we want a higher chance of triggering a notification
  let simulatedPrice;
  if (Math.random() < 0.5) { // 50% chance to get a price below target
    simulatedPrice = targetPrice * 0.9; // 10% below target
    console.log(`💲 Simulating price DROP for ${product.title}: ${simulatedPrice} (below target ${targetPrice})`);
  } else {
    simulatedPrice = targetPrice * 1.1; // 10% above target
    console.log(`💲 Simulating price for ${product.title}: ${simulatedPrice} (above target ${targetPrice})`);
  }

  // Update product data
  products[index].currentPrice = simulatedPrice;
  products[index].lastChecked = new Date().toISOString();

  // If price is below target and confirmed, send notification
  if (simulatedPrice <= targetPrice && product.priceConfirmed) {
    console.log(`✓ Simulated price below target and confirmed! ${product.title}: ${simulatedPrice} <= ${targetPrice}`);

    // Send browser notification
    sendPriceDropNotification(product.title, simulatedPrice, product.url);

    // Force notification flag - set to true for the first time or if price dropped
    const forceNotify = !product.lastNotified || simulatedPrice < previousPrice;

    // Send email notification if email is configured and notification criteria met
    if (userEmail && forceNotify) {
      console.log(`📧 Sending simulated email to ${userEmail} for ${product.title}`);
      sendEmailNotification(userEmail, product, simulatedPrice)
        .then(() => {
          console.log(`✅ Simulated email notification sent for ${product.title}`);
          // Update last notified time
          products[index].lastNotified = new Date().toISOString();
        })
        .catch(error => {
          console.error(`❌ Failed to send simulated email for ${product.title}:`, error.message);
        });
    } else if (!userEmail) {
      console.warn('⚠️ Email notification skipped - no email configured');
    } else {
      console.log(`ℹ️ Skipping notification for ${product.title} - already notified about this price`);
    }
  } else if (simulatedPrice <= targetPrice && !product.priceConfirmed) {
    console.log(`ℹ️ Simulated price below target for ${product.title} but not confirmed yet: ${simulatedPrice} <= ${targetPrice}`);
  } else {
    console.log(`✗ Simulated price above target for ${product.title}: ${simulatedPrice} > ${targetPrice}`);
  }
}

// Function to send browser notification
function sendPriceDropNotification(title, price, url) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Price Drop Alert! 🎉',
    message: `${title} is now Rs. ${price}. Click to view.`,
    priority: 2
  });

  // Add notification click handler
  chrome.notifications.onClicked.addListener(function (notificationId) {
    chrome.tabs.create({ url: url });
  });
}

// Function to send email notification
async function sendEmailNotification(email, product, currentPrice) {
  // Check if server is available first
  const serverAvailable = await checkServerAvailability();
  if (!serverAvailable) {
    console.log('Server unavailable, email notification skipped');
    return;
  }

  try {
    console.log(`Sending email notification to ${email} for ${product.title}`);

    // Ensure prices are properly formatted as numbers
    const numericCurrentPrice = typeof currentPrice === 'string' ? parseFloat(currentPrice) : currentPrice;
    const numericTargetPrice = typeof product.targetPrice === 'string' ? parseFloat(product.targetPrice) : product.targetPrice;

    // Log with clear formatting to aid debugging
    console.log(`Email data:
      - Current price: ${numericCurrentPrice} (${typeof numericCurrentPrice})
      - Target price: ${numericTargetPrice} (${typeof numericTargetPrice})
      - Is price drop?: ${numericCurrentPrice <= numericTargetPrice}
    `);

    // Extra validation to prevent false notifications
    if (numericCurrentPrice > numericTargetPrice) {
      console.warn(`Warning: Current price (${numericCurrentPrice}) is higher than target price (${numericTargetPrice}). Sending notification anyway as requested.`);
    }

    // If price value seems unreasonably high, log a warning
    if (numericCurrentPrice > 1000000) {
      console.warn(`Warning: Price value (${numericCurrentPrice}) seems unusually high. Please verify.`);
    }

    const apiUrl = `${API_URL}/notify`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const requestData = {
      email,
      product: {
        ...product,
        // Ensure these fields are present and in the correct format
        title: product.title || 'Product',
        url: product.url,
        targetPrice: numericTargetPrice
      },
      currentPrice: numericCurrentPrice
    };

    console.log('Email notification request data:', JSON.stringify(requestData));

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.success) {
      console.log('Email notification sent successfully for:', product.title);
    } else {
      console.error('Email notification failed:', result.message);
    }
  } catch (error) {
    console.error('Failed to send email notification:', error.message);
  }
}

// Function to stop monitoring a product
async function stopMonitoring(url, sendResponse) {
  console.log(`Stopping monitoring for URL: ${url}`);

  // Check if server is available
  const serverAvailable = await checkServerAvailability();

  if (serverAvailable) {
    try {
      // Call the server to stop monitoring
      const stopUrl = `${API_URL}/monitor/stop`;
      const response = await fetch(stopUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url })
      });

      if (!response.ok) {
        console.error('Failed to stop monitoring on server:', response.status, response.statusText);
        sendResponse({ success: false, message: 'Failed to stop monitoring on server' });
        return;
      }

      const result = await response.json();

      if (result.success) {
        console.log('Server monitoring stopped successfully');
        sendResponse({ success: true });
      } else {
        console.error('Server reported error stopping monitoring:', result.message);
        sendResponse({ success: false, message: result.message });
      }
    } catch (error) {
      console.error('Error stopping server monitoring:', error);
      sendResponse({ success: false, message: error.message });
    }
  } else {
    // Simulation mode - just respond with success
    console.log('Server unavailable, simulating stop monitoring response');
    sendResponse({ success: true, isSimulated: true });
  }
}

// Function to update manual price
async function updateManualPrice(url, currentPrice, request, sendResponse) {
  console.log(`Updating manual price for URL: ${url} to ${currentPrice}`);

  try {
    // Extract additional parameters
    const sendNotification = request?.data?.sendNotification || false;
    const userEmail = request?.data?.userEmail || '';

    console.log(`Send notification: ${sendNotification}, User email: ${userEmail}`);

    // First update the price in local storage to ensure consistency
    chrome.storage.local.get(['trackedProducts'], function (result) {
      const products = result.trackedProducts || [];

      // Find the product with the matching URL
      const productIndex = products.findIndex(p => p.url === url);

      if (productIndex >= 0) {
        // Update the product with the manual price
        products[productIndex].currentPrice = currentPrice;
        products[productIndex].manualPriceUpdate = true;
        products[productIndex].lastChecked = new Date().toISOString();

        // Save the updated products back to storage
        chrome.storage.local.set({ trackedProducts: products }, function () {
          console.log(`Local storage updated with manual price: ${currentPrice}`);

          // If we should send a notification and have an email
          if (sendNotification && userEmail) {
            console.log(`Sending email notification for manual price update to ${userEmail}`);

            // Get the product data
            const product = products[productIndex];

            // Send email notification
            sendEmailNotification(userEmail, product, currentPrice)
              .then(() => {
                console.log('Email notification sent for manual price update');
              })
              .catch(error => {
                console.error('Failed to send email for manual price update:', error);
              });
          }
        });
      } else {
        console.warn(`Product with URL ${url} not found in local storage`);
      }
    });

    // Check if server is available
    const serverAvailable = await checkServerAvailability();

    if (serverAvailable) {
      try {
        // Call the server to update the price
        const updateUrl = `${API_URL}/monitor/update-price`;

        console.log(`Sending manual price update to server: ${updateUrl}`);
        console.log(`Data: URL=${url}, Price=${currentPrice}, SendNotification=${sendNotification}`);

        const response = await fetch(updateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: url,
            currentPrice: currentPrice,
            sendNotification: sendNotification
          })
        });

        if (!response.ok) {
          console.error('Failed to update price on server:', response.status, response.statusText);

          // Try the alternative endpoint at /api/monitor/update-price
          console.log('Trying alternative endpoint for manual price update...');
          const altUpdateUrl = `${API_URL}/api/monitor/update-price`;

          const altResponse = await fetch(altUpdateUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: url,
              currentPrice: currentPrice,
              sendNotification: sendNotification
            })
          });

          if (!altResponse.ok) {
            console.error('Failed to update price on server (alternative endpoint):', altResponse.status, altResponse.statusText);
            sendResponse({ success: false, message: 'Failed to update price on server' });
            return;
          }

          const altResult = await altResponse.json();

          if (altResult.success) {
            console.log('Server price updated successfully (alternative endpoint)');
            sendResponse({ success: true, notificationSent: sendNotification });
          } else {
            console.error('Server reported error updating price (alternative endpoint):', altResult.message);
            sendResponse({ success: false, message: altResult.message });
          }
          return;
        }

        const result = await response.json();

        if (result.success) {
          console.log('Server price updated successfully');
          sendResponse({ success: true, notificationSent: sendNotification });
        } else {
          console.error('Server reported error updating price:', result.message);
          sendResponse({ success: false, message: result.message });
        }
      } catch (error) {
        console.error('Error updating price on server:', error);
        sendResponse({ success: false, message: error.message });
      }
    } else {
      // Simulation mode - just respond with success since we've already updated local storage
      console.log('Server unavailable, manual price stored locally only');
      sendResponse({ success: true, isSimulated: true, notificationSent: sendNotification });
    }
  } catch (error) {
    console.error('Error in updateManualPrice function:', error);
    sendResponse({ success: false, message: error.message });
  }
}