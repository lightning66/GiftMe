const fetch = require('node-fetch');
const cheerio = require('cheerio');

const url = 'https://www.target.com/p/floral-arch-decorative-wall-mirror-with-6-flowers-gold-cloud-island-8482/-/A-86861142#lnk=sametab';

(async () => {
  try {
    console.log('Fetching:', url);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/'
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // get title
    let title = $('meta[property="og:title"]').attr('content') || $('meta[name="title"]').attr('content') || $('title').text().trim();

    // get JSON-LD
    let jsonLdData = null;
    $('script[type="application/ld+json"]').each((i, el) => {
      const raw = $(el).contents().text().trim();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed) {
          if (Array.isArray(parsed)) {
            parsed.forEach(p => { if (!jsonLdData && p && (p['@type'] === 'Product' || p.product)) jsonLdData = p; });
          } else if (!jsonLdData && (parsed['@type'] === 'Product' || parsed.product || parsed.offers)) {
            jsonLdData = parsed;
          }
        }
      } catch (e) {}
    });

    // image
    let image = $('meta[property="og:image"]').attr('content') || $('link[rel="image_src"]').attr('href') || $('meta[name="image"]').attr('content') || $('meta[property="twitter:image"]').attr('content') || '';
    if ((!image || image.length === 0) && jsonLdData) {
      if (jsonLdData.image) {
        if (Array.isArray(jsonLdData.image)) image = jsonLdData.image[0];
        else if (typeof jsonLdData.image === 'string') image = jsonLdData.image;
        else if (jsonLdData.image.url) image = jsonLdData.image.url;
      }
      if ((!title || title.length === 0) && (jsonLdData.name || jsonLdData.title)) {
        title = jsonLdData.name || jsonLdData.title;
      }
    }

    // price - prefer JSON-LD offers
    let price = 'Price not available';
    if (jsonLdData && jsonLdData.offers) {
      try {
        const offers = Array.isArray(jsonLdData.offers) ? jsonLdData.offers[0] : jsonLdData.offers;
        console.log('jsonLdData.offers:', JSON.stringify(offers).substring(0, 600));
        if (offers && (offers.price || offers.priceSpecification || offers.priceCurrency)) {
          const p = offers.price || (offers.priceSpecification && offers.priceSpecification.price) || null;
          if (p) price = (offers.priceCurrency ? offers.priceCurrency + ' ' : '') + `$${parseFloat(p).toFixed(2)}`.replace('undefined ', '');
          else if (offers.price) price = `$${parseFloat(offers.price).toFixed(2)}`;
        }
      } catch (e) {}
    }

    // meta/itemprop fallback
    if (price === 'Price not available') {
      const metaPrice = $('meta[property="product:price:amount"]').attr('content') || $('meta[itemprop="price"]').attr('content') || $('meta[name="price"]').attr('content');
      if (metaPrice) {
        const mp = parseFloat(String(metaPrice).replace(/[^0-9.]/g, ''));
        if (!isNaN(mp)) price = `$${mp.toFixed(2)}`;
      }
      console.log('metaPrice:', metaPrice);
    }

    if (price === 'Price not available') {
      const itempropPrice = $('[itemprop="price"]').first().attr('content') || $('[itemprop="price"]').first().text();
      if (itempropPrice) {
        const ip = parseFloat(String(itempropPrice).replace(/[^0-9.]/g, ''));
        if (!isNaN(ip)) price = `$${ip.toFixed(2)}`;
      }
    }
    console.log('itempropPrice:', $('[itemprop="price"]').first().attr('content') || $('[itemprop="price"]').first().text());

    // Scan scripts for retailer specific price metadata (Target uses current_retail/formatted_current_price)
    // Do this unconditionally to override JSON-LD price when appropriate
    try {
      const scriptsText = $('script').map((i, el) => $(el).html()).get().join('\n');
      const m1 = scriptsText.match(/(?:\\")?current_retail(?:\\")?\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
      let scriptFoundPrice = null;
      if (m1 && m1[1]) scriptFoundPrice = parseFloat(m1[1]);
      const m2 = scriptsText.match(/(?:\\")?formatted_current_price(?:\\")?\s*:\s*"\$([0-9,]+(?:\.[0-9]+)?)"/i);
      if (m2 && m2[1] && !scriptFoundPrice) scriptFoundPrice = parseFloat(String(m2[1]).replace(/,/g, ''));
      // Also check raw HTML for these keys — sometimes JSON is inside HTML attributes
      const m1Raw = html.match(/"current_retail"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
      const m2Raw = html.match(/"formatted_current_price"\s*:\s*"\$([0-9,]+(?:\.[0-9]+)?)"/i);
      if ((!scriptFoundPrice || scriptFoundPrice === null) && m1Raw && m1Raw[1]) scriptFoundPrice = parseFloat(m1Raw[1]);
      if ((!scriptFoundPrice || scriptFoundPrice === null) && m2Raw && m2Raw[1]) scriptFoundPrice = parseFloat(String(m2Raw[1]).replace(/,/g, ''));
      console.log('scriptFoundPrice candidate:', scriptFoundPrice);
      console.log('jsonLdPriceNumber:', jsonLdPriceNumber);
      if (scriptFoundPrice && (!jsonLdPriceNumber || scriptFoundPrice > jsonLdPriceNumber)) {
        price = `$${scriptFoundPrice.toFixed(2)}`;
      }
      console.log('price after script scan:', price);
    } catch (e) {}

    // Debug: find current_retail in raw HTML and log the nearby content
    try {
      const idx = html.indexOf('"current_retail"');
      if (idx >= 0) {
        const snippet = html.substring(Math.max(0, idx - 120), Math.min(html.length, idx + 120)).replace(/\n/g, ' ');
        console.log('Found current_retail snippet in raw HTML:', snippet);
        const m = snippet.match(/"current_retail"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
        if (m && m[1]) console.log('Parsed current_retail from snippet:', m[1]);
      }
    } catch (e) {}

    try {
      const idx2 = html.indexOf('$60.99');
      if (idx2 >= 0) {
        const snippet2 = html.substring(Math.max(0, idx2 - 120), Math.min(html.length, idx2 + 120)).replace(/\n/g, ' ');
        console.log('Found $60.99 snippet:', snippet2);
        const m = snippet2.match(/"current_retail"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
        if (m && m[1]) console.log('Parsed current_retail near $60.99 snippet:', m[1]);
        const m2 = snippet2.match(/"formatted_current_price"\s*:\s*"\$([0-9,]+(?:\.[0-9]+)?)"/i);
        if (m2 && m2[1]) console.log('Parsed formatted_current_price near $60.99 snippet:', m2[1]);
      }
    } catch (e) {}

    // Last resort regex fallback to parse first $-price in the HTML
    if (price === 'Price not available') {
      const priceRegex = /\$[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?/g;
      const allPrices = html.match(priceRegex) || [];
      const uniquePrices = [...new Set(allPrices)].map(p => parseFloat(p.replace(/[^0-9.]/g, ''))).filter(n => !isNaN(n)).sort((a, b) => a - b);
      if (uniquePrices.length > 0) {
        price = `$${uniquePrices[0].toFixed(2)}`;
      }
    }

    // Try to find price from scripts where they sometimes store product data
    if (price === 'Price not available') {
      const scripts = $('script');
      scripts.each((i, el) => {
        const txt = $(el).html();
        // quick heuristics
        if (txt && txt.includes('analytics') === false && txt.includes('price') && txt.length < 5000) {
          const m = txt.match(/\"price\"\s*:\s*\"?([0-9.,]+)\"?/i);
          if (m && m[1]) {
            const p = parseFloat(m[1].replace(/,/g, ''));
            if (!isNaN(p)) price = `$${p.toFixed(2)}`;
          }
        }
      });
    }

    // make image absolute if necessary
    if (image && image.length) {
      image = String(image).trim();
      if (image.startsWith('//')) image = 'https:' + image;
      if (!image.startsWith('http')) {
        try { image = new URL(image, url).href; } catch(e) { image = ''; }
      }
    }

    // print all price matches for debugging
    const rawMatches = (html.match(/\$[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?/g) || []);
    const uniqueRaw = [...new Set(rawMatches)];
    console.log({title: title || 'Untitled Item', image, price});
    console.log('All price matches:', uniqueRaw);
    // show context snippets for $60.99 if found
    uniqueRaw.forEach(p => {
      if (p.includes('60.99') || p.includes('60.99')) {
        const idx = html.indexOf(p);
        const snippet = html.substring(Math.max(0, idx - 80), Math.min(html.length, idx + 80)).replace(/\n/g, ' ');
        console.log('Found match context for', p, '->', snippet);
      }
    });
  } catch (err) {
    console.error('Error fetching page', err);
  }
})();
