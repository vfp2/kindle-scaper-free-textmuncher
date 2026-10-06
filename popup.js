document.getElementById('startBtn').addEventListener('click', async () => {
  const btn = document.getElementById('startBtn');
  const status = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');

  btn.disabled = true;
  btn.textContent = 'Exporting...';
  progressBar.classList.add('active');
  status.textContent = 'Initializing...';

  try {
    // Get the active tab
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

    // Send message to content script to start export
    const response = await browser.tabs.sendMessage(tab.id, {
      action: 'startExport'
    });

    if (response && response.status === 'started') {
      status.textContent = 'Export started. Collecting pages...';

      // Poll for progress
      const pollInterval = setInterval(async () => {
        try {
          const progress = await browser.tabs.sendMessage(tab.id, {
            action: 'getProgress'
          });

          if (progress) {
            const percent = progress.totalPages > 0
              ? Math.round((progress.currentPage / progress.totalPages) * 100)
              : 0;
            progressFill.style.width = percent + '%';
            status.textContent = `Page ${progress.currentPage} of ${progress.totalPages} (${percent}%)`;

            if (progress.done) {
              clearInterval(pollInterval);
              status.textContent = 'Export complete! Downloading...';
              btn.textContent = 'Export Complete';
              progressFill.style.width = '100%';

              // Trigger download
              const markdown = progress.markdown;
              const blob = new Blob([markdown], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = (progress.bookTitle || 'kindle-book') + '.md';
              a.click();
              URL.revokeObjectURL(url);

              setTimeout(() => {
                btn.disabled = false;
                btn.textContent = 'Start Export';
                status.textContent = 'Download ready!';
              }, 2000);
            }
          }
        } catch (e) {
          // Content script might not be ready yet
        }
      }, 500);

      // Timeout after 30 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        btn.disabled = false;
        btn.textContent = 'Start Export';
        status.textContent = 'Export timed out.';
      }, 30 * 60 * 1000);
    } else {
      status.textContent = 'Could not start export. Make sure you are on a Kindle book page.';
      btn.disabled = false;
      btn.textContent = 'Start Export';
    }
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    btn.disabled = false;
    btn.textContent = 'Start Export';
    console.error(err);
  }
});