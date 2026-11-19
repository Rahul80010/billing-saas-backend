const axios = require('axios');

// In-memory cache for search queries with 15-minute TTL
const searchCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Clean and normalize search query
 */
const cleanQuery = (q) => {
  return (q || '').replace(/[^\w\s\d\-\+\.]/gi, ' ').trim().replace(/\s+/g, ' ');
};

/**
 * Fetch product images from Bing Images Async engine
 * Free, fast, returns real-world product packaging photos (Amazon, Flipkart, IndiaMART, Brand sites)
 */
const searchBingImages = async (query, limit = 18) => {
  try {
    const cleaned = cleanQuery(query);
    if (!cleaned) return [];

    // Search query with hints for product photography
    const searchQuery = `${cleaned} product pack white background`;

    const url = 'https://www.bing.com/images/async';
    const response = await axios.get(url, {
      params: {
        q: searchQuery,
        first: 1,
        count: Math.min(limit * 2, 40),
        mmasync: 1
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
      },
      timeout: 7000
    });

    const results = [];
    const mRegex = /m="({[^"]+})"/g;
    let match;

    while ((match = mRegex.exec(response.data)) !== null && results.length < limit) {
      const raw = match[1].replace(/&quot;/g, '"');
      try {
        const parsed = JSON.parse(raw);
        const imageUrl = parsed.murl;
        const thumbUrl = parsed.turl || parsed.murl;
        const title = (parsed.t || parsed.desc || parsed.displayTitle || cleaned).replace(/<[^>]+>/g, '').trim();

        if (imageUrl && imageUrl.startsWith('http')) {
          results.push({
            id: `web_${Buffer.from(imageUrl).toString('base64').slice(0, 16)}_${results.length}`,
            name: title.length > 55 ? title.slice(0, 52) + '...' : title,
            fullName: title,
            imageUrl,
            thumbnailUrl: thumbUrl,
            source: parsed.purl || '',
            categoryName: 'Web Search',
            isExternal: true,
          });
        }
      } catch (_) {
        // Skip malformed items
      }
    }

    return results;
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
 * Fallback: Search Wikimedia Commons for Brands & General Products
 */
const searchWikimedia = async (query, limit = 6) => {
  try {
    const cleaned = cleanQuery(query);
    if (!cleaned) return [];

    const url = 'https://en.wikipedia.org/w/api.php';
    const response = await axios.get(url, {
      params: {
        action: 'query',
        generator: 'search',
        gsrsearch: cleaned,
        gsrlimit: limit,
        prop: 'pageimages|pageterms',
        piprop: 'thumbnail|original',
        pithumbsize: 600,
        format: 'json',
      },
      headers: {
        'User-Agent': 'MohuriBillingSaaS/1.0 (support@mohuri.detalogy.com)',
      },
      timeout: 5000,
    });

    const pages = response.data?.query?.pages || {};
    const results = [];

    for (const pageId of Object.keys(pages)) {
      const p = pages[pageId];
      const img = p.thumbnail?.source || p.original?.source;
      if (img && img.startsWith('http')) {
        results.push({
          id: `wiki_${pageId}`,
          name: p.title,
          fullName: p.title,
          imageUrl: img,
          thumbnailUrl: p.thumbnail?.source || img,
          categoryName: 'General',
          isExternal: true,
        });
      }
    }

    return results;
  } catch (error) {
    console.warn('[ProductImageSearch] Wikimedia fallback failed:', error.message);
    return [];
  }
};

/**
 * Main Live Search function
 * Queries live product image engines with caching and multi-tier fallbacks
 */
const searchLiveProductImages = async (query, limit = 18) => {
  const cleanTerm = cleanQuery(query);
  if (!cleanTerm || cleanTerm.length < 2) return [];

  const cacheKey = cleanTerm.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    return cached.data;
  }

  // 1. Try Bing Async Image Search first (High accuracy product packaging)
  let results = await searchBingImages(cleanTerm, limit);

  // 2. If Bing returned fewer than 4 results, complement with Open Food Facts
  if (results.length < 4) {
    const offResults = await searchOpenFoodFacts(cleanTerm, limit - results.length);
    results = [...results, ...offResults];
  }

  // 3. If still low, complement with Wikimedia
  if (results.length < 3) {
    const wikiResults = await searchWikimedia(cleanTerm, limit - results.length);
    results = [...results, ...wikiResults];
  }

  // Cache results
  if (results.length > 0) {
    searchCache.set(cacheKey, {
      timestamp: Date.now(),
      data: results,
    });

    // Prune cache if it gets too large (> 500 entries)
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
