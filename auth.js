// ─── Supabase Auth for Shelvd ───

const SUPABASE_URL = 'https://ttdxdcxighxlauwcmhgk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0ZHhkY3hpZ2h4bGF1d2NtaGdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxMTgzMzksImV4cCI6MjA4OTY5NDMzOX0.XLbEFU8xaCFk9B2yAjuyk2pRMW1casXn30zICv3bIu8';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        flowType: 'pkce',
        detectSessionInUrl: true
    }
});
window.shelvdAuth = { supabase: sb, currentUser: null, currentProfile: null };

// ─── DOM refs ───
const authScreen = document.getElementById('auth-screen');
const emailForm = document.getElementById('auth-email-form');
const magicLinkForm = document.getElementById('auth-magic-link-form');
const emailInput = document.getElementById('auth-email');
const submitBtn = document.getElementById('auth-submit-btn');
const checkEmail = document.getElementById('auth-check-email');
const sentEmail = document.getElementById('auth-sent-email');
const backBtn = document.getElementById('auth-back-btn');
const usernameForm = document.getElementById('auth-username-form');
const usernameInput = document.getElementById('auth-username');
const usernamePreview = document.getElementById('username-preview-text');
const usernameError = document.getElementById('username-error');
const cardStamp = document.getElementById('library-card-stamp');
const cardNumber = document.getElementById('library-card-number');
const actionBar = document.getElementById('action-bar');
const utilityMenuToggle = document.getElementById('utility-menu-toggle');
const searchToggleBtn = document.getElementById('search-toggle-btn');
const mobileUtilityMenu = document.getElementById('mobile-utility-menu');
const mobileUtilityBackdrop = document.getElementById('mobile-utility-backdrop');
const mobileUtilityPanel = document.getElementById('mobile-utility-panel');
const mobileUtilityGrid = document.getElementById('mobile-utility-grid');
const mobileAddBookBtn = document.getElementById('mobile-add-book-btn');
const mobileShareBtn = document.getElementById('mobile-share-btn');
const mobileIOBtn = document.getElementById('mobile-io-btn');
const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

// ─── Check if viewing a public profile ───
function getPublicUsername() {
    const path = window.location.pathname;
    const match = path.match(/^\/@([a-zA-Z0-9_]+)/);
    return match ? match[1].toLowerCase() : null;
}

// ─── Auth state management ───
let hasEnteredLibrary = false;

async function handleSession(session) {
    if (hasEnteredLibrary) return;

    window.shelvdAuth.currentUser = session.user;
    cardNumber.textContent = 'No. ' + session.user.id.substring(0, 6).toUpperCase();

    // Look up profile
    const { data: profile } = await sb
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .maybeSingle();

    if (profile && profile.username) {
        window.shelvdAuth.currentProfile = profile;
        cardStamp.classList.add('stamped');
        enterLibrary(profile.username);
    } else {
        // New user — show username picker
        emailForm.style.display = 'none';
        checkEmail.style.display = 'none';
        usernameForm.style.display = 'flex';
        authScreen.style.display = 'flex';
        cardStamp.classList.add('stamped');
    }
}

function syncMobileUtilityLayout() {
    if (!mobileUtilityGrid) return;
    const visibleTiles = [mobileShareBtn, mobileIOBtn].filter((button) => button && button.style.display !== 'none');
    mobileUtilityGrid.classList.toggle('single-tile', visibleTiles.length <= 1);
}

syncMobileUtilityLayout();

// ─── Handle OAuth callback code manually ───
async function handleOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
        console.log('[Shelvd] OAuth code detected, exchanging...');
        // Clean URL immediately
        window.history.replaceState({}, '', window.location.pathname);

        const { data, error } = await sb.auth.exchangeCodeForSession(code);
        if (error) {
            console.error('[Shelvd] Code exchange failed:', error.message);
        } else {
            console.log('[Shelvd] Code exchange success');
        }
        // Session will be handled by onAuthStateChange
        return true;
    }

    // Also check hash fragment (implicit flow / magic links)
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
        console.log('[Shelvd] Hash token detected');
        // Supabase client handles this automatically
        return true;
    }

    return false;
}

// ─── Auth listener ───
sb.auth.onAuthStateChange(async (event, session) => {
    console.log('[Shelvd] Auth event:', event, session ? 'has session' : 'no session');
    if (hasEnteredLibrary) return;

    // Public profile — skip auth entirely
    const publicUsername = getPublicUsername();
    if (publicUsername) {
        authScreen.style.display = 'none';
        enterLibrary(publicUsername, true);
        return;
    }

    if (session) {
        handleSession(session);
    } else if (event === 'INITIAL_SESSION') {
        // No session on initial load — show login
        authScreen.style.display = 'flex';
    }
});

// Process OAuth callback before anything else
handleOAuthCallback();

// ─── Auth redirect: always go to root (not back to /@username) ───
function getAuthRedirectUrl() {
    return window.location.origin + '/';
}

// ─── Google OAuth ───
document.getElementById('auth-google-btn').addEventListener('click', async () => {
    if (window.shelvdTrack) shelvdTrack('auth_started', { method: 'google' });
    const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: getAuthRedirectUrl()
        }
    });
    if (error) console.error('Google auth error:', error.message);
});

// ─── Magic link form ───
magicLinkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) return;

    if (window.shelvdTrack) shelvdTrack('auth_started', { method: 'magic_link' });
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
            emailRedirectTo: getAuthRedirectUrl()
        }
    });

    if (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send magic link';
        console.error('Auth error:', error.message);
        return;
    }

    emailForm.style.display = 'none';
    checkEmail.style.display = 'flex';
    sentEmail.textContent = email;
});

// ─── Back button ───
backBtn.addEventListener('click', () => {
    checkEmail.style.display = 'none';
    emailForm.style.display = 'flex';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send magic link';
});

// ─── Username form ───
usernameInput.addEventListener('input', () => {
    const val = usernameInput.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
    usernameInput.value = val;
    usernamePreview.textContent = '@' + (val || '...');
    usernameError.textContent = '';
});

usernameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim().toLowerCase();
    if (!username || username.length < 3) {
        usernameError.textContent = 'Username must be at least 3 characters';
        return;
    }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        usernameError.textContent = 'Session expired — please reload';
        return;
    }

    const { error } = await sb.from('profiles').insert({
        id: session.user.id,
        username: username
    });

    if (error) {
        if (error.code === '23505') {
            // Could be our own profile already exists
            const { data: existing } = await sb
                .from('profiles')
                .select('username')
                .eq('id', session.user.id)
                .maybeSingle();
            if (existing) {
                enterLibrary(existing.username);
                return;
            }
            usernameError.textContent = 'Username already taken';
        } else {
            usernameError.textContent = error.message || 'Something went wrong';
        }
        return;
    }

    window.shelvdAuth.currentProfile = { username };
    enterLibrary(username);
});

