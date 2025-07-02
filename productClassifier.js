// Product classification system with weighted categories and scoring

// Category definitions with keywords and their weights
const categories = {
    electronics: {
        keywords: {
            // Core electronics
            'mobile': 10, 'phone': 10, 'smartphone': 10, 'tv': 10, 'television': 10,
            'laptop': 10, 'computer': 10, 'tablet': 10, 'ipad': 10, 'camera': 10,

            // Audio/Video devices
            'headphone': 8, 'earphone': 8, 'speaker': 8, 'bluetooth': 8, 'wireless': 8,
            'soundbar': 8, 'projector': 8, 'microphone': 8, 'audio': 8,

            // Computer peripherals
            'monitor': 7, 'printer': 7, 'keyboard': 7, 'mouse': 7, 'router': 7,
            'modem': 7, 'webcam': 7, 'scanner': 7,

            // Components
            'processor': 6, 'cpu': 6, 'gpu': 6, 'ram': 6, 'ssd': 6, 'hdd': 6,
            'motherboard': 6, 'graphics': 6, 'battery': 6, 'charger': 6,

            // Brands (lower weight as they can make other products too)
            'samsung': 3, 'apple': 3, 'sony': 3, 'lg': 3, 'dell': 4, 'hp': 4,
            'lenovo': 4, 'asus': 4, 'acer': 4, 'xiaomi': 3, 'oneplus': 4
        },
        negativeKeywords: ['shirt', 'dress', 'pant', 'clothing', 'fashion', 'apparel']
    },
    fashion: {
        keywords: {
            // Clothing types
            'shirt': 10, 'tshirt': 10, 't-shirt': 10, 'dress': 10, 'pant': 10,
            'trouser': 10, 'jeans': 10, 'skirt': 10, 'top': 8, 'blouse': 10,

            // Traditional wear
            'saree': 10, 'kurta': 10, 'kurti': 10, 'lehenga': 10, 'dupatta': 9,
            'salwar': 9, 'palazzo': 9, 'ethnic': 8,

            // Outerwear
            'jacket': 9, 'coat': 9, 'sweater': 9, 'sweatshirt': 9, 'hoodie': 9,
            'blazer': 9, 'shrug': 8,

            // Fashion terms
            'fashion': 7, 'clothing': 7, 'apparel': 7, 'wear': 6, 'outfit': 6,
            'designer': 6, 'boutique': 6, 'trendy': 5, 'stylish': 5,

            // Materials
            'cotton': 4, 'silk': 4, 'wool': 4, 'polyester': 4, 'linen': 4,
            'denim': 4, 'leather': 4, 'fabric': 4
        },
        negativeKeywords: ['electronics', 'mobile', 'laptop', 'charger', 'digital']
    }
};

// Threshold for category classification
const CLASSIFICATION_THRESHOLD = 10;
const NEGATIVE_KEYWORD_PENALTY = -15;

/**
 * Classifies a product based on its URL and title
 * @param {string} url - Product URL
 * @param {string} title - Product title
 * @returns {Object} Classification result with category and confidence score
 */
function classifyProduct(url, title = '') {
    const text = (url + ' ' + title).toLowerCase();
    const scores = {};

    // Calculate scores for each category
    for (const [category, data] of Object.entries(categories)) {
        let score = 0;

        // Check positive keywords
        for (const [keyword, weight] of Object.entries(data.keywords)) {
            if (text.includes(keyword)) {
                score += weight;
            }
        }

        // Check negative keywords
        for (const negativeKeyword of data.negativeKeywords) {
            if (text.includes(negativeKeyword)) {
                score += NEGATIVE_KEYWORD_PENALTY;
            }
        }

        scores[category] = score;
    }

    // Find the category with the highest score
    let maxScore = -Infinity;
    let bestCategory = null;

    for (const [category, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            bestCategory = category;
        }
    }

    // Only classify if the score meets the threshold
    if (maxScore >= CLASSIFICATION_THRESHOLD) {
        return {
            category: bestCategory,
            score: maxScore,
            isConfident: maxScore >= CLASSIFICATION_THRESHOLD * 2
        };
    }

    // Default to 'other' if no strong category match
    return {
        category: 'other',
        score: 0,
        isConfident: false
    };
}

/**
 * Determines if a product is electronic based on classification
 * @param {string} url - Product URL
 * @param {string} title - Product title
 * @returns {boolean} Whether the product is classified as electronics
 */
function isElectronicProduct(url, title = '') {
    const classification = classifyProduct(url, title);
    return classification.category === 'electronics';
}

// Export functions for use in other files
module.exports = {
    classifyProduct,
    isElectronicProduct,
    categories
}; 