// Kindle to Markdown Exporter - Content Script
// This script runs inside the Kindle Cloud Reader iframes

(function() {
  'use strict';

  // State
  let isExporting = false;
  let collectedContent = [];
  let seenHashes = new Set();
  let currentPage = 0;
  let totalPages = 0;
  let bookTitle = '';
  let maxPages = 2000; // Safety limit
  let noNewContentCount = 0;
  let lastContentHash = '';

  // Listen for messages from popup
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startExport') {
      if (isExporting) {
        sendResponse({ status: 'already_running' });
        return;
      }
      startExport();
      sendResponse({ status: 'started' });
    } else if (message.action === 'getProgress') {
      sendResponse({
        currentPage: currentPage,
        totalPages: totalPages,
        done: !isExporting && collectedContent.length > 0,
        markdown: generateMarkdown(),
        bookTitle: bookTitle
      });
    }
    return true;
  });

  // Simple string hash for deduplication
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  // Find the Kindle reader frame
  function findReaderFrame() {
    // The Kindle reader is typically nested in iframes
    // Try to find the main reader iframe
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (doc && (
          doc.querySelector('#kindleReader_pageTurnAreaRight') ||
          doc.querySelector('.kindleReader_arrowBtn') ||
          doc.querySelector('#kindleReader_pageTurnAreaLeft')
        )) {
          return iframe;
        }
      } catch (e) {
        // Cross-origin iframe, skip
      }
    }
    return null;
  }

  // Get the content document (either direct or via iframe)
  function getContentDocument() {
    // If this frame itself contains the reader controls
    if (document.querySelector('#kindleReader_pageTurnAreaRight') ||
        document.querySelector('.kindleReader_arrowBtn')) {
      return document;
    }

    // Check nested iframes
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (doc && (
          doc.querySelector('#kindleReader_pageTurnAreaRight') ||
          doc.querySelector('.kindleReader_arrowBtn')
        )) {
          return doc;
        }
      } catch (e) {
        // Cross-origin, skip
      }
    }

    return null;
  }

  // Find the content iframe (where text is rendered)
  function findContentIframe(readerDoc) {
    const iframes = readerDoc.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body) {
          // Check if this iframe has substantial text content
          const text = doc.body.innerText || '';
          if (text.length > 50) {
            return doc;
          }
        }
      } catch (e) {
        // Cross-origin, skip
      }
    }
    return null;
  }

  // Extract text and images from the current page
  function extractCurrentPage() {
    const readerDoc = getContentDocument();
    if (!readerDoc) return null;

    // Try to find content iframe
    let contentDoc = findContentIframe(readerDoc);

    // If no iframe, use the reader doc directly
    if (!contentDoc) {
      contentDoc = readerDoc;
    }

    // Get the body
    const body = contentDoc.body;
    if (!body) return null;

    // Extract paragraphs and other block elements
    const blocks = [];
    const walker = contentDoc.createTreeWalker(
      body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function(node) {
          const tag = node.tagName.toLowerCase();
          // Accept block-level elements and images
          if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
               'blockquote', 'pre', 'table', 'ul', 'ol', 'li',
               'img', 'figure', 'hr', 'br'].includes(tag)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      const tag = node.tagName.toLowerCase();

      // Skip elements inside other blocks we've already processed
      if (node.closest('p, h1, h2, h3, h4, h5, h6, blockquote, pre, li, table, figure')) {
        if (tag !== 'p' && tag !== 'h1' && tag !== 'h2' && tag !== 'h3' &&
            tag !== 'h4' && tag !== 'h5' && tag !== 'h6' &&
            tag !== 'blockquote' && tag !== 'pre' && tag !== 'li' &&
            tag !== 'table' && tag !== 'figure' && tag !== 'img') {
          continue;
        }
      }

      if (tag === 'img') {
        const src = node.src || node.getAttribute('data-src') || '';
        if (src && !src.startsWith('data:image/svg')) {
          const alt = node.alt || 'Image';
          blocks.push({ type: 'image', src: src, alt: alt });
        }
        continue;
      }

      if (tag === 'br') {
        blocks.push({ type: 'linebreak' });
        continue;
      }

      if (tag === 'hr') {
        blocks.push({ type: 'hr' });
        continue;
      }

      // Get text content
      const text = node.innerText?.trim();
      if (!text || text.length < 2) continue;

      // Determine heading level
      let headingLevel = 0;
      if (tag.match(/^h[1-6]$/)) {
        headingLevel = parseInt(tag[1]);
      }

      // Check for bold/italic formatting within the element
      const html = node.innerHTML || '';
      const hasBold = /<(b|strong)>/i.test(html);
      const hasItalic = /<(i|em)>/i.test(html);

      blocks.push({
        type: 'text',
        tag: tag,
        text: text,
        headingLevel: headingLevel,
        bold: hasBold,
        italic: hasItalic
      });
    }

    // Also handle tables
    const tables = contentDoc.querySelectorAll('table');
    tables.forEach(table => {
      const rows = [];
      table.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('td, th').forEach(cell => {
          cells.push(cell.innerText?.trim() || '');
        });
        if (cells.length > 0) {
          rows.push(cells);
        }
      });
      if (rows.length > 0) {
        blocks.push({ type: 'table', rows: rows });
      }
    });

    return blocks;
  }

  // Deduplicate content blocks
  function addUniqueBlocks(blocks) {
    if (!blocks) return 0;

    let added = 0;
    for (const block of blocks) {
      let hash;
      if (block.type === 'text') {
        hash = hashString(block.text + block.tag + block.headingLevel);
      } else if (block.type === 'image') {
        hash = hashString(block.src);
      } else if (block.type === 'table') {
        hash = hashString(JSON.stringify(block.rows));
      } else {
        hash = hashString(JSON.stringify(block));
      }

      if (!seenHashes.has(hash)) {
        seenHashes.add(hash);
        collectedContent.push(block);
        added++;
      }
    }
    return added;
  }

  // Click the next page button
  function clickNextPage() {
    const readerDoc = getContentDocument();
    if (!readerDoc) return false;

    // Try multiple selectors for the next page button
    const selectors = [
      '#kindleReader_pageTurnAreaRight',
      '.kindleReader_pageTurnAreaRight',
      '[id*="pageTurnAreaRight"]',
      '.kindleReader_arrowBtn'
    ];

    for (const selector of selectors) {
      const elements = readerDoc.querySelectorAll(selector);
      for (const el of elements) {
        // Check if it's a next button (right arrow)
        const text = (el.textContent || '').trim();
        const className = (el.className || '').toLowerCase();
        if (className.includes('right') || text === '›' || text === '→' ||
            el.id?.includes('Right')) {
          el.click();
          return true;
        }
      }
    }

    // Fallback: try arrow key simulation
    try {
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        code: 'ArrowRight',
        keyCode: 39,
        which: 39,
        bubbles: true
      });
      (readerDoc.activeElement || readerDoc.body).dispatchEvent(event);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Get book title
  function getBookTitle() {
    // Try to find the book title in the reader
    const readerDoc = getContentDocument();
    if (readerDoc) {
      const titleSelectors = [
        '#kindleReader_bookTitle',
        '.kindleReader_bookTitle',
        '[class*="bookTitle"]',
        '[class*="title"]'
      ];
      for (const sel of titleSelectors) {
        const el = readerDoc.querySelector(sel);
        if (el && el.textContent.trim()) {
          return el.textContent.trim();
        }
      }
    }

    // Fallback: try page title
    return document.title.replace(/ - Kindle.*/, '').replace(/^Amazon.*?:\s*/, '').trim() || 'Kindle Book';
  }

  // Estimate total pages
  function estimateTotalPages() {
    const readerDoc = getContentDocument();
    if (!readerDoc) return 100;

    // Try to find page count indicators
    const pageIndicators = readerDoc.querySelectorAll(
      '[class*="page"], [id*="page"], [class*="progress"], [class*="location"]'
    );
    for (const el of pageIndicators) {
      const text = el.textContent || '';
      const match = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (match) {
        return parseInt(match[2]);
      }
      const match2 = text.match(/(\d+)\s*(?:of|de|von)\s*(\d+)/i);
      if (match2) {
        return parseInt(match2[2]);
      }
    }

    return 200; // Default estimate
  }

  // Main export loop
  async function startExport() {
    if (isExporting) return;
    isExporting = true;
    collectedContent = [];
    seenHashes = new Set();
    currentPage = 0;
    noNewContentCount = 0;

    bookTitle = getBookTitle();
    totalPages = estimateTotalPages();

    // Wait for the reader to be ready
    await sleep(2000);

    // Main collection loop
    while (isExporting && currentPage < maxPages) {
      currentPage++;

      // Extract content from current page
      const blocks = extractCurrentPage();
      const added = addUniqueBlocks(blocks);

      // Check if we've stopped getting new content
      if (added === 0) {
        noNewContentCount++;
      } else {
        noNewContentCount = 0;
      }

      // Stop if we've gone many pages without new content
      if (noNewContentCount > 15) {
        break;
      }

      // Try to turn the page
      const clicked = clickNextPage();
      if (!clicked) {
        // Try keyboard navigation as fallback
        try {
          const event = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            code: 'ArrowRight',
            keyCode: 39,
            which: 39,
            bubbles: true,
            cancelable: true
          });
          document.dispatchEvent(event);
        } catch (e) {
          // Ignore
        }
      }

      // Wait for page to load
      await sleep(1500);
    }

    isExporting = false;
  }

  // Generate Markdown from collected content
  function generateMarkdown() {
    if (collectedContent.length === 0) {
      return '# Export pending...\n\nNo content collected yet.';
    }

    const lines = [];
    lines.push(`# ${bookTitle}`);
    lines.push('');
    lines.push(`> Exported from Kindle Cloud Reader on ${new Date().toLocaleDateString()}`);
    lines.push('');

    let lastType = '';

    for (const block of collectedContent) {
      switch (block.type) {
        case 'text':
          // Add spacing between block types
          if (lastType === 'text' && lines[lines.length - 1] !== '') {
            // Keep paragraphs close together
          }

          let text = block.text;

          // Apply formatting
          if (block.bold) {
            text = `**${text}**`;
          }
          if (block.italic) {
            text = `*${text}*`;
          }

          // Headings
          if (block.headingLevel > 0) {
            const hashes = '#'.repeat(Math.min(block.headingLevel, 6));
            lines.push(`${hashes} ${block.text}`);
            lines.push('');
          } else if (block.tag === 'blockquote') {
            lines.push(`> ${text}`);
            lines.push('');
          } else if (block.tag === 'pre') {
            lines.push('```');
            lines.push(block.text);
            lines.push('```');
            lines.push('');
          } else if (block.tag === 'li') {
            lines.push(`- ${text}`);
          } else {
            lines.push(text);
            lines.push('');
          }
          lastType = 'text';
          break;

        case 'image':
          lines.push(`![${block.alt}](${block.src})`);
          lines.push('');
          lastType = 'image';
          break;

        case 'table':
          if (block.rows && block.rows.length > 0) {
            // Markdown table
            const header = block.rows[0];
            lines.push('| ' + header.join(' | ') + ' |');
            lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
            for (let i = 1; i < block.rows.length; i++) {
              lines.push('| ' + block.rows[i].join(' | ') + ' |');
            }
            lines.push('');
          }
          lastType = 'table';
          break;

        case 'hr':
          lines.push('---');
          lines.push('');
          lastType = 'hr';
          break;

        case 'linebreak':
          // Just add a line break
          break;
      }
    }

    return lines.join('\n');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Notify content script is loaded
  console.log('[Kindle Exporter] Content script loaded');
})();