// ─── Enter library ───
function enterLibrary(username, isPublic) {
    if (hasEnteredLibrary) return;
    hasEnteredLibrary = true;

    const usernameEl = document.getElementById('library-user-username');
    if (usernameEl) usernameEl.textContent = '@' + username;

    document.querySelector('.library-user-header').style.display = '';
    document.title = `Shelvd — @${username}`;

    // Show action bar with staggered animation
    actionBar.style.display = '';
    closeUtilityMenu();
    document.getElementById('share-btn').setAttribute('data-username', username);
    if (mobileShareBtn) mobileShareBtn.setAttribute('data-username', username);

    // Hide owner-only buttons for public view
    if (isPublic) {
        document.getElementById('add-book-btn').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'none';
        const ioBtn = document.getElementById('io-btn');
        if (ioBtn) ioBtn.style.display = 'none';
        if (mobileAddBookBtn) mobileAddBookBtn.style.display = 'none';
        if (mobileIOBtn) mobileIOBtn.style.display = 'none';
        if (mobileLogoutBtn) mobileLogoutBtn.style.display = 'none';
    } else {
        if (mobileAddBookBtn) mobileAddBookBtn.style.display = '';
        if (mobileIOBtn) mobileIOBtn.style.display = '';
        if (mobileLogoutBtn) mobileLogoutBtn.style.display = '';
    }

    syncMobileUtilityLayout();

    if (isPublic) {
        // Public view — skip auth animation, start immediately
        authScreen.style.display = 'none';
        if (window.shelvdTrack) shelvdTrack('public_profile_viewed', { username });
        window.dispatchEvent(new CustomEvent('shelvd:authenticated', {
            detail: { username, isPublic: true }
        }));
    } else {
        if (window.shelvdTrack) shelvdTrack('auth_completed', { username });
        authScreen.classList.add('exiting');
        setTimeout(() => {
            authScreen.style.display = 'none';
            window.dispatchEvent(new CustomEvent('shelvd:authenticated', {
                detail: { username }
            }));
        }, 600);
    }
}

function isMobileLibraryUI() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function closeUtilityMenu() {
    if (!utilityMenuToggle || !mobileUtilityMenu) return;
    mobileUtilityMenu.classList.remove('is-open');
    mobileUtilityMenu.setAttribute('aria-hidden', 'true');
    utilityMenuToggle.classList.remove('active');
    utilityMenuToggle.setAttribute('aria-expanded', 'false');
}

function openUtilityMenu() {
    if (!utilityMenuToggle || !mobileUtilityMenu || !isMobileLibraryUI()) return;
    mobileUtilityMenu.classList.add('is-open');
    mobileUtilityMenu.setAttribute('aria-hidden', 'false');
    utilityMenuToggle.classList.add('active');
    utilityMenuToggle.setAttribute('aria-expanded', 'true');
}

if (utilityMenuToggle && mobileUtilityMenu) {
    utilityMenuToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!isMobileLibraryUI()) return;
        if (mobileUtilityMenu.classList.contains('is-open')) {
            closeUtilityMenu();
        } else {
            openUtilityMenu();
        }
    });

    if (mobileUtilityBackdrop) {
        mobileUtilityBackdrop.addEventListener('click', () => {
            if (!isMobileLibraryUI()) return;
            closeUtilityMenu();
        });
    }

    document.addEventListener('click', (event) => {
        if (!isMobileLibraryUI() || !mobileUtilityMenu.classList.contains('is-open')) return;
        if ((mobileUtilityPanel && mobileUtilityPanel.contains(event.target)) || utilityMenuToggle.contains(event.target)) return;
        closeUtilityMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeUtilityMenu();
    });

    window.addEventListener('resize', () => {
        if (!isMobileLibraryUI()) closeUtilityMenu();
    });
}

if (searchToggleBtn) {
    searchToggleBtn.addEventListener('click', () => {
        if (isMobileLibraryUI()) closeUtilityMenu();
    });
}

// ─── Logout Button ───
document.getElementById('logout-btn').addEventListener('click', async () => {
    await sb.auth.signOut();
    // Clear local caches
    localStorage.removeItem('book-covers-cache');
    localStorage.removeItem('book-covers-version');
    window.location.href = '/';
});

function copyText(text) {
    return navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}

function handleDesktopShareState(btn) {
    btn.classList.add('stamping');

    setTimeout(() => {
        btn.classList.remove('stamping');
        btn.classList.add('copied');
        btn.querySelector('.share-label').textContent = 'Copied';
    }, 220);

    setTimeout(() => {
        btn.classList.remove('copied');
        btn.querySelector('.share-label').textContent = 'Share';
    }, 2200);
}

function handleMobileShareState(btn) {
    const label = btn.querySelector('.mobile-utility-tile-label');
    const meta = btn.querySelector('.mobile-utility-tile-meta');
    btn.classList.add('is-copied');
    if (label) label.textContent = 'Copied';
    if (meta) meta.textContent = 'Link copied';

    setTimeout(() => {
        btn.classList.remove('is-copied');
        if (label) label.textContent = 'Share';
        if (meta) meta.textContent = 'Copy link';
    }, 2200);
}

function handleShareAction(btn) {
    if (!btn) return;
    if (btn.classList.contains('copied') || btn.classList.contains('is-copied')) return;

    const username = btn.getAttribute('data-username') || document.getElementById('share-btn').getAttribute('data-username') || 'user';
    const shareUrl = `${window.location.origin}/@${username}`;
    if (window.shelvdTrack) shelvdTrack('share_clicked', { username });

    if (btn === mobileShareBtn) closeUtilityMenu();

    copyText(shareUrl);

    if (btn === mobileShareBtn) {
        handleMobileShareState(btn);
    } else {
        handleDesktopShareState(btn);
    }
}

// ─── Share Button ───
document.getElementById('share-btn').addEventListener('click', function () {
    handleShareAction(this);
});

// ─── Add Book Modal ───

const addBtn = document.getElementById('add-book-btn');
const addModal = document.getElementById('add-book-modal');
const addBackdrop = document.getElementById('add-book-backdrop');
const addCard = addModal.querySelector('.add-book-card');
const ioBtn = document.getElementById('io-btn');
const logoutBtn = document.getElementById('logout-btn');
const stepChoose = document.getElementById('add-step-choose');
const captureZone = document.getElementById('add-capture-zone');
const coverInput = document.getElementById('add-cover-input');
const backInput = document.getElementById('add-back-input');
const stepCapture = document.getElementById('add-step-capture');
const stepAnalyzing = document.getElementById('add-step-analyzing');
const stepConfirm = document.getElementById('add-step-confirm');
const addStepBackBtn = document.getElementById('add-back-btn');
const addChooseManualBtn = document.getElementById('add-choose-manual');
const addRetakeBtn = document.getElementById('add-retake-btn');
const addConfirmBtn = document.getElementById('add-confirm-btn');
const addBackPhotoBtn = document.getElementById('add-back-photo-btn');
const addIsbnScanBtn = document.getElementById('add-isbn-scan-btn');
const addDetailToggle = document.getElementById('add-detail-toggle');
const addAdvancedFields = document.getElementById('add-advanced-fields');
const addUploadSpinner = document.getElementById('add-upload-spinner');
const addPreviewAnalyzing = document.getElementById('add-preview-analyzing');
const addPreviewConfirm = document.getElementById('add-preview-confirm');
const addMatchPreview = document.getElementById('add-match-preview');
const addMatchCover = document.getElementById('add-match-cover');
const addMatchBadge = document.getElementById('add-match-badge');
const addMatchCopy = document.getElementById('add-match-copy');
const addAnalyzingText = document.getElementById('add-analyzing-text');
const addCandidateSection = document.getElementById('add-candidate-section');
const addCandidateList = document.getElementById('add-candidate-list');
const addRescueActions = document.getElementById('add-rescue-actions');
const addStatusMessage = document.getElementById('add-status-message');
const evidenceCover = document.getElementById('add-evidence-cover');
const evidenceBack = document.getElementById('add-evidence-back');
const addSummaryCover = document.getElementById('add-summary-cover');
const addSummaryPublisher = document.getElementById('add-summary-publisher');
const addSummaryIsbn = document.getElementById('add-summary-isbn');
const addSummaryYear = document.getElementById('add-summary-year');

