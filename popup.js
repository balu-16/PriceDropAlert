document.addEventListener('DOMContentLoaded', function () {
  const addButton = document.getElementById('add-button');
  const saveEmailButton = document.getElementById('save-email-button');
  const productUrlInput = document.getElementById('product-url');
  const targetPriceInput = document.getElementById('target-price');
  const checkIntervalInput = document.getElementById('check-interval');
  const userEmailInput = document.getElementById('user-email');
  const productsList = document.getElementById('products-list');
  const statusMessage = document.getElementById('status-message');
  const presetButtons = document.querySelectorAll('.preset-btn');

  // Set default check interval (24 hours in seconds)
  checkIntervalInput.placeholder = "Default: 86400 (1 day)";

  // Add event listeners for preset interval buttons
  presetButtons.forEach(button => {
    button.addEventListener('click', function () {
      const seconds = this.getAttribute('data-seconds');
      checkIntervalInput.value = seconds;

      // Update active state
      presetButtons.forEach(btn => btn.classList.remove('active'));
      this.classList.add('active');

      console.log(`Set check interval to: ${seconds} seconds`);
    });
  });

  // Add event listener for interval info
  const infoIcon = document.querySelector('.info-icon');
  const tooltip = document.querySelector('.interval-tooltip');

  if (infoIcon && tooltip) {
    infoIcon.addEventListener('mouseover', function () {
      tooltip.style.display = 'block';
    });

    infoIcon.addEventListener('mouseout', function () {
      tooltip.style.display = 'none';
    });
  }

  // Create server status indicator
  const statusBar = document.createElement('div');
  statusBar.id = 'server-status';
  statusBar.className = 'server-status';
  document.querySelector('.container').prepend(statusBar);

  // Create check prices button
  const checkPricesButton = document.createElement('button');
  checkPricesButton.id = 'check-prices-button';
  checkPricesButton.textContent = 'Check All Prices Now';
  checkPricesButton.className = 'check-prices-btn';
  checkPricesButton.addEventListener('click', function () {
    checkPricesNow();
  });

  // Insert the button after the tracked products heading
  const trackingHeading = document.querySelector('h2');
  if (trackingHeading && trackingHeading.textContent.includes('Tracking')) {
    trackingHeading.insertAdjacentElement('afterend', checkPricesButton);
  } else {
    // Fallback - insert before products list
    productsList.parentNode.insertBefore(checkPricesButton, productsList);
  }

  // Check server status on popup open
  checkServerStatus();

  // Load user email
  loadUserEmail();

  // Load tracked products when popup opens
  loadTrackedProducts();

  // Add event listener for save email button
  saveEmailButton.addEventListener('click', function () {
    const email = userEmailInput.value.trim();

    if (!email) {
      showStatus('Please enter your email address', 'error');
      return;
    }

    if (!isValidEmail(email)) {
      showStatus('Please enter a valid email address', 'error');
      return;
    }
  });

  // Add event listener for save email button
  document.getElementById('save-email-button').addEventListener('click', () => {
    const email = document.getElementById('user-email').value;

    chrome.runtime.sendMessage({
      action: 'email-setup',
      data: { email }
    }, (response) => {
      if (response && response.success) {
        const successMessage = document.getElementById('successMessage');
        successMessage.textContent = 'Email updated successfully!';
        successMessage.style.display = 'block';
        setTimeout(() => {
          successMessage.style.display = 'none';
        }, 3000);
      }
    });
  });

  // Add event listener for add button
  addButton.addEventListener('click', function () {
    const url = productUrlInput.value.trim();
    const targetPrice = parseFloat(targetPriceInput.value);

    // Get interval value and ensure it's a valid number
    let checkInterval = null;
    if (checkIntervalInput.value.trim()) {
      checkInterval = parseInt(checkIntervalInput.value.trim(), 10);
    }

    console.log(`Raw check interval input: "${checkIntervalInput.value}"`);
    console.log(`Parsed check interval: ${checkInterval}`);

    // If invalid or not provided, use the default
    if (!checkInterval || isNaN(checkInterval) || checkInterval < 60) {
      if (checkIntervalInput.value.trim() && (isNaN(checkInterval) || checkInterval < 60)) {
        showStatus('Check interval must be at least 60 seconds', 'error');
        return;
      }
      // If not provided or invalid, use default
      checkInterval = 86400; // Default to 24 hours
    }

    console.log(`Final check interval to use: ${checkInterval} seconds`);

    if (!url) {
      showStatus('Please enter a product URL', 'error');
      return;
    }

    if (isNaN(targetPrice) || targetPrice <= 0) {
      showStatus('Please enter a valid target price', 'error');
      return;
    }

    // Show loading status
    showStatus('Adding product...', 'info');

    // Send message to background script with explicit parameter naming
    chrome.runtime.sendMessage(
      {
        action: 'addProduct',
        data: {
          url: url,
          targetPrice: targetPrice,
          checkInterval: checkInterval
        }
      },
      function (response) {
        if (response && response.success && response.product && Array.isArray(response.product.priceOptions) && response.product.priceOptions.length > 0) {
          // Show modal for user to select price
          showPriceSelectionModal(
            response.product,
            response.product.priceOptions,
            response.product.priceDisplayOptions,
            function (selectedIdx) {
              // Use the selected price as currentPrice
              const selectedPrice = response.product.priceOptions[selectedIdx];
              // Save the product with the selected price
              chrome.runtime.sendMessage({
                action: 'addProduct',
                data: {
                  url: url,
                  targetPrice: targetPrice,
                  checkInterval: checkInterval,
                  selectedPrice: selectedPrice,
                  title: response.product.title
                }
              }, function (finalResponse) {
                if (finalResponse && finalResponse.success) {
                  showStatus('Product added successfully!', 'success');
                  setTimeout(function () {
                    loadTrackedProducts();
                  }, 1000);
                } else {
                  showStatus(finalResponse?.message || 'Failed to add product', 'error');
                }
              });
            }
          );
          return; // Don't continue with the old flow
        }

        if (response && response.success) {
          // Clear input fields
          productUrlInput.value = '';
          targetPriceInput.value = '';
          checkIntervalInput.value = '';
          
          // Remove active state from all preset buttons
          presetButtons.forEach(btn => btn.classList.remove('active'));

          console.log('Product added with response:', response);
          console.log('Check interval used:', response.product?.checkInterval || 'not returned');

          // Add the newly added product to the list immediately
          addProductToList({
            url: url,
            targetPrice: targetPrice,
            checkInterval: checkInterval,
            title: response.product?.title || 'New Product',
            currentPrice: response.product?.currentPrice || 'checking...'
          }, 0, true);

          let message = 'Product added successfully!';
          if (response.isSimulated) {
            message += ' (Simulation mode)';
          }

          showStatus(message, 'success');

          // Show price confirmation modal after product is added
          setTimeout(function () {
            confirmExtractedPrice({
              url: url,
              targetPrice: targetPrice,
              checkInterval: checkInterval,
              title: response.product?.title || 'New Product',
              currentPrice: response.product?.currentPrice || 'checking...'
            }, 0);
          }, 500);

          // Reload the complete product list after a short delay
          setTimeout(function () {
            loadTrackedProducts();
          }, 1000);
        } else {
          console.error('Failed to add product:', response?.message || 'Unknown error');
          showStatus(response?.message || 'Failed to add product', 'error');
        }
      }
    );
  });

  // Function to check server status
  function checkServerStatus() {
    chrome.runtime.sendMessage(
      { action: 'checkServer' },
      function (response) {
        if (response && response.success) {
          updateServerStatus(response.isServerAvailable);
        } else {
          updateServerStatus(false);
        }
      }
    );
  }

  // Function to update server status indicator
  function updateServerStatus(isAvailable) {
    const statusBar = document.getElementById('server-status');
    if (isAvailable) {
      statusBar.className = 'server-status online';
      statusBar.textContent = 'Server: Online';
    } else {
      statusBar.className = 'server-status offline';
      statusBar.textContent = 'Server: Offline (Simulation Mode)';
    }
  }

  // Function to load user email
  function loadUserEmail() {
    chrome.storage.local.get(['userEmail'], function (result) {
      if (result.userEmail) {
        userEmailInput.value = result.userEmail;
      }
    });
  }

  // Function to load tracked products
  function loadTrackedProducts() {
    chrome.storage.local.get(['trackedProducts'], function (result) {
      const products = result.trackedProducts || [];

      if (products.length === 0) {
        productsList.innerHTML = '<p>No products being tracked</p>';
        return;
      }

      productsList.innerHTML = '';

      products.forEach(function (product, index) {
        addProductToList(product, index, false);
      });
    });
  }

  // Function to add a product to the list
  function addProductToList(product, index, isNew) {
    const li = document.createElement('li');
    li.className = 'product-item';
    if (isNew) {
      li.className += ' new-product';
    }

    const details = document.createElement('div');
    details.className = 'product-details';

    const title = document.createElement('div');
    title.className = 'product-title';
    title.textContent = product.title || 'Product ' + (index + 1);

    const url = document.createElement('div');
    url.className = 'product-url';
    url.textContent = truncateUrl(product.url);

    const priceInfo = document.createElement('div');
    priceInfo.className = 'product-price';
    priceInfo.textContent = `Current: Rs. ${product.currentPrice || 'checking...'} | Target: Rs. ${product.targetPrice}`;

    // Add check interval info if available
    const checkIntervalInfo = document.createElement('div');
    checkIntervalInfo.className = 'check-interval-info';

    // Format the check interval for display
    const interval = product.checkInterval || 86400;
    let intervalDisplay = '';

    if (interval >= 86400 && interval % 86400 === 0) {
      // Display as days
      const days = interval / 86400;
      intervalDisplay = `${days} day${days > 1 ? 's' : ''}`;
    } else if (interval >= 3600 && interval % 3600 === 0) {
      // Display as hours
      const hours = interval / 3600;
      intervalDisplay = `${hours} hour${hours > 1 ? 's' : ''}`;
    } else if (interval >= 60 && interval % 60 === 0) {
      // Display as minutes
      const minutes = interval / 60;
      intervalDisplay = `${minutes} minute${minutes > 1 ? 's' : ''}`;
    } else {
      // Display as seconds
      intervalDisplay = `${interval} seconds`;
    }

    // Add "having troubles?" text between price and check interval
    if (product.currentPrice && product.currentPrice !== 'checking...') {
      const troublesText = document.createElement('div');
      troublesText.className = 'troubles-text';
      troublesText.textContent = 'Having Troubles?';
      troublesText.style.cursor = 'pointer';
      troublesText.style.color = '#0066cc';
      troublesText.style.fontSize = '12px';
      troublesText.style.textDecoration = 'underline';
      troublesText.style.marginTop = '5px';
      troublesText.style.marginBottom = '5px';

      troublesText.addEventListener('click', function () {
        showPriceErrorDisclaimer(product, index);
      });

      details.appendChild(title);
      details.appendChild(url);
      details.appendChild(priceInfo);
      details.appendChild(troublesText);
      checkIntervalInfo.textContent = `Checks: every ${intervalDisplay}`;
      details.appendChild(checkIntervalInfo);
    } else {
      checkIntervalInfo.textContent = `Checks: every ${intervalDisplay}`;
      details.appendChild(title);
      details.appendChild(url);
      details.appendChild(priceInfo);
      details.appendChild(checkIntervalInfo);
    }

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'delete-btn';

    // Use the minus.png icon instead of text
    const minusIcon = document.createElement('img');
    minusIcon.src = 'icons/minus.png';
    minusIcon.alt = 'Remove';
    minusIcon.style.width = '16px';
    minusIcon.style.height = '16px';
    deleteBtn.appendChild(minusIcon);

    deleteBtn.addEventListener('click', function () {
      removeProduct(index);
    });

    li.appendChild(details);
    li.appendChild(deleteBtn);
    productsList.appendChild(li);
  }

  // Function to remove a product
  function removeProduct(index) {
    chrome.storage.local.get(['trackedProducts'], function (result) {
      const products = result.trackedProducts || [];

      if (index >= 0 && index < products.length) {
        // Get the product URL before removing it
        const productUrl = products[index].url;

        // Remove from tracked products
        products.splice(index, 1);

        chrome.storage.local.set({ trackedProducts: products }, function () {
          // Notify background script to stop monitoring this product
          chrome.runtime.sendMessage({
            action: 'stopMonitoring',
            data: { url: productUrl }
          }, function (response) {
            console.log('Stop monitoring response:', response);
          });

          loadTrackedProducts();
          showStatus('Product removed', 'success');
        });
      }
    });
  }

  // Helper function to truncate long URLs
  function truncateUrl(url) {
    if (url.length > 40) {
      return url.substring(0, 37) + '...';
    }
    return url;
  }

  // Helper function to validate email
  function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  // Function to show status messages
  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = type || '';

    // Clear message after a few seconds
    setTimeout(function () {
      statusMessage.textContent = '';
      statusMessage.className = '';
    }, 3000);
  }

  // Function to show price error disclaimer
  function showPriceErrorDisclaimer(product, index) {
    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);

    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'modal-container';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    // Create modal header
    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    modalHeader.innerHTML = '<h3>Price Error Report</h3>';

    // Create close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () {
      document.body.removeChild(backdrop);
    });
    modalHeader.appendChild(closeBtn);

    // Add minimize icon
    const minimizeIcon = document.createElement('img');
    minimizeIcon.src = 'icons/minimize.png';
    minimizeIcon.alt = 'Minimize';
    minimizeIcon.style.width = '16px';
    minimizeIcon.style.height = '16px';
    minimizeIcon.style.cursor = 'pointer';
    minimizeIcon.style.position = 'absolute';
    minimizeIcon.style.right = '40px';
    minimizeIcon.style.top = '15px';

    minimizeIcon.addEventListener('click', function () {
      document.body.removeChild(backdrop);
    });

    modalHeader.appendChild(minimizeIcon);

    // Create modal body
    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    
    // Check if product has extracted price options
    const hasExtractedPrices = product.priceOptions && product.priceOptions.length > 0;
    
    let optionsHTML = `<p>If the current price (Rs. ${Number(product.currentPrice).toLocaleString()}) shown by our extension is incorrect, you can:</p><div class="error-options">`;
    
    if (hasExtractedPrices) {
      optionsHTML += `
        <button id="select-from-extracted">Choose from extracted prices</button>
        <p class="option-desc">Select the correct price from the ${product.priceOptions.length} prices we found on this page.</p>
        
        <button id="refresh-product">Refresh product data</button>
        <p class="option-desc">Try again by refreshing the product data. This will recheck the price and ask for confirmation.</p>
      `;
    } else {
      optionsHTML += `
        <button id="refresh-product">Refresh product data</button>
        <p class="option-desc">Try again by refreshing the product data. This will recheck the price and ask for confirmation.</p>
      `;
    }
    
    optionsHTML += `</div>`;
    modalBody.innerHTML = optionsHTML;

    // Create modal footer
    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer';
    modalFooter.innerHTML = '<button id="cancel-error-report">Cancel</button>';

    // Assemble modal
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalContent.appendChild(modalFooter);
    modal.appendChild(modalContent);
    backdrop.appendChild(modal);

    // Add event listeners for modal buttons
    // Add event listener for "Choose from extracted prices" button if it exists
    const selectFromExtractedBtn = document.getElementById('select-from-extracted');
    if (selectFromExtractedBtn) {
      selectFromExtractedBtn.addEventListener('click', function () {
        document.body.removeChild(backdrop);
        // Show the price selection modal with extracted prices
        showPriceSelectionModal(product, index);
      });
    }
    
    document.getElementById('refresh-product').addEventListener('click', function () {
      // Close the current modal
      document.body.removeChild(backdrop);
      
      // Show loading status
      showStatus('Refreshing product data...', 'info');
      
      // Re-scrape the product data
      chrome.runtime.sendMessage(
        {
          action: 'addProduct',
          data: {
            url: product.url,
            targetPrice: product.targetPrice,
            checkInterval: product.checkInterval || 86400,
            refresh: true // Flag to indicate this is a refresh
          }
        },
        function (response) {
          if (response && response.success) {
            // Update the product with new data
            chrome.storage.local.get(['trackedProducts'], function (result) {
              const products = result.trackedProducts || [];
              if (index >= 0 && index < products.length) {
                // Update the product with new price data
                products[index].currentPrice = response.product.currentPrice;
                products[index].title = response.product.title || products[index].title;
                products[index].priceConfirmed = false; // Reset confirmation status
                
                // Save updated products
                chrome.storage.local.set({ trackedProducts: products }, function () {
                  // Show confirmation modal with new price
                  setTimeout(function () {
                    confirmExtractedPrice(products[index], index);
                  }, 500);
                  
                  // Reload the product list
                  setTimeout(function () {
                    loadTrackedProducts();
                  }, 1000);
                });
              }
            });
            
            showStatus('Product data refreshed successfully!', 'success');
          } else {
            showStatus(response?.message || 'Failed to refresh product data', 'error');
          }
        }
      );
    });

    // Manual price entry option removed - users can enter prices manually in the price selection modal

    document.getElementById('cancel-error-report').addEventListener('click', function () {
      document.body.removeChild(backdrop);
    });
  }

  // Function to trigger immediate price check
  function checkPricesNow() {
    showStatus('Checking prices...', 'info');

    chrome.runtime.sendMessage(
      { action: 'checkPricesNow' },
      function (response) {
        if (response && response.success) {
          showStatus('Price check completed!', 'success');

          // Reload the product list to show updated prices
          setTimeout(function () {
            loadTrackedProducts();
          }, 500);
        } else {
          showStatus('Failed to check prices', 'error');
        }
      }
    );
  }

  // Function to confirm if extracted price is correct
  function confirmExtractedPrice(product, index) {
    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);

    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'modal-container';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    // Create modal header
    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    modalHeader.innerHTML = '<h3>Confirm Price</h3>';

    // Create close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () {
      document.body.removeChild(backdrop);
    });
    modalHeader.appendChild(closeBtn);

    // Add minimize icon
    const minimizeIcon = document.createElement('img');
    minimizeIcon.src = 'icons/minimize.png';
    minimizeIcon.alt = 'Minimize';
    minimizeIcon.style.width = '16px';
    minimizeIcon.style.height = '16px';
    minimizeIcon.style.cursor = 'pointer';
    minimizeIcon.style.position = 'absolute';
    minimizeIcon.style.right = '40px';
    minimizeIcon.style.top = '15px';

    minimizeIcon.addEventListener('click', function () {
      document.body.removeChild(backdrop);
    });

    modalHeader.appendChild(minimizeIcon);

    // Create modal body
    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    modalBody.innerHTML = `
      <p>Is the extracted current price (Rs. ${Number(product.currentPrice).toLocaleString()}) for ${product.title} correct?</p>
    `;

    // Create modal footer
    const modalFooter = document.createElement('div');
    modalFooter.className = 'modal-footer price-confirm-footer';
    modalFooter.innerHTML = `
      <button id="price-incorrect" class="error-button">No, incorrect</button>
      <button id="price-correct" class="success-button">Yes, correct</button>
    `;

    // Assemble modal
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modalContent.appendChild(modalFooter);
    modal.appendChild(modalContent);
    backdrop.appendChild(modal);

    // Add event listeners for modal buttons
    document.getElementById('price-correct').addEventListener('click', function () {
      chrome.storage.local.get(['trackedProducts', 'userEmail'], function (result) {
        const products = result.trackedProducts || [];
        const userEmail = result.userEmail;

        // Find the product with matching URL
        const productIndex = products.findIndex(p => p.url === product.url);

        if (productIndex >= 0) {
          // Update the product with confirmation
          const targetPrice = parseFloat(products[productIndex].targetPrice);
          products[productIndex].priceConfirmed = true;

          // Check if price is below target to trigger notification
          const shouldNotify = parseFloat(products[productIndex].currentPrice) <= targetPrice;

          chrome.storage.local.set({ trackedProducts: products }, function () {
            if (shouldNotify) {
              // Send notification since price is confirmed and below target
              chrome.runtime.sendMessage({
                action: 'updateManualPrice',
                data: {
                  url: products[productIndex].url,
                  currentPrice: products[productIndex].currentPrice,
                  sendNotification: true,
                  userEmail: userEmail
                }
              }, function (response) {
                console.log('Price confirmation response:', response);
                showStatus(`Price confirmed. Notification sent!`, 'success');
              });
            } else {
              showStatus(`Price confirmed`, 'success');
            }
          });
        }
        document.body.removeChild(backdrop);
      });
    });

    document.getElementById('price-incorrect').addEventListener('click', function () {
      document.body.removeChild(backdrop);
      // Get the complete product data from storage to ensure priceOptions are available
      chrome.storage.local.get(['trackedProducts'], function (result) {
        const products = result.trackedProducts || [];
        const productFromStorage = products.find(p => p.url === product.url);
        if (productFromStorage) {
          // Show price selection modal with complete product data
          showPriceSelectionModal(productFromStorage, index);
        } else {
          // Fallback to original product if not found in storage
          showPriceSelectionModal(product, index);
        }
      });
    });
  }

  // Add this function to show a modal for price selection with 3 options
  function showPriceSelectionModal(product, index) {
    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    document.body.appendChild(backdrop);

    // Create modal container
    const modal = document.createElement('div');
    modal.className = 'modal-container';

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    // Create modal header
    const modalHeader = document.createElement('div');
    modalHeader.className = 'modal-header';
    modalHeader.innerHTML = `<h3>Select the correct price</h3>`;

    // Create close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'modal-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function () {
      document.body.removeChild(backdrop);
    });
    modalHeader.appendChild(closeBtn);

    // Add minimize icon
    const minimizeIcon = document.createElement('img');
    minimizeIcon.src = 'icons/minimize.png';
    minimizeIcon.alt = 'Minimize';
    minimizeIcon.style.width = '16px';
    minimizeIcon.style.height = '16px';
    minimizeIcon.style.cursor = 'pointer';
    minimizeIcon.style.position = 'absolute';
    minimizeIcon.style.right = '40px';
    minimizeIcon.style.top = '15px';

    minimizeIcon.addEventListener('click', function () {
      document.body.removeChild(backdrop);
    });

    modalHeader.appendChild(minimizeIcon);

    // Get price options from product data
    const priceOptions = product.priceOptions || [];
    const priceDisplayOptions = product.priceDisplayOptions || [];
    
    // Debug logging
    console.log('Product object:', product);
    console.log('Price options available:', priceOptions);
    console.log('Price display options available:', priceDisplayOptions);

    // Create modal body
    const modalBody = document.createElement('div');
    modalBody.className = 'modal-body';
    
    let optionsHTML = `<p>Choose the correct price for ${product.title}:</p>`;
    
    // Use actual extracted prices or show message if no prices available
    if (priceOptions.length === 0) {
      // If no prices were extracted, show manual entry only
      optionsHTML += `
        <div style="margin-bottom:15px; padding:15px; background:#fff3cd; border:1px solid #ffeaa7; border-radius:8px;">
          <p style="margin:0; color:#856404; font-weight:bold;">⚠️ No prices could be automatically detected for this product.</p>
          <p style="margin:5px 0 0 0; color:#856404; font-size:14px;">Please manually enter the current price below.</p>
        </div>`;
    } else {
      // Show available extracted prices
      priceOptions.forEach((price, idx) => {
        const displayPrice = priceDisplayOptions[idx] || `Rs. ${Number(price).toLocaleString()}`;
        const buttonColor = idx === 0 ? '#1976d2' : idx === 1 ? '#388e3c' : '#9c27b0';
        const borderColor = idx === 0 ? '#1565c0' : idx === 1 ? '#2e7d32' : '#7b1fa2';
        
        optionsHTML += `
          <div style="margin-bottom:15px;">
            <button class="price-option-btn" data-price="${price}" style="width:100%; padding:12px; margin-bottom:5px; background:${buttonColor}; color:white; border:2px solid ${borderColor}; border-radius:8px; cursor:pointer; font-weight:bold; transition:all 0.3s ease;">
              Option ${idx + 1}: ${displayPrice}
            </button>
          </div>`;
      });
    }
     
     // Manual entry option (always available)
     optionsHTML += `
       <div style="margin-bottom:15px; margin-top:20px; padding-top:15px; border-top:1px solid #eee;">
         <p style="margin-bottom:8px; font-weight:bold; color:#666;">Or manually enter the correct price:</p>
         <input type="number" id="manual-price-input" placeholder="Enter correct price" style="width:100%; padding:12px; border:2px solid #ddd; border-radius:6px; font-size:14px; margin-bottom:10px;">
       </div>`;
    
    modalBody.innerHTML = optionsHTML;

    // Assemble modal
    modalContent.appendChild(modalHeader);
    modalContent.appendChild(modalBody);
    modal.appendChild(modalContent);
    backdrop.appendChild(modal);

    // Add selection state management
    let selectedPrice = null;
    let selectedButton = null;
    
    // Add confirm button for selected options
    const confirmSelectedButton = document.createElement('button');
    confirmSelectedButton.textContent = 'Confirm Selection';
    confirmSelectedButton.style.cssText = 'width:100%; padding:12px; margin-top:15px; background:#ff9800; color:white; border:none; border-radius:8px; font-weight:bold; cursor:pointer; display:none;';
    modalBody.appendChild(confirmSelectedButton);
    
    // Add event listeners for price option buttons AFTER modal is added to DOM
    const priceOptionButtons = backdrop.querySelectorAll('.price-option-btn');
    priceOptionButtons.forEach(button => {
      button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // Remove selection from previous button
        if (selectedButton) {
          selectedButton.style.transform = 'scale(1)';
          selectedButton.style.boxShadow = 'none';
        }
        
        // Mark this button as selected
        selectedButton = this;
        selectedPrice = parseFloat(this.getAttribute('data-price'));
        
        // Add visual feedback
        this.style.transform = 'scale(0.98)';
        this.style.boxShadow = '0 0 15px rgba(0,0,0,0.3)';
        
        // Show confirm button
        confirmSelectedButton.style.display = 'block';
        confirmSelectedButton.textContent = `Confirm: Rs. ${Number(selectedPrice).toLocaleString()}`;
        
        console.log('Selected price:', selectedPrice);
      });
    });
    
    // Add event listener for confirm selected price
    confirmSelectedButton.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      // Check if we have a selected price from buttons
      if (selectedPrice !== null) {
        console.log('Confirming selected price:', selectedPrice);
        updateProductPrice(product, selectedPrice, index);
        document.body.removeChild(backdrop);
        return;
      }
      
      // Check if manual price is entered
      const manualPriceInput = backdrop.querySelector('#manual-price-input');
      if (manualPriceInput && manualPriceInput.value) {
        const manualPrice = parseFloat(manualPriceInput.value);
        if (!isNaN(manualPrice) && manualPrice > 0) {
          console.log('Confirming manual price:', manualPrice);
          updateProductPrice(product, manualPrice, index);
          document.body.removeChild(backdrop);
        } else {
          alert('Please enter a valid price.');
        }
      } else {
        alert('Please select an option or enter a manual price.');
      }
    });
    
    // Add event listener for manual price input to show confirm button
    const manualPriceInput = backdrop.querySelector('#manual-price-input');
    if (manualPriceInput) {
      manualPriceInput.addEventListener('input', function() {
        const value = parseFloat(this.value);
        if (!isNaN(value) && value > 0) {
          // Clear any selected button
          if (selectedButton) {
            selectedButton.style.transform = 'scale(1)';
            selectedButton.style.boxShadow = 'none';
            selectedButton = null;
            selectedPrice = null;
          }
          // Show confirm button with manual price
          confirmSelectedButton.style.display = 'block';
          confirmSelectedButton.textContent = `Confirm: Rs. ${Number(value).toLocaleString()}`;
        } else {
          if (!selectedPrice) {
            confirmSelectedButton.style.display = 'none';
          }
        }
      });
    }
  }

  // Helper function to update product price
  function updateProductPrice(product, newPrice, index) {
    console.log('updateProductPrice called with:', { 
      productTitle: product.title, 
      productUrl: product.url,
      newPrice, 
      index 
    });
    
    chrome.storage.local.get(['trackedProducts', 'userEmail'], function (result) {
      const products = result.trackedProducts || [];
      const userEmail = result.userEmail;
      
      console.log('Current tracked products:', products);
      console.log('Looking for product with URL:', product.url);

      // Find the product with matching URL
      const productIndex = products.findIndex(p => p.url === product.url);
      console.log('Found product at index:', productIndex);

      if (productIndex >= 0) {
        // Update the product with new price
        const targetPrice = parseFloat(products[productIndex].targetPrice);
        const oldPrice = products[productIndex].currentPrice;
        
        console.log('Updating product:', {
          oldPrice,
          newPrice,
          targetPrice
        });
        
        products[productIndex].currentPrice = newPrice;
        products[productIndex].priceConfirmed = true;
        products[productIndex].manualPriceUpdate = true;
        products[productIndex].lastChecked = new Date().toISOString();

        // Check if price is below target to trigger notification
        const shouldNotify = newPrice <= targetPrice;
        console.log('Should notify:', shouldNotify);

        chrome.storage.local.set({ trackedProducts: products }, function () {
          console.log('Products saved to storage successfully');
          
          // Notify background script about the price update
          chrome.runtime.sendMessage({
            action: 'updateManualPrice',
            data: {
              url: products[productIndex].url,
              currentPrice: newPrice,
              sendNotification: shouldNotify,
              userEmail: userEmail
            }
          }, function (response) {
            console.log('Price update response:', response);

            if (shouldNotify) {
              showStatus(`Price updated to Rs. ${Number(newPrice).toLocaleString()}. Notification sent!`, 'success');
            } else {
              showStatus(`Price updated to Rs. ${Number(newPrice).toLocaleString()}`, 'success');
            }

            // Refresh the entire products list to show updated price
            console.log('Refreshing products list...');
            loadTrackedProducts();
          });
        });
      } else {
        console.error(`Could not find product with URL: ${product.url}`);
        console.error('Available products:', products.map(p => ({ title: p.title, url: p.url })));
        showStatus('Error: Product not found', 'error');
      }
    });
  }
});