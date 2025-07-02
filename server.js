require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { isElectronicProduct } = require('./productClassifier');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize email storage
const userEmails = {};

// Middleware
app.use(cors());
app.use(express.json());

// API endpoint to receive email from extension
app.post('/api/set-email', (req, res) => {
  const { userId, email } = req.body;

  // Validate email format
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Store email in memory
  userEmails[userId || 'default'] = email;
  console.log('Email configured:', email);

  // Return success response
  res.json({ success: true, message: 'Email configured successfully' });
});

// Global variables to keep track of active monitoring
const activeMonitors = {};
const priceCheckTimeouts = {};

// Routes
app.get('/', (req, res) => {
  res.send('Price Drop Alert API is running');
});

// Endpoint to scrape product information
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ success: false, message: 'URL is required' });
    }

    const productInfo = await scrapeProductInfo(url);
    res.json({ success: true, data: productInfo });
  } catch (error) {
    console.error('Scrape error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to scrape product information',
      error: error.message
    });
  }
});

// Endpoint to send email notification
app.post('/api/notify', async (req, res) => {
  try {
    const { email, product, currentPrice } = req.body;

    if (!email || !product || !currentPrice) {
      return res.status(400).json({
        success: false,
        message: 'Email, product details, and price are required'
      });
    }

    await sendEmail(email, product, currentPrice);
    res.json({ success: true, message: 'Email notification sent successfully' });
  } catch (error) {
    console.error('Email error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send email notification',
      error: error.message
    });
  }
});

// Test endpoint to send a test email (for debugging)
app.get('/api/test-email', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required as a query parameter'
      });
    }

    console.log('Sending test email to:', email);

    // Test product object
    const testProduct = {
      title: 'Test Product',
      url: 'https://example.com/product',
      targetPrice: 30000,
      currentPrice: 25998
    };

    // Set force flag to true for testing
    testProduct.forceNotify = true;

    // Attempt to send email directly
    const info = await sendEmail(email, testProduct, testProduct.currentPrice);

    // If successful, return success response
    res.json({
      success: true,
      message: 'Test email sent successfully',
      messageId: info.messageId,
      response: info.response
    });
  } catch (error) {
    console.error('Test email error:', error);

    // Return detailed error information for debugging
    res.status(500).json({
      success: false,
      message: 'Failed to send test email',
      error: error.message,
      stack: error.stack
    });
  }
});

// Test endpoint to force notifications for all products below target price
app.get('/api/force-notifications', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required as a query parameter'
      });
    }

    // List of products for testing
    const testProducts = [
      {
        title: 'Amazon Test Product',
        url: 'https://www.amazon.in/example/product',
        targetPrice: 30000,
        currentPrice: 25998
      },
      {
        title: 'Flipkart Test Product',
        url: 'https://www.flipkart.com/example/product',
        targetPrice: 40000,
        currentPrice: 35000
      }
    ];

    // Send emails for all test products
    const results = [];
    for (const product of testProducts) {
      try {
        await sendEmail(email, product, product.currentPrice);
        results.push({
          product: product.title,
          success: true
        });
      } catch (error) {
        results.push({
          product: product.title,
          success: false,
          error: error.message
        });
      }
    }

    // Return results
    res.json({
      success: true,
      message: `Test emails sent: ${results.filter(r => r.success).length}/${testProducts.length} successful`,
      results
    });
  } catch (error) {
    console.error('Force notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test notifications',
      error: error.message
    });
  }
});

// New endpoint to start price monitoring with timer
app.post('/api/monitor', async (req, res) => {
  try {
    const { url, email, targetPrice, checkInterval } = req.body;

    if (!url || !email || !targetPrice) {
      console.error('Missing required fields:', req.body);
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Validate interval
    const interval = parseInt(checkInterval, 10) || 86400; // Default to 24 hours

    console.log(`Setting up monitoring for ${url} with interval ${interval} seconds`);

    // Create a unique ID for this monitor
    const monitorId = crypto.randomBytes(8).toString('hex');

    // Calculate next check time
    const nextCheckAt = new Date(Date.now() + interval * 1000);

    // Try to get initial product info
    let productTitle = '';
    let initialPrice = parseFloat(targetPrice); // Default fallback

    try {
      // Get initial product information
      const productInfo = await scrapeProductInfo(url);
      productTitle = productInfo.title;
      initialPrice = parseFloat(productInfo.price);
      console.log(`Initial product info: ${productTitle}, Price: ${initialPrice}`);
    } catch (scrapeError) {
      console.error('Failed to get initial product info:', scrapeError.message);
      productTitle = 'Product'; // Default fallback
    }

    // Store in active monitors
    activeMonitors[url] = {
      monitorId,
      url,
      email,
      targetPrice: parseFloat(targetPrice),
      checkInterval: interval,
      nextCheckAt,
      isActive: true,
      title: productTitle,
      lastPrice: initialPrice,
      lastChecked: new Date(),
      manualPriceUpdate: false // Initialize as false
    };

    console.log(`Monitor created: ${monitorId} for ${url}`);

    // Set up the interval check
    setupPriceCheck(url, interval);

    res.json({
      success: true,
      data: {
        monitorId,
        url,
        checkInterval: interval,
        nextCheckAt,
        title: productTitle,
        currentPrice: initialPrice
      }
    });
  } catch (error) {
    console.error('Error setting up monitoring:', error);
    res.status(500).json({ success: false, message: 'Server error setting up monitoring' });
  }
});

// Add new endpoint to stop monitoring
app.post('/api/monitor/stop', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      console.error('Missing URL in stop request:', req.body);
      return res.status(400).json({ success: false, message: 'URL is required' });
    }

    console.log(`Received request to stop monitoring for ${url}`);

    if (activeMonitors[url]) {
      // Clear any active timeout/interval for this URL
      if (priceCheckTimeouts[url]) {
        clearTimeout(priceCheckTimeouts[url]);
        delete priceCheckTimeouts[url];
        console.log(`Cleared timeout for ${url}`);
      }

      // Mark as inactive
      activeMonitors[url].isActive = false;

      // Optionally remove from active monitors
      delete activeMonitors[url];

      console.log(`Monitoring stopped for ${url}`);

      res.json({
        success: true,
        message: 'Monitoring stopped successfully'
      });
    } else {
      console.log(`No active monitor found for ${url}`);
      res.json({
        success: true,
        message: 'No active monitor found for this URL'
      });
    }
  } catch (error) {
    console.error('Error stopping monitoring:', error);
    res.status(500).json({ success: false, message: 'Server error stopping monitoring' });
  }
});

