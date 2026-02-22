ui.openPdfModal = function (customerId) {
    const m = document.getElementById('modal-container');
    m.classList.remove('hidden');

    const today = new Date().toISOString().split('T')[0];

    m.innerHTML = `
        <div class="modal" style="max-width:350px;">
            <h3>Share Account PDF</h3>

            <label>From Date</label>
            <input type="date" id="pdf-from">

            <label>To Date</label>
            <input type="date" id="pdf-to" value="${today}">

            <div class="flex gap-1" style="margin-top:15px">
                <button class="btn btn-s" onclick="ui.closeModal()">Cancel</button>
                <button class="btn btn-p" onclick="exportCustomerPDF('${customerId}')">
                    Generate PDF
                </button>
            </div>
        </div>
    `;
};