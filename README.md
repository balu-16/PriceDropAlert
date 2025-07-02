# Price Drop Alert Browser Extension

A browser extension that tracks product prices and alerts you when they drop to your target price.

## Features

- Track prices of products from various e-commerce websites
- Set target prices and get notified when prices drop
- Email notifications for price drops
- Simple and easy-to-use interface

## How to Install the Extension

### Chrome

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension folder
5. The extension icon should now appear in your browser toolbar

### Firefox

1. Download or clone this repository
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select any file in the extension folder (e.g., manifest.json)
5. The extension icon should now appear in your browser toolbar

## Setting Up the Backend Server

The extension uses a backend server for web scraping and sending email notifications. To set up the server:

1. Navigate to the server directory
2. Create a `.env` file with the following contents:

   ```
   PORT=3000
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   ```

   Replace the email credentials with your own. For Gmail, you'll need to use an [App Password](https://support.google.com/accounts/answer/185833).

3. Install dependencies:

   ```
   npm install
   ```

4. Start the server:
   ```
   npm start
   ```

## How to Use

1. Click on the extension icon in your browser toolbar
2. Paste the URL of the product you want to track
3. Enter your target price
4. Click "Track Price"
5. The extension will check prices periodically and notify you when the price drops to or below your target

## Technologies Used

- JavaScript
- HTML/CSS
- Node.js (for backend server)
- Express.js
- Cheerio (for web scraping)
- Nodemailer (for email notifications)

## Limitations

- The current implementation works best with major e-commerce websites like Amazon, Flipkart, etc.
- Some websites may block automated requests, in which case the extension may not be able to track prices accurately

## Future Improvements

- Support for more e-commerce websites
- Price history graphs
- User accounts to track products across devices
- Mobile app integration