const ADD_MODAL_TRANSITION_MS = 340;
const ADD_BUTTON_HALO_MS = 480;
let addModalOpenFrame = null;
let addModalCloseTimeout = null;
let addModalHaloTimeout = null;
let addLaunchTrigger = addBtn;
let isbnRefreshTimeout = null;

const addFieldRefs = {
    title: document.getElementById('add-field-title'),
    author: document.getElementById('add-field-author'),
    pages: document.getElementById('add-field-pages'),
    publisher: document.getElementById('add-field-publisher'),
    published_year: document.getElementById('add-field-published-year'),
    isbn_13: document.getElementById('add-field-isbn13'),
    isbn_10: document.getElementById('add-field-isbn10'),
    edition: document.getElementById('add-field-edition'),
    language: document.getElementById('add-field-language'),
    translator: document.getElementById('add-field-translator'),
    format: document.getElementById('add-field-format')
};

function createEmptyAnalysis(matchStatus = 'manual_required') {
    return {
        title: null,
        author: null,
        pages: null,
        isbn_13: null,
        isbn_10: null,
        publisher: null,
        published_year: null,
        edition: null,
        language: null,
        translator: null,
        format: null,
        confidence: 0,
        match_status: matchStatus,
        matched_cover_url: null,
        recommended_candidate_source_id: null,
        candidate_editions: [],
        missing_fields: [],
        rationale: null,
        analysis_issue: null,
        lookup_issue: null
    };
}

const addState = {
    mode: 'photo',
    files: { cover: null, back: null },
    base64: { cover: null, back: null },
    previewUrls: { cover: null, back: null },
    analysis: createEmptyAnalysis(),
    selectedCandidateSourceId: null,
    advancedOpen: false,
    status: { message: '', tone: 'info' }
};

function clearAddModalTimers() {
    if (addModalOpenFrame) {
        cancelAnimationFrame(addModalOpenFrame);
        addModalOpenFrame = null;
    }

    if (addModalCloseTimeout) {
        clearTimeout(addModalCloseTimeout);
        addModalCloseTimeout = null;
    }

    if (addModalHaloTimeout) {
        clearTimeout(addModalHaloTimeout);
        addModalHaloTimeout = null;
    }
}

