// ─── Import/Export for Shelvd ───

const ioModal = document.getElementById('io-modal');
const ioProgress = document.getElementById('io-progress');
const ioProgressText = document.getElementById('io-progress-text');
const ioProgressFill = document.getElementById('io-progress-fill');
const ioImportInput = document.getElementById('io-import-input');
const addModal = document.getElementById('add-book-modal');

function openIOModal() { ioModal.style.display = 'flex'; }
function closeIOModal() {
    ioModal.style.display = 'none';
    ioProgress.style.display = 'none';
    ioProgressFill.style.width = '0%';
}

function showProgress(text, pct) {
    ioProgress.style.display = 'block';
    ioProgressText.textContent = text;
    ioProgressFill.style.width = pct + '%';
}

// ─── Export modal ───
document.getElementById('io-btn').addEventListener('click', openIOModal);
document.getElementById('io-backdrop').addEventListener('click', closeIOModal);
document.getElementById('io-close').addEventListener('click', closeIOModal);

// ─── Add book: choose method step ───
const stepChoose = document.getElementById('add-step-choose');
const stepCapture = document.getElementById('add-step-capture');

document.getElementById('add-choose-photo').addEventListener('click', () => {
    stepChoose.style.display = 'none';
    stepCapture.style.display = '';
});

document.getElementById('add-choose-file').addEventListener('click', () => {
    ioImportInput.click();
});

// Back button: return to choose step
const backBtn = document.getElementById('add-back-btn');
if (backBtn) {
    backBtn.addEventListener('click', () => {
        stepCapture.style.display = 'none';
        stepChoose.style.display = '';
    });
}

// Reset to choose step when modal opens
const addBookBtn = document.getElementById('add-book-btn');
if (addBookBtn) {
    const origClick = addBookBtn.onclick;
    addBookBtn.addEventListener('click', () => {
        stepChoose.style.display = '';
        stepCapture.style.display = 'none';
    }, true); // capture phase, runs before auth.js handler
}

