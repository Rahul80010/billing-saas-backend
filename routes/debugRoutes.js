const express = require('express');
const axios = require('axios');
const router = express.Router();

router.get('/debug-bing', async (req, res) => {
  try {
    const q = req.query.q || 'realme tws';
    const bingUrl = 'https://www.bing.com/images/async';
    const resp = await axios.get(bingUrl, {
      params: {
        q: `${q} product`,
        first: 1,
        count: 10,
        mmasync: 1
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      timeout: 7000
    });

    const mRegex = /m="({[^"]+})"/g;
    let match;
    const items = [];
    while ((match = mRegex.exec(resp.data)) !== null && items.length < 10) {
      const raw = match[1].replace(/&quot;/g, '"');
      try {
        const parsed = JSON.parse(raw);
        items.push({
          title: parsed.t || parsed.desc,
          murl: parsed.murl,
          purl: parsed.purl,
        });
      } catch (_) {}
    }

    res.json({
      status: resp.status,
      htmlLength: resp.data?.length,
      itemCount: items.length,
      items,
      snippet: resp.data?.slice(0, 400),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