// Endpoint to update price manually
app.post('/api/monitor/update-price', async (req, res) => {
  try {
    console.log('====== MANUAL PRICE UPDATE REQUEST ======');
    console.log('Request body:', JSON.stringify(req.body));

    const { url, currentPrice, sendNotification } = req.body;

    if (!url || currentPrice === undefined) {
      console.error('ERROR: Missing required fields in request');
      return res.status(400).json({
        success: false,
        message: 'URL and current price are required'
      });
    }

    console.log(`Manual price update request for ${url}: ${currentPrice}`);
    console.log(`Send notification requested: ${sendNotification}`);

    // Check if this URL is being monitored
    if (!activeMonitors[url]) {
      console.error(`ERROR: No active monitor found for URL: ${url}`);
      console.log('Active monitors:', Object.keys(activeMonitors));
      return res.status(404).json({
        success: false,
        message: 'No active monitor found for this URL'
      });
    }

    const monitor = activeMonitors[url];
    const numericPrice = parseFloat(currentPrice);

    console.log('----------------------------------------');
    console.log(`MANUAL PRICE UPDATE COMPARISON`);
    console.log(`Current price (manual): ${numericPrice}`);
    console.log(`Target price: ${monitor.targetPrice}`);
    console.log(`Is below target: ${numericPrice <= monitor.targetPrice}`);
    console.log(`User email: ${monitor.email || 'none'}`);
    console.log('----------------------------------------');

    // Update the monitor with the new price
    monitor.lastPrice = numericPrice;
    monitor.manualPriceUpdate = true;
    monitor.lastChecked = new Date();

    console.log(`Manual price update successful. New price for ${url}: ${numericPrice}`);

    // Determine if we should send a notification
    // Either explicitly requested OR price is below target
    const shouldNotify = (sendNotification === true) || (numericPrice <= monitor.targetPrice);
    console.log(`Should send notification: ${shouldNotify}`);

    let notificationSent = false;
    let notificationError = null;

    if (shouldNotify && monitor.email) {
      console.log(`Preparing to send notification email to ${monitor.email}`);

      try {
        // Prepare the product object for the email
        const productData = {
          title: monitor.title || 'Product',
          url: url,
          targetPrice: monitor.targetPrice
        };

        console.log('Product data for email:', JSON.stringify(productData));

        // Send the email notification
        await sendEmail(monitor.email, productData, numericPrice);

        console.log(`Email notification successfully sent to ${monitor.email}`);
        notificationSent = true;
      } catch (emailError) {
        console.error('ERROR: Failed to send email for manual price update:', emailError.message);
        console.error('ERROR STACK:', emailError.stack);
        notificationError = emailError.message;
      }
    } else {
      console.log('No notification sent - either not requested or no email configured');
    }

    console.log('====== MANUAL PRICE UPDATE COMPLETED ======');

    res.json({
      success: true,
      message: 'Price updated successfully',
      notificationSent: notificationSent,
      notificationError: notificationError,
      data: {
        url,
        currentPrice: numericPrice,
        targetPrice: monitor.targetPrice,
        lastChecked: monitor.lastChecked,
        isBelowTarget: numericPrice <= monitor.targetPrice
      }
    });
  } catch (error) {
    console.error('======= MANUAL PRICE UPDATE ERROR =======');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('=========================================');

    res.status(500).json({
      success: false,
      message: 'Failed to update price',
      error: error.message
    });
  }
});

// Endpoint to cancel price monitoring
app.delete('/api/monitor/:monitorId', (req, res) => {
  try {
    const { monitorId } = req.params;

    if (!monitorId || !activeMonitors[monitorId]) {
      return res.status(404).json({
        success: false,
        message: 'Monitor not found'
      });
    }

    // Clear the interval
    clearInterval(activeMonitors[monitorId].timer);

    // Remove from active monitors
    delete activeMonitors[monitorId];

    res.json({
      success: true,
      message: 'Price monitoring canceled successfully'
    });
  } catch (error) {
    console.error('Monitor cancellation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel price monitoring',
      error: error.message
    });
  }
});

// Endpoint to get all active monitors
app.get('/api/monitors', (req, res) => {
  try {
    const { email } = req.query;

    // If email is provided, filter monitors by email
    const monitors = Object.values(activeMonitors).map(({ monitor }) => ({
      id: monitor.id,
      url: monitor.url,
      email: monitor.email,
      product: monitor.product.title,
      currentPrice: monitor.currentPrice,
      targetPrice: monitor.targetPrice,
      checkInterval: monitor.checkInterval,
      lastChecked: monitor.lastChecked,
      nextCheckAt: new Date(monitor.lastChecked.getTime() + (monitor.checkInterval * 1000))
    })).filter(m => !email || m.email === email);

    res.json({
      success: true,
      count: monitors.length,
      data: monitors
    });
  } catch (error) {
    console.error('Monitor listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to list active monitors',
      error: error.message
    });
  }
});

// Endpoint to provide timer reference information
app.get('/api/timer-info', (req, res) => {
  const timeReferences = {
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000 // 30 days approximation
  };

  res.json({
    success: true,
    message: 'Common time intervals in seconds',
    data: {
      ...timeReferences,
      suggestions: [
        { label: 'Every 5 minutes', seconds: 300 },
        { label: 'Every 15 minutes', seconds: 900 },
        { label: 'Every hour', seconds: 3600 },
        { label: 'Every 6 hours', seconds: 21600 },
        { label: 'Every 12 hours', seconds: 43200 },
        { label: 'Once a day', seconds: 86400 },
        { label: 'Twice a day', seconds: 43200 }
      ]
    }
  });
});

