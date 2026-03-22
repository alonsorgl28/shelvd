// ─── Import/Export for Shelvd ───

const ioModal = document.getElementById('io-modal');
const ioProgress = document.getElementById('io-progress');
const ioProgressText = document.getElementById('io-progress-text');
const ioProgressFill = document.getElementById('io-progress-fill');
const ioImportInput = document.getElementById('io-import-input');

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

// ─── UI Wiring ───
document.getElementById('io-btn').addEventListener('click', openIOModal);
document.getElementById('io-backdrop').addEventListener('click', closeIOModal);
document.getElementById('io-close').addEventListener('click', closeIOModal);

// ─── Export to Excel ───
document.getElementById('io-export-excel').addEventListener('click', async () => {
    showProgress('Preparing Excel...', 10);

    const books = getBookList();
    const rows = books.map(b => ({
        Title: b.title,
        Author: b.author,
        Pages: b.pages || '',
        'Cover URL': b.coverUrl || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    // Column widths
    ws['!cols'] = [{ wch: 40 }, { wch: 30 }, { wch: 8 }, { wch: 60 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Library');

    showProgress('Generating file...', 80);

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `shelvd-library-${today}.xlsx`);

    showProgress('Done!', 100);
    setTimeout(closeIOModal, 800);
});

// ─── Export to Word (.docx as HTML) ───
document.getElementById('io-export-word').addEventListener('click', async () => {
    showProgress('Preparing Word document...', 10);

    const books = getBookList();
    const today = new Date().toISOString().slice(0, 10);

    // Build HTML content for the Word doc
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
            ? `<img class="cover" src="${b.coverUrl}" alt="${b.title}">`
            : `<div class="cover" style="background:#ddd;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">${b.title}</div>`;
        html += `<tr>
            <td style="width:100px">${coverHtml}</td>
            <td>
                <div class="title">${b.title}</div>
                <div class="author">${b.author}</div>
                <div class="pages">${b.pages ? b.pages + ' pages' : ''}</div>
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

// ─── Import from Excel ───
document.getElementById('io-import-excel').addEventListener('click', () => {
    ioImportInput.click();
});

ioImportInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    ioImportInput.value = '';

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

    // Detect column names (flexible: Title/title/título, Author/author/autor, etc.)
    const sample = rows[0];
    const keys = Object.keys(sample);
    const titleKey = keys.find(k => /^(title|t[ií]tulo|libro|book)$/i.test(k));
    const authorKey = keys.find(k => /^(author|autor|writer)$/i.test(k));
    const pagesKey = keys.find(k => /^(pages|p[áa]ginas|pags?)$/i.test(k));

    if (!titleKey) {
        showProgress('Could not find a "Title" column', 100);
        setTimeout(closeIOModal, 2000);
        return;
    }

    // Get existing books to deduplicate
    const existingBooks = getBookList();
    const existingKeys = new Set(existingBooks.map(b => `${b.title.toLowerCase()}|${b.author.toLowerCase()}`));

    const sb = window.shelvdAuth?.supabase;
    const session = sb ? (await sb.auth.getSession()).data.session : null;

    let added = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const title = String(row[titleKey] || '').trim();
        const author = String(row[authorKey] || row[keys.find(k => k !== titleKey && typeof row[k] === 'string')] || 'Unknown').trim();
        const pages = parseInt(row[pagesKey]) || 250;

        if (!title) { skipped++; continue; }

        const key = `${title.toLowerCase()}|${author.toLowerCase()}`;
        if (existingKeys.has(key)) { skipped++; continue; }
        existingKeys.add(key);

        showProgress(`Importing ${i + 1}/${rows.length}...`, 10 + (i / rows.length * 85));

        // Insert into Supabase if authenticated
        if (sb && session) {
            const { data: book, error } = await sb
                .from('books')
                .insert({ user_id: session.user.id, title, author, pages })
                .select()
                .single();

            if (!error && book) {
                window.dispatchEvent(new CustomEvent('shelvd:book-added', {
                    detail: { book, coverUrl: null }
                }));
                added++;
            }
        }
    }

    showProgress(`Done! Added ${added} books, skipped ${skipped} duplicates.`, 100);
    setTimeout(() => {
        closeIOModal();
        if (added > 0) window.location.reload();
    }, 1500);
});

// ─── Helper: Get book list with cover URLs ───
function getBookList() {
    // Access bookObjects from app.js (it's a module-level var, exposed on window)
    const bookObjs = window.shelvdBookObjects || [];
    const cache = window.shelvdCoverCache || {};

    return bookObjs.map(b => {
        const bd = b.userData?.bookData || b;
        const cacheKey = `${bd.title}|${bd.author}`;
        return {
            title: bd.title || '',
            author: bd.author || '',
            pages: bd.pages || 0,
            coverUrl: cache[cacheKey] || bd.cover || ''
        };
    });
}
