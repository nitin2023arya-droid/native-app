function resolveLedgerParticular(e) {
    const metal = e.metal || '';

    if (e.nature === 'Round-off') return 'Round-off Adjustment';

    if (e.nature === 'Sauda') {
        if (e.action === 'Purchase (IN)') return `${metal} Purchase – Booked`;
        if (e.action === 'Sale (OUT)') return `${metal} Sale – Booked`;
    }

    if (e.nature === 'Physical' && (!e.amount || Number(e.amount) === 0)) {
        if (e.action === 'Purchase (IN)') return `${metal} Received – Weight`;
        if (e.action === 'Sale (OUT)') return `${metal} Paid – Weight`;
    }

    if (e.nature === 'Physical' && Number(e.amount) > 0) {
        if (e.action === 'Purchase (IN)') return `${metal} Purchase`;
        if (e.action === 'Sale (OUT)') return `${metal} Sale`;
    }

    if (e.nature === 'Paid') {
        if (e.action === 'Purchase (IN)') return `${metal} Purchase – Booked Paid`;
        if (e.action === 'Sale (OUT)') return `${metal} Sale – Booked Paid`;
    }

    if (e.nature === 'Settle') return 'Sauda Settlement';

    if (e.nature === 'Cash') {
        return e.type === 'Cash Paid' ? 'Cash Paid' : 'Cash Received';
    }

    return `${metal} ${e.action || e.type || ''}`.trim();
}

/**
 * Returns all sauda entries that still have pending weight as of `asOfDate`.
 * @param {Object} customer - full customer object
 * @param {Date} asOfDate - cut‑off date (paid/settle entries after this are ignored)
 * @returns {Array} - array of { saudaEntry, pendingWeight }
 */
function getPendingSaudasAsOf(customer, asOfDate) {
    const pending = [];
    const allEntries = customer.entries || [];

    // Collect all sauda entries
    const saudaEntries = allEntries.filter(e => e.nature === 'Sauda');

    for (const sauda of saudaEntries) {
        const bookingWeight = parseFloat(sauda.weight) || 0;
        if (bookingWeight === 0) continue;

        // Find all paid/settle entries linked to this sauda with date <= asOfDate
        let totalPaid = 0;
        let totalSettled = 0;

        allEntries.forEach(entry => {
            if (entry.saudaId !== sauda.id) return;

            const entryDate = new Date(entry.date.split('/').reverse().join('-'));
            if (entryDate > asOfDate) return;

            if (entry.nature === 'Paid') {
                totalPaid += parseFloat(entry.weight) || 0;
            } else if (entry.nature === 'Settle') {
                totalSettled += parseFloat(entry.weight) || 0;
            }
        });

        const pendingWeight = bookingWeight - totalPaid - totalSettled;
        if (pendingWeight > 0) {
            pending.push({
                saudaEntry: sauda,
                pendingWeight: pendingWeight
            });
        }
    }
    return pending;
}