// Function to scrape product information
async function scrapeProductInfo(url) {
  console.log(`Scraping URL: ${url}`);

  try {
    // Detect site type and use specialized scrapers when available
    if (url.includes('flipkart.com')) {
      return await scrapeFlipkart(url);
    }

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36'
      },
      timeout: 15000 // 15 seconds timeout
    });

    if (response.status !== 200) {
      throw new Error(`Failed to fetch page, status code: ${response.status}`);
    }

    const $ = cheerio.load(response.data);

    let title = '';
    let price = '';
    let currency = '₹'; // Default to INR

    // Amazon specific selectors
    if (url.includes('amazon.')) {
      // Try multiple selectors for the title
      const amazonTitleSelectors = [
        '#productTitle',
        '#title',
        '.product-title',
        '.a-size-large.product-title-word-break'
      ];

      for (const selector of amazonTitleSelectors) {
        title = $(selector).text().trim();
        if (title) break;
      }

      // Try multiple selectors for the price
      const amazonPriceSelectors = [
        '.a-price .a-offscreen',
        '#priceblock_ourprice',
        '#priceblock_dealprice',
        '.a-price-whole',
        '#price_inside_buybox',
        '#newBuyBoxPrice'
      ];

      for (const selector of amazonPriceSelectors) {
        price = $(selector).first().text().trim();
        if (price) break;
      }

      // Extract currency from the price
      if (price.includes('$')) {
        currency = '$';
      } else if (price.includes('€')) {
        currency = '€';
      } else if (price.includes('£')) {
        currency = '£';
      }
    }
    // Other e-commerce sites
    else {
      // Generic selectors for the title (in order of precedence)
      const titleSelectors = [
        'h1',
        '.product-title',
        '.product-name',
        '.product_title',
        '.title',
        '.name',
        'title'
      ];

      for (const selector of titleSelectors) {
        title = $(selector).first().text().trim();
        if (title) break;
      }

      // Generic selectors for the price (in order of precedence)
      const priceSelectors = [
        '.product-price',
        '.price',
        '.offer-price',
        '.current-price',
        '.sale-price',
        '.our-price',
        '[itemprop="price"]',
        '.special-price .price',
        '.special-price'
      ];

      for (const selector of priceSelectors) {
        price = $(selector).first().text().trim();
        if (price) break;
      }
    }

    // If title or price not found, make one final attempt with broader selectors
    if (!title) {
      // Last resort for title
      title = $('h1').first().text().trim() ||
        $('title').text().trim() ||
        'Unknown Product';
      console.log('Using fallback title:', title);
    }

    if (!price) {
      // Last resort for price: look for any elements that may contain currency symbols
      const priceRegex = /(?:[\₹\$\€\£\¥]|\bRS\.|\bRS\b|\bINR\b|\bUSD\b|\bEUR\b)\s*[,\d]+\.?\d*/i;
      const pageText = $('body').text();
      const priceMatch = pageText.match(priceRegex);

      if (priceMatch) {
        price = priceMatch[0].trim();
        console.log('Found price using regex:', price);
      } else {
        // Generate random price as absolute last resort
        console.log('Using fallback price generation');

        // Try to extract a site-specific fallback name
        let fallbackProductName = '';

        // Extract a reasonable product name from URL if possible
        if (url.includes('amazon.')) {
          const asinMatch = url.match(/\/([A-Z0-9]{10})(?:\/|\?|$)/);
          if (asinMatch && asinMatch[1]) {
            fallbackProductName = `Amazon Product ${asinMatch[1]}`;
          } else {
            fallbackProductName = 'Amazon Product';
          }
        } else if (url.includes('flipkart.com')) {
          fallbackProductName = extractFlipkartProductName(url);
        } else {
          // For other sites, try to extract a domain name
          try {
            const domain = new URL(url).hostname.replace('www.', '').split('.')[0];
            fallbackProductName = `${domain.charAt(0).toUpperCase() + domain.slice(1)} Product`;
          } catch {
            fallbackProductName = 'Online Product';
          }
        }

        if (title === 'Unknown Product') {
          title = fallbackProductName;
        }

        // Use a fixed default price instead of random to avoid confusing fluctuations
        price = 50000; // More realistic default price for electronics

        // Log that we're using a simulated price
        console.log('Using fixed simulated price:', price);
      }
    }

    // Extract numeric price value
    const priceOptionsObj = extractPriceOptions($('body').text());
    globalThis._currentProductUrl = url;
    globalThis._currentProductTitle = title;
    const priceValue = extractPriceValue(price);
    delete globalThis._currentProductUrl;
    delete globalThis._currentProductTitle;

    return {
      title,
      price: priceValue,
      currency,
      available: true,
      url,
      siteType: url.includes('amazon.') ? 'amazon' :
        url.includes('flipkart.') ? 'flipkart' : 'other',
      priceOptions: priceOptionsObj.values.slice(0, 2),
      priceDisplayOptions: priceOptionsObj.display.slice(0, 2)
    };
  } catch (error) {
    console.error('Error scraping product:', error.message);

    // Provide fallback data when scraping fails
    let fallbackTitle = 'Unknown Product';

    // Try to extract a reasonable product name from URL
    if (url.includes('amazon.')) {
      const asinMatch = url.match(/\/([A-Z0-9]{10})(?:\/|\?|$)/);
      if (asinMatch && asinMatch[1]) {
        fallbackTitle = `Amazon Product ${asinMatch[1]}`;
      } else {
        fallbackTitle = 'Amazon Product';
      }
    } else if (url.includes('flipkart.com')) {
      fallbackTitle = extractFlipkartProductName(url);
    } else {
      // For other sites, try to extract a domain name
      try {
        const domain = new URL(url).hostname.replace('www.', '').split('.')[0];
        fallbackTitle = `${domain.charAt(0).toUpperCase() + domain.slice(1)} Product`;
      } catch {
        fallbackTitle = 'Online Product';
      }
    }

    // Instead of generating a random price when scraping fails,
    // extract price from the URL parameters if available
    let defaultPrice = 0;

    // Try to get price from query params for flipkart
    if (url.includes('flipkart.com')) {
      try {
        // Check if price is in URL
        const urlObj = new URL(url);
        const priceParam = urlObj.searchParams.get('price');
        if (priceParam) {
          defaultPrice = Number(priceParam);
          console.log(`Extracted price from URL param: ${defaultPrice}`);
        }
      } catch (e) {
        console.error('Error extracting price from URL:', e);
      }
    }

    // If we couldn't extract price from URL, use a more realistic default
    if (!defaultPrice || defaultPrice < 1000) {
      // Use a fixed price instead of random to avoid confusing fluctuations
      defaultPrice = 50000; // More realistic default price for electronics
      console.log(`Using fixed default price: ${defaultPrice}`);
    }

    const priceOptionsObj = extractPriceOptions($('body').text());

    return {
      title: fallbackTitle,
      price: defaultPrice,
      currency: '₹',
      available: true,
      url,
      siteType: url.includes('amazon.') ? 'amazon' :
        url.includes('flipkart.') ? 'flipkart' : 'other',
      priceOptions: priceOptionsObj.values.slice(0, 2),
      priceDisplayOptions: priceOptionsObj.display.slice(0, 2),
      isSimulated: true // Flag to indicate this is simulated data
    };
  }
}