function setAddModalLaunchVector() {
    const launchTrigger = (isMobileLibraryUI() && addLaunchTrigger) ? addLaunchTrigger : addBtn;
    const fallbackTrigger = utilityMenuToggle || addBtn;
    const trigger = (launchTrigger && launchTrigger.offsetWidth > 0 && launchTrigger.offsetHeight > 0) ? launchTrigger : fallbackTrigger;
    const addBtnRect = trigger.getBoundingClientRect();
    const addCardRect = addCard.getBoundingClientRect();
    const addBtnCenterX = addBtnRect.left + (addBtnRect.width / 2);
    const addBtnCenterY = addBtnRect.top + (addBtnRect.height / 2);
    const addCardCenterX = addCardRect.left + (addCardRect.width / 2);
    const addCardCenterY = addCardRect.top + (addCardRect.height / 2);
    const originX = ((addBtnCenterX - addCardRect.left) / addCardRect.width) * 100;
    const originY = ((addBtnCenterY - addCardRect.top) / addCardRect.height) * 100;

    addModal.style.setProperty('--add-launch-x', `${addBtnCenterX - addCardCenterX}px`);
    addModal.style.setProperty('--add-launch-y', `${addBtnCenterY - addCardCenterY}px`);
    addModal.style.setProperty('--add-origin-x', `${originX}%`);
    addModal.style.setProperty('--add-origin-y', `${originY}%`);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeIsbn(value) {
    return String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
}

function revokePreviewUrl(kind) {
    if (addState.previewUrls[kind]) {
        URL.revokeObjectURL(addState.previewUrls[kind]);
        addState.previewUrls[kind] = null;
    }
}

function resetEditionFields() {
    Object.values(addFieldRefs).forEach((input) => {
        if (!input) return;
        input.value = '';
    });
    if (addFieldRefs.pages) addFieldRefs.pages.value = '250';
}

function resetAddState() {
    ['cover', 'back'].forEach((kind) => revokePreviewUrl(kind));
    addState.mode = 'photo';
    addState.files = { cover: null, back: null };
    addState.base64 = { cover: null, back: null };
    addState.analysis = createEmptyAnalysis();
    addState.selectedCandidateSourceId = null;
    addState.advancedOpen = false;
    resetEditionFields();
    renderEvidencePreviews();
    renderCandidateListUI();
    renderMatchedCoverPreview();
    syncAdvancedFields();
    if (addMatchBadge) {
        addMatchBadge.textContent = 'Manual review';
        addMatchBadge.className = 'add-match-badge is-manual';
    }
    if (addMatchCopy) {
        addMatchCopy.textContent = 'Review this book before adding it to your shelf.';
    }
    if (addPreviewConfirm) {
        addPreviewConfirm.innerHTML = '<div class="add-evidence-preview">No front cover yet</div>';
    }
    clearAddStatus();
    renderEditionSummary();
}

function showAddStep(stepName) {
    if (stepChoose) stepChoose.style.display = stepName === 'choose' ? '' : 'none';
    stepCapture.style.display = stepName === 'capture' ? '' : 'none';
    stepAnalyzing.style.display = stepName === 'analyzing' ? '' : 'none';
    stepConfirm.style.display = stepName === 'confirm' ? '' : 'none';
}

function renderPreviewBox(container, url, alt, placeholder) {
    if (!container) return;
    if (url) {
        container.innerHTML = `<img src="${url}" alt="${escapeHtml(alt)}">`;
    } else {
        container.textContent = placeholder;
    }
}

function renderEvidencePreviews() {
    renderPreviewBox(evidenceCover, addState.previewUrls.cover, 'Front cover', 'Front cover');
    renderPreviewBox(evidenceBack, addState.previewUrls.back, 'Barcode or back cover', 'Not added');
}

function getSelectedCandidate() {
    return (addState.analysis.candidate_editions || []).find(
        (candidate) => candidate.source_id === addState.selectedCandidateSourceId
    ) || null;
}

function setFieldValue(field, value) {
    const input = addFieldRefs[field];
    if (!input) return;
    input.value = value == null ? '' : String(value);
}

function renderAddStatus() {
    if (!addStatusMessage) return;
    const message = addState.status?.message || '';
    if (!message) {
        addStatusMessage.hidden = true;
        addStatusMessage.textContent = '';
        addStatusMessage.className = 'add-status-message';
        return;
    }

    addStatusMessage.hidden = false;
    addStatusMessage.textContent = message;
    addStatusMessage.className = `add-status-message is-${addState.status?.tone || 'info'}`;
}

function setAddStatus(message, tone = 'info') {
    addState.status = { message: message || '', tone };
    renderAddStatus();
}

function clearAddStatus() {
    addState.status = { message: '', tone: 'info' };
    renderAddStatus();
}

function openFilePicker(input, statusMessage = '') {
    if (!input) return;
    if (statusMessage) setAddStatus(statusMessage, 'info');
    try {
        if (typeof input.showPicker === 'function') {
            input.showPicker();
            return;
        }
    } catch (err) {
        console.warn('showPicker failed:', err);
    }

    requestAnimationFrame(() => {
        try {
            input.click();
        } catch (err) {
            console.warn('input.click() failed:', err);
            setAddStatus('Could not open the photo picker on this device yet. Try tapping the field again or use the camera upload flow.', 'warning');
        }
    });
}

function fillEditionFields(source = {}) {
    setFieldValue('title', source.title || '');
    setFieldValue('author', source.author || '');
    setFieldValue('pages', source.pages || 250);
    setFieldValue('publisher', source.publisher || '');
    setFieldValue('published_year', source.published_year || '');
    setFieldValue('isbn_13', source.isbn_13 || source.isbn_10 || '');
    setFieldValue('isbn_10', source.isbn_10 || '');
    setFieldValue('edition', source.edition || '');
    setFieldValue('language', source.language || '');
    setFieldValue('translator', source.translator || '');
    setFieldValue('format', source.format || '');
}

function readEditionFields() {
    const pages = parseInt(addFieldRefs.pages?.value || '', 10);
    const publishedYear = parseInt(addFieldRefs.published_year?.value || '', 10);
    const normalizedIsbn = normalizeIsbn(addFieldRefs.isbn_13?.value || '');
    const derivedIsbn13 = normalizedIsbn.length === 13 ? normalizedIsbn : null;
    const derivedIsbn10 = normalizedIsbn.length === 10
        ? normalizedIsbn
        : normalizeIsbn(addFieldRefs.isbn_10?.value || '') || null;

    return {
        title: addFieldRefs.title?.value.trim() || '',
        author: addFieldRefs.author?.value.trim() || '',
        pages: Number.isFinite(pages) && pages > 0 ? pages : 250,
        publisher: addFieldRefs.publisher?.value.trim() || null,
        published_year: Number.isFinite(publishedYear) && publishedYear > 0 ? publishedYear : null,
        isbn_13: derivedIsbn13,
        isbn_10: derivedIsbn10,
        edition: addFieldRefs.edition?.value.trim() || null,
        language: addFieldRefs.language?.value.trim() || null,
        translator: addFieldRefs.translator?.value.trim() || null,
        format: addFieldRefs.format?.value.trim() || null
    };
}

function buildManualOverrides() {
    const edition = readEditionFields();
    return {
        title: edition.title || null,
        author: edition.author || null,
        publisher: edition.publisher || null,
        published_year: edition.published_year || null,
        isbn_13: edition.isbn_13 || null,
        isbn_10: edition.isbn_10 || null
    };
}

function getFinalCoverMode() {
    const effectiveStatus = addState.analysis?.match_status || 'manual_required';
    const selectedCandidate = getSelectedCandidate();
    if (effectiveStatus === 'exact_match') return 'exact_online';
    if (selectedCandidate) return 'selected_online';
    if (addState.mode === 'photo' && addState.previewUrls.cover) return 'user_photo';
    return 'manual_entry';
}

function renderEditionSummary() {
    const edition = readEditionFields();
    const finalCoverMode = getFinalCoverMode();

    if (addSummaryCover) {
        addSummaryCover.textContent =
            finalCoverMode === 'exact_online'
                ? 'Exact online edition'
                : finalCoverMode === 'selected_online'
                    ? 'Selected online edition'
                    : finalCoverMode === 'user_photo'
                        ? 'Your uploaded photo'
                        : 'Manual entry';
    }

    if (addSummaryPublisher) {
        addSummaryPublisher.textContent = edition.publisher || 'Not found yet';
    }

    if (addSummaryIsbn) {
        addSummaryIsbn.textContent = edition.isbn_13 || edition.isbn_10 || 'Not found yet';
    }

    if (addSummaryYear) {
        addSummaryYear.textContent = edition.published_year || edition.edition || 'Not found yet';
    }
}

function getMatchUi(status) {
    if (status === 'exact_match') {
        return {
            label: 'Exact edition',
            tone: 'is-exact',
            copy: 'Shelvd found a matching online edition cover and metadata for this exact book.'
        };
    }
    if (status === 'needs_confirmation') {
        return {
            label: 'Review candidates',
            tone: 'is-review',
            copy: 'Shelvd found likely editions. Confirm the exact one or save this book manually after review.'
        };
    }
    return {
        label: 'Manual review',
        tone: 'is-manual',
        copy: 'Shelvd could not verify an exact online edition. Review the fields and save manually.'
    };
}

function renderMatchedCoverPreview() {
    if (!addMatchPreview || !addMatchCover) return;
    const selectedCandidate = getSelectedCandidate();
    const shouldShowVerified = addState.analysis.match_status === 'exact_match' || Boolean(selectedCandidate);
    const coverUrl = selectedCandidate?.cover_url || (shouldShowVerified ? addState.analysis.matched_cover_url : null);
    if (coverUrl) {
        addMatchPreview.style.display = '';
        addMatchCover.innerHTML = `<img src="${coverUrl}" alt="Matched online cover">`;
    } else {
        addMatchPreview.style.display = 'none';
        addMatchCover.innerHTML = '';
    }
}

function candidateMetaParts(candidate) {
    return [
        candidate.publisher,
        candidate.published_year,
        candidate.isbn_13 || candidate.isbn_10,
        candidate.format
    ].filter(Boolean);
}

function renderCandidateListUI() {
    if (!addCandidateSection || !addCandidateList) return;
    const candidates = addState.analysis.candidate_editions || [];
    if (!candidates.length) {
        addCandidateSection.style.display = 'none';
        addCandidateList.innerHTML = '';
        return;
    }

    addCandidateSection.style.display = '';
    addCandidateList.innerHTML = candidates.map((candidate) => {
        const active = candidate.source_id === addState.selectedCandidateSourceId ? ' is-selected' : '';
        const coverHtml = candidate.cover_url
            ? `<div class="add-candidate-cover"><img src="${escapeHtml(candidate.cover_url)}" alt="${escapeHtml(candidate.title || 'Candidate cover')}"></div>`
            : `<div class="add-candidate-cover"><div class="add-candidate-cover-placeholder">No online cover</div></div>`;
        return `
            <button type="button" class="add-candidate-card${active}" data-source-id="${escapeHtml(candidate.source_id)}">
                ${coverHtml}
                <div>
                    <div class="add-candidate-title">${escapeHtml(candidate.title || 'Unknown title')}</div>
                    <div class="add-candidate-meta">${escapeHtml(candidate.author || 'Unknown author')}</div>
                    <div class="add-candidate-meta">${escapeHtml(candidateMetaParts(candidate).join(' · ') || 'Review details')}</div>
                </div>
            </button>
        `;
    }).join('');

    addCandidateList.querySelectorAll('.add-candidate-card').forEach((button) => {
        button.addEventListener('click', () => {
            if (addState.selectedCandidateSourceId === button.dataset.sourceId) {
                addState.selectedCandidateSourceId = null;
                fillEditionFields(addState.analysis);
                renderCandidateListUI();
                renderMatchedCoverPreview();
                syncConfirmState();
                return;
            }

            addState.selectedCandidateSourceId = button.dataset.sourceId;
            const selectedCandidate = getSelectedCandidate();
            if (selectedCandidate) {
                fillEditionFields({
                    ...addState.analysis,
                    ...selectedCandidate
                });
            }
            renderCandidateListUI();
            renderMatchedCoverPreview();
            syncConfirmState();
        });
    });
}

function syncAdvancedFields() {
    if (!addAdvancedFields || !addDetailToggle) return;
    addAdvancedFields.style.display = addState.advancedOpen ? '' : 'none';
    addDetailToggle.setAttribute('aria-expanded', addState.advancedOpen ? 'true' : 'false');
    addDetailToggle.textContent = addState.advancedOpen ? 'Hide edition details' : 'Edition details';
}

function syncConfirmState() {
    const selectedCandidate = getSelectedCandidate();
    const effectiveStatus = addState.analysis.match_status;
    const ui = getMatchUi(effectiveStatus);
    const edition = readEditionFields();
    const needsMoreEvidence = !edition.title || !edition.author || !edition.publisher || !(edition.isbn_13 || edition.isbn_10);

    if (addMatchBadge) {
        addMatchBadge.textContent = selectedCandidate && effectiveStatus !== 'exact_match'
            ? 'Confirmed edition'
            : ui.label;
        addMatchBadge.className = `add-match-badge ${selectedCandidate && effectiveStatus !== 'exact_match' ? 'is-exact' : ui.tone}`;
    }
    if (addMatchCopy) {
        addMatchCopy.textContent = selectedCandidate && effectiveStatus !== 'exact_match'
            ? 'You selected a specific online edition. Shelvd will use that exact cover after you save.'
            : effectiveStatus === 'exact_match'
                ? ui.copy
                : 'Shelvd has not verified an exact online edition yet. It will keep your own photo unless you explicitly pick an online edition.';
    }
    if (addRescueActions) {
        addRescueActions.style.display = addState.mode === 'photo' && needsMoreEvidence ? '' : 'none';
    }
    if (addConfirmBtn) {
        addConfirmBtn.textContent = 'Add to shelf';
    }
    renderEditionSummary();
}

function renderConfirmStep() {
    showAddStep('confirm');
    renderPreviewBox(
        addPreviewConfirm,
        addState.previewUrls.cover,
        'Uploaded front cover',
        addState.mode === 'manual' ? 'Manual entry' : 'No front cover'
    );
    renderEvidencePreviews();
    renderMatchedCoverPreview();
    renderCandidateListUI();
    syncAdvancedFields();
    renderAddStatus();
    syncConfirmState();
}

function normalizeAnalysisResponse(data) {
    const normalized = {
        ...createEmptyAnalysis(
            ['exact_match', 'needs_confirmation', 'manual_required'].includes(data?.match_status)
                ? data.match_status
                : 'manual_required'
        ),
        ...data
    };
    normalized.candidate_editions = Array.isArray(data?.candidate_editions) ? data.candidate_editions : [];
    normalized.missing_fields = Array.isArray(data?.missing_fields) ? data.missing_fields : [];
    return normalized;
}

function resetAddModalContent() {
    resetAddState();
    showAddStep(stepChoose ? 'choose' : 'capture');
}

function openAddModal() {
    if (addModal.classList.contains('is-open') || addModal.style.display === 'flex' || addModalCloseTimeout) return;

    closeUtilityMenu();
    clearAddModalTimers();
    resetAddModalContent();
    addBtn.classList.add('active');
    addBtn.classList.add('launching');
    addModal.classList.remove('is-open');
    addModal.style.display = 'flex';
    setAddModalLaunchVector();

    addModalOpenFrame = requestAnimationFrame(() => {
        addModal.classList.add('is-open');
        addModalOpenFrame = null;
    });

    addModalHaloTimeout = setTimeout(() => {
        addBtn.classList.remove('launching');
        addModalHaloTimeout = null;
    }, ADD_BUTTON_HALO_MS);
}

    [addBtn, ioBtn, logoutBtn].forEach((button) => {
    if (!button) return;
    button.addEventListener('click', () => {
        if (isMobileLibraryUI()) closeUtilityMenu();
    });
});

if (mobileAddBookBtn) {
    mobileAddBookBtn.addEventListener('click', () => {
        addLaunchTrigger = mobileAddBookBtn;
        openAddModal();
    });
}

if (mobileIOBtn && ioBtn) {
    mobileIOBtn.addEventListener('click', () => {
        closeUtilityMenu();
        ioBtn.click();
    });
}

if (mobileLogoutBtn && logoutBtn) {
    mobileLogoutBtn.addEventListener('click', () => {
        closeUtilityMenu();
        logoutBtn.click();
    });
}

if (mobileShareBtn) {
    mobileShareBtn.addEventListener('click', () => {
        handleShareAction(mobileShareBtn);
    });
}

function closeAddModal() {
    clearAddModalTimers();

    if (addModal.style.display !== 'flex') {
        addBtn.classList.remove('active');
        addBtn.classList.remove('launching');
        resetAddState();
        return;
    }

    setAddModalLaunchVector();
    addModal.classList.remove('is-open');
    resetAddState();

    addModalCloseTimeout = setTimeout(() => {
        addModal.style.display = 'none';
        addBtn.classList.remove('active');
        addBtn.classList.remove('launching');
        addLaunchTrigger = addBtn;
        addModalCloseTimeout = null;
    }, ADD_MODAL_TRANSITION_MS);
}

addBtn.addEventListener('click', openAddModal);
addBackdrop.addEventListener('click', closeAddModal);
document.getElementById('add-close-btn').addEventListener('click', closeAddModal);
document.getElementById('add-confirm-close').addEventListener('click', closeAddModal);

function mergeEditionData(base, override) {
    return {
        title: override?.title || base?.title || null,
        author: override?.author || base?.author || null,
        pages: override?.pages || base?.pages || null,
        publisher: override?.publisher || base?.publisher || null,
        published_year: override?.published_year || base?.published_year || null,
        isbn_13: override?.isbn_13 || base?.isbn_13 || null,
        isbn_10: override?.isbn_10 || base?.isbn_10 || null,
        edition: override?.edition || base?.edition || null,
        language: override?.language || base?.language || null,
        translator: override?.translator || base?.translator || null,
        format: override?.format || base?.format || null
    };
}

function openManualAddFlow() {
    addState.mode = 'manual';
    addState.analysis = createEmptyAnalysis('manual_required');
    addState.selectedCandidateSourceId = null;
    addState.advancedOpen = true;
    fillEditionFields(createEmptyAnalysis('manual_required'));
    renderConfirmStep();
}

async function normalizeUploadFile(file) {
    let normalizedFile = file;
    const name = file.name.toLowerCase();
    if (name.endsWith('.heic') || name.endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif') {
        try {
            const blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
            normalizedFile = new File([blob], file.name.replace(/\.heic|\.heif/i, '.jpg'), { type: 'image/jpeg' });
        } catch (err) {
            console.error('HEIC conversion failed:', err);
        }
    }
    return normalizedFile;
}

async function attachEvidenceFile(kind, file) {
    const normalizedFile = await normalizeUploadFile(file);
    revokePreviewUrl(kind);
    addState.files[kind] = normalizedFile;
    addState.previewUrls[kind] = URL.createObjectURL(normalizedFile);
    addState.base64[kind] = await resizeAndEncode(normalizedFile, kind === 'cover' ? 1600 : 1400);
    renderEvidencePreviews();
    return normalizedFile;
}

function buildIsbnOverride(isbn) {
    const normalized = normalizeIsbn(isbn);
    return {
        isbn_13: normalized && normalized.length === 13 ? normalized : null,
        isbn_10: normalized && normalized.length === 10 ? normalized : null
    };
}

function isbn13To10(isbn13) {
    const normalized = normalizeIsbn(isbn13);
    if (!normalized || normalized.length !== 13 || !normalized.startsWith('978')) return null;
    const core = normalized.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < core.length; i += 1) {
        sum += (10 - i) * parseInt(core[i], 10);
    }
    const remainder = 11 - (sum % 11);
    const check = remainder === 11 ? '0' : remainder === 10 ? 'X' : String(remainder % 11);
    return `${core}${check}`;
}

