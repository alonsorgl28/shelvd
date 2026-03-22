// ─── PWA Install Prompt ───

(function () {
    const DISMISS_KEY = 'shelvd-pwa-dismissed';
    const DISMISS_DAYS = 14;

    // Don't show if already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return;

    // Don't show if dismissed recently
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed) < DISMISS_DAYS * 86400000) return;

    // ── Android / Chrome: beforeinstallprompt ──
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;

        // Show banner after user has entered the library
        function showBanner() {
            const banner = document.getElementById('pwa-install-banner');
            banner.style.display = '';
        }

        // Wait for auth to complete, then show after a short delay
        if (document.querySelector('.auth-screen[style*="display: none"]') ||
            document.querySelector('.auth-screen.exiting')) {
            setTimeout(showBanner, 3000);
        } else {
            window.addEventListener('shelvd:authenticated', () => {
                setTimeout(showBanner, 3000);
            }, { once: true });
        }
    });

    // Install button
    document.getElementById('pwa-install-btn').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('[Shelvd] PWA install:', outcome);
        deferredPrompt = null;
        document.getElementById('pwa-install-banner').style.display = 'none';
    });

    // Dismiss button
    document.getElementById('pwa-dismiss-btn').addEventListener('click', () => {
        document.getElementById('pwa-install-banner').style.display = 'none';
        localStorage.setItem(DISMISS_KEY, Date.now().toString());
    });

    // ── iOS: Safari instructions ──
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|Chrome/.test(navigator.userAgent);

    if (isIOS && isSafari) {
        function showIOSSheet() {
            const sheet = document.getElementById('ios-install-sheet');
            sheet.style.display = '';
        }

        // Wait for auth, then show after delay
        if (document.querySelector('.auth-screen[style*="display: none"]') ||
            document.querySelector('.auth-screen.exiting')) {
            setTimeout(showIOSSheet, 3000);
        } else {
            window.addEventListener('shelvd:authenticated', () => {
                setTimeout(showIOSSheet, 3000);
            }, { once: true });
        }

        document.getElementById('ios-install-close').addEventListener('click', () => {
            document.getElementById('ios-install-sheet').style.display = 'none';
            localStorage.setItem(DISMISS_KEY, Date.now().toString());
        });
    }
})();
