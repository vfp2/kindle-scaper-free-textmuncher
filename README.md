How to Install and Test in Firefox
Step 1: Create the Extension Files
Create a new folder on your computer, e.g., kindle-md-exporter

Inside that folder, create these files:

manifest.json

popup.html

popup.js

content.js

icon16.png, icon48.png, icon128.png (any PNG files)

Step 2: Load the Extension in Firefox (Temporary Installation)
Open Firefox

Type about:debugging in the address bar and press Enter

Click "This Firefox" in the left sidebar

Click "Load Temporary Add-on..."

Navigate to your kindle-md-exporter folder and select the manifest.json file

The extension should now appear in your Firefox toolbar (you may need to pin it)

Step 3: Test the Extension
Go to https://read.kindle.com/ (or https://read.amazon.com/ for US users)

Sign in with your Amazon account

Open a book you have purchased

Click the extension icon in the toolbar

Click "Start Export"

The extension will automatically:

Turn pages in the Kindle reader

Collect all text content

Collect image URLs

Preserve headings, bold, italic, tables, and blockquotes

When complete, a .md file will download automatically

Open the file in any Markdown editor (VS Code, Obsidian, Typora, etc.)

Important Notes
Page turning: The extension uses the kindleReader_pageTurnAreaRight element or simulates arrow key presses to navigate. Kindle Cloud Reader's DOM may change, so if the extension stops working, the selectors may need updating.

Images: Image URLs are extracted as-is. Some images may be blob URLs that expire, so download them immediately if needed.

Text rendering: Kindle Cloud Reader sometimes renders text as canvas images rather than selectable text. If the extension collects no text, the book may be using image-based rendering, which would require OCR (outside the scope of this extension).

Progress: The popup shows page-by-page progress. Large books (500+ pages) may take 10-30 minutes.

Safety limit: The extension stops after 2000 pages or when no new content is detected for 15 consecutive pages.

Troubleshooting
Issue	Solution
"Could not start export"	Make sure you have a book open in Kindle Cloud Reader
No content collected	The book may use canvas rendering; check the browser console for errors
Extension stops early	Increase maxPages or noNewContentCount threshold in content.js
Images missing	Some images may be lazy-loaded; wait for pages to fully render
Making It Permanent
For a permanent installation, you would need to package the extension as a .xpi file and sign it through Mozilla Add-ons. For personal use, the temporary installation method above works until you restart Firefox.

Legal note: This extension is for personal backup of books you have legitimately purchased. Always respect Amazon's Terms of Service and copyright laws.