// ─── Export to Excel ───
document.getElementById('io-export-excel').addEventListener('click', async () => {
    showProgress('Preparing Excel...', 10);

    const books = getBookList();
    const rows = books.map(b => ({
        Title: b.title,
        Author: b.author,
        Pages: b.pages || '',
        'ISBN-13': b.isbn_13 || '',
        'ISBN-10': b.isbn_10 || '',
        Publisher: b.publisher || '',
        'Published Year': b.published_year || '',
        Edition: b.edition || '',
        Language: b.language || '',
        Translator: b.translator || '',
        Format: b.format || '',
        'Match Status': b.match_status || '',
        'Cover URL': b.coverUrl || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
        { wch: 40 }, { wch: 30 }, { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 28 },
        { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 60 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Library');

    showProgress('Generating file...', 80);

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `shelvd-library-${today}.xlsx`);

    showProgress('Done!', 100);
    setTimeout(closeIOModal, 800);
});

// ─── Export to Word (.doc as HTML) ───
document.getElementById('io-export-word').addEventListener('click', async () => {
    showProgress('Preparing Word document...', 10);

    const books = getBookList();
    const today = new Date().toISOString().slice(0, 10);

    let html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:w="urn:schemas-microsoft-com:office:word"
              xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="utf-8">
        <style>
            body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; }
            h1 { font-size: 24px; margin-bottom: 8px; }
            .subtitle { font-size: 13px; color: #888; margin-bottom: 30px; }
            table { width: 100%; border-collapse: collapse; }
            td { vertical-align: top; padding: 12px 8px; border-bottom: 1px solid #eee; }
            .cover { width: 80px; height: 120px; object-fit: cover; border-radius: 4px; }
            .title { font-size: 14px; font-weight: 600; }
            .author { font-size: 12px; color: #666; margin-top: 4px; }
            .pages { font-size: 11px; color: #999; margin-top: 2px; }
        </style></head><body>
        <h1>Shelvd Library</h1>
        <div class="subtitle">${books.length} books &middot; Exported ${today}</div>
        <table>`;

    for (let i = 0; i < books.length; i++) {
        const b = books[i];
        showProgress(`Processing ${i + 1}/${books.length}...`, 10 + (i / books.length * 80));
        const coverHtml = b.coverUrl
            ? `<img class="cover" src="${b.coverUrl}" alt="${escHtml(b.title)}">`
            : `<div class="cover" style="background:#ddd;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">${escHtml(b.title)}</div>`;
        html += `<tr>
            <td style="width:100px">${coverHtml}</td>
            <td>
                <div class="title">${escHtml(b.title)}</div>
                <div class="author">${escHtml(b.author)}</div>
                <div class="pages">${b.pages ? b.pages + ' pages' : ''}</div>
                <div class="pages">${escHtml([b.publisher, b.published_year, b.isbn_13 || b.isbn_10].filter(Boolean).join(' · '))}</div>
            </td>
        </tr>`;
    }

    html += '</table></body></html>';

    showProgress('Generating file...', 95);

    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    saveAs(blob, `shelvd-library-${today}.doc`);

    showProgress('Done!', 100);
    setTimeout(closeIOModal, 800);
});

// ─── Import from Excel/CSV (triggered from add-book modal) ───
ioImportInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    ioImportInput.value = '';

    // Close add-book modal, open IO modal for progress
    if (addModal) addModal.style.display = 'none';
    openIOModal();
    showProgress('Reading file...', 5);

    const data = await file.arrayBuffer();
    const wb = XLSX.read(data);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws);

    if (!rows.length) {
        showProgress('No data found in file', 100);
        setTimeout(closeIOModal, 1500);
        return;
    }

    // Detect column names (flexible: Title/title/título, etc.)
    const sample = rows[0];
    const keys = Object.keys(sample);
    const titleKey = keys.find(k => /^(title|t[ií]tulo|libro|book|name|nombre)$/i.test(k));
    const authorKey = keys.find(k => /^(author|autor|writer|escritor)$/i.test(k));
    const pagesKey = keys.find(k => /^(pages|p[áa]ginas|pags?)$/i.test(k));
    const isbn13Key = keys.find(k => /^(isbn[-_ ]?13)$/i.test(k));
    const isbn10Key = keys.find(k => /^(isbn[-_ ]?10)$/i.test(k));
    const publisherKey = keys.find(k => /^(publisher|editorial)$/i.test(k));
    const yearKey = keys.find(k => /^(published year|year|a[ñn]o|published_year)$/i.test(k));
    const editionKey = keys.find(k => /^(edition|edici[oó]n)$/i.test(k));
    const languageKey = keys.find(k => /^(language|idioma)$/i.test(k));
    const translatorKey = keys.find(k => /^(translator|traductor)$/i.test(k));
    const formatKey = keys.find(k => /^(format|formato)$/i.test(k));
    const matchStatusKey = keys.find(k => /^(match status|match_status)$/i.test(k));
    const coverKey = keys.find(k => /^(cover url|cover|digital_cover_url)$/i.test(k));

    if (!titleKey) {
        showProgress('Could not find a "Title" column. Use headers: Title, Author, Pages', 100);
        setTimeout(closeIOModal, 3000);
        return;
    }

    // Deduplicate against existing library
    const existingBooks = getBookList();
    const existingKeys = new Set(existingBooks.map((b) => {
        const isbnKey = normalizeIsbnToken(b.isbn_13 || b.isbn_10);
        return isbnKey || [
            b.title,
            b.author,
            b.publisher,
            b.edition,
            b.published_year,
            b.format
        ].map((value) => String(value || '').trim().toLowerCase()).join('|');
    }));

    const sb = window.shelvdAuth?.supabase;
    const session = sb ? (await sb.auth.getSession()).data.session : null;

    let added = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const title = String(row[titleKey] || '').trim();
        const author = authorKey ? String(row[authorKey] || '').trim() : 'Unknown';
        const pages = pagesKey ? (parseInt(row[pagesKey]) || 250) : 250;
        const isbn13 = isbn13Key ? normalizeIsbnToken(row[isbn13Key]) : '';
        const isbn10 = isbn10Key ? normalizeIsbnToken(row[isbn10Key]) : '';
        const publisher = publisherKey ? String(row[publisherKey] || '').trim() : null;
        const publishedYear = yearKey ? (parseInt(row[yearKey]) || null) : null;
        const edition = editionKey ? String(row[editionKey] || '').trim() : null;
        const language = languageKey ? String(row[languageKey] || '').trim() : null;
        const translator = translatorKey ? String(row[translatorKey] || '').trim() : null;
        const format = formatKey ? String(row[formatKey] || '').trim() : null;
        const matchStatus = matchStatusKey ? String(row[matchStatusKey] || '').trim() : null;
        const digitalCoverUrl = coverKey ? String(row[coverKey] || '').trim() : null;

        if (!title) { skipped++; continue; }

        const key = isbn13 || isbn10 || [
            title,
            author,
            publisher,
            edition,
            publishedYear,
            format
        ].map((value) => String(value || '').trim().toLowerCase()).join('|');
        if (existingKeys.has(key)) { skipped++; continue; }
        existingKeys.add(key);

        showProgress(`Importing ${i + 1}/${rows.length}...`, 10 + (i / rows.length * 85));

        if (sb && session) {
            const { data: book, error } = await sb
                .from('books')
                .insert({
                    user_id: session.user.id,
                    title,
                    author,
                    pages,
                    isbn_13: isbn13 || null,
                    isbn_10: isbn10 || null,
                    publisher,
                    published_year: publishedYear,
                    edition,
                    language,
                    translator,
                    format,
                    match_status: matchStatus || (digitalCoverUrl ? 'needs_confirmation' : 'manual_required'),
                    digital_cover_url: digitalCoverUrl || null
                })
                .select()
                .single();

            if (!error && book) {
                window.dispatchEvent(new CustomEvent('shelvd:book-added', {
                    detail: {
                        book,
                        coverUrl: book.cover || null,
                        digitalCoverUrl: book.digital_cover_url || digitalCoverUrl || null
                    }
                }));
                added++;
            }
        }
    }

    showProgress(`Added ${added} books` + (skipped > 0 ? `, skipped ${skipped} duplicates` : ''), 100);
    setTimeout(() => {
        closeIOModal();
        if (added > 0) window.location.reload();
    }, 1500);
});

// ─── Helpers ───
function getBookList() {
    const bookObjs = window.shelvdBookObjects || [];
    const cache = window.shelvdCoverCache || {};
    const getCoverCacheKey = window.shelvdGetCoverCacheKey || ((book) => {
        const isbn = normalizeIsbnToken(book?.isbn_13 || book?.isbn_10);
        if (isbn) return `edition:isbn:${isbn}`;
        return `edition:${[
            book?.title,
            book?.author,
            book?.publisher,
            book?.edition,
            book?.published_year,
            book?.format
        ].map((value) => String(value || '').trim().toLowerCase()).join('|')}`;
    });

    return bookObjs.map(b => {
        const bd = b.userData?.bookData || b;
        const cacheKey = getCoverCacheKey(bd);
        return {
            title: bd.title || '',
            author: bd.author || '',
            pages: bd.pages || 0,
            isbn_13: bd.isbn_13 || '',
            isbn_10: bd.isbn_10 || '',
            publisher: bd.publisher || '',
            published_year: bd.published_year || '',
            edition: bd.edition || '',
            language: bd.language || '',
            translator: bd.translator || '',
            format: bd.format || '',
            match_status: bd.match_status || '',
            coverUrl: bd.digital_cover_url || cache[cacheKey] || bd.cover || ''
        };
    });
}

function normalizeIsbnToken(value) {
    return String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
}

function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