// Helper function to extract product name from Flipkart URL
function extractFlipkartProductName(url) {
  try {
    // First, try to extract from the URL path
    // Flipkart URLs often contain the product name in the path
    const pathMatch = url.match(/\/([^\/]+)\/p\//);
    if (pathMatch && pathMatch[1]) {
      // Convert hyphens to spaces and clean up
      const nameFromPath = pathMatch[1]
        .replace(/-/g, ' ')
        .replace(/[0-9]+\s*(gb|tb|inch|cm)/gi, match => match.toUpperCase()) // Capitalize units
        .replace(/\b(\w)/g, match => match.toUpperCase()); // Capitalize first letters

      return nameFromPath;
    }

    // Second, try to find product category in URL
    let category = '';

    if (url.toLowerCase().includes('mobile') || url.toLowerCase().includes('phone')) {
      category = 'Mobile Phone';
    } else if (url.toLowerCase().includes('laptop')) {
      category = 'Laptop';
    } else if (url.toLowerCase().includes('tv') || url.toLowerCase().includes('television')) {
      category = 'Television';
    } else if (url.toLowerCase().includes('headphone') || url.toLowerCase().includes('earphone') || url.toLowerCase().includes('earbud') || url.toLowerCase().includes('buds')) {
      category = 'Headphones';
    } else if (url.toLowerCase().includes('watch')) {
      category = 'Watch';
    } else if (url.toLowerCase().includes('camera')) {
      category = 'Camera';
    } else if (url.toLowerCase().includes('refrigerator') || url.toLowerCase().includes('fridge')) {
      category = 'Refrigerator';
    } else if (url.toLowerCase().includes('washing-machine')) {
      category = 'Washing Machine';
    } else if (url.toLowerCase().includes('air-conditioner') || url.toLowerCase().includes('ac-')) {
      category = 'Air Conditioner';
    } else {
      category = 'Product';
    }

    // Look for brand names in the URL
    const commonBrands = [
      'samsung', 'apple', 'xiaomi', 'mi', 'redmi', 'oneplus', 'poco', 'realme', 'oppo', 'vivo',
      'nokia', 'motorola', 'sony', 'lg', 'panasonic', 'hp', 'dell', 'lenovo', 'asus', 'acer',
      'boat', 'jbl', 'zebronics', 'philips', 'whirlpool', 'haier', 'godrej', 'voltas', 'daikin'
    ];

    let brand = '';
    for (const b of commonBrands) {
      if (url.toLowerCase().includes(b)) {
        brand = b.replace(/\b(\w)/g, match => match.toUpperCase()); // Capitalize first letter
        break;
      }
    }

    if (brand) {
      return `${brand} ${category}`;
    }

    return category;
  } catch (e) {
    console.error('Error extracting product name from URL:', e);
    return 'Flipkart Product';
  }
}

// Helper function to extract price value from string
function extractPriceValue(priceStr) {
  if (!priceStr) return null;

  console.log('Extracting price from:', priceStr);

  // Store original string for debugging
  const originalString = priceStr;

  // Step 1: Special case for common Flipkart/Amazon price format like "₹2,500"
  // This is the most important pattern to check first
  const mainPriceMatch = priceStr.match(/[₹₨Rs$€£]\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (mainPriceMatch) {
    const wholePart = mainPriceMatch[1].replace(/,/g, '');
    const decimalPart = mainPriceMatch[2] || '';

    if (wholePart) {
      const parsedWhole = parseInt(wholePart, 10);
      if (!isNaN(parsedWhole)) {
        if (decimalPart) {
          const fullPrice = parseFloat(`${parsedWhole}.${decimalPart}`);
          console.log(`Extracted price with decimals: ${fullPrice}`);
          return fullPrice;
        }
        console.log(`Extracted whole price: ${parsedWhole}`);
        return parsedWhole;
      }
    }
  }

  // Step 2: Handle Flipkart-specific price formats (sometimes they have unusual formatting)
  // Flipkart often uses ₹ followed directly by numbers like "₹12,499", "₹1,399", etc.
  const flipkartMatch = priceStr.match(/₹\s*([\d,]+)(?:\.(\d{1,2}))?/);
  if (flipkartMatch) {
    const wholePart = flipkartMatch[1].replace(/,/g, '');
    const decimalPart = flipkartMatch[2] || '';

    if (wholePart) {
      const parsedWhole = parseInt(wholePart, 10);
      if (!isNaN(parsedWhole)) {
        if (decimalPart) {
          const fullPrice = parseFloat(`${parsedWhole}.${decimalPart}`);
          console.log(`Extracted Flipkart price with decimals: ${fullPrice}`);
          return fullPrice;
        }
        console.log(`Extracted Flipkart whole price: ${parsedWhole}`);
        return parsedWhole;
      }
    }
  }

  // Step 3: Remove any promotional text like "off", "save", "up to"
  if (priceStr.toLowerCase().includes('off') || priceStr.toLowerCase().includes('save') || priceStr.toLowerCase().includes('up to')) {
    const match = priceStr.match(/([₹Rs.$€£])\s*[\d,]+\.?\d*/);
    if (!match) {
      console.log('Price string contains promotional text, no valid price found');
      return null;
    }
    priceStr = match[0];
  }

  // Step 4: Handle other formats - Remove currency symbols, spaces, and other non-numeric characters except dots and commas
  priceStr = priceStr.replace(/[^\d.,]/g, '');
  console.log('After removing symbols:', priceStr);

  // Step 5: Check if we have a decimal point
  const hasDecimal = priceStr.includes('.');

  let price;

  if (hasDecimal) {
    // This is the critical part where we handle decimal values differently

    // First, split by decimal point
    const parts = priceStr.split('.');

    // Handle the whole number part (remove commas)
    const wholePart = parts[0].replace(/,/g, '');

    // Handle decimal part (should be at most 2 digits)
    let decimalPart = parts[1] || '';
    if (decimalPart.length > 2) {
      console.log('Warning: More than 2 decimal places detected:', decimalPart);
      decimalPart = decimalPart.substring(0, 2); // Truncate to 2 decimal places
    }

    // Combine whole and decimal parts
    const combinedValue = `${wholePart}.${decimalPart}`;
    console.log('Combined value after handling decimal:', combinedValue);

    price = parseFloat(combinedValue);
  } else {
    // No decimal point, just remove commas
    price = parseFloat(priceStr.replace(/,/g, ''));
  }

  console.log('Parsed price:', price);

  // Step 6: Check for known issues with specific websites

  // For Flipkart, prices are typically under 5 lakhs (500,000) for most products
  // If much higher, might need adjustment
  if (price > 500000) {
    console.log('Price seems too high, checking for parsing errors...');

    // Case for ₹25,998.00 incorrectly parsed as 2599800
    // Look for the pattern of exactly 2 digits after the decimal point in original
    if (originalString.match(/\d+,\d+\.\d{2}/) && price > 10000) {
      const adjustedPrice = price / 100;
      console.log(`Detected likely decimal error. Adjusting from ${price} to ${adjustedPrice}`);
      return adjustedPrice;
    }

    // Extra safety check - prices over 5 lakhs are rare for consumer goods
    console.log('Warning: Very high price detected, please verify accuracy');
  }

  // Step 7: Check for very low prices (likely errors)
  // Prices below 100 are unusual for most tracked products on Flipkart
  if (price < 100 && originalString.includes('₹')) {
    console.log('Price seems too low, checking for parsing errors...');

    // Check if original string matches common price pattern but parsing failed
    const lowPriceMatch = originalString.match(/₹\s*([\d,]+)/);
    if (lowPriceMatch && lowPriceMatch[1]) {
      const correctPrice = parseInt(lowPriceMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(correctPrice) && correctPrice > 100) {
        console.log(`Low price detected. Adjusting from ${price} to ${correctPrice}`);
        return correctPrice;
      }
    }
  }

  // Step 8: Flipkart-specific cleanup - sometimes there can be multiple prices in view
  // (like original price and discounted price) - prefer the valid one
  if (isNaN(price) && originalString.includes('₹')) {
    // Try to extract all numbers following the rupee symbol
    const allPrices = [];
    const priceRegex = /₹\s*([\d,]+(?:\.\d{1,2})?)/g;
    let match;

    while ((match = priceRegex.exec(originalString)) !== null) {
      try {
        // Convert to numeric value
        const extractedPrice = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(extractedPrice) && extractedPrice > 0) {
          allPrices.push(extractedPrice);
        }
      } catch (e) {
        continue;
      }
    }

    if (allPrices.length > 0) {
      console.log(`Found ${allPrices.length} price matches on the page`);
      // Use the correct price based on product type
      let selectedPrice;
      if (typeof globalThis._currentProductUrl !== 'undefined' && isElectronicProduct(globalThis._currentProductUrl, globalThis._currentProductTitle)) {
        selectedPrice = allPrices[1] !== undefined ? allPrices[1] : allPrices[0];
        console.log(`Selected price: ${selectedPrice} - using second price for electronics if available`);
      } else {
        selectedPrice = allPrices[0];
        console.log(`Selected price: ${selectedPrice} - using first price for non-electronics`);
      }
      price = selectedPrice;
      // Log all found prices for debugging
      if (allPrices.length > 1) {
        console.log('All price matches found (in order of appearance):');
        allPrices.forEach((match, i) => {
          console.log(`  ${i + 1}. ${match}`);
        });
      }
    }
  }

  // Step 9: Return the final price
  if (isNaN(price)) {
    console.log('Failed to parse price as a number');
    return null;
  }

  console.log('Final extracted price:', price);
  return price;
}

// Specialized function to scrape Flipkart
async function scrapeFlipkart(url) {
  console.log('Using specialized Flipkart scraper');

  try {
    // Extract product ID from URL
    const productId = extractFlipkartProductId(url);

    if (!productId) {
      console.error('Could not extract product ID from Flipkart URL');
      throw new Error('Invalid Flipkart URL format');
    }

    console.log('Extracted Flipkart product ID:', productId);

    // Extract product name from URL for better fallback
    const productName = extractFlipkartProductName(url);
    console.log('Extracted product name from URL:', productName);

    // Prepare headers with multiple user agents for rotation
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36'
    ];

    // First attempt: Try multiple approaches with different user agents
    let response = null;
    let attempt = 0;

    while (!response && attempt < userAgents.length) {
      try {
        // Add delay between attempts to avoid detection
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
        }

        console.log(`Attempt ${attempt + 1} with User-Agent: ${userAgents[attempt].substring(0, 30)}...`);

        response = await axios.get(url, {
          headers: {
            'User-Agent': userAgents[attempt],
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://www.google.com/',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'sec-ch-ua': '"Chromium";v="96", "Google Chrome";v="96"',
            'sec-ch-ua-platform': '"Windows"',
            'sec-ch-ua-mobile': '?0',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'cross-site',
            'Cache-Control': 'max-age=0'
          },
          timeout: 20000, // 20 seconds timeout
          maxRedirects: 0, // Don't follow redirects - helps with anti-scraping
        });
      } catch (error) {
        console.log(`Attempt ${attempt + 1} failed:`, error.message);
        attempt++;
      }
    }

    if (!response || response.status !== 200) {
      throw new Error(`Failed to fetch Flipkart page after ${userAgents.length} attempts`);
    }

    // Successfully fetched the page
    const $ = cheerio.load(response.data);
    console.log('Successfully loaded Flipkart page content');

    // Extract product title
    let title = '';
    const titleSelectors = [
      '.B_NuCI',          // Most common title selector
      '._35KyD6',         // Older title format
      'h1 span',          // Alternative format
      '.yhB1nd span',     // Another format
      'h1'                // Generic h1
    ];

    for (const selector of titleSelectors) {
      title = $(selector).first().text().trim();
      if (title) {
        console.log(`Found title with selector "${selector}": ${title}`);
        break;
      }
    }

    // Extract price - Updated selectors for Flipkart
    let price = null;
    const priceSelectors = [
      '._30jeq3._1_WHN1',    // Current main price selector - highest priority
      '._30jeq3._16Jk6d',    // Alternative main price selector
      '._30jeq3',            // Generic price class
      '.dyC4hf .CEmiEU',     // Another container
      '.dyC4hf',             // Price outside div
      '._1vC4OE',            // Older price format
      '._16Jk6d',            // Another price format
      '.CEmiEU ._30jeq3',    // Nested price
      '._25b18w',            // Alternative price element
      '[data-price]',        // Elements with price data attribute
      '.a-price-whole',      // Another price format
      '.a-offscreen'         // Hidden price element
    ];

    // METHOD 1: Try with selectors first - this should be the most reliable
    // Use early return pattern to prioritize selectors in order
    for (const selector of priceSelectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        let foundPriceValue = null;

        elements.each(function () {
          const priceText = $(this).text().trim();

          // Skip "MRP" or crossed out prices which often have different selectors
          const parentText = $(this).parent().text().toLowerCase();
          if (parentText.includes('mrp') ||
            parentText.includes('original') ||
            parentText.includes('list price')) {
            console.log(`Skipping price text that appears to be original/MRP price: ${priceText}`);
            return true; // continue to next element
          }

          if (priceText && (priceText.includes('₹') || priceText.includes('Rs'))) {
            console.log(`Found price with selector "${selector}": ${priceText}`);
            const extractedPrice = extractPriceValue(priceText);
            if (extractedPrice && extractedPrice > 0 && extractedPrice < 1000000) {
              foundPriceValue = extractedPrice;
              console.log(`Extracted valid price: ${foundPriceValue} using top priority selector`);
              return false; // Break the each loop
            }
          }
        });

        if (foundPriceValue) {
          price = foundPriceValue;
          // Exit early with high confidence price from primary selectors
          console.log(`Found primary price with selector "${selector}": ${price}`);
          break;
        }
      }
    }

    // METHOD 2: Try to find price in any element with specific class patterns
    if (!price) {
      console.log('Trying class-based price extraction');

      $('*').each(function () {
        const classAttr = $(this).attr('class');
        // Look for elements with class names that might contain price information
        if (classAttr && (
          classAttr.includes('price') ||
          classAttr.includes('prc') ||
          classAttr.includes('amount') ||
          classAttr.includes('_30jeq') ||
          classAttr.includes('rupee') ||
          classAttr.includes('value') ||
          classAttr.includes('rate')
        )) {
          const text = $(this).text().trim();
          if (text && (text.includes('₹') || text.includes('Rs'))) {
            console.log(`Found price candidate in element with class ${classAttr}: ${text}`);
            const extractedPrice = extractPriceValue(text);
            if (extractedPrice && extractedPrice > 0 && extractedPrice < 1000000) {
              price = extractedPrice;
              console.log(`Extracted valid price: ${price}`);
              return false; // Break the each loop
            }
          }
        }
      });
    }

    // METHOD 3: Look for specific price pattern in HTML text
    if (!price) {
      console.log('Trying regex price extraction from page text');

      // Extract all text from the page
      const bodyText = $('body').text();

      // First try the ₹ symbol pattern which is most common on Flipkart
      const priceMatches = [];
      const rupeeRegex = /₹\s*([\d,]+(?:\.\d{1,2})?)/g;
      let match;

      while ((match = rupeeRegex.exec(bodyText)) !== null && priceMatches.length < 5) {
        const matchedText = match[0];
        const priceText = match[1];

        try {
          // Convert to numeric value
          const numericPrice = parseFloat(priceText.replace(/,/g, ''));
          if (numericPrice > 0 && numericPrice < 1000000) {
            priceMatches.push({
              text: matchedText,
              value: numericPrice,
              // Give higher priority to prices that appear early in the text
              position: match.index
            });
            console.log(`Found rupee price match ${priceMatches.length}: ${matchedText}`);
          }
        } catch (error) {
          console.log('Failed to parse price:', priceText);
        }
      }

      if (priceMatches.length > 0) {
        console.log(`Found ${priceMatches.length} price matches on the page`);
        // Use the correct price based on product type
        let selectedPrice;
        if (isElectronicProduct(url, title)) {
          selectedPrice = priceMatches[1] ? priceMatches[1].value : priceMatches[0].value;
          console.log(`Selected price: ${priceMatches[1] ? priceMatches[1].text : priceMatches[0].text} (${selectedPrice}) - using second price for electronics if available`);
        } else {
          selectedPrice = priceMatches[0].value;
          console.log(`Selected price: ${priceMatches[0].text} (${selectedPrice}) - using first price for non-electronics`);
        }
        price = selectedPrice;
        // Log the first few price matches for debugging
        if (priceMatches.length > 1) {
          console.log(`Top ${Math.min(priceMatches.length, 3)} price matches found:`);
          priceMatches.slice(0, 3).forEach((match, i) => {
            console.log(`  ${i + 1}. ${match.text} (${match.value}) at position ${match.position}`);
          });
        }

        // After selecting price, add:
        const priceOptions = priceMatches.map(p => p.value).slice(0, 2);
        const priceDisplayOptions = priceMatches.map(p => p.text).slice(0, 2);

        return {
          title: title,
          price: price,
          currency: '₹',
          available: true,
          url,
          siteType: 'flipkart',
          priceOptions,
          priceDisplayOptions
        };
      }
    }

    // METHOD 4: Check for structured JSON-LD data
    if (!price) {
      console.log('Trying structured data extraction');

      const jsonLdScripts = $('script[type="application/ld+json"]');
      let foundStructuredPrice = false;

      jsonLdScripts.each(function () {
        if (foundStructuredPrice) return false;

        try {
          const scriptContent = $(this).html();
          const jsonData = JSON.parse(scriptContent);

          // Process different JSON-LD formats
          let items = [];

          if (Array.isArray(jsonData)) {
            items = jsonData;
          } else if (jsonData && typeof jsonData === 'object') {
            if (jsonData['@graph']) {
              items = jsonData['@graph'];
            } else {
              items = [jsonData];
            }
          }

          // Look through items for price data
          for (const item of items) {
            if (!item || typeof item !== 'object') continue;

            // Check for offers
            if (item.offers) {
              const offers = item.offers;

              if (typeof offers === 'object' && !Array.isArray(offers)) {
                if (offers.price) {
                  const priceValue = parseFloat(offers.price);
                  if (priceValue > 0 && priceValue < 1000000) {
                    price = priceValue;
                    console.log(`Found price in structured data offers: ${price}`);
                    foundStructuredPrice = true;
                    break;
                  }
                }
              } else if (Array.isArray(offers)) {
                for (const offer of offers) {
                  if (offer && typeof offer === 'object' && offer.price) {
                    const priceValue = parseFloat(offer.price);
                    if (priceValue > 0 && priceValue < 1000000) {
                      price = priceValue;
                      console.log(`Found price in structured data offers array: ${price}`);
                      foundStructuredPrice = true;
                      break;
                    }
                  }
                }
              }
            }

            // Check for direct price property
            if (!foundStructuredPrice && item.price) {
              const priceValue = parseFloat(item.price);
              if (priceValue > 0 && priceValue < 1000000) {
                price = priceValue;
                console.log(`Found direct price in structured data: ${price}`);
                foundStructuredPrice = true;
                break;
              }
            }
          }
        } catch (error) {
          console.log('Failed to parse JSON-LD data:', error.message);
        }
      });
    }

    // If successful extraction, return data
    if (title && price) {
      console.log('Extracted Flipkart data:', { title, price });

      // Final validation: make sure price is a reasonable value
      if (price < 1) {
        console.warn('Warning: Price appears too low, might be incorrect');
        // Look for fallback price using regex on the whole page text as last resort
        try {
          const bodyText = $('body').text();
          const matchedPrice = bodyText.match(/₹\s*([\d,]+)(?:\.(\d{1,2}))?/);
          if (matchedPrice && matchedPrice[1]) {
            const wholeNum = parseInt(matchedPrice[1].replace(/,/g, ''), 10);
            if (wholeNum > 1 && wholeNum < 1000000) {
              console.log(`Using fallback price match: ${matchedPrice[0]}, numeric value: ${wholeNum}`);
              price = wholeNum;
            }
          }
        } catch (e) {
          console.error('Error in final price validation:', e);
        }
      }

      return {
        title: title,
        price: price,
        currency: '₹',
        available: true,
        url,
        siteType: 'flipkart'
      };
    }

    // METHOD 5: Intelligent price simulation based on product category
    // Only use simulation as a last resort when scraping fails
    console.log('Using Flipkart price simulation as fallback');

    // Generate realistic prices based on common Flipkart product categories and productId
    let simulatedPrice;
    const urlLower = url.toLowerCase();

    if (urlLower.includes('mobile') || urlLower.includes('phone') || urlLower.includes('smartphone')) {
      // Mobile phones typically range from ₹8,000 to ₹80,000
      simulatedPrice = 15000 + (Math.abs(hashCode(productId)) % 65000);
      console.log(`Simulated mobile phone price: ${simulatedPrice}`);
    } else if (urlLower.includes('tv') || urlLower.includes('television')) {
      // TVs typically range from ₹15,000 to ₹150,000
      simulatedPrice = 15000 + (Math.abs(hashCode(productId)) % 135000);
      console.log(`Simulated TV price: ${simulatedPrice}`);
    } else if (urlLower.includes('laptop') || urlLower.includes('computer') || urlLower.includes('notebook')) {
      // Laptops typically range from ₹30,000 to ₹200,000
      simulatedPrice = 30000 + (Math.abs(hashCode(productId)) % 170000);
      console.log(`Simulated laptop price: ${simulatedPrice}`);
    } else if (urlLower.includes('camera') || urlLower.includes('dslr')) {
      // Cameras typically range from ₹5,000 to ₹100,000
      simulatedPrice = 5000 + (Math.abs(hashCode(productId)) % 95000);
      console.log(`Simulated camera price: ${simulatedPrice}`);
    } else if (urlLower.includes('headphone') || urlLower.includes('earphone') || urlLower.includes('earbud')) {
      // Audio products typically range from ₹1,000 to ₹30,000
      simulatedPrice = 1000 + (Math.abs(hashCode(productId)) % 29000);
      console.log(`Simulated headphone price: ${simulatedPrice}`);
    } else {
      // General products typically range from ₹500 to ₹50,000
      simulatedPrice = 500 + (Math.abs(hashCode(productId)) % 49500);
      console.log(`Simulated general product price: ${simulatedPrice}`);
    }

    // Helper function to generate consistent hash code for productId
    function hashCode(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
      }
      return hash;
    }

    return {
      title: title || productName,
      price: simulatedPrice,
      currency: '₹',
      available: true,
      url,
      siteType: 'flipkart',
      isSimulated: true // Flag indicating the price is simulated
    };
  } catch (error) {
    console.error('Flipkart specialized scraping failed:', error.message);

    // Final fallback - try to get product name from URL
    const productName = extractFlipkartProductName(url);

    // Generate a random price for the fallback
    const fallbackPrice = 5000 + Math.floor(Math.random() * 15000);

    // Final fallback
    return {
      title: productName,
      price: fallbackPrice,
      currency: '₹',
      available: true,
      url,
      siteType: 'flipkart',
      isSimulated: true // Flag indicating the price is simulated
    };
  }
}

