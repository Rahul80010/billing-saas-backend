const axios = require('axios');

// In-memory cache for search queries with 15-minute TTL
const searchCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

// Strict filter terms to eliminate people, humans, selfies, reviews, lifestyle shots
const JUNK_TERMS = [
  'person', 'people', 'man', 'woman', 'men', 'women', 'girl', 'boy', 'human',
  'model', 'wearing', 'face', 'portrait', 'selfie', 'lifestyle', 'actor', 'actress',
  'founder', 'ceo', 'inventor', 'biography', 'ear', 'hands', 'holding', 'unboxing',
  'reaction', 'review', 'vlog', 'youtube', 'ytimg', 'thumbnail', 'meme', 'lady',
  'guy', 'kid', 'child', 'crowd', 'smile', 'posing', 'influencer'
];

/**
 * Check if an image title or URL contains human/lifestyle/junk terms
 */
const isJunkImage = (title, url) => {
  const full = `${title || ''} ${url || ''}`.toLowerCase();
  for (const term of JUNK_TERMS) {
    const reg = new RegExp(`(^|[^a-z0-9])${term}([^a-z0-9]|$)`, 'i');
    if (reg.test(full) || url.toLowerCase().includes(term)) {
      return true;
    }
  }
  return false;
};

/**
 * Calculate relevance score so that exact product matches appear at the top
 */
const calculateScore = (title, url, searchWords) => {
  const lowerTitle = (title || '').toLowerCase();
  const lowerUrl = (url || '').toLowerCase();
  let score = 0;

  for (const word of searchWords) {
    if (word.length <= 1) continue;
    if (lowerTitle.includes(word)) {
      score += 25;
    } else if (lowerUrl.includes(word)) {
      score += 5;
    }
  }

  // Bonus for authentic e-commerce and catalog packaging sources
  const ecomBonus = ['amazon', 'flipkart', 'official', 'product', 'pack', 'box', 'specs', 'store', 'shop', 'oppo', 'samsung', 'apple'];
  for (const b of ecomBonus) {
    if (lowerTitle.includes(b) || lowerUrl.includes(b)) {
      score += 5;
    }
  }

  return score;
};

/**
 * Clean and normalize search query
 */
const cleanQuery = (q) => {
  return (q || '').replace(/[^\w\s\d\-\+\.]/gi, ' ').trim().replace(/\s+/g, ' ');
};

/**
 * Fetch product images from Bing Images Async engine
 * Uses targeted e-commerce hints and negative filters to ensure ONLY clean product photos
 */
const searchBingImages = async (query, limit = 18) => {
  try {
    const cleaned = cleanQuery(query);
    if (!cleaned) return [];

    const searchWords = cleaned.toLowerCase().split(/\s+/).filter(Boolean);

    // Formulate search query with negative filters to exclude people and lifestyle photos
    const searchQuery = `${searchWords.join(' ')} product box pack isolated ecommerce -person -man -woman -men -women -model -face -wearing -people -lifestyle`;

    const url = 'https://www.bing.com/images/async';
    const response = await axios.get(url, {
      params: {
        q: searchQuery,
        first: 1,
        count: Math.min(limit * 2, 45),
        mmasync: 1
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
      },
      timeout: 7000
    });

    const candidates = [];
    const mRegex = /m="({[^"]+})"/g;
    let match;

    while ((match = mRegex.exec(response.data)) !== null) {
      const raw = match[1].replace(/&quot;/g, '"');
      try {
        const parsed = JSON.parse(raw);
        const imageUrl = parsed.murl;
        const thumbUrl = parsed.turl || parsed.murl;
        const rawTitle = (parsed.t || parsed.desc || parsed.displayTitle || cleaned).replace(/<[^>]+>/g, '').trim();

        if (!imageUrl || !imageUrl.startsWith('http')) continue;

        // Skip any image matching human/lifestyle/junk terms
        if (isJunkImage(rawTitle, imageUrl)) continue;

        const score = calculateScore(rawTitle, imageUrl, searchWords);

        candidates.push({
          id: `web_${Buffer.from(imageUrl).toString('base64').slice(0, 16)}_${candidates.length}`,
          name: rawTitle.length > 60 ? rawTitle.slice(0, 57) + '...' : rawTitle,
          fullName: rawTitle,
          imageUrl,
          thumbnailUrl: thumbUrl,
          source: parsed.purl || '',
          categoryName: 'Web Search',
          isExternal: true,
          score,
        });
      } catch (_) {
        // Skip malformed items
      }
    }

    // Sort by relevance score descending so exact product matches are #1
    candidates.sort((a, b) => b.score - a.score);

    return candidates.slice(0, limit);
  } catch (error) {
    console.warn('[ProductImageSearch] Bing search failed:', error.message);
    return [];
  }
};

/**
 * Fallback: Search Open Food Facts for packaged FMCG / Food & Grocery products
 */
const searchOpenFoodFacts = async (query, limit = 8) => {
  try {
    const cleaned = cleanQuery(query);
    if (!cleaned) return [];

    const url = 'https://world.openfoodfacts.net/api/v2/search';
    const response = await axios.get(url, {
      params: {
        categories_tags_en: cleaned,
        fields: 'code,product_name,brands,image_url,image_front_url,image_front_small_url',
        page_size: limit,
      },
      headers: {
        'User-Agent': 'MohuriBillingSaaS/1.0 (support@mohuri.detalogy.com)',
      },
      timeout: 5000,
    });

    const products = response.data?.products || [];
    const results = [];

    products.forEach((p, idx) => {
      const img = p.image_front_url || p.image_url;
      const thumb = p.image_front_small_url || img;
      if (img && img.startsWith('http')) {
        const title = p.product_name || `${p.brands || 'Product'} ${cleaned}`;
        results.push({
          id: `off_${p.code || idx}`,
          name: title,
          fullName: title,
          brand: p.brands || '',
          imageUrl: img,
          thumbnailUrl: thumb,
          categoryName: 'Grocery & Staples',
          isExternal: true,
          score: 50,
        });
      }
    });

    return results;
  } catch (error) {
    console.warn('[ProductImageSearch] OpenFoodFacts fallback failed:', error.message);
    return [];
  }
};

/**
 * Main Live Search function
 * Queries live product image engines with caching, junk filtering, and relevance ranking
 */
const searchLiveProductImages = async (query, limit = 18) => {
  const cleanTerm = cleanQuery(query);
  if (!cleanTerm || cleanTerm.length < 2) return [];

  const cacheKey = cleanTerm.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  // 1. Search Bing with strict e-commerce filters and human/lifestyle exclusions
  let results = await searchBingImages(cleanTerm, limit);

  // 2. If fewer than 4 results, complement with Open Food Facts
  if (results.length < 4) {
    const offResults = await searchOpenFoodFacts(cleanTerm, limit - results.length);
    results = [...results, ...offResults];
  }

  // Cache results
  if (results.length > 0) {
    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      data: results,
    });

    if (searchCache.size > 500) {
      const oldestKey = searchCache.keys().next().value;
      searchCache.delete(oldestKey);
    }
  }

  return results;
};

module.exports = {
  searchLiveProductImages,
};