function parsePublishedYear(value) {
    const match = String(value || '').match(/\b(1[5-9]\d{2}|20\d{2}|2100)\b/);
    return match ? parseInt(match[1], 10) : null;
}

function firstDistinct(values) {
    const seen = new Set();
    for (const value of values || []) {
        const cleaned = String(value || '').trim();
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        return cleaned;
    }
    return null;
}

function openLibraryEditionFromRecord(record, requestedIsbn) {
    if (!record || typeof record !== 'object') return null;
    const identifiers = record.identifiers && typeof record.identifiers === 'object'
        ? record.identifiers
        : {};
    const isbn13 = Array.isArray(identifiers.isbn_13)
        ? normalizeIsbn(identifiers.isbn_13[0])
        : requestedIsbn.length === 13 ? requestedIsbn : null;
    const isbn10 = Array.isArray(identifiers.isbn_10)
        ? normalizeIsbn(identifiers.isbn_10[0])
        : requestedIsbn.length === 13 ? isbn13To10(requestedIsbn) : requestedIsbn.length === 10 ? requestedIsbn : null;

    const matchedCoverUrl = record.cover?.large || record.cover?.medium || record.cover?.small || null;

    return {
        title: String(record.title || '').trim() || null,
        author: firstDistinct((record.authors || []).map((entry) => entry?.name)),
        publisher: firstDistinct((record.publishers || []).map((entry) => entry?.name)),
        published_year: parsePublishedYear(record.publish_date),
        pages: Number.isFinite(record.number_of_pages) ? record.number_of_pages : null,
        isbn_13: isbn13,
        isbn_10: isbn10,
        matched_cover_url: matchedCoverUrl,
        match_status: matchedCoverUrl ? 'exact_match' : 'manual_required',
        missing_fields: [],
        rationale: 'Metadata filled from Open Library ISBN lookup.',
        analysis_issue: null,
        lookup_issue: null
    };
}

