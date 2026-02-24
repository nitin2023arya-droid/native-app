// pdf.js

import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';

/* ================= LEDGER PARTICULAR ================= */
export function resolveLedgerParticular(e) {
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

/* ================= PDF EXPORT ================= */
export async function exportCustomerPDF(customerId) {
  const fromDate = document.getElementById('pdf-from')?.value;
  const toDate = document.getElementById('pdf-to')?.value;

  if (!toDate) {
    alert('Please select end date');
    return;
  }

  const from = fromDate ? new Date(fromDate) : null;
  const to = new Date(toDate);
  to.setHours(23, 59, 59);

  const doc = new jsPDF();

  const db = Storage.get();
  const customer = db.find(c => c.id === customerId);
  if (!customer) return;

  // 🔹 Your existing PDF generation logic remains unchanged
  // (headers, balances, ledger details, closing position, etc.)
  // Keep everything exactly as you have it until the final save step.

  // Instead of doc.save(), convert to Blob/Base64
  const pdfBlob = doc.output('blob');
  const reader = new FileReader();

  reader.onloadend = async () => {
    const base64Data = reader.result.split(',')[1]; // strip "data:application/pdf;base64,"

    try {
      const fileName = `${customer.name.replace(/\s+/g, '_')}_Account.pdf`;

      // Save PDF file to Android Documents directory
      await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
      });

      // Share PDF file via native share dialog
      await Share.share({
        title: 'Customer Account PDF',
        text: 'Here is your account statement',
        url: fileName,
        dialogTitle: 'Share PDF with',
      });

      alert('PDF exported successfully!');
    } catch (err) {
      console.error('PDF export failed', err);
      alert('PDF export failed: ' + err.message);
    }
  };

  reader.readAsDataURL(pdfBlob);

  ui.closeModal();
}