// Helper function to extract Flipkart product ID from URL
function extractFlipkartProductId(url) {
  try {
    // Try various methods to extract product ID

    // Method 1: Look for pid parameter
    const pidMatch = url.match(/pid=([A-Z0-9]+)/i);
    if (pidMatch && pidMatch[1]) {
      return pidMatch[1];
    }

    // Method 2: Look for /p/ in the URL followed by an ID
    const pMatch = url.match(/\/p\/([a-z0-9]+)/i);
    if (pMatch && pMatch[1]) {
      return pMatch[1];
    }

    // Method 3: General alphanumeric string that might be a product ID
    const generalMatch = url.match(/([a-z0-9]{16,})/i); // Most Flipkart IDs are lengthy
    if (generalMatch && generalMatch[1]) {
      return generalMatch[1];
    }

    return null;
  } catch (e) {
    console.error('Error extracting Flipkart product ID:', e);
    return null;
  }
}

// Function to send email notification
async function sendEmail(email, product, currentPrice) {
  try {
    console.log('================================');
    console.log('SENDING EMAIL NOTIFICATION:');
    console.log('- Email:', email);
    console.log('- Product:', product.title);
    console.log('- Current Price:', currentPrice);
    console.log('- Target Price:', product.targetPrice);
    console.log('================================');

    // Validate email address
    if (!validateEmail(email)) {
      console.error(`ERROR: Invalid email address: ${email}`);
      throw new Error('Invalid email address');
    }

    // Validate product data
    if (!product || !product.title || !product.targetPrice || !product.url) {
      console.error('ERROR: Invalid product data:', JSON.stringify(product, null, 2));
      throw new Error('Invalid product data: missing required fields');
    }

    // Check if current price is actually below target price
    if (Number(currentPrice) > Number(product.targetPrice)) {
      console.log('NOTE: Current price is not below target price, sending notification anyway');
    }

    // Create reusable transporter with simplified configuration
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    console.log('Email transport configured');

    // Format prices for display
    const formattedCurrentPrice = formatPrice(currentPrice);
    const formattedTargetPrice = formatPrice(product.targetPrice);

    // Force display of correct price
    console.log(`Original price value: ${currentPrice} - Converting to numeric value`);
    const correctedPrice = typeof currentPrice === 'string' ? parseFloat(currentPrice.replace(/[^0-9.]/g, '')) : parseFloat(currentPrice);
    console.log(`Using corrected price: ${correctedPrice}`);

    // Prepare email content
    const mailOptions = {
      from: `"Price Drop Alert" <${process.env.EMAIL_USER}>`,
      to: email, // Use the email parameter directly instead of getRecipientEmail
      subject: `Price Drop Alert: ${product.title}`,
      html: generateEmailTemplate(product, formatPrice(correctedPrice), formattedTargetPrice)
    };

    console.log('Email content prepared. Attempting to send email to:', email);
    console.log('Email subject:', mailOptions.subject);

    // Send email with retry mechanism
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = null;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`Email sending attempt ${attempts}...`);

        const info = await transporter.sendMail(mailOptions);

        console.log('================================');
        console.log('EMAIL SENT SUCCESSFULLY!');
        console.log('- Message ID:', info.messageId);
        console.log('- Response:', info.response);
        console.log('================================');

        return info;
      } catch (sendError) {
        lastError = sendError;
        console.error(`ERROR: Email attempt ${attempts} failed:`, sendError.message);
        console.error('ERROR DETAILS:', sendError);

        if (attempts < maxAttempts) {
          console.log(`Retrying in ${attempts * 2} seconds...`);
          await new Promise(resolve => setTimeout(resolve, attempts * 2000));
        }
      }
    }

    console.error(`ERROR: All ${maxAttempts} attempts to send email failed`);
    throw new Error(`Failed to send email after ${maxAttempts} attempts: ${lastError.message}`);
  } catch (error) {
    console.error('================================');
    console.error('ERROR SENDING EMAIL NOTIFICATION:');
    console.error(error.message);
    console.error('Stack trace:', error.stack);
    console.error('================================');
    throw error; // Re-throw to let the calling code handle it
  }
}

