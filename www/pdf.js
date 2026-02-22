function resolveLedgerParticular(e) {
    const metal = e.metal || '';

    // 1. Round-off
    if (e.nature === 'Round-off') {
        return 'Round-off Adjustment';
    }

    // 2. Sauda Booking (pure booking, not delivery)
    if (e.nature === 'Sauda') {
        if (e.action === 'Purchase (IN)') {
            return `${metal} Purchase – Booked`;
        }
        if (e.action === 'Sale (OUT)') {
            return `${metal} Sale – Booked`;
        }
    }

    // 3. Physical – Weight only (no amount)
    if (e.nature === 'Physical' && (!e.amount || Number(e.amount) === 0)) {
        if (e.action === 'Purchase (IN)') {
            return `${metal} Received – Weight`;
        }
        if (e.action === 'Sale (OUT)') {
            return `${metal} Paid – Weight`;
        }
    }

    // 4. Physical – Actual delivery (amount present)
    if (e.nature === 'Physical' && Number(e.amount) > 0) {
        if (e.action === 'Purchase (IN)') {
            return `${metal} Purchase`;
        }
        if (e.action === 'Sale (OUT)') {
            return `${metal} Sale`;
        }
    }

    // 5. Paid / Settlement
    if (e.nature === 'Paid')  {
        if (e.action === 'Purchase (IN)') {
            return `${metal} Purchase – Booked Paid`;
        }
        if (e.action === 'Sale (OUT)') {
            return `${metal} Sale – Booked Paid`;
        }
    }

    if (e.nature === 'Settle') {
        return 'Sauda Settlement';
    } 

    // 6. Cash
    if (e.nature === 'Cash') {
        return e.type === 'Cash Paid'
            ? 'Cash Paid'
            : 'Cash Received';
    }

    // 7. Fallback (safe)
    return `${metal} ${e.action || e.type || ''}`.trim();
}

