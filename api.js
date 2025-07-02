// API configuration
const API_BASE_URL = 'http://localhost:3000/api';

// API client for the Price Drop Alert extension
const ApiClient = {
  /**
   * Fetch product information from a URL
   * @param {string} url - The product URL to scrape
   * @returns {Promise<Object>} - Product information
   */
  async fetchProductInfo(url) {
    try {
      const response = await fetch(`${API_BASE_URL}/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch product information');
      }
      
      return data.data;
    } catch (error) {
      console.error('API Error (fetchProductInfo):', error);
      throw error;
    }
  },
  
  /**
   * Send email notification for price drop
   * @param {string} email - User's email address
   * @param {Object} product - Product information
   * @param {number} currentPrice - Current product price
   * @returns {Promise<Object>} - Response from the API
   */
  async sendNotification(email, product, currentPrice) {
    try {
      const response = await fetch(`${API_BASE_URL}/notify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, product, currentPrice }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to send notification');
      }
      
      return data;
    } catch (error) {
      console.error('API Error (sendNotification):', error);
      throw error;
    }
  }
};

// Export the API client
if (typeof module !== 'undefined') {
  module.exports = ApiClient;
} 