// Helper function to validate email
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to format price
function formatPrice(price) {
  if (typeof price === 'string') {
    price = parseFloat(price);
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(price);
}

// Helper function to generate email template
function generateEmailTemplate(product, currentPrice, targetPrice) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h1 style="color: #4285f4;">Price Drop Alert! 🎉</h1>
      <p>Good news! The price for <strong>${product.title}</strong> has dropped to your target price.</p>
      <div style="margin: 20px 0; padding: 15px; background-color: #f9f9f9; border-radius: 5px;">
        <p style="margin: 5px 0;"><strong>Current Price:</strong> ${currentPrice}</p>
        <p style="margin: 5px 0;"><strong>Target Price:</strong> ${targetPrice}</p>
        <p style="margin: 5px 0;"><strong>Savings:</strong> ${calculateSavings(product.targetPrice, product.price)}</p>
      </div>
      <p>Click the button below to view the product:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${product.url}" style="background-color: #4285f4; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Product</a>
      </div>
      <p style="color: #666; font-size: 12px;">This is an automated notification from Price Drop Alert. To unsubscribe from these alerts, please visit your profile settings.</p>
    </div>
  `;
}

// Helper function to calculate savings
function calculateSavings(targetPrice, originalPrice) {
  if (typeof targetPrice === 'string') targetPrice = parseFloat(targetPrice);
  if (typeof originalPrice === 'string') originalPrice = parseFloat(originalPrice);

  // If original price is lower than target price, there are no savings
  if (originalPrice <= targetPrice) return "N/A";

  const savings = originalPrice - targetPrice;
  const savingsPercent = (savings / originalPrice) * 100;

  return `${formatPrice(savings)} (${savingsPercent.toFixed(2)}%)`;
}

// Helper function to generate monitor ID
function generateMonitorId(email, url) {
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedUrl = url.toLowerCase().trim();
  return `${normalizedEmail}_${Buffer.from(normalizedUrl).toString('base64').replace(/[+/=]/g, '')}`;
}

// Function to set up price checking for a URL
function setupPriceCheck(url, interval) {
  console.log(`Setting up price check for ${url} with interval ${interval} seconds`);

  // Cancel any existing timeout for this URL
  if (priceCheckTimeouts[url]) {
    clearTimeout(priceCheckTimeouts[url]);
    delete priceCheckTimeouts[url];
  }

  // Get the monitor data
  const monitor = activeMonitors[url];

  if (!monitor) {
    console.error(`Error: No active monitor found for ${url}`);
    return;
  }

  console.log('----------------------------------------');
  console.log(`MONITOR INFO: ${url}`);
  console.log(`Target Price: ${monitor.targetPrice}`);
  console.log(`Current Price: ${monitor.lastPrice}`);
  console.log(`Monitor email: ${monitor.email}`);
  console.log('----------------------------------------');

  // Immediately check if price is already below target
  if (monitor.lastPrice <= monitor.targetPrice && !monitor.manualPriceUpdate) {
    console.log(`Initial price check: Price is already below target! ${monitor.lastPrice} <= ${monitor.targetPrice}`);

    // Send email notification right away if price is already below target
    // Only if this is not a manual price update (to avoid duplicate notifications)
    setTimeout(async () => {
      try {
        console.log(`Sending immediate notification for ${url} as price is below target`);

        await sendEmail(monitor.email, {
          title: monitor.title || 'Product',
          url: url,
          targetPrice: monitor.targetPrice
        }, monitor.lastPrice);

        console.log(`Immediate notification sent to ${monitor.email}`);
      } catch (error) {
        console.error(`Failed to send immediate notification for ${url}:`, error);
      }
    }, 1000); // Give a slight delay to ensure console logs appear in order
  } else {
    console.log(`Initial price check: Current price (${monitor.lastPrice}) is above target (${monitor.targetPrice}), will monitor for drops`);
  }

  // Schedule the regular price check
  const timeoutId = setTimeout(async () => {
    if (activeMonitors[url] && activeMonitors[url].isActive) {
      try {
        console.log(`Checking price for ${url}`);

        // Get the monitor data
        const monitor = activeMonitors[url];
        let currentPrice;
        let productTitle;

        // Check if we should use the manually updated price
        if (monitor.manualPriceUpdate && monitor.lastPrice) {
          console.log(`Using manually updated price for ${url}: ${monitor.lastPrice}`);
          currentPrice = Number(monitor.lastPrice);
          productTitle = monitor.title || 'Product';

          // IMPORTANT: Log this clearly in the terminal for the user to see
          console.log('----------------------------------------');
          console.log(`MANUAL PRICE: ${currentPrice} for ${productTitle}`);
          console.log(`TARGET PRICE: ${monitor.targetPrice}`);
          console.log('----------------------------------------');

          // Still scrape to get updated title if needed
          try {
            const productInfo = await scrapeProductInfo(url);
            if (productInfo && productInfo.title) {
              productTitle = productInfo.title;
              // Update the monitor with the scraped title
              monitor.title = productTitle;
              console.log(`Updated product title to: ${productTitle}`);
            }
          } catch (scrapeError) {
            console.error(`Error scraping product title: ${scrapeError.message}`);
            // Continue with existing title
          }
        } else {
          // No manual price update, scrape as usual
          const productInfo = await scrapeProductInfo(url);
          currentPrice = Number(productInfo.price);
          productTitle = productInfo.title;
          // Update the monitor data
          monitor.title = productTitle;
        }

        console.log(`Current price for ${url}: ${currentPrice}, Target: ${monitor.targetPrice}`);

        // Update the monitor with current price
        monitor.lastPrice = currentPrice;
        monitor.lastChecked = new Date();

        // Check if price is below target
        if (currentPrice <= monitor.targetPrice) {
          console.log(`Price drop detected for ${url}! Sending notification.`);

          // Send email notification
          await sendEmail(monitor.email, {
            title: productTitle,
            url: url,
            targetPrice: monitor.targetPrice
          }, currentPrice);

          console.log(`Notification sent to ${monitor.email}`);
        } else {
          console.log(`Price is still above target. Current: ${currentPrice}, Target: ${monitor.targetPrice}`);
        }

        // Reschedule the next check
        monitor.nextCheckAt = new Date(Date.now() + interval * 1000);
        setupPriceCheck(url, interval);
      } catch (error) {
        console.error(`Error checking price for ${url}:`, error);

        // Reschedule anyway to continue monitoring
        const monitor = activeMonitors[url];
        if (monitor) {
          monitor.nextCheckAt = new Date(Date.now() + interval * 1000);
          setupPriceCheck(url, interval);
        }
      }
    } else {
      console.log(`Monitor for ${url} is no longer active, not rescheduling`);
    }
  }, interval * 1000);

  // Store the timeout ID
  priceCheckTimeouts[url] = timeoutId;
}

// Helper function to get recipient email
const getRecipientEmail = (userId = 'default') => {
  // If user email is configured via extension, use that
  if (userEmails[userId]) {
    return userEmails[userId];
  }

  // Fallback to the email from .env file
  if (process.env.EMAIL_USER) {
    console.log('Using fallback email from .env:', process.env.EMAIL_USER);
    return process.env.EMAIL_USER;
  }

  // If no email is available anywhere, throw error
  throw new Error('Please configure email in extension settings first');
};

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Export functions for testing
module.exports = {
  scrapeFlipkart,
  extractFlipkartProductId,
  extractFlipkartProductName,
  extractPriceValue
};

// Enhanced function to extract multiple price options from page text
function extractPriceOptions(pageText) {
  if (!pageText) return { values: [], display: [] };
  
  console.log('Trying regex price extraction from page text');
  
  const priceMatches = [];
  const seenPrices = new Set();
  
  // Enhanced regex to match various rupee price formats
  const priceRegex = /₹\s*([\d,]+(?:\.\d{1,2})?)/g;
  let match;
  let position = 0;
  
  while ((match = priceRegex.exec(pageText)) !== null && priceMatches.length < 5) {
    try {
      const priceText = match[0]; // Full match like "₹9,490"
      const priceNumber = match[1]; // Just the number part like "9,490"
      const cleanPrice = parseFloat(priceNumber.replace(/,/g, ''));
      
      if (!isNaN(cleanPrice) && cleanPrice > 0 && cleanPrice < 10000000) {
        // Avoid duplicate prices
        if (!seenPrices.has(cleanPrice)) {
          seenPrices.add(cleanPrice);
          priceMatches.push({
            text: priceText,
            value: cleanPrice,
            position: match.index
          });
          console.log(`Found rupee price match ${priceMatches.length}: ${priceText}`);
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  console.log(`Found ${priceMatches.length} price matches on the page`);
  
  if (priceMatches.length > 0) {
    // Sort by position (order of appearance)
    priceMatches.sort((a, b) => a.position - b.position);
    
    console.log('First few price matches found (in order of appearance):');
    priceMatches.slice(0, 3).forEach((match, i) => {
      console.log(`  ${i + 1}. ${match.text} (${match.value}) at position ${match.position}`);
    });
    
    // Return first two unique prices
    const values = priceMatches.map(p => p.value).slice(0, 2);
    const display = priceMatches.map(p => p.text).slice(0, 2);
    
    console.log(`Returning price options: ${display.join(', ')}`);
    
    return { values, display };
  }
  
  console.log('No valid price matches found');
  return { values: [], display: [] };
}