function exportCustomerPDF(customerId) {
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

    const filteredEntries = customer.entries.filter(e => {
        const d = new Date(e.date.split('/').reverse().join('-'));
        if (from && d < from) return false;
        return d <= to;
    });

    const snapshotCustomer = { ...customer, entries: filteredEntries };
    const bal = Engine.calculate(snapshotCustomer);

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

    /* ================= ACCOUNT SUMMARY ================= */

    // Compute opening cash balance (before the selected period)
    let openingCash = 0;
    if (fromDate && from) {
        const entriesBeforePeriod = customer.entries.filter(e => {
            const d = new Date(e.date.split('/').reverse().join('-'));
            return d < from;
        });
        const customerBeforePeriod = { ...customer, entries: entriesBeforePeriod };
        const balBeforePeriod = Engine.calculate(customerBeforePeriod);
        openingCash = balBeforePeriod.cash;
    } // else openingCash stays 0

    doc.setFontSize(12);
    doc.text('ACCOUNT SUMMARY', 10, y);
    y += 6;

    doc.setFontSize(10);
    doc.text(`Opening Cash Balance : Rs. ${Math.abs(openingCash).toLocaleString()} ${openingCash >= 0 ? 'Cr' : 'Dr'}`, 10, y);
    y += 5;

    doc.text(`Gold Balance   : ${(bal.gold.Premium + bal.gold.Mcx + bal.gold.Weight).toFixed(3)} gms`, 10, y);
    y += 5;

    doc.text(`Silver Balance : ${(bal.silver.Premium + bal.silver.Mcx + bal.silver.Weight).toFixed(3)} gms`, 10, y);
    y += 8;

    /* ================= PENDING SAUDA ================= */
    doc.setFontSize(12);
    doc.text('PENDING SAUDA', 10, y);
    y += 6;

    doc.setFontSize(9);
    doc.text('Date', 10, y);
    doc.text('Metal', 35, y);
    doc.text('Type', 65, y);
    doc.text('Booked (gms)', 95, y);
    doc.text('Pending (gms)', 130, y);
    doc.text('Bhav', 170, y);
    y += 4;

    doc.line(10, y, 200, y);
    y += 4;

    const pendingSauda = filteredEntries.filter(
        e => e.nature === 'Sauda' && ui.getSaudaPendingWeight(customer, e.id) > 0
    );

    if (!pendingSauda.length) {
        doc.text('No pending sauda', 10, y);
        y += 6;
    } else {
        pendingSauda.forEach(s => {
            const pending = ui.getSaudaPendingWeight(customer, s.id);

            doc.text(s.date, 10, y);
            doc.text(s.metal, 35, y);
            doc.text(s.action, 65, y);
            doc.text(`${Number(s.weight).toFixed(3)} gms`, 95, y);
            doc.text(`${pending.toFixed(3)} gms`, 130, y);
            doc.text(`Rs. ${s.bhav.toLocaleString()}`, 170, y);

            y += 5;
        });
    }

    y += 6;

    /* ================= LEDGER DETAILS ================= */
    doc.setFontSize(12);
    doc.text('LEDGER DETAILS (STATEMENT STYLE)', 10, y);
    y += 6;

    doc.setFontSize(9);
    doc.text('Date', 10, y);
    doc.text('Particulars', 32, y);
    doc.text('Weight (gms)', 78, y);
    doc.text('Final Bhav', 102, y);
    doc.text('Dr (Rs.)', 130, y);
    doc.text('Cr (Rs.)', 150, y);
    doc.text('Balance', 172, y);
    y += 4;

    doc.line(10, y, 200, y);
    y += 4;

    // Calculate opening balance by processing entries before the fromDate
    let runningCash = 0;
    
    // If we have a fromDate, we need to calculate the opening balance
    if (fromDate) {
        const entriesBeforePeriod = customer.entries.filter(e => {
            const d = new Date(e.date.split('/').reverse().join('-'));
            return d < from;
        });
        
        // Recreate customer with only entries before the period
        const customerBeforePeriod = { ...customer, entries: entriesBeforePeriod };
        const balBeforePeriod = Engine.calculate(customerBeforePeriod);
        runningCash = balBeforePeriod.cash;
    } else {
        // No fromDate, opening balance is 0
        runningCash = 0;
    }

    doc.text(fromDate || '-', 10, y);
    doc.text('Opening Balance', 32, y);
    doc.text('-', 78, y);
    doc.text('-', 102, y);
    doc.text('-', 130, y);
    doc.text('-', 150, y);
    doc.text(`Rs. ${Math.abs(runningCash).toLocaleString()} ${runningCash >= 0 ? 'Cr' : 'Dr'}`, 172, y);
    y += 5;

    // Sort entries by date for proper chronological order
    const sortedEntries = [...filteredEntries].sort((a, b) => {
        const dateA = new Date(a.date.split('/').reverse().join('-'));
        const dateB = new Date(b.date.split('/').reverse().join('-'));
        return dateA - dateB;
    });

    const finalCash = bal.cash;        // engine truth
    let cashSoFar = runningCash;       // ledger tracker
            
    sortedEntries.forEach(e => {

    let dr = '';
    let cr = '';
    let amount = 0;

    if (e.nature === 'Cash') {
        amount = Number(e.amount) || 0;
        if (e.type === 'Cash Paid') {
            cr = amount;
            cashSoFar += amount;
        } else if (e.type === 'Cash Received') {
            dr = amount;
            cashSoFar -= amount;
        }

    } else if (e.nature === 'Physical') {
        amount = Number(e.amount) || 0;
        if (e.action === 'Sale (OUT)') {
            cr = amount;
            cashSoFar += amount;
        } else if (e.action === 'Purchase (IN)') {
            dr = amount;
            cashSoFar -= amount;
        }

    } else if (e.nature === 'Paid') {
        amount = Number(e.amount) || 0;
        if (e.action === 'Purchase (IN)') {
            dr = amount;
            cashSoFar -= amount;
        } else {
            cr = amount;
            cashSoFar += amount;
        }

    } else if (e.nature === 'Settle') {
        amount = Number(e.amount) || 0;
        if (e.cashEffect?.includes('Cash CR')) {
            cr = amount;
            cashSoFar += amount;
        } else if (e.cashEffect?.includes('Cash DR')) {
            dr = amount;
            cashSoFar -= amount;
        }

 } else if (e.nature === 'Round-off') {

    const fine = Number(e.fine) || 0;
    const bhav = Number(e.bhav) || 0;
    const metalKey = (e.metal || '').toLowerCase().startsWith('s') ? 'silver' : 'gold';
    const divisor = metalKey === 'silver' ? 1000 : 10;

    // ✅ CORRECT: use ALL entries before this date
    const thisEntryDate = new Date(e.date.split('/').reverse().join('-'));
    const allEntriesBeforeThis = customer.entries.filter(entry => {
        const entryDate = new Date(entry.date.split('/').reverse().join('-'));
        return entryDate < thisEntryDate;
    });
    const tempCustomer = { ...customer, entries: allEntriesBeforeThis };
    const tempBal = Engine.calculate(tempCustomer);

    let stockBucket = 0;
    if (e.type === 'Weight+Premium') {
        stockBucket = tempBal[metalKey].Premium;
    } else if (e.type === 'Weight+MCX') {
        stockBucket = tempBal[metalKey].Mcx;
    } else {
        stockBucket = tempBal[metalKey].Weight;
    }

    if (stockBucket !== 0 && fine > 0 && bhav > 0) {
        let adjustment;
        if (stockBucket > 0) {
            adjustment = -Math.min(Math.abs(stockBucket), fine);
        } else {
            adjustment = Math.min(Math.abs(stockBucket), fine);
        }

        amount = Math.abs((Math.abs(adjustment) * bhav) / divisor);

        if (stockBucket > 0) {
            cr = amount;               // stock Dr → Cash Cr
            cashSoFar += amount;
        } else {
            dr = amount;               // stock Cr → Cash Dr
            cashSoFar -= amount;
        }
    }
}

    runningCash = cashSoFar;

   /* ---------- PDF ROW ---------- */
let particulars = resolveLedgerParticular(e);

doc.text(e.date, 10, y);
doc.text(particulars, 32, y);
doc.text(e.weight ? `${Number(e.weight).toFixed(3)} gms` : '', 78, y);
doc.text(e.bhav ? e.bhav.toString() : '', 102, y);
doc.text(dr ? dr.toLocaleString() : '', 130, y);
doc.text(cr ? cr.toLocaleString() : '', 150, y);
doc.text(
    `Rs. ${Math.abs(runningCash).toLocaleString()} ${runningCash >= 0 ? 'Cr' : 'Dr'}`,
    172,
    y
);

    y += 5;

    if (y > 270) {
        doc.addPage();
        y = 10;
    }
});

    /* ================= CLOSING POSITION ================= */
    y += 6;
    doc.setFontSize(12);
    doc.text(`CLOSING POSITION (As on ${toDate})`, 10, y);
    y += 6;

    doc.setFontSize(10);
    doc.text(`Cash Balance   : Rs. ${Math.abs(runningCash).toLocaleString()} ${runningCash >= 0 ? 'Cr' : 'Dr'}`,10,y);
    y += 5;
    doc.text(`Gold Balance   : ${(bal.gold.Premium + bal.gold.Mcx + bal.gold.Weight).toFixed(3)} gms`, 10, y);
    y += 5;
    doc.text(`Silver Balance : ${(bal.silver.Premium + bal.silver.Mcx + bal.silver.Weight).toFixed(3)} gms`, 10, y);

    y += 8;
    doc.setFontSize(9);
    doc.text('This is a computer-generated statement.', 105, y, { align: 'center' });

    const filename = `${customer.name.replace(/\s+/g, '_')}_Account.pdf`;

    // Check if running inside Capacitor native app
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        // Get PDF as blob and share
        const pdfBlob = doc.output('blob');
        sharePDF(pdfBlob, filename);
    } else {
        // Browser fallback: download PDF
        doc.save(filename);
        ui.closeModal();
    }
}

async function sharePDF(pdfBlob, filename) {
    try {
        const { Filesystem, Share } = Capacitor.Plugins;
        const { Directory } = Filesystem;  // Directory comes from Filesystem

        const reader = new FileReader();
        reader.onloadend = async function () {
            const base64 = reader.result.split(',')[1];

            const savedFile = await Filesystem.writeFile({
                path: filename,
                data: base64,
                directory: Directory.Cache,  // Now Directory is defined
            });

            await Share.share({
                title: 'Account Statement',
                text: 'Customer account statement',
                url: savedFile.uri,
                dialogTitle: 'Share via',
            });

            ui.closeModal();
        };
        reader.readAsDataURL(pdfBlob);
    } catch (error) {
        console.error('Error sharing PDF:', error);
        alert('Failed to share PDF: ' + error.message);
        ui.closeModal();
    }
}