async function fetchOpenLibraryEditionByIsbn(isbn) {
    const normalized = normalizeIsbn(isbn);
    if (!normalized || (normalized.length !== 10 && normalized.length !== 13)) return null;

    const isbnKeys = [normalized];
    if (normalized.length === 13) {
        const isbn10 = isbn13To10(normalized);
        if (isbn10) isbnKeys.push(isbn10);
    }

    const bibkeys = isbnKeys.map((key) => `ISBN:${key}`).join(',');
    const url = `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibkeys)}&format=json&jscmd=data`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Open Library lookup failed: ${response.status}`);
    }

    const data = await response.json();
    for (const key of isbnKeys) {
        const record = data[`ISBN:${key}`];
        const edition = openLibraryEditionFromRecord(record, normalized);
        if (edition) return edition;
    }

    return null;
}

function applyAnalysisResult(data, currentFields, fallbackStatus = '') {
    addState.analysis = normalizeAnalysisResponse(data);
    addState.selectedCandidateSourceId = addState.analysis.match_status === 'exact_match'
        ? addState.analysis.recommended_candidate_source_id
        : null;
    addState.advancedOpen = addState.mode === 'manual'
        || addState.analysis.match_status !== 'exact_match'
        || addState.analysis.missing_fields.length > 0
        || !addState.analysis.publisher
        || !(addState.analysis.isbn_13 || addState.analysis.isbn_10);

    const mergedFields = mergeEditionData(addState.analysis, currentFields);
    fillEditionFields(mergedFields);

    if (addState.analysis.lookup_issue) {
        setAddStatus(addState.analysis.lookup_issue, 'warning');
    } else if (addState.analysis.analysis_issue) {
        setAddStatus(addState.analysis.analysis_issue, 'warning');
    } else if (!mergedFields.title && !mergedFields.author) {
        setAddStatus(
            fallbackStatus || 'We could not read the cover yet. Try scanning the barcode or type the ISBN manually.',
            'warning'
        );
    } else if ((mergedFields.isbn_13 || mergedFields.isbn_10) && mergedFields.title && mergedFields.author) {
        setAddStatus('Metadata updated. Review the edition details before saving.', 'success');
    } else {
        setAddStatus('Cover read partially. Scan or type the ISBN to complete the edition.', 'info');
    }
}

async function invokeEditionAnalysis(body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) {
        throw new Error('Session expired');
    }

    const { data, error } = await sb.functions.invoke('analyze-book', {
        headers: {
            Authorization: `Bearer ${session.access_token}`
        },
        body
    });

    if (error) {
        throw new Error(error.message || 'Analysis failed');
    }

    return data;
}

async function detectIsbnFromFile(file) {
    if (!('BarcodeDetector' in window) || !window.createImageBitmap) return null;
    try {
        const detector = new window.BarcodeDetector({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
        });
        const bitmap = await createImageBitmap(file);
        try {
            const results = await detector.detect(bitmap);
            for (const result of results || []) {
                const isbn = normalizeIsbn(result?.rawValue);
                if (isbn && (isbn.startsWith('978') || isbn.startsWith('979') || isbn.length === 10)) {
                    return isbn;
                }
            }
        } finally {
            if (typeof bitmap.close === 'function') bitmap.close();
        }
    } catch (err) {
        console.warn('BarcodeDetector failed:', err);
    }
    return null;
}

async function lookupEditionByIsbn(isbn, message = 'Checking ISBN details') {
    const normalized = normalizeIsbn(isbn);
    if (!normalized) return false;

    setAddStatus(message, 'info');
    const currentFields = readEditionFields();

    try {
        const edition = await fetchOpenLibraryEditionByIsbn(normalized);
        if (!edition) {
            setAddStatus('Could not find metadata for that ISBN yet. You can keep editing the fields manually.', 'warning');
            renderConfirmStep();
            return false;
        }

        addState.analysis = normalizeAnalysisResponse({
            ...addState.analysis,
            ...edition,
            matched_cover_url: addState.analysis.matched_cover_url || edition.matched_cover_url
        });
        addState.selectedCandidateSourceId = null;
        fillEditionFields({
            ...currentFields,
            ...edition,
            isbn_13: edition.isbn_13 || (normalized.length === 13 ? normalized : null),
            isbn_10: edition.isbn_10 || (normalized.length === 10 ? normalized : null)
        });
        setAddStatus('Metadata filled from ISBN. Review the details before saving.', 'success');
        renderConfirmStep();
        return Boolean(readEditionFields().title || readEditionFields().author || readEditionFields().publisher);
    } catch (err) {
        console.error('ISBN lookup error:', err);
        setAddStatus('Could not look up metadata from that ISBN yet. You can keep editing the fields manually.', 'error');
        renderConfirmStep();
        return false;
    }
}

function queueIsbnRefresh() {
    if (isbnRefreshTimeout) {
        clearTimeout(isbnRefreshTimeout);
        isbnRefreshTimeout = null;
    }

    if (!addState.base64.cover) return;

    const edition = readEditionFields();
    const typedIsbn = edition.isbn_13 || edition.isbn_10;
    const analyzedIsbn = addState.analysis?.isbn_13 || addState.analysis?.isbn_10;
    if (!typedIsbn || (typedIsbn.length !== 10 && typedIsbn.length !== 13) || typedIsbn === analyzedIsbn) return;

    isbnRefreshTimeout = setTimeout(() => {
        lookupEditionByIsbn(typedIsbn, 'Checking ISBN details');
        isbnRefreshTimeout = null;
    }, 250);
}

function showAnalyzingState(message) {
    if (addAnalyzingText) addAnalyzingText.textContent = message || 'Checking the exact edition';
    renderPreviewBox(addPreviewAnalyzing, addState.previewUrls.cover, 'Front cover preview', 'Preparing front cover');
    showAddStep('analyzing');
}

async function analyzeEditionEvidence(message = 'Checking the exact edition') {
    if (!addState.base64.cover) return;

    clearAddStatus();
    showAnalyzingState(message);
    const currentFields = readEditionFields();

    try {
        const data = await invokeEditionAnalysis({
            cover_image: addState.base64.cover,
            back_image: addState.base64.back,
            manual_overrides: buildManualOverrides()
        });

        applyAnalysisResult(data, currentFields);
    } catch (err) {
        console.error('Analyze error:', err);
        addState.analysis = createEmptyAnalysis('manual_required');
        addState.analysis.rationale = 'Shelvd could not verify an online edition from these photos.';
        addState.selectedCandidateSourceId = null;
        addState.advancedOpen = true;
        if (!addFieldRefs.pages.value) addFieldRefs.pages.value = '250';
        setAddStatus('Your photo will be used as the cover. Fill in the title and author below, or add the ISBN to autofill.', 'info');
    }

    renderConfirmStep();
}

async function handleEvidenceInput(kind, event, options = {}) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (options.showSpinner && addUploadSpinner) addUploadSpinner.style.display = 'flex';

    try {
        const normalizedFile = await attachEvidenceFile(kind, file);
        addState.mode = 'photo';
        if (kind === 'cover') {
            await analyzeEditionEvidence('Checking the front cover');
        } else {
            const detectedIsbn = await detectIsbnFromFile(normalizedFile);
            if (detectedIsbn) {
                setFieldValue('isbn_13', detectedIsbn);
                setAddStatus('ISBN detected from the barcode. Checking edition details.', 'success');
                await lookupEditionByIsbn(detectedIsbn, 'Reading the barcode and checking ISBN details');
            } else {
                setAddStatus('We could not read a barcode from that photo. Try centering the ISBN/barcode or type it manually.', 'warning');
                await analyzeEditionEvidence('Checking the barcode and back cover');
            }
        }
    } finally {
        if (options.showSpinner && addUploadSpinner) addUploadSpinner.style.display = 'none';
    }
}

async function uploadEvidenceAssets(session, evidenceFiles) {
    const urls = { cover: null, spine: null, back: null };
    const timestamp = Date.now();

    for (const [kind, file] of Object.entries(evidenceFiles)) {
        if (!file) continue;
        const compressedBlob = await compressForUpload(file, kind === 'cover' ? 800 : 1024);
        const fileName = `${session.user.id}/${timestamp}-${kind}.jpg`;
        const { error: uploadErr } = await sb.storage
            .from('covers')
            .upload(fileName, compressedBlob, {
                contentType: 'image/jpeg',
                upsert: false
            });

        if (!uploadErr) {
            const { data: urlData } = sb.storage.from('covers').getPublicUrl(fileName);
            urls[kind] = urlData.publicUrl;
        }
    }

    return urls;
}

captureZone.addEventListener('click', () => openFilePicker(coverInput, 'Take a clear photo of the front cover.'));

if (addStepBackBtn) {
    addStepBackBtn.addEventListener('click', () => {
        resetAddState();
        showAddStep('choose');
    });
}

if (addChooseManualBtn) {
    addChooseManualBtn.addEventListener('click', openManualAddFlow);
}

if (addDetailToggle) {
    addDetailToggle.addEventListener('click', () => {
        addState.advancedOpen = !addState.advancedOpen;
        syncAdvancedFields();
    });
}

Object.values(addFieldRefs).forEach((input) => {
    if (!input) return;
    input.addEventListener('input', () => {
        renderEditionSummary();
    });
});

if (addFieldRefs.isbn_13) {
    addFieldRefs.isbn_13.addEventListener('input', queueIsbnRefresh);
    addFieldRefs.isbn_13.addEventListener('change', queueIsbnRefresh);
    addFieldRefs.isbn_13.addEventListener('blur', queueIsbnRefresh);
}

coverInput.addEventListener('change', (event) => handleEvidenceInput('cover', event, { showSpinner: true }));
backInput.addEventListener('change', (event) => handleEvidenceInput('back', event));

if (addIsbnScanBtn) {
    addIsbnScanBtn.addEventListener('click', openBarcodeScanner);
}

// ─── Live Barcode Scanner ───
let barcodeScanStream = null;

async function openBarcodeScanner() {
    const modal = document.getElementById('barcode-modal');
    const video = document.getElementById('barcode-video');
    const closeBtn = document.getElementById('barcode-modal-close');
    const captureBtn = document.getElementById('barcode-capture-btn');
    const hint = document.getElementById('barcode-hint');
    const status = document.getElementById('barcode-status');

    // Request camera
    try {
        barcodeScanStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = barcodeScanStream;
    } catch (err) {
        // Camera denied — fall back to file input
        openFilePicker(backInput, 'Take a photo of the ISBN barcode on the back cover.');
        return;
    }

    modal.style.display = 'flex';
    status.textContent = '';

    function stopScanner() {
        if (barcodeScanStream) {
            barcodeScanStream.getTracks().forEach(t => t.stop());
            barcodeScanStream = null;
        }
        if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
        modal.style.display = 'none';
        captureBtn.style.display = 'none';
        captureBtn.disabled = false;
        captureBtn.textContent = 'Capture';
        status.textContent = '';
    }

    closeBtn.onclick = stopScanner;

    let scanInterval = null;

    if ('BarcodeDetector' in window) {
        // Auto-scan mode (Chrome / Android)
        hint.textContent = 'Hold steady — scanning automatically';
        const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        let scanning = false;

        scanInterval = setInterval(async () => {
            if (scanning || video.readyState < 2) return;
            scanning = true;
            try {
                const results = await detector.detect(video);
                for (const result of results || []) {
                    const isbn = normalizeIsbn(result?.rawValue);
                    if (isbn && (isbn.startsWith('978') || isbn.startsWith('979') || isbn.length === 10)) {
                        stopScanner();
                        setFieldValue('isbn_13', isbn);
                        setAddStatus('ISBN detected. Checking edition details.', 'success');
                        await lookupEditionByIsbn(isbn, 'Checking ISBN details');
                        return;
                    }
                }
            } catch (e) { /* continue */ } finally { scanning = false; }
        }, 300);
    } else {
        // Manual capture mode (iOS Safari)
        hint.textContent = 'Frame the barcode, then tap Capture';
        captureBtn.style.display = 'block';

        captureBtn.onclick = () => {
            stopScanner();
            // Use native file input for full-quality photo (avoids blurry video frame on iOS)
            const tmpInput = document.createElement('input');
            tmpInput.type = 'file';
            tmpInput.accept = 'image/*';
            tmpInput.capture = 'environment';
            tmpInput.style.display = 'none';
            document.body.appendChild(tmpInput);
            tmpInput.onchange = async (e) => {
                document.body.removeChild(tmpInput);
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const base64 = ev.target.result.split(',')[1];
                    await extractIsbnFromBarcodeFrame(base64);
                };
                reader.readAsDataURL(file);
            };
            setTimeout(() => tmpInput.click(), 200);
        };
    }
}

async function extractIsbnFromBarcodeFrame(base64) {
    clearAddStatus();
    showAnalyzingState('Reading the barcode...');

    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session?.access_token) throw new Error('Session expired');

        const { data, error } = await sb.functions.invoke('analyze-book', {
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: { cover_image: base64 }
        });

        if (error) throw new Error(error.message || 'Failed');

        const isbn = normalizeIsbn(data?.isbn_13 || data?.isbn_10);
        if (isbn && (isbn.startsWith('978') || isbn.startsWith('979') || isbn.length === 10)) {
            setFieldValue('isbn_13', isbn);
            setAddStatus('ISBN detected. Checking edition details.', 'success');
            renderConfirmStep();
            await lookupEditionByIsbn(isbn, 'Checking ISBN details');
        } else {
            setAddStatus('Could not read the ISBN. Try again or type it manually.', 'warning');
            renderConfirmStep();
        }
    } catch (err) {
        console.error('Barcode extract error:', err);
        setAddStatus('Could not read the barcode. Type the ISBN manually.', 'warning');
        renderConfirmStep();
    }
}

if (addRetakeBtn) {
    addRetakeBtn.addEventListener('click', () => {
        resetAddState();
        addState.mode = 'photo';
        showAddStep('capture');
    });
}

addConfirmBtn.addEventListener('click', async () => {
    let edition = readEditionFields();
    if (!edition.title) {
        if (edition.isbn_13 || edition.isbn_10) {
            const filled = await lookupEditionByIsbn(edition.isbn_13 || edition.isbn_10, 'Checking ISBN details before saving');
            if (!filled) {
                setAddStatus('Add a title or a valid ISBN before saving this book.', 'warning');
                return;
            }
            edition = readEditionFields();
        } else {
            setAddStatus('Add a title or a valid ISBN before saving this book.', 'warning');
            return;
        }
    }

    addConfirmBtn.disabled = true;
    addConfirmBtn.textContent = 'Adding...';

    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) {
            addConfirmBtn.textContent = 'Session expired';
            return;
        }

        const uploaded = await uploadEvidenceAssets(session, addState.files);
        const selectedCandidate = getSelectedCandidate();
        const analysis = addState.analysis || createEmptyAnalysis('manual_required');
        const hasVerifiedEdition = analysis.match_status === 'exact_match' || Boolean(selectedCandidate);
        const finalMatchStatus = analysis.match_status === 'exact_match'
            ? 'exact_match'
            : selectedCandidate
                ? 'needs_confirmation'
                : 'manual_required';
        const mergedEdition = mergeEditionData(analysis, edition);
        const digitalCoverUrl = hasVerifiedEdition
            ? (selectedCandidate?.cover_url || analysis.matched_cover_url || null)
            : null;

        const { data: book, error: insertErr } = await sb
            .from('books')
            .insert({
                user_id: session.user.id,
                title: mergedEdition.title,
                author: mergedEdition.author || 'Unknown',
                pages: mergedEdition.pages || 250,
                cover: uploaded.cover,
                digital_cover_url: digitalCoverUrl,
                isbn_13: mergedEdition.isbn_13,
                isbn_10: mergedEdition.isbn_10,
                publisher: mergedEdition.publisher,
                published_year: mergedEdition.published_year,
                edition: mergedEdition.edition,
                language: mergedEdition.language,
                translator: mergedEdition.translator,
                format: mergedEdition.format,
                back_photo_url: uploaded.back,
                match_status: finalMatchStatus
            })
            .select()
            .single();

        if (insertErr) {
            console.error('Insert error:', insertErr);
            addConfirmBtn.textContent = 'Error — try again';
            addConfirmBtn.disabled = false;
            return;
        }

        if (window.shelvdTrack) {
            shelvdTrack('book_added', {
                title: mergedEdition.title,
                author: mergedEdition.author || 'Unknown',
                method: addState.mode,
                match_status: finalMatchStatus
            });
        }

        window.dispatchEvent(new CustomEvent('shelvd:book-added', {
            detail: {
                book,
                coverUrl: uploaded.cover,
                digitalCoverUrl: digitalCoverUrl
            }
        }));

        const countEl = document.getElementById('header-book-count');
        const currentCount = parseInt(countEl.textContent, 10) || 0;
        countEl.textContent = `${currentCount + 1} books`;

        closeAddModal();
        addConfirmBtn.disabled = false;
        syncConfirmState();
    } catch (err) {
        console.error('Add book error:', err);
        addConfirmBtn.textContent = 'Error — try again';
        addConfirmBtn.disabled = false;
    }
});

// Compress image for Storage upload (max 800px, JPEG 0.8) — returns Blob
function compressForUpload(file, maxSize = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;
                if (w > maxSize || h > maxSize) {
                    const scale = maxSize / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                canvas.toBlob((blob) => {
                    resolve(blob || file); // fallback to original if toBlob fails
                }, 'image/jpeg', 0.8);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Resize image and return base64 (without data:... prefix)
function resizeAndEncode(file, maxSize) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                let w = img.width;
                let h = img.height;
                if (w > maxSize || h > maxSize) {
                    const scale = maxSize / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
                resolve(dataUrl.split(',')[1]); // strip data:image/jpeg;base64,
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ─── Start ───
// Auth is handled by onAuthStateChange listener above
