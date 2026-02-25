// export.js

/**
 * Exports localStorage data to a JSON file in the Android Documents folder.
 * Compatible with Capacitor 6.
 */
export async function exportData() {
    try {
        // 1. Ensure we have access to the Filesystem and Toast plugins
        // If not using a bundler, these are accessed via Capacitor.Plugins
        const Filesystem = window.Capacitor?.Plugins?.Filesystem;
        const Toast = window.Capacitor?.Plugins?.Toast;

        if (!Filesystem) {
            throw new Error("Filesystem plugin not found. Run 'npx cap sync'.");
        }

        // 2. Retrieve data from localStorage
        // Note: Using 'Storage.KEY' assumes 'Storage' is a globally defined object.
        // If it fails, replace with your literal key string, e.g., 'bullion_data'
        const data = localStorage.getItem(typeof Storage !== 'undefined' ? Storage.KEY : 'bullion_db');

        if (!data) {
            alert('No data to export');
            return;
        }

        // 3. Request Permissions (Required for Capacitor 6 on Android)
        const check = await Filesystem.checkPermissions();
        if (check.publicStorage !== 'granted') {
            const request = await Filesystem.requestPermissions();
            if (request.publicStorage !== 'granted') {
                alert('Storage permission denied. Cannot save backup.');
                return;
            }
        }

        const fileName = `bullion_pro_backup_${Date.now()}.json`;

        // 4. Write the file
        await Filesystem.writeFile({
            path: fileName,
            data: data,
            directory: 'DOCUMENTS', // Using string constant 'DOCUMENTS' is more resilient
            encoding: 'utf8',
            recursive: true
        });

        // 5. Notify the user
        if (Toast) {
            await Toast.show({
                text: `Backup saved: ${fileName}`,
                duration: 'long'
            });
        } else {
            alert('Backup saved to Documents folder');
        }

    } catch (error) {
        console.error('Export failed:', error);
        alert('Export failed: ' + error.message);
    }
}

// Attach to window so it's callable from HTML onclick attributes
window.exportData = exportData;
