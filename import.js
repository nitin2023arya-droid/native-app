function importData(file) {
    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            const imported = JSON.parse(e.target.result);

            if (!Array.isArray(imported)) {
                alert('Invalid backup file');
                return;
            }

            const existing = Storage.get();

            // Build map of existing customers
            const customerMap = new Map(existing.map(c => [c.id, c]));

            imported.forEach(impCust => {
                if (!customerMap.has(impCust.id)) {
                    // New customer → add
                    customerMap.set(impCust.id, impCust);
                } else {
                    // Existing customer → merge entries
                    const curr = customerMap.get(impCust.id);
                    const entryIds = new Set(curr.entries.map(e => e.id));

                    impCust.entries.forEach(entry => {
                        if (!entryIds.has(entry.id)) {
                            curr.entries.push(entry);
                        }
                    });
                }
            });

            const merged = Array.from(customerMap.values());

            if (!confirm(
                `Import summary:\n` +
                `• Existing customers: ${existing.length}\n` +
                `• Imported customers: ${imported.length}\n` +
                `• Final customers: ${merged.length}\n\n` +
                `Continue import?`
            )) {
                return;
            }

            Storage.save(merged);
            ui.view = 'dashboard';
            ui.render();

            alert('Import completed successfully');
        } catch (err) {
            alert('Invalid JSON file');
        }
    };

    reader.readAsText(file);
}