// Helper to convert Blob to base64 (required for Filesystem)
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function exportCustomerPDF(customerId) {

    const formatStock = (value) =>
        `${Math.abs(value).toFixed(3)} g ${value >= 0 ? 'Cr' : 'Dr'}`;

    const fromDate = document.getElementById('pdf-from')?.value;
    const toDate = document.getElementById('pdf-to')?.value;

    if (!toDate) {
        alert('Please select end date');
        return;
    }

    const from = fromDate ? new Date(fromDate) : null;
    const to = new Date(toDate);
    to.setHours(23, 59, 59);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const db = Storage.get();
    const customer = db.find(c => c.id === customerId);
    if (!customer) return;

    // ---- Filter entries for the ledger (only those inside the period) ----
    const filteredEntries = customer.entries.filter(e => {
        const d = new Date(e.date.split('/').reverse().join('-'));
        if (from && d < from) return false;
        return d <= to;
    });

    let y = 10;

    /* ================= HEADER ================= */

    doc.setFontSize(12);
    doc.text('FIRM NAME', 105, y, { align: 'center' });
    y += 6;

    doc.setFontSize(14);
    doc.text('Bullion Account Statement', 105, y, { align: 'center' });
    y += 8;

    doc.setFontSize(10);
    doc.text(`Customer : ${customer.name}`, 10, y);
    doc.text(`Period   : ${fromDate || 'Start'} to ${toDate}`, 120, y);
    y += 6;

    doc.line(10, y, 200, y);
    y += 6;

    /* ================= OPENING BALANCE ================= */

    let openingCash = 0;
    let openingGold = 0;
    let openingSilver = 0;

    if (fromDate && from) {
        const entriesBeforePeriod = customer.entries.filter(e => {
            const d = new Date(e.date.split('/').reverse().join('-'));
            return d < from;
        });

        const balBefore = Engine.calculate({ ...customer, entries: entriesBeforePeriod });

        openingCash = balBefore.cash;
        openingGold = balBefore.gold.Premium + balBefore.gold.Mcx + balBefore.gold.Weight;
        openingSilver = balBefore.silver.Premium + balBefore.silver.Mcx + balBefore.silver.Weight;
    }

    doc.setFontSize(12);
    doc.text('OPENING BALANCE', 10, y);
    y += 6;

    doc.setFontSize(10);
    doc.text(
        `Opening Cash Balance : Rs. ${Math.abs(openingCash).toLocaleString()} ${openingCash >= 0 ? 'Cr' : 'Dr'}`,
        10,
        y
    );
    y += 5;

    doc.text(`Opening Gold Balance : ${formatStock(openingGold)}`, 10, y);
    y += 5;

    doc.text(`Opening Silver Balance : ${formatStock(openingSilver)}`, 10, y);
    y += 8;

    /* ================= PENDING SAUDA / CONTRACTS ================= */

    const pendingSaudas = getPendingSaudasAsOf(customer, to);

    if (pendingSaudas.length > 0) {
        // Check space, maybe new page if needed
        if (y > 220) {
            doc.addPage();
            y = 20;
        }

        doc.setFontSize(12);
        doc.text('PENDING SAUDA / CONTRACTS', 10, y);
        y += 6;

        doc.setFontSize(9);
        doc.text('Date', 10, y);
        doc.text('Metal', 35, y);
        doc.text('Action', 55, y);
        doc.text('Book Wt (g)', 85, y);
        doc.text('Pending (g)', 115, y);
        doc.text('Book Bhav', 145, y);
        y += 4;

        doc.line(10, y, 200, y);
        y += 4;

        pendingSaudas.forEach(({ saudaEntry: s, pendingWeight }) => {
            // Check page break
            if (y > 270) {
                doc.addPage();
                y = 20;
            }

            const action = s.action === 'Purchase (IN)' ? 'Buy' : 'Sell';
            doc.text(s.date, 10, y);
            doc.text(s.metal || 'Gold', 35, y);
            doc.text(action, 55, y);
            doc.text((s.weight || 0).toFixed(3), 85, y);
            doc.text(pendingWeight.toFixed(3), 115, y);
            doc.text((s.bhav || 0).toString(), 145, y);

            y += 5;
        });

        y += 6;
        doc.line(10, y - 4, 200, y - 4);
    }

    /* ================= LEDGER ================= */

    doc.setFontSize(12);
    doc.text('LEDGER DETAILS (STATEMENT STYLE)', 10, y);
    y += 6;

    doc.setFontSize(9);
    doc.text('Date', 10, y);
    doc.text('Particulars', 32, y);
    doc.text('Weight', 78, y);
    doc.text('Bhav', 102, y);
    doc.text('Dr', 130, y);
    doc.text('Cr', 150, y);
    doc.text('Balance', 172, y);
    y += 4;

    doc.line(10, y, 200, y);
    y += 4;

    // ---- Opening line ----
    doc.text(fromDate || '-', 10, y);
    doc.text('Opening Balance', 32, y);
    doc.text(
        `Rs. ${Math.abs(openingCash).toLocaleString()} ${openingCash >= 0 ? 'Cr' : 'Dr'}`,
        172,
        y
    );
    y += 4;

    doc.line(10, y - 2, 200, y - 2);
    y += 2;

    const openingMetalLine =
        `Gold: ${formatStock(openingGold)}        ` +
        `Silver: ${formatStock(openingSilver)}`;
    doc.text(openingMetalLine, 200, y, { align: 'right' });
    y += 4;
    doc.line(10, y - 2, 200, y - 2);
    y += 10;

    // ---- Running balances (using full customer history) ----
    const runningBalances = Engine.calculateRunningBalances(customer);
    const balanceMap = {};
    runningBalances.forEach(b => balanceMap[b.entryId] = b.fullBalance);

    const sortedEntries = [...filteredEntries].sort((a, b) =>
        new Date(a.date.split('/').reverse().join('-')) -
        new Date(b.date.split('/').reverse().join('-'))
    );

    let cashBefore = openingCash;
    let lastAfter = null; // will hold the full balance after the last entry

    sortedEntries.forEach(e => {
        const cashAfter = balanceMap[e.id]?.cash ?? cashBefore;
        const delta = cashAfter - cashBefore;

        let dr = '';
        let cr = '';
        if (delta > 0) {
            dr = delta;
        } else if (delta < 0) {
            cr = -delta;
        }

        doc.text(e.date, 10, y);
        doc.text(resolveLedgerParticular(e), 32, y);
        doc.text(e.weight ? `${Number(e.weight).toFixed(3)} g` : '', 78, y);
        doc.text(e.bhav ? e.bhav.toString() : '', 102, y);
        doc.text(dr ? dr.toLocaleString() : '', 130, y);
        doc.text(cr ? cr.toLocaleString() : '', 150, y);
        doc.text(
            `Rs. ${Math.abs(cashAfter).toLocaleString()} ${cashAfter >= 0 ? 'Cr' : 'Dr'}`,
            172,
            y
        );

        y += 4;

        const after = balanceMap[e.id];
        if (after) {
            lastAfter = after; // keep the most recent after object
            const goldTotal = after.gold.Premium + after.gold.Mcx + after.gold.Weight;
            const silverTotal = after.silver.Premium + after.silver.Mcx + after.silver.Weight;

            doc.line(10, y - 2, 200, y - 2);
            y += 2;
            const metalLine =
                `Gold: ${formatStock(goldTotal)}        ` +
                `Silver: ${formatStock(silverTotal)}`;
            doc.text(metalLine, 200, y, { align: 'right' });
            y += 4;
            doc.line(10, y - 2, 200, y - 2);
            y += 10;
        }

        cashBefore = cashAfter;

        if (y > 270) {
            doc.addPage();
            y = 20;
        }
    });

    /* ================= CLOSING ================= */

    y += 6;
    doc.setFontSize(12);
    doc.text(`CLOSING POSITION (As on ${toDate})`, 10, y);
    y += 6;

    // Use lastAfter for stock balances; if no entries, use opening balances
    let closingGold, closingSilver;
    if (lastAfter) {
        closingGold = lastAfter.gold.Premium + lastAfter.gold.Mcx + lastAfter.gold.Weight;
        closingSilver = lastAfter.silver.Premium + lastAfter.silver.Mcx + lastAfter.silver.Weight;
    } else {
        closingGold = openingGold;
        closingSilver = openingSilver;
    }

    doc.setFontSize(10);

    doc.text(
        `Cash Balance   : Rs. ${Math.abs(cashBefore).toLocaleString()} ${cashBefore >= 0 ? 'Cr' : 'Dr'}`,
        10,
        y
    );
    y += 5;

    doc.text(`Gold Balance   : ${formatStock(closingGold)}`, 10, y);
    y += 5;

    doc.text(`Silver Balance : ${formatStock(closingSilver)}`, 10, y);

    y += 8;
    doc.setFontSize(9);
    doc.text('This is a computer-generated statement.', 105, y, { align: 'center' });

    // ========== CAPACITOR‑FRIENDLY SAVE ==========
    const fileName = `${customer.name.replace(/\s+/g, '_')}_Account.pdf`;
    const pdfBlob = doc.output('blob');

    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const base64 = await blobToBase64(pdfBlob);
            const { Filesystem } = window.Capacitor.Plugins;
            await Filesystem.writeFile({
                path: fileName,
                data: base64,
                directory: 'DOCUMENTS'   // Works with Capacitor 6
            });
            alert(`PDF saved to Documents/${fileName}`);
        } catch (error) {
            console.error('PDF export failed', error);
            alert('PDF export failed: ' + error.message);
        }
    } else {
        // Fallback for browser (development)
        doc.save(fileName);
    }

    ui.closeModal();
}